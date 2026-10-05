
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai";
import { AI_MODELS } from "../_shared/models.ts";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

// Server-enforced farming bounds (per user, per server day). Attempt quota is
// INDEPENDENT of verification outcome: garbage burns quota too.
const MAX_AI_ATTEMPTS_PER_DAY = 10;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * INTERNAL webhook processor — NOT an end-user endpoint.
 *
 * Trust model (explicit):
 *  - Triggered by the Database Webhook on price_reports INSERT, which must send
 *    the shared secret in the `x-webhook-secret` header (configured in the
 *    Supabase dashboard; value stored as VERIFY_PRICE_WEBHOOK_SECRET).
 *  - The browser NEVER invokes this function to mint rewards (no client helper).
 *  - Payload fields are untrusted hints only: the report row is always reloaded
 *    from the DB and status/ownership/data come from that authoritative row.
 *  - End-user JWTs are deliberately NOT used here — webhook auth and user auth
 *    are separate concerns and must not be mixed.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const expectedSecret = Deno.env.get('VERIFY_PRICE_WEBHOOK_SECRET');
    const providedSecret = req.headers.get('x-webhook-secret');
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = await req.json();
    const hintedId = payload?.record?.id;
    if (!hintedId) {
      return new Response(JSON.stringify({ error: 'missing record id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Authoritative reload — payload is a hint, the DB row is the truth.
    const { data: record, error: rowError } = await supabase
      .from('price_reports')
      .select('*')
      .eq('id', hintedId)
      .single();

    if (rowError || !record) {
      return new Response(JSON.stringify({ error: 'report not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Defense in depth: the proof file must live under the reporter's own folder
    // (upload RLS already enforces this; the check here closes confused-deputy paths).
    if (typeof record.proof_image_url !== 'string' ||
        !record.proof_image_url.startsWith(`${record.user_id}/`)) {
      return new Response(JSON.stringify({ error: 'proof ownership mismatch' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (typeof record.item_name !== 'string' || record.item_name.trim() === '') {
      await supabase.rpc('finalize_price_verification', {
        px_report_id: record.id, px_verified: false, px_confidence: 0,
      });
      return new Response(JSON.stringify({ success: true, final: { status: 'rejected' } }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Order below is deliberate and cost-ordered (cheapest first):
    //  1. download + hash (no AI) → 2. same-proof dup check (no AI, no quota)
    //  3. atomic claim RPC (quota + pending gate) → 4. Gemini → 5. finalize.
    //  A duplicate proof is rejected BEFORE quota is consumed. A concurrent
    //  same-proof race collapses on uq_price_proof_per_user: the loser throws,
    //  the webhook retries, and the retry finds the winner's hash → rejected.
    //  No path reaches Gemini twice for one proof, and no DB error is ignored.

    // ۱. دانلود تصویر از استوریج
    const { data: fileData } = await supabase.storage
      .from('price_proofs')
      .download(record.proof_image_url);

    if (!fileData) throw new Error("File not found");

    const arrayBuffer = await fileData.arrayBuffer();
    const proofHash = await sha256Hex(arrayBuffer);

    // Same-proof reuse: byte-identical proof already submitted by this user
    // (pending or verified) earns nothing twice. No Gemini call for dupes.
    const { data: dupes } = await supabase
      .from('price_reports')
      .select('id')
      .eq('user_id', record.user_id)
      .eq('proof_hash', proofHash)
      .neq('id', record.id)
      .in('ai_verification_status', ['pending', 'verified'])
      .limit(1);
    const { error: hashError } = await supabase.from('price_reports').update({ proof_hash: proofHash }).eq('id', record.id);
    if (hashError) {
      // Almost certainly the unique rail firing under a concurrent same-proof
      // race: another worker claimed this hash first. Never ignore it — treat
      // as duplicate (fail closed, no Gemini, no quota consumed).
      await supabase.rpc('finalize_price_verification', {
        px_report_id: record.id, px_verified: false, px_confidence: 0,
      });
      return new Response(JSON.stringify({ success: true, final: { status: 'rejected', reason: 'duplicate-proof-race' } }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (dupes && dupes.length > 0) {
      await supabase.rpc('finalize_price_verification', {
        px_report_id: record.id, px_verified: false, px_confidence: 0,
      });
      return new Response(JSON.stringify({ success: true, final: { status: 'rejected', reason: 'duplicate-proof' } }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Atomic pre-AI claim: serializes concurrent webhooks for THIS report and
    // enforces the daily AI-attempt quota. Refusal here means NO model call.
    const { data: claim, error: claimError } = await supabase.rpc('claim_price_attempt', {
      px_report_id: record.id,
      px_max_attempts_per_day: MAX_AI_ATTEMPTS_PER_DAY,
    });
    if (claimError) throw claimError;
    if (!claim?.ok) {
      return new Response(JSON.stringify({ success: true, final: { status: 'rejected', reason: claim?.reason || 'claim-refused' } }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const base64Image = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

    // ۲. تحلیل بصری با Gemini
    const ai = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY')! });
    const response = await ai.models.generateContent({
      model: AI_MODELS.PRICE_VERIFY,
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
          { text: `Check if the price for '${record.item_name}' is clearly visible and matches '${record.reported_price}'. Output verified (true/false) and confidence.` }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            verified: { type: Type.BOOLEAN },
            confidence: { type: Type.NUMBER }
          },
          required: ["verified", "confidence"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");

    // ۳. finalize اتمیک سمت دیتابیس (verdict + reward در یک تراکنش، retry-safe).
    const { data: final, error: finalizeError } = await supabase.rpc('finalize_price_verification', {
      px_report_id: record.id,
      px_verified: result.verified === true && (result.confidence ?? 0) > 0.8,
      px_confidence: result.confidence ?? null,
    });

    if (finalizeError) throw finalizeError;

    return new Response(JSON.stringify({ success: true, final }));
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

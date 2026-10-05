
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

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

    // ۱. دانلود تصویر از استوریج
    const { data: fileData } = await supabase.storage
      .from('price_proofs')
      .download(record.proof_image_url);

    if (!fileData) throw new Error("File not found");

    const arrayBuffer = await fileData.arrayBuffer();
    const base64Image = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

    // ۲. تحلیل بصری با Gemini
    const ai = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY')! });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
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


import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai";
import { AI_MODELS } from "../_shared/models.ts";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // استخراج امن هویت کاربر از JWT (جلوگیری از جعل)
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error("Unauthorized");

    const { imagePath } = await req.json();
    if (typeof imagePath !== 'string' || !imagePath) throw new Error("Missing imagePath");

    // مالکیت فایل: path باید زیر پوشه خود کاربر باشد، وگرنه service role دانلود نمی‌کند.
    // (پالیسی آپلود همین ساختار را enforce می‌کند؛ این چک confused-deputy را می‌بندد.)
    if (!imagePath.startsWith(`${user.id}/`)) throw new Error("Forbidden: ticket ownership mismatch");

    // Atomic pre-AI claim (single gate for quota, duplicates, cooldown, retries).
    // Parallel same-ticket requests collapse here: exactly ONE proceeds to AI.
    const { data: claim, error: claimError } = await supabase.rpc('claim_ticket_attempt', {
      px_user_id: user.id,
      px_image_path: imagePath,
    });
    if (claimError) throw claimError;
    if (!claim?.ok) {
      if (claim?.reason === 'duplicate' && claim?.trip_id) {
        const { data: existing } = await supabase
          .from('trips')
          .select()
          .eq('id', claim.trip_id)
          .maybeSingle();
        if (existing) {
          return new Response(JSON.stringify({ success: true, data: existing, duplicate: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        // Receipt points nowhere (trip deleted): fall through and reprocess
        // under a fresh claim is impossible here (row exists) — treat as failed
        // terminal for this path and let a future reclaim handle it.
      }
      const status = claim?.reason === 'capped' || claim?.reason === 'cooldown' ? 429 : 409;
      return new Response(JSON.stringify({ error: claim?.reason || 'claim-refused' }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const tripId = claim.trip_id as string;

    // ۱. دانلود تصویر (failure -> bounded-retry bookkeeping, then 500).
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('tickets')
      .download(imagePath);

    if (downloadError || !fileData) {
      await supabase.rpc('fail_ticket_attempt', { px_user_id: user.id, px_image_path: imagePath });
      throw new Error("Image download failed");
    }

    const base64Image = btoa(new Uint8Array(await fileData.arrayBuffer())
      .reduce((data, byte) => data + String.fromCharCode(byte), ''));

    // ۲. پردازش با Gemini (failure -> bounded-retry bookkeeping, then 500).
    const ai = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY')! });
    let response;
    try {
      response = await ai.models.generateContent({
        model: AI_MODELS.TICKET_OCR,
        contents: {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
            { text: "Analyze this travel document. Extract details: type (flight/hotel/activity), title, time (HH:MM), date (YYYY-MM-DD), and address. Return JSON." }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, enum: ['flight', 'hotel', 'activity', 'food'] },
              title: { type: Type.STRING },
              time: { type: Type.STRING },
              date: { type: Type.STRING },
              address: { type: Type.STRING }
            },
            required: ["type", "title", "date"]
          }
        }
      });

    } catch (aiErr) {
      await supabase.rpc('fail_ticket_attempt', { px_user_id: user.id, px_image_path: imagePath });
      throw aiErr;
    }

    const ticketData = JSON.parse(response.text || "{}");

    // ۳. ثبت در دیتابیس با trip id قطعی claim (insert idempotent: retryها ردیف تکراری نمی‌سازند).
    const { error: insertError } = await supabase
      .from('trips')
      .upsert({
        id: tripId,
        user_id: user.id,
        type: ticketData.type,
        title: ticketData.title,
        start_time: `${ticketData.date}T${ticketData.time || '00:00'}:00`,
        details: { address: ticketData.address },
        status: 'upcoming'
      }, { onConflict: 'id', ignoreDuplicates: true });
    if (insertError) {
      await supabase.rpc('fail_ticket_attempt', { px_user_id: user.id, px_image_path: imagePath });
      throw insertError;
    }

    const { data: trip } = await supabase
      .from('trips')
      .select()
      .eq('id', tripId)
      .single();

    await supabase.rpc('complete_ticket_attempt', {
      px_user_id: user.id,
      px_image_path: imagePath,
      px_trip_id: tripId,
    });

    return new Response(JSON.stringify({ success: true, data: trip }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

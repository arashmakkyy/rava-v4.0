
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

    // ۱. دانلود تصویر
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('tickets')
      .download(imagePath);

    if (downloadError) throw new Error("Image download failed");

    const base64Image = btoa(new Uint8Array(await fileData.arrayBuffer())
      .reduce((data, byte) => data + String.fromCharCode(byte), ''));

    // ۲. پردازش با Gemini 3 Flash
    const ai = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY')! });
    const response = await ai.models.generateContent({
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

    const ticketData = JSON.parse(response.text || "{}");

    // ۳. ثبت در دیتابیس برای کاربر تایید شده
    const { data: trip, error: insertError } = await supabase
      .from('trips')
      .insert({
        user_id: user.id,
        type: ticketData.type,
        title: ticketData.title,
        start_time: `${ticketData.date}T${ticketData.time || '00:00'}:00`,
        details: { address: ticketData.address },
        status: 'upcoming'
      })
      .select().single();

    if (insertError) throw insertError;

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

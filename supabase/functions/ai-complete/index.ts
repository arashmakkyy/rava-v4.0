import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_PROXY_CALLS_PER_DAY = 100;
const MAX_STR = 500;
const MAX_JSON_BYTES = 8000;

const clip = (v: unknown, max = MAX_STR): string => String(v ?? '').slice(0, max);

/**
 * Authenticated generic proxy for non-Live Gemini calls.
 *
 * Trust model (explicit):
 *  - Caller authenticates with their own Supabase JWT; per-user daily quota
 *    enforced via consume_proxy_call (server-derived, unbypassable).
 *  - The task allowlist below is exhaustive: prompts live SERVER-SIDE.
 *    The client sends ONLY structured data (task + fields) — never prompt text.
 *  - Inputs are clipped server-side (length caps) before reaching the model.
 *
 * This function (plus mint-live-token) is why the browser bundle carries NO
 * Gemini credential at all.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: allowed, error: quotaError } = await supabase.rpc('consume_proxy_call', {
      px_max_per_day: MAX_PROXY_CALLS_PER_DAY,
    });
    if (quotaError) throw quotaError;
    if (allowed !== true) {
      return new Response(JSON.stringify({ error: 'daily AI quota reached' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const task = body?.task as string | undefined;
    const p = (body?.payload ?? {}) as Record<string, unknown>;

    const ai = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY')! });
    let text = '';

    if (task === 'bargain_verdict') {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `به عنوان "راوا" (دستیار توریست ایرانی)، این قیمت رو کارشناسی کن:
        آیتم: ${clip(p.item, 100)}
        قیمت اعلامی فروشنده: ${clip(p.price, 32)} ${clip(p.currency, 16)}
        شهر: ${clip(p.city, 32)}
        سبک سفر کاربر: ${clip(p.vibe, 32)}

        بگو آیا می‌ارزه؟ قیمت منصفانه (fair_price) چنده؟
        لحن: صمیمی و محافظ جیب مسافر.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              status: { type: Type.STRING, enum: ['good', 'bad', 'neutral'] },
              fair_price: { type: Type.NUMBER },
              message: { type: Type.STRING },
            },
            required: ['status', 'fair_price', 'message'],
          },
        },
      });
      text = response.text || '{}';
    } else if (task === 'daily_plan') {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `به عنوان راوا، برای امروز من در ${clip(p.city, 32)} یک برنامه سفر باحال بچین.
        موقعیت فعلی من: ${clip(p.location, 64)}
        برنامه شامل: صبح، ناهار، عصر و شب.
        خروجی فقط و فقط JSON باشد.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              morning: { type: Type.STRING },
              lunch: { type: Type.STRING },
              afternoon: { type: Type.STRING },
              evening: { type: Type.STRING },
            },
            required: ['morning', 'lunch', 'afternoon', 'evening'],
          },
        },
      });
      text = response.text || '{}';
    } else if (task === 'recap_summary') {
      const facts = JSON.stringify(p.facts ?? {}).slice(0, MAX_JSON_BYTES);
      const { RECAP_PROMPT } = await import('./recap-prompt.ts');
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: `DAILY FACTS (JSON):\n${facts}`,
        config: {
          systemInstruction: RECAP_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
              tomorrow_hint: { type: Type.STRING },
              passport_item: { type: Type.STRING },
            },
            required: ['summary', 'highlights', 'tomorrow_hint', 'passport_item'],
          },
        },
      });
      text = response.text || '{}';
    } else if (task === 'vibe_check') {
      const reviews = Array.isArray(p.reviews) ? p.reviews.slice(0, 5) : [];
      const reviewText = reviews.map((r) => clip((r as any)?.text ?? '', 500)).join('\n');
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `تحلیلگر Vibe مکان (راوا): این نظرات را بخوان و اتمسفر مکان را در یک پاراگراف کوتاه (حداکثر ۲ جمله) به زبان فارسی صمیمی خلاصه کن:\n\n${reviewText}`,
        config: { temperature: 0.7 },
      });
      text = response.text || '';
    } else {
      return new Response(JSON.stringify({ error: 'unknown task' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'ai-complete failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

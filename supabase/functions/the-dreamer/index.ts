
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

  // INTERNAL nightly job — never triggerable by an ordinary user JWT.
  // The scheduler/caller must send the shared job secret (THE_DREAMER_JOB_SECRET).
  // verify_jwt is OFF for this function (see supabase/config.toml) precisely
  // because no user identity is involved; this header check IS the auth boundary.
  try {
    const expectedSecret = Deno.env.get('THE_DREAMER_JOB_SECRET');
    const providedSecret = req.headers.get('x-job-secret');
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // یافتن کاربرانی که در ۲۴ ساعت اخیر چت کرده‌اند و خلاصه‌سازی نشده‌اند
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: activeUsers } = await supabase
      .from('profiles')
      .select('id, semantic_profile')
      .or(`last_summary_at.lt.${yesterday},last_summary_at.is.null`)
      .limit(5);

    if (!activeUsers) return new Response(JSON.stringify({ message: "No active users to process." }));

    const ai = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY')! });

    for (const user of activeUsers) {
      // دریافت ۳۰ پیام آخر کاربر
      const { data: logs } = await supabase
        .from('chat_logs')
        .select('role, content')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (!logs || logs.length < 5) continue;

      const chatString = logs.reverse().map(l => `${l.role}: ${l.content}`).join('\n');

      const response = await ai.models.generateContent({
        model: AI_MODELS.DREAMER,
        contents: `Based on the following chat history, update the user travel profile. 
        Focus on: likes, dislikes, energy level, and budget sensitivity.
        History:
        ${chatString}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              travel_style: { type: Type.STRING },
              food_preferences: { type: Type.ARRAY, items: { type: Type.STRING } },
              energy_level: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
              budget_sensitivity: { type: Type.STRING, enum: ['low', 'medium', 'high'] }
            }
          }
        }
      });

      const updatedProfile = JSON.parse(response.text || "{}");
      
      await supabase.from('profiles').update({
        semantic_profile: { ...user.semantic_profile, ...updatedProfile },
        last_summary_at: new Date().toISOString()
      }).eq('id', user.id);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

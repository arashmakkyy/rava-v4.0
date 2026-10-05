
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI, Modality } from "https://esm.sh/@google/genai@^1";
import { AI_MODELS } from "../_shared/models.ts";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// API version for BOTH token creation and Live connect (single pinned constant).
// Default 'v1beta' per the current Live/ephemeral docs reference at implementation time.
// The B0 behavioral probe (real key, real connect) is the source of truth for this
// value — if mint/connect fails on version mismatch, flip this ONE constant, not call sites.
const LIVE_API_VERSION = 'v1beta';

// Server-enforced cost boundary (per user, per server day).
const MAX_LIVE_MINTS_PER_DAY = 10;
const TOKEN_TTL_MINUTES = 15;
const NEW_SESSION_WINDOW_SECONDS = 90;
// Live model is locked server-side here AND mirrored in the client sessionManager.
// Revalidate against current docs before rotating (B0 behavioral probe decides).
const LIVE_MODEL = AI_MODELS.LIVE;

/**
 * Authenticated minter for Gemini Live ephemeral tokens.
 *
 * Trust model (explicit):
 *  - Caller authenticates with their own Supabase JWT (Authorization header).
 *    Identity matters here because the daily mint quota is per user.
 *  - Server Gemini credential (GEMINI_API_KEY) never leaves this function.
 *  - Issued token: uses=1, short expireTime, short newSessionExpireTime,
 *    model locked via liveConnectConstraints. A reconnect always needs a new
 *    mint (counted), and Google itself rejects traffic past expireTime — so
 *    max cost per user per day is bounded WITHOUT proxying audio.
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

    // User-scoped client: quota RPC runs as the caller (auth.uid() works).
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

    const { data: allowed, error: quotaError } = await supabase.rpc('consume_live_mint', {
      px_max_per_day: MAX_LIVE_MINTS_PER_DAY,
    });
    if (quotaError) throw quotaError;
    if (allowed !== true) {
      return new Response(JSON.stringify({ error: 'daily mint quota reached', quota: MAX_LIVE_MINTS_PER_DAY }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = Date.now();
    const ai = new GoogleGenAI({
      apiKey: Deno.env.get('GEMINI_API_KEY')!,
      httpOptions: { apiVersion: LIVE_API_VERSION },
    });

    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + TOKEN_TTL_MINUTES * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_SECONDS * 1000).toISOString(),
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: { responseModalities: [Modality.AUDIO] },
        },
      },
    });

    if (!token?.name) throw new Error('token mint failed');

    return new Response(JSON.stringify({
      token: token.name,
      apiVersion: LIVE_API_VERSION,
      expiresAt: new Date(now + TOKEN_TTL_MINUTES * 60 * 1000).toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'mint failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

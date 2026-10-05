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
// The B0 behavioral probe (real key, real connect) is the source of truth for this
// value — if mint/connect fails on version mismatch, flip this ONE constant, not call sites.
const LIVE_API_VERSION = 'v1beta';

// Lease bounds (authoritative values live in acquire_live_lease; these are the
// request caps for a single mint — the server may grant less).
const MAX_LEASE_MINUTES = 15;
const MAX_LIVE_MINTS_PER_DAY = 10;
const NEW_SESSION_WINDOW_SECONDS = 90;
// Live model is locked server-side here AND mirrored in the client sessionManager.
// Revalidate against current docs before rotating (B0 behavioral probe decides).
const LIVE_MODEL = AI_MODELS.LIVE;

/**
 * Authenticated minter for Gemini Live ephemeral tokens, backed by PROPORTIONAL
 * server-side fuel leases (see migration 16).
 *
 * Per mint, atomically: locks the profile, computes affordable minutes from the
 * REAL balance, debits the lease cost up front, and enforces the daily quota.
 * The token TTL equals the granted lease (never a fixed 15 minutes for dust
 * balances). Reconnects always acquire a NEW lease (re-checked, re-charged).
 * If token minting fails after acquiring, the lease is refunded in full.
 * No long-lived Gemini credential exists in the browser bundle.
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

    // User-scoped client: acquire_live_lease runs as the caller (auth.uid() works).
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

    const { data: lease, error: leaseError } = await supabase.rpc('acquire_live_lease', {
      px_max_minutes: MAX_LEASE_MINUTES,
      px_max_mints_per_day: MAX_LIVE_MINTS_PER_DAY,
    });
    if (leaseError) throw leaseError;
    if (!lease?.ok) {
      const reason = lease?.reason || 'denied';
      const status = reason === 'quota-exceeded' ? 429 : 402;
      return new Response(JSON.stringify({ error: reason }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const leaseId = lease.lease_id as string;
    const expiresAt = lease.expires_at as string;

    const now = Date.now();
    const ai = new GoogleGenAI({
      apiKey: Deno.env.get('GEMINI_API_KEY')!,
      httpOptions: { apiVersion: LIVE_API_VERSION },
    });

    try {
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime: expiresAt,
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
        expiresAt,
        leaseId,
        minutes: lease.minutes,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (mintErr) {
      // Mint failed AFTER debiting: refund the lease in full (idempotent).
      await supabase.rpc('close_live_lease', { px_lease_id: leaseId, px_actual_seconds: 0 });
      throw mintErr;
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'mint failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

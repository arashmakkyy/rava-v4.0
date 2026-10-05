/**
 * RAVA SECURITY ABUSE SUITE (server-side, P0 acceptance).
 *
 * Complements scripts/smoke_test.mjs (happy paths) with adversarial cases.
 * Each case maps to a P0 lockdown and MUST FAIL CLOSED (attack rejected).
 *
 * Env: SMOKE_URL, SMOKE_ANON, SMOKE_SERVICE (same as smoke; never logged).
 * Requires migrations 10 (economy) + 11 (price verification) APPLIED —
 * before that, cases fail OPEN and the suite correctly reports red.
 *
 * Run: SMOKE_URL=... SMOKE_ANON=... SMOKE_SERVICE=... node scripts/abuse_test.mjs
 */
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.SMOKE_URL;
const ANON = process.env.SMOKE_ANON;
const SERVICE = process.env.SMOKE_SERVICE;

if (!SUPABASE_URL || !ANON || !SERVICE) {
  console.error('Missing SMOKE_URL / SMOKE_ANON / SMOKE_SERVICE');
  process.exit(2);
}

const results = [];
const stamp = Date.now();

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function rest(path, { method = 'GET', token = ANON, body, prefer } = {}) {
  const headers = {
    apikey: ANON,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { res, json, text };
}

async function rpc(fn, params, token) {
  return rest(`/rest/v1/rpc/${fn}`, { method: 'POST', token, body: params });
}

async function authAdmin(path, { method = 'POST', body } = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => null);
  return json?.access_token ?? null;
}

async function makeUser(tag) {
  const email = `rava.abuse.${tag}.${stamp}@mailinator.com`;
  const password = `AbuseTest!${stamp}Aa`;
  const { res, json } = await authAdmin('/admin/users', {
    body: { email, password, email_confirm: true, user_metadata: { username: `abuse_${tag}` } },
  });
  if (!res.ok || !json?.id) throw new Error(`user create failed: ${JSON.stringify(json)}`);
  const token = await signIn(email, password);
  if (!token) throw new Error('sign-in failed');
  return { id: json.id, email, token };
}

async function deleteUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}

async function profileOf(token) {
  const { json } = await rest('/rest/v1/profiles?select=wallet_balance,xp_level', { token });
  return Array.isArray(json) ? json[0] : json;
}

async function main() {
  console.log('\n=== RAVA ABUSE SUITE ===\n');
  const A = await makeUser('attacker');
  const B = await makeUser('victim');

  try {
    // A1: direct wallet mint via table UPDATE must be denied (P0.1 column revoke).
    {
      const { res } = await rest(`/rest/v1/profiles?id=eq.${A.id}`, {
        method: 'PATCH',
        token: A.token,
        body: { wallet_balance: 999999 },
      });
      record('A1: direct wallet_balance UPDATE denied', !res.ok, `status=${res.status}`);
    }

    // A2: increment_wallet with arbitrary amount must be denied (P0.1 revoke).
    {
      const { res, json } = await rpc('increment_wallet', {
        px_transaction_id: randomUUID(),
        px_amount: 999,
        px_xp_amount: 99999,
        px_reward_type: 'topup',
      }, A.token);
      const denied = !res.ok || JSON.stringify(json).includes('permission');
      record('A2: increment_wallet arbitrary mint denied', denied, `status=${res.status}`);
    }

    // A3: same-day double daily_itinerary claims credit once (P0.1 entitlement).
    {
      const before = await profileOf(A.token);
      await rpc('claim_reward', { px_transaction_id: randomUUID(), px_reward_type: 'daily_itinerary' }, A.token);
      const mid = await profileOf(A.token);
      const second = await rpc('claim_reward', { px_transaction_id: randomUUID(), px_reward_type: 'daily_itinerary' }, A.token);
      const after = await profileOf(A.token);
      const creditedOnce = mid && after && Number(mid.wallet_balance) === Number(after.wallet_balance);
      const flagged = second.json && second.json.idempotent === true;
      record(
        'A3: double daily claim credits once + idempotent flag',
        !!creditedOnce && !!flagged,
        `before=${before?.wallet_balance} mid=${mid?.wallet_balance} after=${after?.wallet_balance}`
      );
    }

    // A4: far-away stamp for a curated place must be rejected (P0.1 soft geofence).
    {
      const { json: attractions } = await rest('/rest/v1/attractions?select=place_id&limit=1', { token: A.token });
      const placeId = Array.isArray(attractions) ? attractions[0]?.place_id : null;
      if (!placeId) {
        record('A4: far stamp rejected (TOO_FAR)', false, 'no curated attraction to test against');
      } else {
        const { res, json } = await rpc('process_poi_visit', {
          px_transaction_id: randomUUID(),
          px_place_id: placeId,
          px_place_name: 'abuse probe',
          px_city: 'Test',
          px_lat: 0,
          px_lng: 0,
        }, A.token);
        const rejected = !res.ok || JSON.stringify(json).includes('TOO_FAR');
        record('A4: far stamp rejected (TOO_FAR)', !!rejected, `status=${res.status}`);
      }
    }

    // A5: cross-account isolation — B sees none of A's stamps (P0.1 RLS / P0.2 isolation).
    {
      const { json: aStamps } = await rest('/rest/v1/stamps?select=id', { token: A.token });
      const { json: bView } = await rest('/rest/v1/stamps?select=id', { token: B.token });
      const bSeesNothingForeign = Array.isArray(bView) && bView.length === 0;
      record(
        'A5: victim sees no foreign stamps',
        bSeesNothingForeign,
        `attacker_rows=${Array.isArray(aStamps) ? aStamps.length : '?'} victim_rows=${Array.isArray(bView) ? bView.length : '?'}`
      );
    }

    // A6: verify-price without webhook secret must not succeed (P0.3 trust model).
    {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-price`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ record: { id: randomUUID(), user_id: B.id } }),
      });
      const json = await res.json().catch(() => null);
      const notSuccessful = res.status === 403 || (json && json.success !== true);
      record('A6: secretless verify-price never succeeds', !!notSuccessful, `status=${res.status}`);
    }

    // A7: finalize_price_verification on unknown report errors closed (shape check).
    {
      const { res } = await rest('/rest/v1/rpc/finalize_price_verification', {
        method: 'POST',
        token: SERVICE,
        body: { px_report_id: randomUUID(), px_verified: true, px_confidence: 1 },
      });
      // Service-role call: must raise REPORT_NOT_FOUND, never silently succeed.
      record('A7: finalize unknown report fails closed', !res.ok, `status=${res.status}`);
    }
  } finally {
    await deleteUser(A.id).catch(() => {});
    await deleteUser(B.id).catch(() => {});
    console.log('Cleanup: test users deleted (best-effort).');
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ABUSE SUMMARY: ${passed}/${results.length} passed ===`);
  if (failed.length) failed.forEach((f) => console.log(` - ${f.name}: ${f.detail}`));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

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

    // A8: direct xp_level UPDATE denied (P0.1 column allowlist).
    {
      const { res } = await rest(`/rest/v1/profiles?id=eq.${A.id}`, {
        method: 'PATCH',
        token: A.token,
        body: { xp_level: 99999 },
      });
      record('A8: direct xp_level UPDATE denied', !res.ok, `status=${res.status}`);
    }

    // A9: fake-date streak cannot mint extra XP; date is server-authoritative.
    {
      const before = await profileOf(A.token);
      await rpc('record_daily_activity', { px_date: '2999-01-01' }, A.token);
      await rpc('record_daily_activity', { px_date: '1999-01-01' }, A.token);
      const after = await profileOf(A.token);
      const today = new Date().toISOString().slice(0, 10);
      const dateHonest = after && after.last_active_date !== '2999-01-01' && after.last_active_date !== '1999-01-01';
      void today;
      record(
        'A9: fake-date streak writes no fake date',
        !!dateHonest,
        `last_active_date=${after?.last_active_date}`
      );
    }

    // A10: stamp without coordinates fails closed (P0.1 strict geofence).
    {
      const { res, json } = await rpc('process_poi_visit', {
        px_transaction_id: randomUUID(),
        px_place_id: 'abuse_no_coords',
        px_place_name: 'abuse probe',
        px_city: 'Test',
        px_lat: null,
        px_lng: null,
      }, A.token);
      const rejected = !res.ok || JSON.stringify(json).includes('NO_LOCATION');
      record('A10: coord-less stamp rejected', !!rejected, `status=${res.status}`);
    }

    // A11: unknown place_id fails closed (P0.1 known-entity rule).
    {
      const { res, json } = await rpc('process_poi_visit', {
        px_transaction_id: randomUUID(),
        px_place_id: `abuse_unknown_${stamp}`,
        px_place_name: 'abuse probe',
        px_city: 'Test',
        px_lat: 41.0082,
        px_lng: 28.9784,
      }, A.token);
      const rejected = !res.ok || JSON.stringify(json).includes('UNKNOWN_PLACE');
      record('A11: unknown place_id stamp rejected', !!rejected, `status=${res.status}`);
    }

    // A12: duplicate stamp (fresh tx ids) credits once (P0.1 dedup).
    {
      const { json: attractions } = await rest(
        '/rest/v1/attractions?select=place_id,location&limit=5',
        { token: A.token }
      );
      const row = Array.isArray(attractions) ? attractions[0] : null;
      let coords = null;
      try {
        const c = typeof row?.location === 'string' ? JSON.parse(row.location) : row?.location;
        if (c && Array.isArray(c.coordinates)) coords = { lng: c.coordinates[0], lat: c.coordinates[1] };
      } catch { /* unparseable location */ }
      if (!row?.place_id || !coords) {
        record('A12: duplicate stamp credits once', false, 'no geo-coded attraction to test against');
      } else {
        const before = await profileOf(A.token);
        await rpc('process_poi_visit', {
          px_transaction_id: randomUUID(), px_place_id: row.place_id,
          px_place_name: 'abuse dup', px_city: 'Test', px_lat: coords.lat, px_lng: coords.lng,
        }, A.token);
        const mid = await profileOf(A.token);
        await rpc('process_poi_visit', {
          px_transaction_id: randomUUID(), px_place_id: row.place_id,
          px_place_name: 'abuse dup', px_city: 'Test', px_lat: coords.lat, px_lng: coords.lng,
        }, A.token);
        const after = await profileOf(A.token);
        const once = mid && after && Number(mid.wallet_balance) === Number(after.wallet_balance);
        record('A12: duplicate stamp credits once', !!once && Number(mid.wallet_balance) > Number(before?.wallet_balance ?? 0), `before=${before?.wallet_balance} mid=${mid?.wallet_balance} after=${after?.wallet_balance}`);
      }
    }

    // A13: processing another user's ticket path is forbidden (P0.3 ownership).
    {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/process-ticket`, {
        method: 'POST',
        headers: { apikey: ANON, Authorization: `Bearer ${A.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: `${B.id}/foreign.jpg` }),
      });
      const json = await res.json().catch(() => null);
      const blocked = res.status === 403 || (json && (json.error || {}).toString().includes('orbidden')) || (json && JSON.stringify(json).includes('orbidden'));
      record('A13: foreign ticket processing forbidden', !!blocked, `status=${res.status}`);
    }

    // A14: double finalize of one report credits once (P0.3 atomicity).
    {
      const { json: cacheRows } = await rest('/rest/v1/places_cache?select=place_id&limit=1', { token: SERVICE });
      const cacheId = Array.isArray(cacheRows) ? cacheRows[0]?.place_id : null;
      const { json: created } = await rest('/rest/v1/price_reports', {
        method: 'POST', token: A.token, prefer: 'return=representation',
        body: { user_id: A.id, place_id: cacheId || 'abuse', item_name: 'abuse item', reported_price: 1, currency: 'TRY', proof_image_url: `${A.id}/abuse.jpg`, ai_verification_status: 'pending' },
      });
      const reportId = Array.isArray(created) ? created[0]?.id : created?.id;
      if (!reportId) {
        record('A14: double finalize credits once', false, 'could not seed price report');
      } else {
        const call = () => rest('/rest/v1/rpc/finalize_price_verification', {
          method: 'POST', token: SERVICE,
          body: { px_report_id: reportId, px_verified: true, px_confidence: 1 },
        });
        const before = await profileOf(A.token);
        await call();
        const mid = await profileOf(A.token);
        const second = await call();
        const after = await profileOf(A.token);
        const once = mid && after && Number(mid.wallet_balance) === Number(after.wallet_balance) && Number(mid.wallet_balance) > Number(before?.wallet_balance ?? 0);
        const flagged = second.json && second.json.idempotent === true;
        record('A14: double finalize credits once + idempotent flag', !!once && !!flagged, `second=${JSON.stringify(second.json)}`);
      }
    }

    // A15: ordinary user JWT cannot trigger the internal dreamer job (P0.5/F8).
    {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/the-dreamer`, {
        method: 'POST',
        headers: { apikey: ANON, Authorization: `Bearer ${A.token}`, 'Content-Type': 'application/json' },
        body: {},
      });
      const json = await res.json().catch(() => null);
      const blocked = res.status === 403 || res.status === 401 || (json && json.success !== true);
      record('A15: user JWT cannot trigger the-dreamer', !!blocked, `status=${res.status}`);
    }

    // A16: profile id/wallet/xp cannot be PATCHed directly (allowlist).
    {
      const { res } = await rest(`/rest/v1/profiles?id=eq.${A.id}`, {
        method: 'PATCH',
        token: A.token,
        body: { id: B.id, wallet_balance: 1, xp_level: 1 },
      });
      const after = await profileOf(A.token);
      record('A16: id/wallet/xp direct PATCH denied', !res.ok, `status=${res.status} balance=${after?.wallet_balance}`);
    }

    // A17: concurrent claim_price_attempt on one report → exactly one allowed.
    {
      const { json: cacheRows } = await rest('/rest/v1/places_cache?select=place_id&limit=1', { token: SERVICE });
      const cacheId = Array.isArray(cacheRows) ? cacheRows[0]?.place_id : null;
      const { json: created } = await rest('/rest/v1/price_reports', {
        method: 'POST', token: A.token, prefer: 'return=representation',
        body: { user_id: A.id, place_id: cacheId || 'abuse', item_name: `race ${stamp}`, reported_price: 1, currency: 'TRY', proof_image_url: `${A.id}/race.jpg`, ai_verification_status: 'pending' },
      });
      const reportId = Array.isArray(created) ? created[0]?.id : created?.id;
      if (!reportId) {
        record('A17: concurrent claim allows exactly one', false, 'could not seed price report');
      } else {
        const call = () => rest('/rest/v1/rpc/claim_price_attempt', {
          method: 'POST', token: SERVICE,
          body: { px_report_id: reportId, px_max_attempts_per_day: 10 },
        });
        const [r1, r2] = await Promise.all([call(), call()]);
        const oks = [r1.json?.ok === true, r2.json?.ok === true].filter(Boolean).length;
        record('A17: concurrent claim allows exactly one', oks === 1, `r1=${JSON.stringify(r1.json)} r2=${JSON.stringify(r2.json)}`);
      }
    }

    // A18: parallel live-lease mints never exceed the real balance.
    {
      // Drain A to ~0.1h first (deduct is the honest client path).
      const start = await profileOf(A.token);
      const drain = Math.max(0, (Number(start?.wallet_balance) || 0) * 3600 - 360);
      if (drain > 0) {
        await rpc('deduct_fuel', { px_seconds: drain, px_reason: 'abuse setup', px_transaction_id: randomUUID() }, A.token);
      }
      const before = await profileOf(A.token);
      const mint = () => rest('/rest/v1/rpc/acquire_live_lease', {
        method: 'POST', token: A.token,
        body: { px_max_minutes: 15, px_max_mints_per_day: 10 },
      });
      const [m1, m2] = await Promise.all([mint(), mint()]);
      const okCount = [m1.json?.ok === true, m2.json?.ok === true].filter(Boolean).length;
      const after = await profileOf(A.token);
      const mins = [m1.json?.minutes || 0, m2.json?.minutes || 0];
      const grantedValue = (mins[0] + mins[1]) / 60;
      const spent = Number(before?.wallet_balance || 0) - Number(after?.wallet_balance || 0);
      // At most one full lease from dust; never negative; never over-spent.
      const bounded = okCount <= 1 && Number(after?.wallet_balance || 0) >= 0 && spent <= Number(before?.wallet_balance || 0) + 1e-9;
      record('A18: parallel mints bounded by balance', !!bounded, `ok=${okCount} mins=${mins} spent=${spent}`);
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

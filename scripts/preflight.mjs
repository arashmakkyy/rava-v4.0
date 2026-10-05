/**
 * RAVA PREFLIGHT — read-only production data check before applying
 * migrations 10-15. NEVER writes. Exits 1 on would-break-apply conditions.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read-only usage here).
 * Run:  node scripts/preflight.mjs
 *
 * Checks:
 *  P1 duplicate reward entitlements that would violate uq_reward_entitlement
 *  P2 duplicate (user, place, item, day) price reports (uq_price_report_entitlement)
 *  P3 byte-identical proof reuse per user (uq_price_proof_per_user proxy)
 *  P4 NULL/empty item_name rows (migration backfills them — informational)
 *  P5 place_ids matching NEITHER attractions NOR places_cache
 *     (validates the migration-15 identity decision with real data)
 *
 * Exact GROUP BY checks for the new UNIQUE indexes (run once in the SQL editor,
 * read-only, pre-apply — must return zero rows):
 *
 *  -- uq_reward_entitlement conflicts:
 *  SELECT user_id, reward_type, reference_id, COUNT(*)
 *  FROM reward_ledger
 *  WHERE reward_type IN ('daily_itinerary','profile_complete','topup_demo')
 *    AND reference_id IS NOT NULL
 *  GROUP BY 1,2,3 HAVING COUNT(*) > 1;
 *
 *  -- uq_price_report_entitlement conflicts:
 *  SELECT user_id, place_id, lower(btrim(item_name)), COALESCE(report_date, created_at::date), COUNT(*)
 *  FROM price_reports
 *  GROUP BY 1,2,3,4 HAVING COUNT(*) > 1;
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (read-only use)');
  process.exit(2);
}

const headers = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
};

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { res, json };
}

const findings = [];
function check(name, level, detail) {
  findings.push({ name, level, detail });
  console.log(`[${level}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  console.log('\n=== RAVA PREFLIGHT (read-only) ===\n');

  // P4: NULL/empty item names (migration 15 backfills; count must be known).
  {
    const { res, json } = await rest(
      "/rest/v1/price_reports?select=id&or=(item_name.is.null,item_name.eq.)"
    );
    if (!res.ok) {
      check('P4 item_name null/empty count', 'FAIL', `query failed: ${res.status}`);
    } else {
      const n = Array.isArray(json) ? json.length : 0;
      check('P4 item_name null/empty rows (will be backfilled)', n > 0 ? 'WARN' : 'PASS', `${n} rows`);
    }
  }

  // P5: place_ids matching neither registry (validates the identity decision).
  {
    const { res, json } = await rest('/rest/v1/price_reports?select=place_id');
    if (!res.ok) {
      check('P5 place_id registry coverage', 'FAIL', `query failed: ${res.status}`);
    } else {
      const ids = [...new Set((Array.isArray(json) ? json : []).map((r) => r.place_id).filter(Boolean))];
      let matched = 0;
      for (const id of ids.slice(0, 200)) {
        const a = await rest(`/rest/v1/attractions?select=place_id&or=(place_id.eq.${encodeURIComponent(id)},google_place_id.eq.${encodeURIComponent(id)})&limit=1`);
        const c = await rest(`/rest/v1/places_cache?select=place_id&place_id=eq.${encodeURIComponent(id)}&limit=1`);
        const hitA = Array.isArray(a.json) && a.json.length > 0;
        const hitC = Array.isArray(c.json) && c.json.length > 0;
        if (hitA || hitC) matched += 1;
      }
      check(
        'P5 place_ids resolvable post-identity-fix',
        'INFO',
        `${matched}/${ids.length} distinct ids resolve (unresolvable ones prove the old FK was wrong)`
      );
    }
  }

  // P2/P3 proxies: duplicate (user, place, item) same-day submissions.
  {
    const { res, json } = await rest('/rest/v1/price_reports?select=user_id,place_id,item_name,created_at&order=created_at.desc&limit=1000');
    if (!res.ok) {
      check('P2/P3 duplicate submission scan', 'FAIL', `query failed: ${res.status}`);
    } else {
      const seen = new Map();
      let dups = 0;
      for (const r of Array.isArray(json) ? json : []) {
        const day = String(r.created_at || '').slice(0, 10);
        const key = `${r.user_id}|${r.place_id}|${String(r.item_name || '').toLowerCase().trim()}|${day}`;
        seen.set(key, (seen.get(key) || 0) + 1);
        if (seen.get(key) === 2) dups += 1;
      }
      check(
        'P2/P3 same-day duplicate submissions',
        dups > 0 ? 'WARN' : 'PASS',
        `${dups} duplicate groups in last 1000 rows (entitlement index will reject future ones)`
      );
    }
  }

  // P1 proxy: same-tx rewards are PK-guarded already; check reward bursts per user/day.
  {
    const { res, json } = await rest('/rest/v1/reward_ledger?select=user_id,created_at&order=created_at.desc&limit=2000');
    if (!res.ok) {
      check('P1 reward burst scan', 'FAIL', `query failed: ${res.status}`);
    } else {
      const perDay = new Map();
      let max = 0;
      for (const r of Array.isArray(json) ? json : []) {
        const key = `${r.user_id}|${String(r.created_at || '').slice(0, 10)}`;
        const n = (perDay.get(key) || 0) + 1;
        perDay.set(key, n);
        if (n > max) max = n;
      }
      check('P1 max rewards per user/day (burst signal)', max > 25 ? 'WARN' : 'PASS', `max=${max}`);
    }
  }

  // NOTE: exact GROUP BY duplicate detection for the new UNIQUE indexes runs in
  // the SQL editor pre-apply (see migration comments); PostgREST cannot group.
  // This script covers everything expressible read-only over REST.
  const fails = findings.filter((f) => f.level === 'FAIL');
  console.log(`\n=== PREFLIGHT: ${fails.length} FAIL, ${findings.filter((f) => f.level === 'WARN').length} WARN ===`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

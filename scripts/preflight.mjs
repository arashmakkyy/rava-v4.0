/**
 * RAVA PREFLIGHT — production migration gate (read-only against the DB).
 *
 * Usage:
 *   node scripts/preflight.mjs --self-test   # no credentials needed; synthetic
 *                                            # breaking + clean fixtures must
 *                                            # exit 1 and 0 respectively.
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/preflight.mjs
 *                                            # full-table live gate. Any
 *                                            # migration-breaking condition
 *                                            # exits non-zero. WARN is reserved
 *                                            # for advisory issues ONLY.
 *
 * Design: every check is a PURE function over fetched rows (evaluate* below),
 * so --self-test exercises the EXACT same code path as the live gate —
 * no mock theater, no comment-only SQL.
 *
 * Blocking (FAIL) conditions — each would fail migrations 10–16 at apply:
 *  F1 duplicate reward entitlement rows for uq_reward_entitlement
 *  F2 duplicate (user, place, item, day) rows for uq_price_report_entitlement
 *  F3 duplicate (user, proof_hash) rows for uq_price_proof_per_user
 *  F4 NULL/empty item_name rows (migration sets NOT NULL)
 *  F5 NULL report_date rows that created_at cannot backfill (migration sets NOT NULL)
 *
 * Exact GROUP BY equivalents (for the SQL editor, informational):
 *  SELECT user_id, reward_type, reference_id, COUNT(*) FROM reward_ledger
 *   WHERE reward_type IN ('daily_itinerary','profile_complete','topup_demo')
 *     AND reference_id IS NOT NULL GROUP BY 1,2,3 HAVING COUNT(*) > 1;
 *  SELECT user_id, place_id, lower(btrim(item_name)), COALESCE(report_date, created_at::date), COUNT(*)
 *   FROM price_reports GROUP BY 1,2,3,4 HAVING COUNT(*) > 1;
 *  SELECT user_id, proof_hash, COUNT(*) FROM price_reports
 *   WHERE proof_hash IS NOT NULL GROUP BY 1,2 HAVING COUNT(*) > 1;
 */

const TYPES = ['daily_itinerary', 'profile_complete', 'topup_demo'];

function entitlementKey(r) {
  return `${r.user_id}|${r.reward_type}|${r.reference_id}`;
}

function priceKey(r) {
  const day = r.report_date || String(r.created_at || '').slice(0, 10);
  return `${r.user_id}|${r.place_id}|${String(r.item_name || '').toLowerCase().trim()}|${day}`;
}

/** Pure evaluators — shared by live gate and self-test. */
export function evaluateRewardEntitlements(rows) {
  const seen = new Map();
  const dupGroups = [];
  for (const r of rows || []) {
    if (!TYPES.includes(r.reward_type) || r.reference_id == null) continue;
    const k = entitlementKey(r);
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    if (n === 2) dupGroups.push(k);
  }
  return dupGroups;
}

export function evaluatePriceEntitlements(rows) {
  const seen = new Map();
  const dupGroups = [];
  for (const r of rows || []) {
    const k = priceKey(r);
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    if (n === 2) dupGroups.push(k);
  }
  return dupGroups;
}

export function evaluateProofDupes(rows) {
  const seen = new Map();
  const dupGroups = [];
  for (const r of rows || []) {
    if (r.proof_hash == null) continue;
    const k = `${r.user_id}|${r.proof_hash}`;
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    if (n === 2) dupGroups.push(k);
  }
  return dupGroups;
}

export function evaluateItemNames(rows) {
  return (rows || []).filter((r) => r.item_name == null || String(r.item_name).trim() === '');
}

export function evaluateReportDates(rows) {
  // Rows whose date can come from NEITHER report_date NOR created_at.
  return (rows || []).filter((r) => r.report_date == null && !r.created_at);
}

function runSelfTest() {
  const cases = [];
  const dup = { user_id: 'u1', reward_type: 'daily_itinerary', reference_id: '2026-01-01' };
  cases.push(['F1 breaking -> FAIL', evaluateRewardEntitlements([dup, { ...dup }]).length === 1]);
  cases.push(['F1 clean -> pass', evaluateRewardEntitlements([dup]).length === 0]);
  const pr = { user_id: 'u1', place_id: 'p1', item_name: ' Tea ', created_at: '2026-01-01T10:00:00Z' };
  const prSame = { user_id: 'u1', place_id: 'p1', item_name: 'tea', created_at: '2026-01-01T20:00:00Z' };
  cases.push(['F2 breaking (case/space-insensitive) -> FAIL', evaluatePriceEntitlements([pr, prSame]).length === 1]);
  cases.push(['F2 different day -> pass', evaluatePriceEntitlements([pr, { ...prSame, created_at: '2026-01-02T10:00:00Z' }]).length === 0]);
  const ph = { user_id: 'u1', proof_hash: 'abc' };
  cases.push(['F3 breaking -> FAIL', evaluateProofDupes([ph, { ...ph }]).length === 1]);
  cases.push(['F3 null hash ignored -> pass', evaluateProofDupes([{ user_id: 'u1' }]).length === 0]);
  cases.push(['F4 null/empty flagged', evaluateItemNames([{ item_name: null }, { item_name: '  ' }, { item_name: 'x' }]).length === 2]);
  cases.push(['F5 missing both dates flagged', evaluateReportDates([{ id: 1 }, { report_date: '2026-01-01' }]).length === 1]);
  // Pre-schema legacy rows (no report_date/proof_hash columns): evaluators must
  // still work off created_at and skip hash checks, never crash.
  const legacy = { user_id: 'u9', place_id: 'p9', item_name: 'x', created_at: '2026-03-01T10:00:00Z' };
  cases.push(['legacy rows evaluate (created_at fallback)', evaluatePriceEntitlements([legacy, { ...legacy }]).length === 1]);
  cases.push(['legacy rows: no hash => no dup', evaluateProofDupes([legacy, { ...legacy }]).length === 0]);

  let failed = 0;
  for (const [name, ok] of cases) {
    console.log(`[${ok ? 'PASS' : 'FAIL'}] self-test: ${name}`);
    if (!ok) failed += 1;
  }
  console.log(failed === 0 ? 'SELF-TEST: all green' : `SELF-TEST: ${failed} broken`);
  process.exit(failed === 0 ? 0 : 1);
}

async function runLive() {
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
  // Full-table reads (no sampling caps): constraints cover whole tables,
  // so the gate must too. Pagination: PostgREST defaults to 1000 rows per
  // request — page through with Range headers.
  async function fetchAll(path, select) {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${path}?select=${select}`,
        { headers: { ...headers, Range: `${offset}-${offset + pageSize - 1}` } }
      );
      if (!res.ok) throw new Error(`query failed: ${path} status=${res.status}`);
      const page = await res.json();
      if (!Array.isArray(page) || page.length === 0) break;
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  }

  console.log('\n=== RAVA PREFLIGHT (read-only, full-table) ===\n');
  let fails = 0;
  const gate = (name, dups, extra = '') => {
    const bad = dups.length > 0;
    console.log(`[${bad ? 'FAIL' : 'PASS'}] ${name}${bad ? ` — ${dups.length} blocking group(s) ${extra}` : ''}`);
    if (bad) fails += 1;
  };

  // Schema-awareness: production may still be on an older migration, where new
  // columns (report_date, proof_hash, google_place_id) simply don't exist yet.
  // A missing column is NOT a failure — the migration creates it empty, so the
  // corresponding constraint is trivially satisfiable. Probe first, then query
  // only what exists. Auth/network errors still throw (never masked as clean).
  async function hasColumns(table, cols) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=${cols.join(',')}&limit=1`,
      { headers }
    );
    if (res.ok) return true;
    if (res.status === 400) return false;
    throw new Error(`query failed: ${table} status=${res.status}`);
  }

  const ledger = await fetchAll('reward_ledger', 'user_id,reward_type,reference_id');
  gate('F1 reward entitlement duplicates', evaluateRewardEntitlements(ledger));

  const priceCols = ['user_id', 'place_id', 'item_name', 'created_at'];
  let priceNote = '';
  if (await hasColumns('price_reports', ['report_date', 'proof_hash'])) {
    priceCols.push('report_date', 'proof_hash');
  } else {
    priceNote = ' (report_date/proof_hash absent pre-migration: backfill + fresh-column paths, no legacy dupes possible)';
  }
  const reports = await fetchAll('price_reports', priceCols.join(','));
  gate('F2 price entitlement duplicates', evaluatePriceEntitlements(reports));
  gate('F3 proof-hash duplicates', evaluateProofDupes(reports));
  const badItems = evaluateItemNames(reports);
  console.log(`[${badItems.length > 0 ? 'FAIL' : 'PASS'}] F4 null/empty item_name rows${badItems.length > 0 ? ` — ${badItems.length} rows (migration backfills, then NOT NULL)` : ''}`);
  if (badItems.length > 0) fails += 1;
  const badDates = evaluateReportDates(reports);
  // Backfill covers created_at-present rows; only rows missing BOTH block.
  console.log(`[${badDates.length > 0 ? 'FAIL' : 'PASS'}] F5 un-backfillable report dates${badDates.length > 0 ? ` — ${badDates.length} rows` : ''}`);
  if (badDates.length > 0) fails += 1;

  // Advisory only: registry coverage informs the identity decision, blocks nothing.
  // google_place_id may itself be absent pre-migration: probe and degrade honestly.
  const ids = [...new Set(reports.map((r) => r.place_id).filter(Boolean))];
  const googleCol = await hasColumns('attractions', ['google_place_id']);
  let matched = 0;
  let checked = 0;
  for (const id of ids.slice(0, 500)) {
    const orFilter = googleCol
      ? `or=(place_id.eq.${encodeURIComponent(id)},google_place_id.eq.${encodeURIComponent(id)})`
      : `place_id.eq.${encodeURIComponent(id)}`;
    const a = await fetch(
      `${SUPABASE_URL}/rest/v1/attractions?select=place_id&${orFilter}&limit=1`,
      { headers }
    ).then((r) => r.json()).catch(() => []);
    checked += 1;
    if (Array.isArray(a) && a.length > 0) matched += 1;
  }
  console.log(`[INFO] place registry coverage: ${matched}/${ids.length} distinct ids resolve${priceNote}${googleCol ? '' : ' (google_place_id absent pre-migration)'}`);

  console.log(fails === 0 ? '\nPREFLIGHT: clean' : `\nPREFLIGHT: ${fails} BLOCKING group(s)`);
  process.exit(fails === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  runLive().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}

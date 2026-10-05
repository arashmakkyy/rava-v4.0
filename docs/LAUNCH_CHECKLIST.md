# Rava Launch Checklist

Official name: **Rava** (EN) / **راوا** (FA)

Production build: `npm run build` (verified passing).

Status legend used below: **implemented** (in repo) vs **deployed/configured** (on Supabase/production) vs **verified** (exercised against production). These are NOT the same — nothing here is marked verified until it runs against production.

## Before go-live

### 1. Supabase migrations — APPLIED on `thmsfdugojokxtemnqdw` (2026-08)

```
supabase/migrations/20240806000001_core_schema.sql
supabase/migrations/20240806000002_rls_and_rpcs.sql
supabase/migrations/20240806000003_seed_places.sql
supabase/migrations/20240806000004_fuel_idempotent.sql
supabase/migrations/20240806000005_budget_gamification.sql
supabase/migrations/20240806000006_journey_logic.sql
supabase/migrations/20240806000007_production_hardening.sql
supabase/migrations/20240806000008_production_hotfix.sql
supabase/migrations/20240806000009_smoke_hotfixes.sql
```

### 1b. Supabase migrations — WRITTEN, PENDING APPLY (needs `SUPABASE_ACCESS_TOKEN`)

```
supabase/migrations/20240806000010_economy_lockdown.sql      (P0.1: mint-RPC revoke,
  wallet column allowlist, server-derived reward entitlement, server-date streak,
  strict soft geofence + audit coords)
supabase/migrations/20240806000011_price_verification.sql   (P0.3: admin_increment_wallet
  definition, atomic finalize_price_verification, entitlement rails, report_date/
  proof_hash + attempt counters, atomic claim_price_attempt gate)
supabase/migrations/20240806000012_places_identity.sql      (B2: google_place_id column)
supabase/migrations/20240806000013_ai_usage_quota.sql       (P0.4: ai_usage + quota RPCs
  + ticket_receipts dedup table)
supabase/migrations/20240806000014_footprint_visibility.sql (P0.5: own-pending rows
  visible; DROP+CREATE required — return shape grew)
supabase/migrations/20240806000015_price_report_identity.sql (P0.5: subject identity
  resolution, places_cache FK removed)
supabase/migrations/20240806000016_live_leases.sql          (P0.4b: prepaid proportional
  fuel leases — service-only acquire/refund; NO client refund path)
```

Pre-apply gate (read-only, must exit 0; exact GROUP BY SQL is in the script header):

```
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/preflight.mjs
```

Apply forward-only, in order (09 already live is untouched):

```
SUPABASE_ACCESS_TOKEN=… node scripts/apply_migrations.mjs
```

> `apply_migrations.mjs` is a MANUAL RUNNER, not a migration system: it re-executes
> whole files and tracks no history. Source of truth is the Supabase migration
> history. All new schema changes must be forward-only migrations.

Re-run history: source of truth is the Supabase migration history, not this runner.
The script below is manual-only (re-executes whole files, tracks no history).

```
SUPABASE_ACCESS_TOKEN=… node scripts/apply_migrations.mjs
```

Confirm Edge Functions still use the **service role** key only on the server (`process-ticket`, `verify-price`, `the-dreamer`, `mint-live-token`, `ai-complete`). Frontend keeps the **anon** key only — no Gemini credential is bundled anymore (Live uses ephemeral tokens, other AI calls use the `ai-complete` proxy).

New/changed Edge Functions to deploy from repo (status: **implemented**, NOT yet deployed):
- `mint-live-token` (prepaid proportional leases: server-side balance gate + per-day quota + TTL = granted minutes; needs `GEMINI_API_KEY`, `SUPABASE_URL` + `SUPABASE_ANON_KEY`; user-JWT caller, gateway JWT check stays ON; NO client refund path — mint-failure refunds only via service-role `refund_live_lease`)
- `ai-complete` (same secrets as above; user-JWT caller)
- `verify-price` (internal webhook processor: `supabase/config.toml` sets `verify_jwt = false`; needs NEW secret `VERIFY_PRICE_WEBHOOK_SECRET`, mirrored as `x-webhook-secret` header on the Database Webhook for `price_reports` INSERT; handler re-reads the row and enforces ownership/status)
- `the-dreamer` (internal scheduled job: `verify_jwt = false`; needs NEW secret `THE_DREAMER_JOB_SECRET` sent as `x-job-secret` by the scheduler; ordinary user JWTs are rejected with 403)
- `process-ticket` (redeploy: ownership check; user-JWT caller, gateway JWT check stays ON)

**Verified remote state**
- Istanbul curated POIs: 31 · Dubai: 28
- RLS enabled on private + curated tables
- Idempotent `deduct_fuel(seconds, reason, transaction_id)`
- Economy RPCs revoked from `anon`; public place RPCs granted to `anon`+`authenticated`
- `admin_increment_wallet` = `service_role` only
- Storage buckets: `avatars`, `tickets`, `narratives`, `price_proofs`
- Edge functions redeployed from repo (ACTIVE)

**Still required before public launch**
- Set Auth **Site URL** + redirect allow-list to the production domain (currently `http://localhost:3000` + local allow-list)
- Rotate any Supabase access tokens that were shared in chat

### 2. Environment

- Google Maps JS API key (Places + Maps + Routes library)
- NO client Gemini key (removed; see `mint-live-token` / `ai-complete` above)
- Supabase URL + anon key
- Auth redirect / callback URLs for magic links and password recovery

### 3. Places data

Seed migration ships curated POIs for Istanbul and Dubai (≥20 each; remote now 31 / 28 including prior rows). Refresh with real Place IDs (fills `google_place_id`, never renames PKs or Persian copy):

```
node scripts/fetch_places.mjs --city Istanbul            # dry-run first
node scripts/fetch_places.mjs --city Istanbul --apply    # needs GOOGLE_PLACES_API_KEY + service key
```

(Server-only Google Places key — never ship in the browser.)

### 4. Smoke test flows

Automated + browser results: see [`docs/SMOKE_TEST_REPORT.md`](./SMOKE_TEST_REPORT.md).

- `npm run typecheck` + `npm run typecheck:edge` + `npm run build` — green gates (frontend 400+ files, all 5 Edge Functions)
- `npx playwright test` — 3 boot tests green; auth/outbox suites skip honestly without `E2E_EMAIL`/`E2E_PASSWORD`
- `npm run abuse` / `npm run smoke` / `node scripts/preflight.mjs` — require live credentials (run post-apply, pre-staging)

- [x] Sign up → email confirm → onboarding → dashboard *(API + UI; onboarding race fixed)*
- [x] Login / logout / session recovery *(API + UI login/session)*
- [x] Forgot password email *(API recover accepted; needs production Site URL for real delivery)*
- [~] Map load, curated markers, Google POI click → sheet *(curated data + controls OK; Google Maps tiles blocked without API key)*
- [ ] Favorites, itinerary add, start navigation polyline *(favorites/itinerary API OK; navigation needs Maps key)*
- [ ] Gemini Live: connect, barge-in, disconnect, reconnect *(blocked — no Gemini key in env)*
- [x] Zero fuel → clamps / Profile top-up path *(API clamp OK; UI redirect previously wired)*
- [x] Trip: create/start/complete activity + journey + daily recap *(API)*
- [x] Passport stamps / XP / achievements *(API + Profile UI metrics)*
- [x] Explore sections: skeleton / empty / error+retry *(UI empty states verified)*
- [~] Offline: last curated cache *(not fully exercised this run)*

### 5. Known residual risks

See `debug/DEBUG_REPORT_PHASE5.md`, `docs/SUPABASE_PRODUCTION_REPORT.md`, and `docs/SMOKE_TEST_REPORT.md`.

**Launch blockers right now:** missing Maps + Gemini env keys; Auth production Site URL; rotate exposed access token.

# Rava Launch Checklist

Official name: **Rava** (EN) / **راوا** (FA)

Production build: `npm run build` (verified passing).

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
  wallet column protection, server-derived reward entitlement, soft geofence)
supabase/migrations/20240806000011_price_verification.sql   (P0.3: admin_increment_wallet
  definition, atomic finalize_price_verification, entitlement guard)
supabase/migrations/20240806000012_places_identity.sql      (B2: google_place_id column)
supabase/migrations/20240806000013_ai_usage_quota.sql       (P0.4: ai_usage + quota RPCs)
```

Apply forward-only, in order (09 already live is untouched):

```
SUPABASE_ACCESS_TOKEN=… node scripts/apply_migrations.mjs
```

> `apply_migrations.mjs` is a MANUAL RUNNER, not a migration system: it re-executes
> whole files and tracks no history. Source of truth is the Supabase migration
> history. All new schema changes must be forward-only migrations.

Re-apply (idempotent) if needed:

```
SUPABASE_ACCESS_TOKEN=… node scripts/apply_migrations.mjs
```

Confirm Edge Functions still use the **service role** key only on the server (`process-ticket`, `verify-price`, `the-dreamer`, `mint-live-token`, `ai-complete`). Frontend keeps the **anon** key only — no Gemini credential is bundled anymore (Live uses ephemeral tokens, other AI calls use the `ai-complete` proxy).

New/changed Edge Functions to deploy from repo:
- `mint-live-token` (needs secrets: `GEMINI_API_KEY`, plus `SUPABASE_URL` + `SUPABASE_ANON_KEY` for user JWT quota checks)
- `ai-complete` (same secrets as above)
- `verify-price` (rewritten trust model: needs NEW secret `VERIFY_PRICE_WEBHOOK_SECRET`, mirrored as `x-webhook-secret` header on the Database Webhook for `price_reports` INSERT)
- `process-ticket` (redeploy: ownership check)

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

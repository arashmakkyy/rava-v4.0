# PROJECT.md — Project North Star

**Product:** Rava (راوا) — Smart Tour Guide  
**Document type:** Enduring project-wide source of truth  
**Last architecture review:** 2026-08-04

---

## Product Overview

Rava is a luxury, voice-first, map-centric mobile web tour guide for Persian-speaking travelers. It turns city exploration into a reliable phone-browser experience: curated attractions on a dark Google Map, hybrid POI details (first-party curated content plus Google Places), social footprints, passport-style stamps and wallet fuel, trip timeline tools, survival utilities (currency, flashcards, subway map), and a live Gemini voice agent grounded in map and profile context.

The product is a single-page React client backed by Supabase (Auth, Postgres/PostGIS, Realtime, Storage, Edge Functions) and Google Maps / Places / Gemini. It is designed for imperfect mobile networks: IndexedDB place cache, offline outbox sync, and graceful empty/fallback paths when Google or Supabase are unavailable.

Primary city modes today: **Istanbul**, **Dubai**, and **Tehran** (schema and types support all three; map camera defaults currently specialize Istanbul vs non-Istanbul).

---

## Business Goal

Deliver a premium AI-assisted tour guide that Iranian travelers trust on real trips—discover places, hear curated narration, leave social proof, and use survival tools—while keeping maps, billing surface area, and auth stable for existing users.

---

## Target Personas

1. **Persian-speaking traveler (primary)** — Visiting Istanbul or Dubai (and expanding to Tehran), wants low-friction discovery, rich POI context, and spoken guidance on a phone browser.
2. **Expat / returning visitor** — Needs passport/stamps, favorites, referrals, and tools even when not mid-trip.
3. **Active trip user vs veteran** — Auth routing sends users with an active trip window into the map-first Dashboard; veterans default to the tools tab inside the same shell.

---

## Product Principles

1. **Simplicity** — Prefer the established stack and thin service modules over new frameworks or speculative abstractions.
2. **Production readiness** — Changes must preserve map load, auth session, wallet integrity, and Persian/RTL UI for paying users.
3. **Low operational risk** — Stage upgrades; pin Maps release channel for production; minimize billable Google Places fields.
4. **Maintainability** — Domain logic in `services/` and `store/`; UI components stay presentation-focused.
5. **Clean Architecture** — Clear boundaries: pages compose UI; stores own client state; services own external I/O; utils own shared pure helpers (`GeoPoint`).
6. **Avoid unnecessary complexity** — No second maps wrapper, no second global state library, no big-bang rewrites during platform upgrades.
7. **Root-cause solutions** — Fix coordinate order, loader ownership, and API deprecations at the boundary—not with UI patches.

---

## Technology Stack

Verified from `package.json`, `index.html`, `vite.config.ts`, `config.ts`, and source imports. Do not assume packages that are not listed here.

### Frameworks & languages
- **React** `^19.2.3` + **React DOM** `^19.2.3`
- **TypeScript** `~5.8.2`
- **Vite** `^6.2.0` (`@vitejs/plugin-react` `^5.0.0`)

### UI & client libraries
- **Zustand** `^5.0.11` (all client state; persist middleware for auth/user/discovery/survival)
- **Framer Motion** `^12.29.0`
- **Lucide React** `^0.563.0`
- **Tailwind CSS** via CDN (`cdn.tailwindcss.com` in `index.html`) plus inline critical styles in `index.html`
- **Vazirmatn** (Google Fonts)

### Maps
- **`@vis.gl/react-google-maps`** `1.1.0` (pinned in `package.json` and `index.html` importmap)
- Google Maps JavaScript API **v3** (loaded exclusively through `APIProvider`)
- **Advanced Markers** + cloud **`mapId`**
- Places (New): `google.maps.places.Place`, `fetchFields`, `Place.searchNearby`, `importLibrary("places")`
- Declared but **unused** in application TS/TSX: `@googlemaps/markerclusterer` `^2.6.2`

### Backend & data
- **Supabase** Auth, Postgres + PostGIS, RPC, Realtime, Storage, Edge Functions
- Client created via `https://esm.sh/@supabase/supabase-js@^2.48.1` in `services/supabaseClient.ts` (not an npm dependency)
- Local **IndexedDB** via `services/dbService.ts` (places cache + atomic outbox)

### AI / voice
- **`@google/genai`** `^1.38.0` (Gemini Live + vibe summaries)
- Custom `AudioGraph` (`services/audioGraph.ts`) + `hooks/useGeminiLive.ts`
- Browser Speech Synthesis for flashcard TTS (`services/survival/ttsService.ts`)

### Infrastructure / tooling
- npm scripts: `dev`, `build`, `preview`
- Supabase Edge Functions under `supabase/functions/` (`process-ticket`, `verify-price`, `the-dreamer`)
- PWA assets present: `manifest.json`, `sw.js` — service worker registers in production only (`index.tsx`); offline is best-effort (visited shell/assets + narratives/images cache), NOT full offline PWA

### External services
- Google Maps Platform (Maps JS, Places New, Map ID cloud styling)
- Google Gemini / GenAI
- Supabase cloud project (URL/anon key via `VITE_*` / `config.ts`)
- Unsplash image URLs where curated assets use them

---

## Core Product and Domain Rules

1. **Hybrid POI truth** — Curated first-party data (`attractions` / `narratives` via Supabase) wins when present; Google Places fills gaps for essentials, ratings, reviews, and nearby fallback.
2. **Coordinate order** — PostGIS / GEOGRAPHY is `(longitude, latitude)`. Google Maps and app UI use `(latitude, longitude)`. All conversions go through `utils/geoPoint.ts` (`GeoPoint`). Never invent ad-hoc parsers for PostGIS points.
3. **Place identity** — Google Place ID is the golden key for curated attractions (`attractions.place_id`) and map POI clicks.
4. **Wallet / fuel** — `wallet_balance` is AI hours (decimal). UI may display minutes as hours × 60. Default welcome gift is 2.0 hours. Fuel deduction and stamp rewards go through outbox/RPC paths for resilience.
5. **Cities** — Supported `CityMode`: `Istanbul` | `Dubai` | `Tehran` | `null`. Profiles enforce the three city names in the database check constraint.
6. **Auth gating** — Unauthenticated → `AuthScreen`; incomplete onboarding → `Onboarding`; otherwise → `Dashboard` (tab default depends on active-trip detection).
7. **Single Maps loader** — Only `components/map/MainMap.tsx` owns `APIProvider`. Do not add raw Maps `<script>` tags.
8. **Field minimization** — Places `fetchFields` must request only needed fields; photos are on-demand (`fetchPlacePhotos`).
9. **Persian voice persona** — Live agent system instruction in `constants.ts` is Persian colloquial tour-guide voice; user-facing AI text remains Persian.

---

## Localization and Interface Rules

The application is **Persian-first** and **RTL-only** for user-facing UI. This is a non-negotiable product requirement.

### Primary language
- **Persian (Farsi)** is the default for all user-visible copy: labels, buttons, navigation, errors, empty states, tooltips, modals, and AI-generated user-facing text.
- English may appear only where product-intentional (brand tokens, some secondary labels) or for inherently technical/LTR content (see exceptions).

### RTL layout
- Document root: `index.html` sets `<html lang="fa" dir="rtl">`.
- Typography: Vazirmatn; dark luxury theme (`#050505` base, yellow accent `#eab308`).
- Layouts, forms, navigation, spacing, icons, and directional interactions must behave correctly under RTL.

### Allowed LTR exceptions (only)
- Source/code snippets, URLs, emails, phone numbers, numeric IDs/codes/raw coordinates — isolated with nested `dir="ltr"` where needed; never flip the page to LTR.

### Accessibility & mobile
- Viewport is mobile-locked (`maximum-scale=1.0`, `viewport-fit=cover`).
- Safe-area padding utility (`.pb-safe`) for notched devices.
- Requested permissions (metadata): camera, microphone, geolocation.

---

## Architectural Boundaries

| Layer | Responsibility | Must not contain |
| --- | --- | --- |
| `pages/` | Tab/shell composition and screen layout | Raw Google/Supabase protocol details |
| `components/` | Reusable UI (map, POI, voice, layout, tools, social) | Duplicate business rules already in services |
| `features/` | Auth and profile/onboarding feature modules | Map loader ownership |
| `store/` | Zustand client state and orchestration of service calls | Direct Maps JS script loading |
| `services/` | External I/O (Places, discovery, auth client, sync, AI helpers, social) | JSX / visual layout |
| `hooks/` | Cross-cutting React hooks (e.g. Gemini Live) | Persistence schema ownership |
| `utils/` | Pure helpers (`GeoPoint`, geo distance, JSON/audio helpers) | Network side effects |
| `config.ts` | Env-backed keys and endpoints | Feature UI |
| `supabase/` | SQL, notes, Edge Functions | Client React components |
| `docs/` | Project Brain (this file, architecture, tasks) | Runtime code |

---

## Strict Anti-Patterns

### Maps
- Do **not** load Maps JavaScript API v2 or global `G*` APIs.
- Do **not** use legacy `google.maps.Marker` — only `AdvancedMarker` / Advanced Marker Element.
- Do **not** use legacy `google.maps.places.PlacesService` — only Places (New) `Place`.
- Do **not** introduce Drawing Library, Heatmap Layer, or KmlLayer.
- Do **not** introduce `DirectionsService` / `DistanceMatrixService` inline; if routing is ever required, use Routes library behind a dedicated service module.
- Do **not** remove/change cloud `mapId` without verifying Advanced Markers.
- Do **not** load Maps outside `APIProvider`.
- Do **not** use `beta` / `alpha` Maps channels in production.
- Do **not** add a second React maps wrapper (`@react-google-maps/api`, `google-map-react`, etc.).
- Do **not** leave unused map dependencies without an explicit keep-or-remove decision (`@googlemaps/markerclusterer` is currently unused).

### State & UI
- Do **not** introduce Redux, MobX, Jotai, Recoil, or Context-as-global-store — **Zustand only**.
- Prefer Tailwind utilities already used; do not invent a second CSS architecture.
- Do **not** duplicate API/business logic inside UI when a service already owns it.

### Localization & RTL
- Do **not** ship LTR-first root layout or English-default user-facing strings.
- Do **not** remove `lang="fa"` / `dir="rtl"` from `index.html`.
- Prefer logical start/end spacing for new layout work; verify physical `left`/`right` utilities under RTL.

### Data & security
- Do **not** invent a second coordinate type outside `GeoPoint`.
- Do **not** store PostGIS points as `(lat, lng)`.
- Do **not** commit new hardcoded secrets; prefer `VITE_*` via `config.ts` `getEnv`. Production must not rely on embedded fallback keys.
- Do **not** expand Places `fetchFields` “just in case.”
- Do **not** add speculative abstractions without a concrete current use case.

---

## Quality and Production Standards

| Area | Expectation |
| --- | --- |
| Error handling | Services return safe empties/fallbacks where UX requires continuity; log unexpected failures without leaking PII. |
| Logging | Prefer concise console diagnostics with module tags (`[Discovery]`, `[PlaceService]`, `[Sync Manager]`). Chat turns may be fire-and-forget to `chat_logs`. |
| Security | Supabase JWT for user actions; Edge Functions validate auth or use service role only server-side; RLS on user tables; public read only where content is intentionally public (curated attractions). |
| Privacy | Do not log full transcripts or locations into third-party analytics without product approval; keep secrets in env. |
| Performance | Cache curated places (24h client TTL); Places essentials/full details ~30-day IndexedDB TTL; photos on demand; avoid unnecessary map remounts. |
| Dependency management | Keep `package.json` and `index.html` importmap pins synchronized for shared CDN/npm packages used by this project. |
| Testing | No automated test runner is configured in `package.json` today; validate via `npm run build` and manual browser smoke on map/auth/voice paths. |
| Build validation | `npm run build` must succeed after dependency or type changes. |
| Browser/runtime | Target modern mobile browsers with geolocation, mic, camera; respect offline indicator and outbox replay. |
| Backward compatibility | Preserve Place ID keys, wallet semantics, and auth session storage keys unless a versioned migration is planned. |
| Failure behavior | Denied geolocation must not crash the map; Google not ready returns safe placeholders; network loss queues outbox actions. |
| Observability | Realtime profile wallet updates drive reward toasts; sync manager processes outbox on `online`. |

---

## Current Initiative Appendix

> **Temporary / initiative-specific.** Replace or archive when the maps upgrade phase ends. Does not redefine the product foundation above.

### Initiative: Maps platform upgrade readiness (production-safe)

**Correction vs user belief:** The app is **already on Maps JavaScript API v3** with Advanced Markers and Places (New). This is **not** a v2→v3 rewrite.

**Objective**
1. Bump `@vis.gl/react-google-maps` `1.1.0` → `1.9.0` (npm + importmap lockstep).
2. Pin Maps JS release channel for production (`quarterly` preferred).
3. Modernize AdvancedMarker anchoring (replace CSS `translate(-50%, -50%)` with library anchor props when available).
4. Harden Places (New) readiness (`importLibrary` consistency).
5. Resolve unused `@googlemaps/markerclusterer` (prefer remove unless clustering is immediately scheduled).

**Official Google notes informing this phase (as of 2026-08-04 research)**
- Maps JS v2 decommissioned since 2021 — not used here.
- Legacy `Marker` and `PlacesService` deprecated — project already on Advanced Markers + `Place`.
- Drawing/Heatmap unavailable as of May 2026 — unused.
- `DirectionsService` / `DistanceMatrixService` deprecated 2026-02-25 — unused; future routing must use Routes library.

**Phase anti-scope**
- Unrelated feature work, Map3D adoption, routing features, or broad bug hunts unless required to keep maps working.

**Authoritative task list for this phase:** see `docs/tasks.md` (maps upgrade roadmap). Do not treat that file as the product north star.

# ARCHITECTURE.md — System Architecture Anchor

**Product:** Rava (راوا)  
**Document type:** Enduring system architecture reference  
**Last architecture review:** 2026-08-04  
**Scope note:** Existing product. Document organization rules, data flows, and verified modules. Do not redraw the entire repository tree.

---

## System Overview

Rava is a Vite-bundled React SPA that runs primarily as a mobile web client.

**Runtime collaborators**
1. **Browser UI** — React 19 tree rooted at `index.tsx` → `App.tsx` → `AuthGuard` → `Dashboard` (or auth/onboarding).
2. **Zustand stores** — Client state for auth, user wallet/trips, UI chrome, map/POI, discovery, missions, survival tools.
3. **Service layer** — Supabase client, PlaceService, discoveryService, dbService/syncManager, AudioGraph, AI helpers, footprint/storage/survival utilities.
4. **Google Maps JS v3** — Loaded once via `@vis.gl/react-google-maps` `APIProvider` inside `MainMap`.
5. **Google Places (New)** — Essentials, full details, photos, nearby fallback.
6. **Google Gemini** — Live voice agent (`useGeminiLive`) and occasional vibe summarization (`PlaceService.getAIVibeCheck`); Edge Functions also call Gemini server-side.
7. **Supabase** — Auth, Postgres/PostGIS, RPC, Realtime profile updates, Storage (avatars, tickets, narratives, price proofs), Edge Functions.
8. **IndexedDB** — Local place payload cache and durable offline outbox (`dbService`).

There is **no React Router**. Navigation is tab state (`useUIStore.activeTab`) inside a persistent map shell.

---

## Architectural Style

Verified style: **component-based SPA with a service layer and Zustand state management**, plus **hybrid client/server data** (curated Supabase content + live Google APIs + Gemini).

Not claimed (unsupported by repo structure): microservices frontend, Redux, Clean Architecture folders beyond practical layers, or GraphQL.

---

## Major Modules and Responsibilities

### App shell & auth
| Module | Responsibility | Must not | Depends on | Public points |
| --- | --- | --- | --- | --- |
| `App.tsx` | Boot auth, sync manager, online listeners; render `AuthGuard` | Map loading | `useAuthStore`, `useUserStore`, `syncManager` | Default export |
| `features/auth/AuthGuard.tsx` | Route by session / onboarding / active trip | Places I/O | auth + user stores, pages | `AuthGuard` |
| `features/auth/*` | Email/password auth UI steps | Map state | `useAuthStore` | `AuthScreen`, steps |
| `pages/Onboarding.tsx` | City / vibe / crew onboarding | Maps API | `useAuthStore` | `Onboarding` |

### Dashboard & pages
| Module | Responsibility | Must not | Depends on | Public points |
| --- | --- | --- | --- | --- |
| `pages/Dashboard.tsx` | Host `MainMap`, tab overlays, MagicButton, vision, POI | Own Places protocol | UI store, map/poi/voice components | `Dashboard` |
| `pages/Explore.tsx` | Mood discovery feed | Direct Maps script | discovery + map stores | `Explore` |
| `pages/MyTrip.tsx` | Trip timeline / ticket scanner entry | Auth protocol | `useUserStore` | `MyTrip` |
| `pages/Tools.tsx` | Survival toolkit surface | Gemini Live | survival components/store | `Tools` |
| `pages/Profile.tsx` | Passport / actions / settings entry | Outbox processing | profile components | `Profile` |

### Map & POI
| Module | Responsibility | Must not | Depends on | Public points |
| --- | --- | --- | --- | --- |
| `components/map/MainMap.tsx` | Sole `APIProvider` owner; markers; MapController | Auth flows | map/discovery/user stores, PlaceService, GeoPoint | `MainMap` |
| `components/map/MapControls.tsx` | Curated layer toggle, recenter | Places fetch | discovery/map stores, `useMap` | `MapControls` |
| `components/poi/POIController.tsx` | POI sheet UX, expand, narrative, stamp attempt | Own Google field lists | map/user stores, PlaceService, AudioGraph | `POIController` |
| `components/tools/SubwayMap.tsx` | Static subway overlay imagery | Google Maps JS | survival store | `SubwayMap` |

### Services
| Module | Responsibility | Must not | Depends on | Public points |
| --- | --- | --- | --- | --- |
| `services/supabaseClient.ts` | Single Supabase client | UI | `config.ts` | `supabase` |
| `services/placeService.ts` | Hybrid curated + Google Places + vibe AI | JSX | Google, Supabase, dbService, GeoPoint, GenAI | `PlaceService` |
| `services/discoveryService.ts` | RPCs `search_nearby_places`, `get_city_attractions` | Google Places | Supabase | `discoveryService` |
| `services/dbService.ts` | IndexedDB places + outbox | React | browser IndexedDB | `dbService` |
| `services/syncManager.ts` | Replay outbox when online | UI rendering | dbService, supabase, user store | `syncManager` |
| `services/audioGraph.ts` | Mic VAD, live PCM playback, narrative files, SFX | Network business rules | Web Audio | `AudioGraph` |
| `services/ai/edgeService.ts` | Invoke Edge Functions | Map markers | supabase | `edgeService` |
| `services/ai/chatLogger.ts` | Fire-and-forget chat log insert | Blocking UX | supabase | `chatLogger` |
| `services/social/footprintService.ts` | Nearby footprints RPC + insert | Map React tree | supabase | `footprintService` |
| `services/storageService.ts` | Avatar upload | Auth UI | supabase storage | `storageService` |
| `services/survival/*` | Currency rates helper, TTS | Maps | browser APIs | exports |

### State stores (`store/`)
| Store | Owns | Persistence |
| --- | --- | --- |
| `useAuthStore` | Session/user flags, onboarding, semantic profile mutations | localStorage (partial; session excluded) |
| `useUserStore` | City, wallet, trips, favorites, stamps, sync, online | localStorage (partial) |
| `useUIStore` | Tabs, voice/vision chrome, captions, rewards | Memory only |
| `useMapStore` | User location, active/full POI, footprints pending, stamp celebration | Memory only |
| `useDiscoveryStore` | Curated + discovered POIs, mood, curated visibility | localStorage (curated cache fields) |
| `useMissionStore` | Photo missions | Memory only |
| `useSurvivalStore` | FX rates, flashcards, subway fullscreen, currency | localStorage |
| `useAppStore.ts` | Empty legacy stub after split | N/A |

### Voice & vision
| Module | Responsibility |
| --- | --- |
| `hooks/useGeminiLive.ts` | Gemini Live session, tools (`search_nearby`, context, preferences), fuel metering |
| `components/voice/MagicButton*` | Voice UI controls |
| `components/camera/VisionOverlay.tsx` | Camera frame send into live session |

### Config & shared types
| Module | Responsibility |
| --- | --- |
| `config.ts` | `APP_CONFIG` from `VITE_*` with fallbacks |
| `types.ts` | Shared domain TypeScript contracts |
| `constants.ts` | Subway stations, flashcards, agent `SYSTEM_INSTRUCTION` |
| `utils/geoPoint.ts` | Coordinate boundary object |
| `utils/geoUtils.ts` | Haversine / radius checks (stamping) |

---

## Data Flow

### Boot
1. `index.tsx` mounts `App`.
2. `initializeAuth()` subscribes to Supabase auth; hydrates persisted auth flags.
3. `syncManager.init()` registers `online` → outbox processing.
4. When `user` exists: `subscribeToUpdates()` (Realtime `profiles`) + `syncWithCloud()`.
5. `AuthGuard` chooses Auth / Onboarding / Dashboard.

### Tab UI
1. User taps `BottomBar` → `useUIStore.setActiveTab`.
2. `Dashboard` keeps `MainMap` mounted; non-home tabs overlay blurred content.
3. Home shows MagicButton + camera entry; `POIController` is always mounted for sheets.

### Map boot & interaction
1. `MainMap` → `APIProvider` (libraries `places`, `marker`) → `Map` with `mapId`, dark scheme, greedy gestures.
2. `MapController`:
   - Defaults `cityMode` to Istanbul if unset.
   - Listens to native map `click` with `placeId` → `PlaceService.fetchEssentials` → `setActivePOI`.
   - On city change: `fetchCurated(city)` + pan/zoom (Istanbul center vs Dubai center for non-Istanbul).
   - Geolocation watch → `setUserLocation([lat, lng])`.
3. Markers: curated (`useDiscoveryStore`), footprints (`nearby` + `pending`), user pulse AdvancedMarker.
4. Curated marker click → `setActivePOI` without Google essentials fetch.

### Discovery feed
```
Explore mood / location
        │
        ▼
discoveryService.searchNearby (Supabase RPC)
        │ empty
        ▼
PlaceService.fetchNearbyFallback (Places New)
        │
        ▼
useDiscoveryStore.discoveredPlaces → VibeCard list
```

### POI expand (hybrid)
```
POIController.handleExpand
   ├─ PlaceService.fetchHybridDetails (IndexedDB → attractions+narratives → essentials fallback)
   └─ PlaceService.fetchFullDetails (Places New ratings/hours/reviews)
        │
        ▼
Merge into fullDetailPOI; curated description OR Gemini vibe summary
        │
        ▼
Optional stamp if within 150m + not already stamped
```

### Voice agent
```
MagicButton → useGeminiLive.connect
   → AudioGraph mic PCM → Gemini Live
   → tool search_nearby → discoveryService → discovery store
   → fuel deduct via outbox on disconnect
```

### Offline write path
```
Optimistic UI / action
   → dbService.pushToOutbox
   → syncManager.processOutbox (online)
   → Supabase RPC/table insert
   → syncWithCloud refresh
```

### Error / fallback paths
- Google not ready: essentials may show Persian connection error name; nearby fallback returns `[]`.
- Discovery network fail: preserve last curated markers; explore logs error.
- Auth errors: Persian messages via `AuthResult`.
- Zero fuel: alert blocks Live connect.

---

## API and Integration Routing

### Supabase Auth
- **Entry:** `useAuthStore.initializeAuth` / login / signUp / signOut
- **Adapter:** `services/supabaseClient.ts`
- **Config:** `APP_CONFIG.SUPABASE` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- **Flow:** Session in localStorage; `AuthGuard` consumes user + onboarding metadata
- **Errors:** Mapped Persian `AuthResult`; splash until hydrated + initialized
- **Ownership:** Auth session owned by Supabase; semantic profile mirrored to `profiles`

### Google Maps JavaScript API
- **Entry:** `MainMap` `APIProvider`
- **Config:** `APP_CONFIG.GOOGLE.MAPS_API_KEY`
- **Flow:** Provider loads API → Map + AdvancedMarkers + native listeners
- **Errors:** No dedicated `onError` on provider yet (upgrade initiative)
- **Ownership:** Map UI state in Zustand; tiles/API from Google

### Google Places (New)
- **Entry:** `PlaceService` methods
- **Flow:** `waitForGoogle` / `importLibrary("places")` → `Place` + `fetchFields` / `searchNearby`
- **Language:** `requestedLanguage: 'fa'` on essentials/full details
- **Errors:** Empty objects / arrays; console errors on nearby/photo failures
- **Ownership:** Cached copies in IndexedDB; source of truth for non-curated fields is Google

### Supabase data / RPC
- **Discovery:** `search_nearby_places`, `get_city_attractions`
- **Footprints:** `get_nearby_footprints`; insert into `footprints`
- **Wallet:** `deduct_fuel`, `process_poi_visit`, `claim_referral` (and related SQL functions)
- **Tables read/written from client:** `profiles`, `trips`, `stamps`, `favorites`, `reward_ledger`, `attractions`, `chat_logs`, `footprints`, etc.
- **Realtime:** `profiles` UPDATE for wallet/XP toast

### Gemini / GenAI
- **Client Live:** `useGeminiLive` via `@google/genai` + `APP_CONFIG.GOOGLE.GEMINI_API_KEY` (also checks `process.env.API_KEY`)
- **Client text:** all non-Live AI goes through the authenticated `ai-complete` proxy (server-side prompts, per-user quota); model IDs live in `supabase/functions/_shared/models.ts`, never in client code
- **Edge:** `process-ticket`, `verify-price`, `the-dreamer` use server `GEMINI_API_KEY`

### Storage
- Avatars bucket via `storageService`
- Narratives public URLs consumed by AudioGraph / SW cache strategy (SW file present)
- Tickets / price_proofs used by Edge Functions

### Unsplash
- Optional image URLs in curated assets; `POIController` optimizes Unsplash query params

---

## Database Schema

Sources of truth in-repo: `supabase/code/database_schema.txt`, `supabase/code/sql/frozen_memory_schema_v1.sql`, plus later SQL under `supabase/code/` (stamps, reward_ledger, favorites, chat_logs, RLS patches). **Live remote schema may include migrations beyond these files; treat SQL files as confirmed design docs, not a guarantee of deployment parity.**

### Global coordinate rule
- PostGIS: `(lng, lat)`
- App/Google: `(lat, lng)`
- Convert only via `GeoPoint`

### Core tables (from `database_schema.txt`)

#### `profiles`
- `id` UUID PK → `auth.users`
- `username` TEXT UNIQUE
- `wallet_balance` DECIMAL (AI hours; UI minutes × 60)
- `xp_level`, `reputation_score`
- `current_city` CHECK (`Istanbul` | `Dubai` | `Tehran`)
- `preferences` JSONB (legacy name in base schema; runtime also uses `semantic_profile` via later migrations)
- `created_at`

Later migrations (confirmed in SQL files / client usage): `semantic_profile`, `referral_code`, `referred_by`, and related indexes.

#### `places_cache`
- Google Place ID PK, GEOGRAPHY location, category/types, address/phone/hours, photo refs, vibe_summary, lazy refresh ~30 days

#### `footprints`
- User + optional place_id, GEOGRAPHY, content, mood, upvotes, `is_verified`

#### `trips`
- Typed itinerary events with GEOGRAPHY, timing, JSON details, status

#### `price_reports`
- Contribution reports with AI verification fields

### Frozen memory layer (from `frozen_memory_schema_v1.sql`)

#### `destinations`
- City packages: name, center GEOGRAPHY, `manifest_version`, `is_active`

#### `attractions`
- PK `place_id` (Google Place ID), `destination_id`, name, location, `static_data` JSONB, `assets` JSONB, `is_premium`

#### `narratives`
- Audio URLs + transcript, trigger type, `voice_profile`, duration; FK to attractions

Public read RLS policies are defined for destinations/attractions/narratives in that schema file.

### Additional tables confirmed by client/SQL usage
- `stamps`, `favorites`, `reward_ledger`, `chat_logs`
- Exact full column lists for some of these live primarily in later SQL patches — **document columns from those files when modifying them; do not invent.**

### Undocumented / verify before changing
- Exact production deployment status of every SQL file under `supabase/code/`
- Full RLS matrix across all tables
- Whether `preferences` vs `semantic_profile` dual fields are fully consolidated remotely

---

## State Management

1. **Server state** — Supabase is source of truth for profile wallet, trips, stamps, favorites, curated attractions, chat logs.
2. **Client state** — Zustand stores; map/UI ephemeral; discovery curated cache persisted 24h TTL.
3. **Local durable** — IndexedDB for place payloads and outbox actions.
4. **Derived** — Active-trip detection in `AuthGuard` / `hasActiveTrip`; visible curated markers from `showCurated` flag.
5. **Async boundaries** — Stores call services; UI should not open parallel competing Places requests without the POI request-id guard pattern.
6. **Conflict rules** — Prefer cloud on `syncWithCloud`; outbox retries in timestamp order and stops on first failure to preserve sequence; do not duplicate wallet math in multiple writers without going through RPC/ledger patterns.

---

## Routing and Page Composition

```
App
 └─ AuthGuard
     ├─ LoadingSplash (hydration / auth init)
     ├─ AuthScreen (!user)
     ├─ Onboarding (!onboardingCompleted)
     └─ Dashboard (defaultTab tools if no active trip)
          ├─ TopBar
          ├─ MainMap (always; opacity by tab)
          ├─ Tab overlay: Explore | MyTrip | Tools | Profile
          ├─ MagicButton + Vision (home)
          ├─ BottomBar
          ├─ POIController
          └─ VisionOverlay
```

Tabs (`AppTab`): `home` | `explore` | `trip` | `tools` | `profile`  
(`trip` tab label in UI: «سفر من» / My Trip. Legacy id `wallet` removed.)

---

## File Placement Rules

| Category | Location |
| --- | --- |
| Pages / screens | `pages/` |
| Shared UI components | `components/{map,poi,voice,layout,tools,social,profile,wallet,camera,discovery,core}/` |
| Feature modules | `features/{auth,onboarding,profile}/` |
| Zustand stores | `store/` |
| Services / adapters | `services/` (+ `services/ai`, `services/social`, `services/survival`) |
| Hooks | `hooks/` |
| Utils | `utils/` |
| Shared types | `types.ts`, `supabase/code/types/` |
| Config | `config.ts`, `vite.config.ts`, `tsconfig*.json` |
| Constants / copy templates | `constants.ts` |
| Supabase SQL & functions | `supabase/` |
| Docs (Project Brain) | `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/tasks.md` |
| PWA assets | `manifest.json`, `sw.js` |
| Historical notes | `note/`, `notes/`, `project-change-log/`, `debug/` — not runtime architecture |

### Central architectural files
- `App.tsx`, `features/auth/AuthGuard.tsx`, `pages/Dashboard.tsx`
- `components/map/MainMap.tsx`, `services/placeService.ts`, `services/discoveryService.ts`
- `store/use*Store.ts`, `utils/geoPoint.ts`, `config.ts`, `hooks/useGeminiLive.ts`

### New files
- Prefer extending existing modules.
- Optional thin `services/maps/` adapter only if Places load logic becomes unsafe to keep inside `placeService.ts`.
- Do **not** create a second map component tree.

---

## Dependency and Boundary Rules

**Allowed**
- pages/components → stores, services, utils, types
- stores → services, other stores (sparingly), utils
- services → supabase client, config, utils, other services
- hooks → stores, services, constants

**Forbidden**
- services → React components
- utils → network/Supabase (keep pure)
- components → raw `createClient` bypassing `supabaseClient`
- duplicate Maps `APIProvider` outside `MainMap`
- UI importing Edge Function secrets or service-role keys

---

## Error, Loading, and Offline Behavior

| Situation | Expected behavior |
| --- | --- |
| Network offline | `useUserStore.isOnline` false; outbox retains actions; curated cache may still render; `OfflineIndicator` available |
| Missing Maps/Gemini key | Maps/voice features fail; prefer env configuration — do not expand hardcoded fallbacks |
| Unauthorized | Auth screens / Edge Function 401; user-scoped queries fail closed |
| Empty discovery | Persian empty state; optional Google nearby fallback |
| Partial POI data | Sheet shows essentials first; expand merges hybrid + Google |
| Google provider failure | Safe empty/error placeholders; preserve last curated markers |
| Invalid input | Auth validation messages in Persian; stamp requires proximity |
| Unexpected runtime errors | Console error; avoid uncaught crashes in map click / sync loops |
| Geolocation denied | Map still usable; recenter no-ops without user location |

---

## Security and Privacy Boundaries

1. Browser may hold **anon** Supabase key and Maps/Gemini keys via Vite env — treat as public client credentials; protect with HTTP referrer/API restrictions and RLS.
2. **Service role** and server `GEMINI_API_KEY` exist only in Edge Functions / Supabase secrets — never in client bundles.
3. `config.ts` currently includes fallback strings for local/dev convenience — production ops must supply `VITE_*` and must not treat fallbacks as secure defaults.
4. Do not log passwords, full card data, or unnecessary PII.
5. RLS: user tables are user-scoped; curated tourism tables may be public read by design.
6. Chat logs store conversational content — treat as sensitive user data.

---

## Performance and Scalability Rules

1. One Maps JS load path; keep `MainMap` mounted across tabs.
2. Curated fetch guarded by city + 24h TTL.
3. Places field minimization and on-demand photos.
4. Memoized markers; skip invalid lat/lng.
5. Outbox sequential processing to preserve trip/fuel ordering.
6. Avoid introducing clustering or Map3D until product explicitly requires it.
7. No speculative caching layers beyond IndexedDB + Zustand persist already in use.

---

## Architectural Anti-Patterns

- Treating this codebase as Maps JS v2 or planning a v2→v3 migration.
- Second state manager or second maps React library.
- Business logic duplicated in POI UI and PlaceService.
- Ad-hoc `{lat,lng}` PostGIS parsing outside `GeoPoint`.
- Raw Maps script tags beside `APIProvider`.
- Big-bang unrelated refactors during platform upgrades.
- Wiring unused `@googlemaps/markerclusterer` without a product clustering requirement.
- Assuming service worker is active without adding registration code.
- Assuming Tehran map camera is specialized (current code pans non-Istanbul cities to Dubai coordinates).

---

## Current Initiative Appendix

> **Temporary / initiative-specific.** Isolate from the stable architecture above. Safe to replace when the maps upgrade phase completes.

### Current architectural objective
Production-safe maps stack upgrade **without** a v2→v3 rewrite:
- Wrapper `1.1.0` → `1.9.0` (npm + importmap)
- Pin Maps channel (`quarterly`) + `APIProvider` `onError`
- Modernize AdvancedMarker anchors
- Harden Places readiness
- Remove or consciously keep unused markerclusterer

### Affected modules / files
| File | Role in initiative |
| --- | --- |
| `package.json` / `package-lock.json` | Bump wrapper; markerclusterer decision |
| `index.html` | Sync importmap; preserve `lang`/`dir` |
| `components/map/MainMap.tsx` | Channel, onError, anchors |
| `components/map/MapControls.tsx` | Verify `useMap` after bump |
| `services/placeService.ts` | Places load hygiene |
| `config.ts` | Key wiring clarification only if required |
| `docs/*` | Architect-owned documentation |

### Temporary constraints
- Prefer staged, bisectable changes over one mega-PR.
- Production: no `beta`/`alpha` Maps channels.
- Preserve Persian/RTL on all touched map-adjacent UI.
- Keep rollback via numbered Maps version pin if quarterly regresses.

### Risks
- Importmap/npm version drift
- Marker double-offset if CSS translate and native anchors both apply
- Places billing growth from expanded fields
- Subtle RTL regressions on map chrome/tooltips

### Migration / upgrade boundaries
- In scope: React Google Maps library, Maps channel, marker anchoring, Places readiness, dead dependency cleanup, smoke validation.
- Out of scope: Map3D, routing/Directions, auth/voice/Edge refactors, SubwayMap Google conversion, unrelated feature completion.

### Solution evaluation (retained)
| Option | Verdict |
| --- | --- |
| A. Console-only changes | Reject |
| B. Single PR: 1.9.0 + weekly + all edits | Reject for production |
| C. Staged inventory → dual pin → quarterly + onError → anchors → Places hygiene → dead-dep → smoke | **Selected** |

### Official references for this phase
- https://developers.google.com/maps/documentation/javascript/versions
- https://developers.google.com/maps/deprecations
- https://developers.google.com/maps/documentation/javascript/legacy/places-migration-overview
- https://visgl.github.io/react-google-maps/docs/whats-new
- npm `@vis.gl/react-google-maps@1.9.0` (noted 2026-07-03)

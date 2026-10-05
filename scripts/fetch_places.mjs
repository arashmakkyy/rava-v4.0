/**
 * scripts/fetch_places.mjs
 *
 * Resolve Google Place IDs for curated attractions and refresh their
 * coordinates/ratings/hours from Google Places API (New) into Supabase.
 *
 * IDENTITY MODEL (see migration 12): internal attractions.place_id PK NEVER
 * changes. Matching fills attractions.google_place_id + fresh geo/ratings.
 * Persian names/descriptions are curated and NEVER overwritten here.
 *
 * Usage:
 *   node scripts/fetch_places.mjs --city Istanbul            # dry-run: print plan
 *   node scripts/fetch_places.mjs --city Istanbul --apply    # resolve + upsert
 *
 * Env (only needed with --apply):
 *   GOOGLE_PLACES_API_KEY=...        (server-only, never shipped to the browser)
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
 *   (.env.local is read as a fallback source for these.)
 *
 * Safety: without --apply nothing touches the network except nothing at all —
 * dry-run prints queries and exits 0. With --apply, every row is printed
 * BEFORE its REST call so the operator can audit the log afterwards.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// English search term for Google + the synthetic PK it should match (if any).
// Entries WITHOUT matchSyn insert as brand-new curated rows (rare; review first).
// Generic/non-matchable entries (pharmacies, card centers, metro stations) are
// intentionally absent — they stay synthetic-only by design.
const CITY_QUERIES = {
  Istanbul: [
    { name: 'Galata Tower', category: 'attractions' },
    { name: 'Hagia Sophia', category: 'attractions' },
    { name: 'Topkapi Palace', category: 'attractions', matchSyn: 'rava_syn_istanbul_topkapi' },
    { name: 'Basilica Cistern', category: 'attractions', matchSyn: 'rava_syn_istanbul_cistern' },
    { name: 'Blue Mosque Sultanahmet', category: 'attractions', matchSyn: 'rava_syn_istanbul_blue_mosque' },
    { name: "Maiden's Tower Istanbul", category: 'attractions', matchSyn: 'rava_syn_istanbul_maiden_tower' },
    { name: 'Grand Bazaar Istanbul', category: 'shopping', matchSyn: 'rava_syn_istanbul_grand_bazaar' },
    { name: 'Spice Bazaar Istanbul', category: 'shopping', matchSyn: 'rava_syn_istanbul_spice_bazaar' },
    { name: 'Istiklal Street', category: 'attractions', matchSyn: 'rava_syn_istanbul_istiklal' },
    { name: 'Ciya Sofrasi Kadikoy', category: 'food', matchSyn: 'rava_syn_istanbul_ciya' },
    { name: 'Karakoy Lokantasi', category: 'food', matchSyn: 'rava_syn_istanbul_karakoy_lokanta' },
    { name: 'Mandabatmaz Turk Kahvesi', category: 'cafes', matchSyn: 'rava_syn_istanbul_mandabatmaz' },
    { name: 'Petra Roasting Co Istanbul', category: 'cafes', matchSyn: 'rava_syn_istanbul_petra_roja' },
    { name: 'Mikla Restaurant Istanbul', category: 'food', matchSyn: 'rava_syn_istanbul_mikla' },
    { name: 'Balat Istanbul', category: 'hidden_gems', matchSyn: 'rava_syn_istanbul_fener_balat' },
    { name: "Princes' Islands Istanbul", category: 'attractions', matchSyn: 'rava_syn_istanbul_princes_islands' },
    { name: 'Miniaturk Istanbul', category: 'attractions', matchSyn: 'rava_syn_istanbul_miniaturk' },
    { name: 'Gulhane Park', category: 'attractions', matchSyn: 'rava_syn_istanbul_gulhane' },
  ],
  Dubai: [
    { name: 'Burj Khalifa', category: 'attractions' },
    { name: 'The Dubai Mall', category: 'shopping' },
    { name: 'Museum of the Future Dubai', category: 'attractions', matchSyn: 'rava_syn_dubai_museum_future' },
    { name: 'Dubai Frame', category: 'attractions', matchSyn: 'rava_syn_dubai_frame' },
    { name: 'Palm Jumeirah', category: 'attractions', matchSyn: 'rava_syn_dubai_palm' },
    { name: 'Burj Al Arab', category: 'attractions', matchSyn: 'rava_syn_dubai_burj_arab' },
    { name: 'Souk Madinat Jumeirah', category: 'shopping', matchSyn: 'rava_syn_dubai_souk_madinat' },
    { name: 'Dubai Gold Souk', category: 'shopping', matchSyn: 'rava_syn_dubai_gold_souk' },
    { name: 'Ravi Restaurant Satwa', category: 'food', matchSyn: 'rava_syn_dubai_ravi' },
    { name: 'Pierchic Dubai', category: 'food', matchSyn: 'rava_syn_dubai_pierchic' },
    { name: '% Arabica Dubai', category: 'cafes', matchSyn: 'rava_syn_dubai_arabica' },
    { name: 'Al Fahidi Historical Neighbourhood', category: 'hidden_gems', matchSyn: 'rava_syn_dubai_al_fahidi' },
    { name: 'Hatta Dubai', category: 'attractions', matchSyn: 'rava_syn_dubai_hatta' },
    { name: 'Dubai Miracle Garden', category: 'attractions', matchSyn: 'rava_syn_dubai_miracle_garden' },
    { name: 'Dubai Aquarium', category: 'attractions', matchSyn: 'rava_syn_dubai_aquarium' },
    { name: 'Rashid Hospital Dubai', category: 'essentials', matchSyn: 'rava_syn_dubai_rashid_hospital' },
  ],
};

function loadEnvFromDotenv() {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

function parseArgs(argv) {
  const cityIdx = argv.indexOf('--city');
  const city = cityIdx >= 0 ? argv[cityIdx + 1] : 'Istanbul';
  const apply = argv.includes('--apply');
  return { city, apply };
}

function restHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function textSearch(query, apiKey) {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.location,places.rating,places.priceLevel,places.formattedAddress,places.regularOpeningHours,places.types',
    },
    body: JSON.stringify({ textQuery: query, languageCode: 'en', maxResultCount: 1 }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Places search failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.places?.[0] || null;
}

function toRefreshPayload(place, city, category) {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  return {
    google_place_id: place.id,
    // PostGIS geography as WKT; Supabase REST accepts it for geography columns.
    location: `SRID=4326;POINT(${lng} ${lat})`,
    static_data: {
      category,
      name_local: place.displayName?.text,
      address: place.formattedAddress || '',
      rating: place.rating ?? null,
      price_range: place.priceLevel ? Number(String(place.priceLevel).replace(/\D/g, '')) || 2 : 2,
      opening_hours: place.regularOpeningHours?.weekdayDescriptions || [],
      tags: (place.types || []).slice(0, 5),
      city,
      country: city === 'Dubai' ? 'AE' : 'TR',
      refreshed_at: new Date().toISOString(),
    },
  };
}

async function resolveDestinationId(supabaseUrl, serviceKey, city) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/destinations?name=eq.${encodeURIComponent(city)}&select=id`,
    { headers: restHeaders(serviceKey) }
  );
  if (!res.ok) throw new Error(`destinations lookup failed (${res.status})`);
  const rows = await res.json();
  if (!rows?.[0]?.id) throw new Error(`destination not found for city "${city}"`);
  return rows[0].id;
}

async function applyMatch(supabaseUrl, serviceKey, synId, payload) {
  console.log(`  SQL: UPDATE attractions SET google_place_id='${payload.google_place_id}' WHERE place_id='${synId}';`);
  const res = await fetch(
    `${supabaseUrl}/rest/v1/attractions?place_id=eq.${encodeURIComponent(synId)}`,
    {
      method: 'PATCH',
      headers: restHeaders(serviceKey, { Prefer: 'return=representation' }),
      body: JSON.stringify({
        google_place_id: payload.google_place_id,
        location: payload.location,
        static_data: payload.static_data,
      }),
    }
  );
  if (!res.ok) throw new Error(`match update failed (${res.status}): ${await res.text()}`);
}

async function applyInsert(supabaseUrl, serviceKey, destinationId, place, city, category) {
  const refresh = toRefreshPayload(place, city, category);
  const row = {
    place_id: place.id,
    destination_id: destinationId,
    // Curated Persian copy must be filled by an operator afterwards.
    name: place.displayName?.text || place.id,
    location: refresh.location,
    static_data: { ...refresh.static_data, description_fa: '' },
    assets: { photos: [] },
    is_premium: category === 'attractions',
    google_place_id: place.id,
  };
  console.log(`  SQL: INSERT attractions(place_id='${row.place_id}') — NEW curated row, Persian copy pending;`);
  const res = await fetch(`${supabaseUrl}/rest/v1/attractions`, {
    method: 'POST',
    headers: restHeaders(serviceKey, { Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert failed (${res.status}): ${await res.text()}`);
}

async function main() {
  loadEnvFromDotenv();
  const { city, apply } = parseArgs(process.argv);
  const queries = CITY_QUERIES[city];
  if (!queries) {
    console.error(`Unknown city "${city}". Supported: ${Object.keys(CITY_QUERIES).join(', ')}`);
    process.exit(1);
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log(`[fetch_places] city=${city} apply=${apply} queries=${queries.length}`);

  if (!apply || !apiKey) {
    console.log(`
DRY RUN — add --apply plus GOOGLE_PLACES_API_KEY (server-only) to resolve.
Planned queries for ${city}:
${queries.map((q) => `  - [${q.category}] ${q.name}${q.matchSyn ? `  ->  ${q.matchSyn}` : '  (NEW row)'}`).join('\n')}

Matching fills google_place_id + geo/ratings on the synthetic PK (never renames it).
Entries without matchSyn insert new rows whose Persian copy needs an operator.
`);
    process.exit(0);
  }

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for --apply.');
    process.exit(1);
  }

  const destinationId = await resolveDestinationId(supabaseUrl, serviceKey, city);
  let matched = 0;
  let inserted = 0;
  for (const q of queries) {
    try {
      const place = await textSearch(`${q.name} ${city}`, apiKey);
      if (!place) {
        console.warn(`No result for: ${q.name} (left untouched)`);
        continue;
      }
      const payload = toRefreshPayload(place, city, q.category);
      if (q.matchSyn) {
        await applyMatch(supabaseUrl, serviceKey, q.matchSyn, payload);
        console.log(`✓ ${q.name} → ${place.id} (matched ${q.matchSyn})`);
        matched += 1;
      } else {
        await applyInsert(supabaseUrl, serviceKey, destinationId, place, city, q.category);
        console.log(`✓ ${q.name} → ${place.id} (inserted)`);
        inserted += 1;
      }
    } catch (err) {
      console.error(`✗ ${q.name}:`, err.message);
    }
  }
  console.log(`[fetch_places] Done. matched=${matched} inserted=${inserted}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

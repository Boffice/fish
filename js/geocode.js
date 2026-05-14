// Look up real lake coordinates from OpenStreetMap's Nominatim service, so the
// map pins sit on the actual water rather than on hand-typed centroids.
// Results are cached per device; Nominatim asks for <=1 request/second, so
// uncached lakes are looked up sequentially in the background.

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// Bumped to v6: Jandari Lake's polygon lives on the Azerbaijani side of the
// border in OSM, so the ge-only country filter could never reach it and v5
// still cached the Georgian village by the same name. v6 forces a fresh
// lookup with the new per-lake country override + polygon-first preference.
const GEO_KEY = "fish.geo.v6";

export function loadGeoCache() {
  try {
    return JSON.parse(localStorage.getItem(GEO_KEY)) || {};
  } catch {
    return {};
  }
}

function saveGeoCache(cache) {
  localStorage.setItem(GEO_KEY, JSON.stringify(cache));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hasPolygon(r) {
  return r.geojson && (r.geojson.type === "Polygon" || r.geojson.type === "MultiPolygon");
}

// A result is a water body (not a same-named village/place) if OSM classes it
// as water, or it carries a polygon outline.
function isWaterBody(r) {
  return (
    r.category === "natural" ||
    r.category === "water" ||
    r.type === "water" ||
    r.type === "reservoir" ||
    hasPolygon(r)
  );
}

async function geocodeOne(lake) {
  // polygon_geojson returns the full lake outline (simplified a little by
  // polygon_threshold); extratags carries any OSM depth tag if one exists.
  // limit=5 + the polygon/water preference picks the lake even when a village
  // shares its name. `countries` is per-lake so transboundary lakes (Jandari)
  // can include their neighbour's country code.
  const countries = lake.countries || "ge";
  const url =
    `${NOMINATIM}?q=${encodeURIComponent(lake.search)}` +
    `&countrycodes=${encodeURIComponent(countries)}&format=jsonv2&limit=5` +
    `&polygon_geojson=1&polygon_threshold=0.0008&extratags=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  if (!data.length) return null;
  // Prefer a result that actually carries a lake outline — that's almost
  // always the lake itself rather than a same-named village or hamlet.
  const r = data.find(hasPolygon) || data.find(isWaterBody) || data[0];
  const out = { lat: Number(r.lat), lon: Number(r.lon) };
  if (hasPolygon(r)) out.shape = r.geojson;
  const tags = r.extratags || {};
  const depth = tags.max_depth || tags.depth;
  if (depth) out.depth = String(depth);
  return out;
}

// Geocode any lakes not already cached. `onProgress(cache)` fires after each
// successful lookup. Returns the full { lakeId: {lat, lon} } cache.
export async function geocodeLakes(lakes, onProgress) {
  const cache = loadGeoCache();
  const pending = lakes.filter((l) => !cache[l.id]);
  for (const lake of pending) {
    try {
      const coord = await geocodeOne(lake);
      if (coord) {
        cache[lake.id] = coord;
        saveGeoCache(cache);
        if (onProgress) onProgress({ ...cache });
      }
    } catch {
      // Leave this lake uncached; the built-in fallback coordinate is used.
    }
    await sleep(1100); // stay within Nominatim's ~1 req/sec guidance
  }
  return cache;
}

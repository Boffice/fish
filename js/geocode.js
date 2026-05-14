// Look up real lake coordinates from OpenStreetMap's Nominatim service, so the
// map pins sit on the actual water rather than on hand-typed centroids.
// Results are cached per device; Nominatim asks for <=1 request/second, so
// uncached lakes are looked up sequentially in the background.

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const GEO_KEY = "fish.geo.v2";

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

async function geocodeOne(lake) {
  // polygon_geojson returns the full lake outline (simplified a little by
  // polygon_threshold) so the app can reason about the whole water body.
  const url =
    `${NOMINATIM}?q=${encodeURIComponent(lake.search)}` +
    `&countrycodes=ge&format=jsonv2&limit=1` +
    `&polygon_geojson=1&polygon_threshold=0.0008`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  if (!data.length) return null;
  const r = data[0];
  const out = { lat: Number(r.lat), lon: Number(r.lon) };
  if (r.geojson && (r.geojson.type === "Polygon" || r.geojson.type === "MultiPolygon")) {
    out.shape = r.geojson;
  }
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

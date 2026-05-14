// UI controller: wires the controls, fetches the forecast once, and renders
// the ranked lake list plus an hourly detail view.

import { LAKES, SPECIES } from "./data.js";
import { fetchForecast, fetchNormals } from "./weather.js";
import { loadGeoCache, geocodeLakes } from "./geocode.js";
import { bestWindow, ratingLabel, moonPhase, moonLabel, spotAdvice } from "./scoring.js";

const el = (id) => document.getElementById(id);
const speciesSel = el("species");
const lakeSel = el("lake");
const dateSel = el("date");
const planBtn = el("planBtn");
const statusEl = el("status");
const resultsEl = el("results");
const weekEl = el("week");
const moonEl = el("moon");

let forecast = null; // cached { lakesById, days }
let normals = null; // cached per-lake monthly climate normals (best-effort)

// Favorite lakes are kept in the browser only (localStorage) — per device,
// no account needed.
const FAV_KEY = "fish.favorites";

function loadFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY)) || []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  localStorage.setItem(FAV_KEY, JSON.stringify([...favorites]));
}

let favorites = loadFavorites();

// Lake coordinates are geocoded from OpenStreetMap (cached per device); the
// built-in centroids in data.js are only a fallback until geocoding lands.
let geoCoords = loadGeoCache();

function lakeCoord(lake) {
  const c = geoCoords[lake.id];
  return c ? { lat: c.lat, lon: c.lon } : { lat: lake.lat, lon: lake.lon };
}

// The lake's outline polygon (GeoJSON geometry) if geocoding found one.
function lakeShape(lake) {
  return geoCoords[lake.id]?.shape || null;
}

// LAKES with geocoded coordinates applied where available.
function effectiveLakes() {
  return LAKES.map((l) => {
    const c = geoCoords[l.id];
    return c ? { ...l, lat: c.lat, lon: c.lon } : l;
  });
}

function fmtHour(ts) {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtDay(key) {
  const d = new Date(key + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function fmtDayShort(key) {
  const d = new Date(key + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
}

function compass(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function trendArrow(delta) {
  if (delta <= -1.2) return { arrow: "↓", word: "falling", cls: "t-fall" };
  if (delta >= 1.2) return { arrow: "↑", word: "rising", cls: "t-rise" };
  return { arrow: "→", word: "steady", cls: "t-steady" };
}

function populateControls() {
  speciesSel.innerHTML =
    `<option value="any">Any fish (pick the best for me)</option>` +
    SPECIES.map((s) => `<option value="${s.id}">${s.name} — ${s.geo}</option>`).join("");

  lakeSel.innerHTML =
    `<option value="all">All lakes (ranked)</option>` +
    `<option value="favorites">★ My favorite lakes</option>` +
    LAKES.map((l) => `<option value="${l.id}">${l.name} — ${l.region}</option>`).join("");
}

function populateDates() {
  dateSel.innerHTML = forecast.days
    .map((d, i) => `<option value="${d}">${fmtDay(d)}${i === 0 ? " (today)" : ""}</option>`)
    .join("");
}

// Pick the result for a lake+day: either the chosen species, or whichever
// species scores best when "any" is selected.
function evaluate(lakeId, dayKey, speciesId) {
  const dayHours = forecast.lakesById[lakeId]?.hoursByDay[dayKey];
  if (!dayHours || dayHours.length === 0) return null;

  if (speciesId === "any") {
    let best = null;
    for (const sp of SPECIES) {
      const w = bestWindow(dayHours, sp);
      if (!best || w.dayScore > best.result.dayScore) {
        best = { species: sp, result: w };
      }
    }
    return best;
  }
  const sp = SPECIES.find((s) => s.id === speciesId);
  return { species: sp, result: bestWindow(dayHours, sp) };
}

// Which lakes the current filter is looking at.
function lakesForFilter(lakeId) {
  if (lakeId === "favorites") return LAKES.filter((l) => favorites.has(l.id));
  if (lakeId === "all") return LAKES;
  return LAKES.filter((l) => l.id === lakeId);
}

// Score every forecast day so the week strip can flag the best ones. A day's
// score is the top lake score available that day for the current filter.
function weekOutlook(speciesId, lakeId) {
  const lakes = lakesForFilter(lakeId);
  return forecast.days.map((day) => {
    let score = -1;
    let topLake = null;
    for (const lake of lakes) {
      const ev = evaluate(lake.id, day, speciesId);
      if (ev && ev.result.dayScore > score) {
        score = ev.result.dayScore;
        topLake = lake;
      }
    }
    return { day, score: Math.max(0, score), topLake };
  });
}

// Move a coordinate `distKm` along a compass `bearingDeg` (small-distance
// flat-earth approximation — fine at lake scale).
function offsetCoord(lat, lon, bearingDeg, distKm) {
  const br = (bearingDeg * Math.PI) / 180;
  const dLat = (distKm / 111) * Math.cos(br);
  const dLon = (distKm / (111 * Math.cos((lat * Math.PI) / 180))) * Math.sin(br);
  return [lat + dLat, lon + dLon];
}

// GeoJSON polygon rings (arrays of [lon, lat]); flattens MultiPolygon.
function shapeRings(geojson) {
  if (!geojson) return [];
  if (geojson.type === "Polygon") return geojson.coordinates;
  if (geojson.type === "MultiPolygon") return geojson.coordinates.flat();
  return [];
}

// Ray-casting point-in-polygon test against any ring of the lake.
function pointInRings(lon, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const crosses =
        yi > lat !== yj > lat &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (crosses) inside = !inside;
    }
  }
  return inside;
}

// Walk outward from the lake centre along `bearingDeg` and return the last
// point still inside the lake — i.e. the shoreline in that direction.
function shorePoint(geojson, lat, lon, bearingDeg) {
  const rings = shapeRings(geojson);
  if (!rings.length) return null;
  let lastInside = null;
  for (let dist = 0; dist <= 14; dist += 0.05) {
    const [plat, plon] = offsetCoord(lat, lon, bearingDeg, dist);
    if (pointInRings(plon, plat, rings)) lastInside = [plat, plon];
    else if (lastInside) break;
  }
  return lastInside;
}

// Shoelace area of one ring (m²), via a local equirectangular projection.
function ringAreaM2(ring) {
  if (ring.length < 4) return 0;
  const lat0 = (ring[0][1] * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(lat0);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0] * mPerDegLon;
    const yi = ring[i][1] * mPerDegLat;
    const xj = ring[j][0] * mPerDegLon;
    const yj = ring[j][1] * mPerDegLat;
    sum += xj * yi - xi * yj;
  }
  return Math.abs(sum) / 2;
}

// Lake surface area in km² from its polygon (subtracts holes, sums parts).
function polygonAreaKm2(geojson) {
  const polys =
    geojson?.type === "Polygon"
      ? [geojson.coordinates]
      : geojson?.type === "MultiPolygon"
        ? geojson.coordinates
        : [];
  let total = 0;
  for (const poly of polys) {
    poly.forEach((ring, idx) => {
      total += idx === 0 ? ringAreaM2(ring) : -ringAreaM2(ring);
    });
  }
  return total / 1e6;
}

// A short "facts" line for a lake: surface area, elevation, and depth where
// OpenStreetMap actually provides it.
function lakeFacts(lake) {
  const shape = lakeShape(lake);
  const parts = [];
  if (shape) {
    const km2 = polygonAreaKm2(shape);
    parts.push(`📐 ${km2 < 1 ? km2.toFixed(2) : km2.toFixed(1)} km²`);
  }
  parts.push(`⛰️ ${lake.elevation} m`);
  const depth = geoCoords[lake.id]?.depth;
  if (depth) {
    const d = depth.trim();
    parts.push(`🌊 ${/^[\d.]+$/.test(d) ? d + " m" : d}`);
  }
  return parts.join(" · ");
}

// Leaflet maps are created lazily (once a card's detail panel is opened) and
// tracked so they can be torn down whenever the card list is re-rendered.
let mapInstances = {};
function initLakeMap(lake, refHour) {
  const id = `map-${lake.id}`;
  if (mapInstances[id] || typeof L === "undefined") return;
  const container = document.getElementById(id);
  if (!container) return;

  const { lat, lon } = lakeCoord(lake);
  const shape = lakeShape(lake);
  const map = L.map(container, { scrollWheelZoom: false }).setView([lat, lon], 12);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  // Draw the whole lake outline and frame the map to it.
  if (shape) {
    const layer = L.geoJSON(shape, {
      style: { color: "#4cc9f0", weight: 2, fillColor: "#4cc9f0", fillOpacity: 0.18 },
    }).addTo(map);
    map.fitBounds(layer.getBounds(), { padding: [18, 18] });
  }
  L.marker([lat, lon])
    .addTo(map)
    .bindPopup(`<b>${lake.name}</b><br><small>${lakeFacts(lake)}</small>`);

  // The green marker is the app's suggestion: the windward shore, where wind
  // and surface drift stack baitfish and the predators that follow them. With
  // a real outline it sits on the actual shoreline; otherwise it's an offset.
  if (refHour && refHour.wind >= 3) {
    const toward = (refHour.windDir + 180) % 360;
    const spot =
      (shape && shorePoint(shape, lat, lon, toward)) ||
      offsetCoord(lat, lon, toward, 2.2);
    L.polyline([[lat, lon], spot], { color: "#2ec4b6", weight: 3 }).addTo(map);
    L.circleMarker(spot, {
      radius: 9,
      color: "#2ec4b6",
      fillColor: "#2ec4b6",
      fillOpacity: 0.8,
    })
      .addTo(map)
      .bindPopup("<b>Suggested spot</b><br><small>Wind pushes baitfish to this shore.</small>");
  }

  mapInstances[id] = map;
  setTimeout(() => map.invalidateSize(), 60); // container was hidden until now
}

function weatherSummary(h, lake) {
  const t = trendArrow(h.pressureTrend);
  const n = normals?.[lake.id];
  const month = new Date(h.ts).getMonth();
  const tempNorm =
    n?.temp?.[month] != null
      ? ` <span class="norm">(norm ${Math.round(n.temp[month])}°)</span>`
      : "";
  return `
    <div class="wx">
      <span title="Air temperature vs seasonal normal">🌡️ ${Math.round(h.temp)}°C${tempNorm}</span>
      <span title="Sea-level pressure & 3h trend" class="${t.cls}">
        🌀 ${Math.round(h.pressure)} hPa ${t.arrow}
      </span>
      <span title="Wind">💨 ${Math.round(h.wind)} km/h ${compass(h.windDir)}</span>
      <span title="Cloud cover">☁️ ${Math.round(h.cloud)}%</span>
      <span title="Precipitation">🌧️ ${h.precip.toFixed(1)} mm</span>
    </div>`;
}

function hourlyBars(scored, windowStart, windowEnd) {
  const a = windowStart?.ts ?? -1;
  const b = windowEnd?.ts ?? -1;
  return `<div class="bars">${scored
    .map(({ h, score }) => {
      const inWin = h.ts >= a && h.ts <= b;
      const { cls } = ratingLabel(score);
      return `
        <div class="bar ${inWin ? "in-window" : ""}" title="${fmtHour(h.ts)} — score ${score}">
          <div class="bar-fill ${cls}" style="height:${Math.max(4, score)}%"></div>
          <div class="bar-label">${new Date(h.ts).getHours()}</div>
        </div>`;
    })
    .join("")}</div>`;
}

function lakeCard(lake, evalResult, rank, speciesId) {
  const { species, result } = evalResult;
  const { dayScore, windowStart, windowEnd, scored } = result;
  const rating = ratingLabel(dayScore);
  const windowTxt = windowStart
    ? `${fmtHour(windowStart.ts)}–${fmtHour(windowEnd.ts)}`
    : "—";
  const refHour = windowStart ?? scored[Math.floor(scored.length / 2)]?.h;
  const isFav = favorites.has(lake.id);
  const spot = refHour ? spotAdvice(refHour) : null;

  return `
    <article class="card" data-lake="${lake.id}">
      <header class="card-head">
        <span class="rank">#${rank}</span>
        <div class="card-title">
          <h3>${lake.name}</h3>
          <p class="region">${lake.region}</p>
        </div>
        <div class="score ${rating.cls}">
          <span class="score-num">${dayScore}</span>
          <span class="score-label">${rating.label}</span>
        </div>
        <button class="fav-btn ${isFav ? "on" : ""}" data-fav="${lake.id}"
                aria-label="${isFav ? "Remove from favorites" : "Add to favorites"}"
                title="${isFav ? "Remove from favorites" : "Add to favorites"}">
          ${isFav ? "★" : "☆"}
        </button>
      </header>
      <div class="card-body">
        <p class="recommend">
          <strong>Best window:</strong> ${windowTxt}
          ${speciesId === "any" ? `&nbsp;·&nbsp; <strong>Target:</strong> ${species.name}` : ""}
        </p>
        ${refHour ? weatherSummary(refHour, lake) : ""}
        <p class="lake-facts">${lakeFacts(lake)}</p>
        ${
          spot
            ? `<p class="spot">📍 <strong>Where on the lake:</strong> ${spot.summary}</p>
               <p class="spot-why">${spot.why}</p>`
            : ""
        }
        <p class="species-note">${species.note}</p>
        <button class="toggle" data-lake="${lake.id}">Show map &amp; hours ▾</button>
        <div class="detail" id="detail-${lake.id}" hidden>
          <div class="lake-map" id="map-${lake.id}"></div>
          ${hourlyBars(scored, windowStart, windowEnd)}
        </div>
      </div>
    </article>`;
}

// The "best days this week" strip. Chips are scored, colour-coded, and the
// top-scoring day(s) are tagged; tapping a chip jumps to that day.
function renderWeek(speciesId, lakeId, dayKey) {
  const outlook = weekOutlook(speciesId, lakeId);
  const best = Math.max(...outlook.map((o) => o.score));

  weekEl.innerHTML =
    `<p class="week-title">Best days ahead</p><div class="week">` +
    outlook
      .map((o) => {
        const r = ratingLabel(o.score);
        const isSel = o.day === dayKey;
        const isBest = o.score === best && o.score > 0;
        return `
        <button class="day-chip ${r.cls} ${isSel ? "sel" : ""} ${isBest ? "best" : ""}"
                data-day="${o.day}" title="${o.topLake ? "Top: " + o.topLake.name : ""}">
          <span class="day-name">${fmtDayShort(o.day)}</span>
          <span class="day-score">${o.score}</span>
          <span class="day-tag">${isBest ? "best" : r.label}</span>
        </button>`;
      })
      .join("") +
    `</div>`;

  weekEl.querySelectorAll(".day-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      dateSel.value = chip.dataset.day;
      render();
    });
  });
}

function render() {
  const speciesId = speciesSel.value;
  const lakeId = lakeSel.value;
  const dayKey = dateSel.value;

  const moonP = moonPhase(new Date(dayKey + "T21:00:00"));
  moonEl.textContent = `Moon: ${moonLabel(moonP)}`;

  renderWeek(speciesId, lakeId, dayKey);

  // Rank every lake first, so a single-lake view can still show its standing.
  const ranked = LAKES.map((lake) => ({ lake, ev: evaluate(lake.id, dayKey, speciesId) }))
    .filter((x) => x.ev)
    .sort((a, b) => b.ev.result.dayScore - a.ev.result.dayScore);
  ranked.forEach((x, i) => (x.rank = i + 1));

  if (ranked.length === 0) {
    resultsEl.innerHTML = `<p class="empty">No forecast data for that day.</p>`;
    statusEl.textContent = "No forecast data for that day.";
    return;
  }

  let display;
  if (lakeId === "all") {
    // Keep score order, but float favorited lakes to the top of the list.
    display = [...ranked].sort(
      (a, b) =>
        (favorites.has(b.lake.id) ? 1 : 0) - (favorites.has(a.lake.id) ? 1 : 0),
    );
  } else if (lakeId === "favorites") {
    display = ranked.filter((x) => favorites.has(x.lake.id));
  } else {
    display = ranked.filter((x) => x.lake.id === lakeId);
  }

  const targetTxt =
    speciesId === "any"
      ? "the best available fish"
      : SPECIES.find((s) => s.id === speciesId).name;

  if (lakeId === "favorites" && display.length === 0) {
    resultsEl.innerHTML =
      `<p class="empty">No favorite lakes yet. Tap the ☆ on any lake to add it here.</p>`;
    statusEl.textContent = `${fmtDay(dayKey)} — no favorite lakes saved yet.`;
    return;
  }

  if (lakeId === "all") {
    statusEl.textContent = `${fmtDay(dayKey)} — ${ranked.length} lakes ranked for ${targetTxt}.`;
  } else if (lakeId === "favorites") {
    statusEl.textContent =
      `${fmtDay(dayKey)} — ${display.length} favorite lake${display.length === 1 ? "" : "s"} ranked for ${targetTxt}.`;
  } else {
    const x = display[0];
    statusEl.textContent =
      `${fmtDay(dayKey)} — ${x.lake.name} ranks #${x.rank} of ${ranked.length} for ${targetTxt}.`;
  }

  // Tear down any live maps before their container DOM is replaced.
  Object.values(mapInstances).forEach((m) => m.remove());
  mapInstances = {};

  resultsEl.innerHTML = display
    .map((x) => lakeCard(x.lake, x.ev, x.rank, speciesId))
    .join("");

  resultsEl.querySelectorAll(".toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.lake;
      const d = el(`detail-${id}`);
      d.hidden = !d.hidden;
      btn.textContent = d.hidden ? "Show map & hours ▾" : "Hide map & hours ▴";
      if (!d.hidden) {
        const x = display.find((y) => y.lake.id === id);
        if (x) {
          const r = x.ev.result;
          const refHour = r.windowStart ?? r.scored[Math.floor(r.scored.length / 2)]?.h;
          initLakeMap(x.lake, refHour);
        }
      }
    });
  });

  resultsEl.querySelectorAll(".fav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.fav;
      if (favorites.has(id)) favorites.delete(id);
      else favorites.add(id);
      saveFavorites();
      render();
    });
  });

  // When the view is narrowed to one lake, open its detail panel (map + hours).
  if (display.length === 1) {
    const x = display[0];
    const d = el(`detail-${x.lake.id}`);
    const btn = resultsEl.querySelector(".toggle");
    if (d && btn) {
      d.hidden = false;
      btn.textContent = "Hide map & hours ▴";
      const r = x.ev.result;
      const refHour = r.windowStart ?? r.scored[Math.floor(r.scored.length / 2)]?.h;
      initLakeMap(x.lake, refHour);
    }
  }
}

async function init() {
  populateControls();
  statusEl.textContent = "Loading forecast from Open-Meteo…";
  try {
    const lakes = effectiveLakes();
    forecast = await fetchForecast(lakes);
    populateDates();
    statusEl.textContent = "Forecast ready. Pick a fish and a day, then plan your trip.";
    planBtn.disabled = false;
    render();

    // Seasonal normals are best-effort: load them in the background and
    // re-render when ready, so the headline forecast never waits on them.
    fetchNormals(lakes)
      .then((n) => {
        normals = n;
        render();
      })
      .catch(() => {});

    // Geocode real lake locations from OpenStreetMap (cached per device).
    // Coordinates update live; re-render once done so the maps land right.
    geocodeLakes(LAKES, (cache) => {
      geoCoords = cache;
    })
      .then((cache) => {
        geoCoords = cache;
        render();
      })
      .catch(() => {});
  } catch (err) {
    statusEl.textContent = `Could not load forecast: ${err.message}. Check your connection and reload.`;
  }
}

planBtn.addEventListener("click", render);
speciesSel.addEventListener("change", render);
lakeSel.addEventListener("change", render);
dateSel.addEventListener("change", render);

init();

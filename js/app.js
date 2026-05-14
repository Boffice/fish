// UI controller: wires the controls, fetches the forecast once, and renders
// the ranked lake list plus an hourly detail view.

import { LAKES, SPECIES } from "./data.js";
import { fetchForecast } from "./weather.js";
import { bestWindow, ratingLabel, moonPhase, moonLabel } from "./scoring.js";

const el = (id) => document.getElementById(id);
const speciesSel = el("species");
const dateSel = el("date");
const planBtn = el("planBtn");
const statusEl = el("status");
const resultsEl = el("results");
const moonEl = el("moon");

let forecast = null; // cached { lakesById, days }

function fmtHour(ts) {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtDay(key) {
  const d = new Date(key + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
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

function weatherSummary(h) {
  const t = trendArrow(h.pressureTrend);
  return `
    <div class="wx">
      <span title="Air temperature">🌡️ ${Math.round(h.temp)}°C</span>
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

  return `
    <article class="card" data-lake="${lake.id}">
      <header class="card-head">
        <span class="rank">#${rank}</span>
        <div class="card-title">
          <h3>${lake.name}</h3>
          <p class="region">${lake.region} · ${lake.elevation} m</p>
        </div>
        <div class="score ${rating.cls}">
          <span class="score-num">${dayScore}</span>
          <span class="score-label">${rating.label}</span>
        </div>
      </header>
      <div class="card-body">
        <p class="recommend">
          <strong>Best window:</strong> ${windowTxt}
          ${speciesId === "any" ? `&nbsp;·&nbsp; <strong>Target:</strong> ${species.name}` : ""}
        </p>
        ${refHour ? weatherSummary(refHour) : ""}
        <p class="species-note">${species.note}</p>
        <button class="toggle" data-lake="${lake.id}">Show hour-by-hour ▾</button>
        <div class="detail" id="detail-${lake.id}" hidden>
          ${hourlyBars(scored, windowStart, windowEnd)}
        </div>
      </div>
    </article>`;
}

function render() {
  const speciesId = speciesSel.value;
  const dayKey = dateSel.value;

  const moonP = moonPhase(new Date(dayKey + "T21:00:00"));
  moonEl.textContent = `Moon: ${moonLabel(moonP)}`;

  const ranked = LAKES.map((lake) => ({ lake, ev: evaluate(lake.id, dayKey, speciesId) }))
    .filter((x) => x.ev)
    .sort((a, b) => b.ev.result.dayScore - a.ev.result.dayScore);

  if (ranked.length === 0) {
    resultsEl.innerHTML = `<p class="empty">No forecast data for that day.</p>`;
    return;
  }

  const targetTxt =
    speciesId === "any"
      ? "the best available fish"
      : SPECIES.find((s) => s.id === speciesId).name;
  statusEl.textContent = `${fmtDay(dayKey)} — ${ranked.length} lakes ranked for ${targetTxt}.`;

  resultsEl.innerHTML = ranked
    .map((x, i) => lakeCard(x.lake, x.ev, i + 1, speciesId))
    .join("");

  resultsEl.querySelectorAll(".toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = el(`detail-${btn.dataset.lake}`);
      d.hidden = !d.hidden;
      btn.textContent = d.hidden ? "Show hour-by-hour ▾" : "Hide hour-by-hour ▴";
    });
  });
}

async function init() {
  populateControls();
  statusEl.textContent = "Loading forecast from Open-Meteo…";
  try {
    forecast = await fetchForecast();
    populateDates();
    statusEl.textContent = "Forecast ready. Pick a fish and a day, then plan your trip.";
    planBtn.disabled = false;
    render();
  } catch (err) {
    statusEl.textContent = `Could not load forecast: ${err.message}. Check your connection and reload.`;
  }
}

planBtn.addEventListener("click", render);
speciesSel.addEventListener("change", render);
dateSel.addEventListener("change", render);

init();

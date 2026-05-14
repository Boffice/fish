// Bite-score engine.
//
// For every forecast hour we build a set of 0..1 sub-scores from the weather,
// blend them with species-specific weights, then apply season and moon
// multipliers. A day's headline score is the best contiguous 3-hour window,
// which is also reported back as the recommended time to fish.

const SYNODIC = 29.530588853; // days in a lunar cycle
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) / 86400000; // in days

// Moon phase as 0 (new) .. 0.5 (full) .. 1 (new again).
export function moonPhase(date) {
  const days = date.getTime() / 86400000 - KNOWN_NEW_MOON;
  const pos = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  return pos / SYNODIC;
}

export function moonLabel(phase) {
  const names = [
    "New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
    "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent",
  ];
  return names[Math.round(phase * 8) % 8];
}

// Fish feed harder around the new and full moon. Map phase -> 0.85..1.1.
function moonFactor(phase) {
  const closeness = Math.cos(phase * 2 * Math.PI * 2); // peaks at new & full
  return 0.97 + 0.13 * Math.max(0, closeness) - 0.06 * Math.max(0, -closeness);
}

// Gaussian-ish bump: 1 at centre, falling to ~0 a few halfWidths away.
function bell(value, center, halfWidth) {
  const z = (value - center) / halfWidth;
  return Math.exp(-z * z);
}

// Flat-topped band: 1 inside [lo,hi], ramping to 0 over `ramp` either side.
function band(value, lo, hi, ramp) {
  if (value >= lo && value <= hi) return 1;
  if (value < lo) return Math.max(0, 1 - (lo - value) / ramp);
  return Math.max(0, 1 - (value - hi) / ramp);
}

function tempScore(airTemp, species) {
  const [lo, hi] = species.tempOpt;
  return band(airTemp, lo, hi, 9);
}

// Absolute barometric pressure (hPa at sea level). Fish are most comfortable
// in the 1012-1022 band; extremes shut the bite down.
function pressureLevelScore(p) {
  return 0.25 + 0.75 * band(p, 1012, 1022, 22);
}

// Pressure trend over the previous 3 hours is the single strongest signal.
// A slow, steady fall ahead of a front triggers feeding; sharp moves and
// post-front rises kill it.
function pressureTrendScore(delta3h) {
  if (delta3h <= -6) return 0.30; // storm crashing in
  if (delta3h <= -1.2) return 1.00; // classic pre-front feed
  if (delta3h < 1.2) return 0.80; // stable
  if (delta3h < 4) return 0.50; // building high
  return 0.30; // sharp post-front rise
}

// Light breeze oxygenates and hides the angler; dead calm and gales do not.
function windScore(kmh) {
  return 0.30 + 0.70 * band(kmh, 6, 19, 16);
}

function cloudScore(cloudPct, species) {
  if (species.cloudPref === "high") return 0.45 + 0.55 * (cloudPct / 100);
  if (species.cloudPref === "low") return 0.55 + 0.45 * (1 - cloudPct / 100);
  return 0.7 + 0.3 * (1 - Math.abs(cloudPct - 55) / 55); // generalists like mid
}

function precipScore(mm) {
  if (mm <= 0.1) return 1.0;
  if (mm <= 1.5) return 0.92; // light rain often helps
  if (mm <= 4) return 0.7;
  if (mm <= 9) return 0.45;
  return 0.25;
}

// Low-light windows (around sunrise / sunset) are prime. Night value depends
// on the species; bright midday is the weakest slot for most fish.
function lightScore(hourTs, sunrise, sunset, isDay, species) {
  const hrsFromSunrise = Math.abs(hourTs - sunrise) / 3600000;
  const hrsFromSunset = Math.abs(hourTs - sunset) / 3600000;
  const twilight = Math.max(bell(hrsFromSunrise, 0, 1.6), bell(hrsFromSunset, 0, 1.6));
  const base = isDay ? 0.55 : 0.30 + 0.55 * species.night;
  return Math.min(1, base + 0.55 * twilight);
}

const WEIGHTS = {
  temp: 0.16,
  pressureLevel: 0.13,
  pressureTrend: 0.22,
  wind: 0.12,
  cloud: 0.09,
  precip: 0.08,
  light: 0.20,
};

// Score a single hour for one species. `h` is a normalised hour record.
export function scoreHour(h, species) {
  const parts = {
    temp: tempScore(h.temp, species),
    pressureLevel: pressureLevelScore(h.pressure),
    pressureTrend: pressureTrendScore(h.pressureTrend),
    wind: windScore(h.wind),
    cloud: cloudScore(h.cloud, species),
    precip: precipScore(h.precip),
    light: lightScore(h.ts, h.sunrise, h.sunset, h.isDay, species),
  };
  // Pressure-sensitive species lean harder on the barometer terms.
  const w = { ...WEIGHTS };
  const lean = species.pressW;
  w.pressureTrend *= 0.6 + 0.8 * lean;
  w.pressureLevel *= 0.6 + 0.8 * lean;

  let total = 0, wsum = 0;
  for (const k in parts) {
    total += parts[k] * w[k];
    wsum += w[k];
  }
  const blended = total / wsum;

  const month = new Date(h.ts).getMonth();
  const seasonMul = species.season[month];
  const moonMul = moonFactor(moonPhase(new Date(h.ts)));

  const score = Math.round(Math.max(0, Math.min(1, blended * seasonMul * moonMul)) * 100);
  return { score, parts, seasonMul, moonMul };
}

// Given the hours belonging to one calendar day, find the best 3-hour window.
export function bestWindow(dayHours, species) {
  const scored = dayHours.map((h) => ({ h, ...scoreHour(h, species) }));
  let best = { avg: -1, start: 0 };
  for (let i = 0; i + 2 < scored.length; i++) {
    const avg = (scored[i].score + scored[i + 1].score + scored[i + 2].score) / 3;
    if (avg > best.avg) best = { avg, start: i };
  }
  const dayAvg = scored.reduce((s, x) => s + x.score, 0) / (scored.length || 1);
  return {
    scored,
    dayScore: Math.round(best.avg < 0 ? dayAvg : best.avg),
    dayAvg: Math.round(dayAvg),
    windowStart: scored[best.start]?.h ?? null,
    windowEnd: scored[best.start + 2]?.h ?? null,
  };
}

export function ratingLabel(score) {
  if (score >= 78) return { label: "Prime", cls: "prime" };
  if (score >= 60) return { label: "Good", cls: "good" };
  if (score >= 42) return { label: "Fair", cls: "fair" };
  return { label: "Slow", cls: "slow" };
}

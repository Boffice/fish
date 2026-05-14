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

// Fish feed harder around the new and full moon. Range 0.75..1.0: a good moon
// never inflates the score past the ceiling (which used to peg almost every
// day at 100 in peak season), the quarters pull it down.
function moonFactor(phase) {
  const closeness = Math.cos(phase * 2 * Math.PI * 2); // peaks at new & full
  return 0.85 + 0.15 * Math.max(0, closeness) - 0.10 * Math.max(0, -closeness);
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

function tempScore(waterTemp, species) {
  const [lo, hi] = species.tempOpt;
  return band(waterTemp, lo, hi, 9);
}

// Absolute barometric pressure (hPa at sea level). Fish are most comfortable
// in the 1012-1022 band; extremes shut the bite down.
function pressureLevelScore(p) {
  return 0.25 + 0.75 * band(p, 1012, 1022, 22);
}

// Pressure trend over the previous 3 hours is the single strongest signal.
// A slow, steady fall ahead of a front triggers feeding; sharp moves and
// post-front rises kill it. Modelled as a smooth bell centred at -2 hPa/3h
// (the classic pre-front feed) so small input changes don't flip score bins.
function pressureTrendScore(delta3h) {
  const z = (delta3h + 2) / 3.0;
  return 0.30 + 0.70 * Math.exp(-z * z);
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
// Twilight bonus capped at +0.35 (was +0.55) so dawn/dusk hours don't
// auto-saturate the score — they were pegging light at 1.0 every single day,
// which fed straight into the headline inflation.
function lightScore(hourTs, sunrise, sunset, isDay, species) {
  const hrsFromSunrise = Math.abs(hourTs - sunrise) / 3600000;
  const hrsFromSunset = Math.abs(hourTs - sunset) / 3600000;
  const twilight = Math.max(bell(hrsFromSunrise, 0, 1.6), bell(hrsFromSunset, 0, 1.6));
  const base = isDay ? 0.55 : 0.30 + 0.55 * species.night;
  return Math.min(1, base + 0.35 * twilight);
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

// Per-1000m-above-500m, biological "spring" arrives roughly one month later
// at altitude. We shift the species season curve backwards by this many
// months for high lakes so May at Tabatskuri (1991 m) reads more like late
// March/April at sea level. Linear interpolation between adjacent months
// keeps the curve continuous.
function seasonalMultiplier(species, month, elevation) {
  const shift = elevation > 500 ? (elevation - 500) / 1000 : 0;
  const effective = month - shift;
  const m0 = ((Math.floor(effective) % 12) + 12) % 12;
  const m1 = (m0 + 1) % 12;
  const f = effective - Math.floor(effective);
  return species.season[m0] * (1 - f) + species.season[m1] * f;
}

// Score a single hour for one species. `h` is a normalised hour record;
// `lake` is needed for the elevation-shifted season curve.
export function scoreHour(h, species, lake) {
  const parts = {
    temp: tempScore(h.waterTemp ?? h.temp, species),
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

  // The weighted sub-scores realistically sit in a ~0.55-1.0 band — the light,
  // wind and precip terms keep the floor up, so blended rarely drops below
  // ~0.5. Stretching that band across [0,1] keeps mediocre days off "prime"
  // and reserves a true 100 for hours where every sub-score lands at the top.
  // Upper clamp removed: let season/moon multipliers still discriminate
  // between near-perfect hours instead of squashing them all to 1.0.
  const contrasted = Math.max(0, (blended - 0.55) / 0.45);

  const month = new Date(h.ts).getMonth();
  const elevation = lake?.elevation ?? 0;
  const seasonMul = seasonalMultiplier(species, month, elevation);
  const moonMul = moonFactor(moonPhase(new Date(h.ts)));

  const score = Math.round(Math.max(0, Math.min(1, contrasted * seasonMul * moonMul)) * 100);
  return { score, parts, seasonMul, moonMul };
}

// Given the hours belonging to one calendar day, find the best 3-hour window.
export function bestWindow(dayHours, species, lake) {
  const scored = dayHours.map((h) => ({ h, ...scoreHour(h, species, lake) }));
  let best = { avg: -1, start: 0 };
  for (let i = 0; i + 2 < scored.length; i++) {
    const avg = (scored[i].score + scored[i + 1].score + scored[i + 2].score) / 3;
    if (avg > best.avg) best = { avg, start: i };
  }
  const dayAvg = scored.reduce((s, x) => s + x.score, 0) / (scored.length || 1);
  const peak = best.avg < 0 ? dayAvg : best.avg;
  // Headline = mostly the best 3-h window, partly the day-as-a-whole. Without
  // the blend, any day with one decent dawn hour scored "Prime" — the window
  // bias used to drown out the question of whether the rest of the day was
  // any good at all.
  const blended = 0.65 * peak + 0.35 * dayAvg;
  return {
    scored,
    dayScore: Math.round(blended),
    dayPeak: Math.round(peak),
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

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function bearing(deg) {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// Where on the lake to position, from wind, pressure and cloud.
//
// Wind direction from Open-Meteo is the direction the wind blows FROM, so the
// productive "windward" bank is the one it blows toward (deg + 180): wind and
// surface drift stack plankton and baitfish against it, and predators follow.
// Pressure sets the depth: a high/rising barometer pins fish deep and tight to
// structure, a low/falling one (or heavy cloud) lifts them into the shallows.
export function spotAdvice(h) {
  const towardDeg = (h.windDir + 180) % 360;
  let shore, shoreReason;
  if (h.wind >= 8) {
    shore = `the ${bearing(towardDeg)} shore`;
    shoreReason = `the ${bearing(h.windDir)} wind at ${Math.round(h.wind)} km/h stacks food against it`;
  } else if (h.wind >= 3) {
    shore = `the ${bearing(towardDeg)} shore`;
    shoreReason = `a light ${bearing(h.windDir)} breeze gives that bank a mild push`;
  } else {
    shore = "points, inflows and shaded structure";
    shoreReason = "it is near calm, so there is no wind-driven side — fish features and cover";
  }

  let depth, depthReason;
  const rising = h.pressureTrend > 2.5 || h.pressure >= 1023;
  const falling = h.pressureTrend < -1.5 || h.pressure <= 1008;
  if (rising) {
    depth = "deeper water and drop-offs";
    depthReason = "high / rising pressure pins fish down and tight to structure";
  } else if (falling || h.cloud >= 70) {
    depth = "shallow flats and bays";
    depthReason = falling
      ? "low / falling pressure lifts fish into the shallows to feed"
      : "heavy cloud cover lets fish roam and feed shallow";
  } else {
    depth = "mid-depth weed edges and breaklines";
    depthReason = "steady pressure keeps fish on their usual feeding edges";
  }

  return {
    shore,
    depth,
    summary: `Work ${shore}, focusing on ${depth}.`,
    why: `${shoreReason}; ${depthReason}.`,
  };
}

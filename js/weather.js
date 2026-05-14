// Open-Meteo integration. One multi-location request covers every lake, so
// the planner can rank them all from a single fetch. No API key required.
// Callers pass the lakes array (already carrying any user coordinate fixes).

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const TZ = "Asia/Tbilisi";

function buildUrl(lakes) {
  const lat = lakes.map((l) => l.lat).join(",");
  const lon = lakes.map((l) => l.lon).join(",");
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: [
      "temperature_2m",
      // Soil temperature at ~18 cm is the closest free proxy for shallow
      // lake-water temperature — it lags air temp by days, the way water
      // does. Used by the species temp comfort score; air temp is kept for
      // the on-card weather summary.
      "soil_temperature_18cm",
      "pressure_msl",
      "wind_speed_10m",
      "wind_direction_10m",
      "cloud_cover",
      "precipitation",
      "precipitation_probability",
      "is_day",
    ].join(","),
    daily: ["sunrise", "sunset"].join(","),
    timezone: TZ,
    forecast_days: "14",
    wind_speed_unit: "kmh",
  });
  return `${ENDPOINT}?${params.toString()}`;
}

// Normalise one Open-Meteo location block into a flat array of hour records,
// each carrying the 3-hour pressure trend and that day's sunrise/sunset.
function normalise(block) {
  const hrs = block.hourly;
  const daily = block.daily;

  // Map "YYYY-MM-DD" -> {sunrise ts, sunset ts}.
  const sun = {};
  daily.time.forEach((d, i) => {
    sun[d] = {
      sunrise: new Date(daily.sunrise[i]).getTime(),
      sunset: new Date(daily.sunset[i]).getTime(),
    };
  });

  return hrs.time.map((iso, i) => {
    const ts = new Date(iso).getTime();
    const dayKey = iso.slice(0, 10);
    const s = sun[dayKey] || { sunrise: ts, sunset: ts };
    const prevPressure = i >= 3 ? hrs.pressure_msl[i - 3] : hrs.pressure_msl[i];
    const air = hrs.temperature_2m[i];
    const soil = hrs.soil_temperature_18cm?.[i];
    return {
      ts,
      iso,
      dayKey,
      temp: air,
      // Lake-water proxy for scoring. Falls back to air temp if Open-Meteo
      // returns null for soil temp at this location/hour.
      waterTemp: soil ?? air,
      pressure: hrs.pressure_msl[i],
      pressureTrend: hrs.pressure_msl[i] - prevPressure,
      wind: hrs.wind_speed_10m[i],
      windDir: hrs.wind_direction_10m[i],
      cloud: hrs.cloud_cover[i],
      precip: hrs.precipitation[i],
      // % chance of measurable rain in this hour; some Open-Meteo models
      // return null, so callers should treat undefined as "unknown".
      precipProb: hrs.precipitation_probability?.[i] ?? null,
      isDay: hrs.is_day[i] === 1,
      sunrise: s.sunrise,
      sunset: s.sunset,
    };
  });
}

// Returns { lakesById: { id: { hours, hoursByDay } }, days: ["YYYY-MM-DD", ...] }.
export async function fetchForecast(lakes) {
  const res = await fetch(buildUrl(lakes));
  if (!res.ok) throw new Error(`Open-Meteo request failed (${res.status})`);
  let data = await res.json();
  if (!Array.isArray(data)) data = [data]; // single-location responses aren't arrays

  const lakesById = {};
  let days = [];
  data.forEach((block, idx) => {
    const lake = lakes[idx];
    if (!lake) return;
    const hours = normalise(block);
    const hoursByDay = {};
    for (const h of hours) {
      (hoursByDay[h.dayKey] ||= []).push(h);
    }
    lakesById[lake.id] = { hours, hoursByDay };
    if (Object.keys(hoursByDay).length > days.length) {
      days = Object.keys(hoursByDay);
    }
  });

  return { lakesById, days };
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function archiveUrl(lakes) {
  const lat = lakes.map((l) => l.lat).join(",");
  const lon = lakes.map((l) => l.lon).join(",");
  // Five recent, complete years of history (archive data lags ~5 days, so we
  // stop a year back to stay well clear of the gap).
  const end = new Date();
  end.setFullYear(end.getFullYear() - 1);
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 5);
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    start_date: isoDate(start),
    end_date: isoDate(end),
    daily: "temperature_2m_mean",
    timezone: TZ,
  });
  return `${ARCHIVE}?${params.toString()}`;
}

// Per-lake monthly temperature normals (Jan..Dec) from recent years of
// history, used to show how today's forecast compares to "normal for this
// time of year". Returns { lakeId: { temp: [12] } }.
export async function fetchNormals(lakes) {
  const res = await fetch(archiveUrl(lakes));
  if (!res.ok) throw new Error(`Open-Meteo archive request failed (${res.status})`);
  let data = await res.json();
  if (!Array.isArray(data)) data = [data];

  const byLake = {};
  data.forEach((block, idx) => {
    const lake = lakes[idx];
    if (!lake || !block.daily) return;
    const d = block.daily;
    const acc = Array.from({ length: 12 }, () => ({ t: 0, n: 0 }));
    d.time.forEach((iso, i) => {
      const t = d.temperature_2m_mean[i];
      if (t == null) return;
      const m = Number(iso.slice(5, 7)) - 1;
      acc[m].t += t;
      acc[m].n += 1;
    });
    byLake[lake.id] = { temp: acc.map((a) => (a.n ? a.t / a.n : null)) };
  });
  return byLake;
}

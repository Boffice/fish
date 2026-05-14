// Open-Meteo integration. One multi-location request covers every lake, so
// the planner can rank them all from a single fetch. No API key required.

import { LAKES } from "./data.js";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const TZ = "Asia/Tbilisi";

function buildUrl() {
  const lat = LAKES.map((l) => l.lat).join(",");
  const lon = LAKES.map((l) => l.lon).join(",");
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: [
      "temperature_2m",
      "pressure_msl",
      "wind_speed_10m",
      "wind_direction_10m",
      "cloud_cover",
      "precipitation",
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
    return {
      ts,
      iso,
      dayKey,
      temp: hrs.temperature_2m[i],
      pressure: hrs.pressure_msl[i],
      pressureTrend: hrs.pressure_msl[i] - prevPressure,
      wind: hrs.wind_speed_10m[i],
      windDir: hrs.wind_direction_10m[i],
      cloud: hrs.cloud_cover[i],
      precip: hrs.precipitation[i],
      isDay: hrs.is_day[i] === 1,
      sunrise: s.sunrise,
      sunset: s.sunset,
    };
  });
}

// Returns { lakesById: { id: { hours, hoursByDay } }, days: ["YYYY-MM-DD", ...] }.
export async function fetchForecast() {
  const res = await fetch(buildUrl());
  if (!res.ok) throw new Error(`Open-Meteo request failed (${res.status})`);
  let data = await res.json();
  if (!Array.isArray(data)) data = [data]; // single-location responses aren't arrays

  const lakesById = {};
  let days = [];
  data.forEach((block, idx) => {
    const lake = LAKES[idx];
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

function archiveUrl() {
  const lat = LAKES.map((l) => l.lat).join(",");
  const lon = LAKES.map((l) => l.lon).join(",");
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
    daily: ["temperature_2m_mean", "wind_speed_10m_mean"].join(","),
    timezone: TZ,
    wind_speed_unit: "kmh",
  });
  return `${ARCHIVE}?${params.toString()}`;
}

// Per-lake monthly climate normals (Jan..Dec) from recent years of history,
// used to show how today's forecast compares to "normal for this time of year".
// Returns { lakeId: { temp: [12], wind: [12] } }.
export async function fetchNormals() {
  const res = await fetch(archiveUrl());
  if (!res.ok) throw new Error(`Open-Meteo archive request failed (${res.status})`);
  let data = await res.json();
  if (!Array.isArray(data)) data = [data];

  const byLake = {};
  data.forEach((block, idx) => {
    const lake = LAKES[idx];
    if (!lake || !block.daily) return;
    const d = block.daily;
    const acc = Array.from({ length: 12 }, () => ({ t: 0, w: 0, n: 0 }));
    d.time.forEach((iso, i) => {
      const m = Number(iso.slice(5, 7)) - 1;
      const t = d.temperature_2m_mean[i];
      if (t == null) return;
      acc[m].t += t;
      acc[m].w += d.wind_speed_10m_mean[i] ?? 0;
      acc[m].n += 1;
    });
    byLake[lake.id] = {
      temp: acc.map((a) => (a.n ? a.t / a.n : null)),
      wind: acc.map((a) => (a.n ? a.w / a.n : null)),
    };
  });
  return byLake;
}

// Open-Meteo integration. One multi-location request covers every lake, so
// the planner can rank them all from a single fetch. No API key required.

import { LAKES } from "./data.js";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
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

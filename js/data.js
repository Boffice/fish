// Static reference data for the Georgia (country) lake fishing planner.
// Coordinates are approximate lake centroids; elevation in metres is used
// only as a hint for the UI.

// lat/lon are fallback centroids only — actual coordinates are geocoded from
// OpenStreetMap at runtime using `search`. `search` is the Nominatim query.
export const LAKES = [
  { id: "paravani",   name: "Paravani Lake",   region: "Samtskhe-Javakheti", lat: 41.451, lon: 43.784, elevation: 2073, search: "Paravani Lake" },
  { id: "tabatskuri", name: "Tabatskuri Lake", region: "Samtskhe-Javakheti", lat: 41.648, lon: 43.620, elevation: 1991, search: "Tabatskuri Lake" },
  { id: "sagamo",     name: "Sagamo Lake",     region: "Samtskhe-Javakheti", lat: 41.310, lon: 43.650, elevation: 1996, search: "Saghamo Lake" },
  { id: "khanchali",  name: "Khanchali Lake",  region: "Samtskhe-Javakheti", lat: 41.282, lon: 43.553, elevation: 1928, search: "Khanchali Lake" },
  { id: "kartsakhi",  name: "Kartsakhi Lake",  region: "Samtskhe-Javakheti", lat: 41.198, lon: 43.255, elevation: 1799, search: "Kartsakhi Lake" },
  { id: "madatapa",   name: "Madatapa Lake",   region: "Samtskhe-Javakheti", lat: 41.176, lon: 43.834, elevation: 2108, search: "Madatapa Lake" },
  { id: "tsalka",     name: "Tsalka Reservoir", region: "Kvemo Kartli",      lat: 41.594, lon: 44.080, elevation: 1457, search: "Tsalka Reservoir" },
  { id: "bazaleti",   name: "Bazaleti Lake",   region: "Mtskheta-Mtianeti",  lat: 42.052, lon: 44.535, elevation: 878,  search: "Bazaleti Lake" },
  { id: "tbilisisea", name: "Tbilisi Reservoir (Sea)", region: "Tbilisi",    lat: 41.783, lon: 44.872, elevation: 540,  search: "Tbilisi Sea" },
  { id: "lisi",       name: "Lisi Lake",       region: "Tbilisi",            lat: 41.742, lon: 44.741, elevation: 620,  search: "Lisi Lake Tbilisi" },
  { id: "kumisi",     name: "Kumisi Lake",     region: "Kvemo Kartli",       lat: 41.601, lon: 44.781, elevation: 463,  search: "Kumisi Lake" },
  { id: "jandari",    name: "Jandari Lake",    region: "Kvemo Kartli",       lat: 41.423, lon: 45.151, elevation: 295,  search: "ჯანდარის ტბა" },
  { id: "sioni",      name: "Sioni Reservoir", region: "Mtskheta-Mtianeti",  lat: 42.099, lon: 44.778, elevation: 1067, search: "Sioni Reservoir Tianeti" },
  { id: "shaori",     name: "Shaori Reservoir", region: "Racha",             lat: 42.451, lon: 43.045, elevation: 1132, search: "Shaori Reservoir" },
  { id: "tkibuli",    name: "Tkibuli Reservoir", region: "Imereti",          lat: 42.347, lon: 42.985, elevation: 750,  search: "Tkibuli Reservoir" },
];

// Species commonly fished in lakes of the country of Georgia.
//
// tempOpt   : [min, max] air-temperature comfort band (°C) used as a proxy
//             for water temperature / metabolic activity.
// cloudPref : "high" predators that hunt better under low light,
//             "mid" generalists, "low" species that prefer bright stable days.
// pressW    : how strongly this species reacts to barometric pressure (0-1).
// night     : relative willingness to feed after dark (0-1).
// season    : per-month activity multiplier (Jan..Dec), 0.3 = sluggish, 1 = peak.
export const SPECIES = [
  {
    id: "trout", name: "Brown / Lake Trout", geo: "კალმახი",
    tempOpt: [7, 17], cloudPref: "high", pressW: 0.7, night: 0.25,
    season: [0.55, 0.6, 0.8, 1.0, 1.0, 0.8, 0.6, 0.55, 0.8, 1.0, 0.85, 0.6],
    note: "Cold-water predator. Loves overcast skies, dawn and dusk, and a slowly falling barometer.",
  },
  {
    id: "carp", name: "Common Carp", geo: "კობრი",
    tempOpt: [18, 28], cloudPref: "mid", pressW: 0.55, night: 0.7,
    season: [0.3, 0.3, 0.45, 0.7, 0.95, 1.0, 1.0, 1.0, 0.9, 0.65, 0.4, 0.3],
    note: "Warm-water bottom feeder. Best on stable high pressure, warm summer mornings and nights.",
  },
  {
    id: "crucian", name: "Crucian Carp", geo: "კარჭხანა",
    tempOpt: [16, 26], cloudPref: "mid", pressW: 0.4, night: 0.45,
    season: [0.3, 0.3, 0.5, 0.75, 0.95, 1.0, 0.95, 0.95, 0.85, 0.6, 0.4, 0.3],
    note: "Hardy and tolerant. Forgiving of weather swings; calm warm days are still best.",
  },
  {
    id: "pike", name: "Northern Pike", geo: "ქარიყლაპია",
    tempOpt: [9, 19], cloudPref: "high", pressW: 0.8, night: 0.3,
    season: [0.7, 0.7, 0.9, 1.0, 0.85, 0.65, 0.55, 0.55, 0.85, 1.0, 0.95, 0.8],
    note: "Ambush predator. Fires up just before a front when pressure drops; overcast and breezy is ideal.",
  },
  {
    id: "perch", name: "European Perch", geo: "ღორჯო",
    tempOpt: [11, 23], cloudPref: "mid", pressW: 0.55, night: 0.2,
    season: [0.6, 0.6, 0.75, 0.9, 1.0, 0.9, 0.8, 0.8, 0.95, 1.0, 0.8, 0.65],
    note: "Active shoaling predator. Feeds through much of the day, peaking morning and late afternoon.",
  },
  {
    id: "zander", name: "Pike-perch (Zander)", geo: "ფეცკარა",
    tempOpt: [13, 24], cloudPref: "high", pressW: 0.7, night: 0.85,
    season: [0.55, 0.55, 0.7, 0.85, 1.0, 0.95, 0.9, 0.9, 0.95, 0.9, 0.7, 0.6],
    note: "Low-light hunter. Dawn, dusk and night are prime; dislikes bright high-pressure middays.",
  },
  {
    id: "catfish", name: "Wels Catfish", geo: "ლოქო",
    tempOpt: [20, 30], cloudPref: "high", pressW: 0.6, night: 0.95,
    season: [0.2, 0.2, 0.3, 0.55, 0.8, 1.0, 1.0, 1.0, 0.8, 0.5, 0.3, 0.2],
    note: "Warm-water night feeder. Humid summer nights and the hours before a thunderstorm are explosive.",
  },
  {
    id: "bream", name: "Common Bream", geo: "კაპარჭინა",
    tempOpt: [16, 26], cloudPref: "mid", pressW: 0.5, night: 0.6,
    season: [0.3, 0.3, 0.5, 0.75, 0.95, 1.0, 0.95, 0.9, 0.8, 0.6, 0.4, 0.3],
    note: "Schooling bottom feeder. Calm, warm, slightly overcast dawns bring the big shoals in.",
  },
  {
    id: "roach", name: "Roach", geo: "წვერა",
    tempOpt: [9, 22], cloudPref: "mid", pressW: 0.35, night: 0.3,
    season: [0.55, 0.55, 0.7, 0.85, 0.95, 1.0, 0.95, 0.95, 0.9, 0.8, 0.65, 0.55],
    note: "Year-round generalist. Tolerant of weather; light wind and stable pressure help.",
  },
  {
    id: "whitefish", name: "Whitefish", geo: "სიგი",
    tempOpt: [5, 15], cloudPref: "high", pressW: 0.6, night: 0.35,
    season: [0.7, 0.7, 0.85, 0.95, 0.85, 0.6, 0.45, 0.45, 0.7, 0.95, 1.0, 0.8],
    note: "High-altitude cold-water species. Best in the cool shoulder seasons on the Javakheti lakes.",
  },
];

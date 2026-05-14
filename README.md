# Georgia Lake Fishing Planner

A no-build static web app that ranks lakes in the **country of Georgia** by a
weather-driven **bite score**, so an angler knows *where* and *when* to fish.
Pick a target fish + a day; it pulls live forecasts, scores every lake, ranks
them, and shows a map with a suggested spot.

This file is the handoff doc — read it before changing anything.

---

## Running it

It's plain HTML/CSS/ES-modules — **no build step, no dependencies to install**.
ES modules need to be served over HTTP (not opened as a `file://`).

```bash
python3 -m http.server 8000      # then open http://localhost:8000
# or:  npx serve
```

### Deployment

- **`main`** is the deployed branch. It's served two ways:
  - **raw.githack.com** (zero-setup): `https://raw.githack.com/Boffice/fish/main/index.html`
  - **GitHub Pages** via `.github/workflows/deploy.yml` (runs on push to `main`).
- **`claude/fishing-trip-planner-7bW0g`** is the development branch.
- Historically `main` was updated via the GitHub API because the dev sandbox
  couldn't `git push` to `main`. On a normal machine just develop on the dev
  branch and merge/push to `main` normally (or work on `main` directly).

### ⚠️ Cache busting — do not forget

`index.html` references assets with a version query: `css/styles.css?v=13`,
`js/app.js?v=13`. **Every time you change `app.js` or `styles.css`, bump that
number** (`?v=14`, ...). Without it, browsers — especially mobile — serve stale
files and "nothing changed" bug reports follow. Only `app.js` and `styles.css`
are versioned; the other JS modules are reached through `app.js`'s import graph,
so bumping `app.js` is enough to refresh them too.

---

## Project structure

```
index.html              Shell: controls, containers, loads Leaflet + app.js
css/styles.css           All styling (dark "water" theme, responsive)
js/data.js               Static data: LAKES (15) and SPECIES (10)
js/weather.js            Open-Meteo: live forecast + historical normals
js/geocode.js            OpenStreetMap Nominatim: real lake coords + outlines
js/scoring.js            The bite-score engine (pure functions, no DOM)
js/app.js                UI controller: fetch, render, events, the Leaflet map
.github/workflows/deploy.yml   GitHub Pages deploy
```

Dependency direction: `app.js` imports from `data/weather/geocode/scoring`.
`weather.js` and `geocode.js` are passed the lakes array by `app.js` (they don't
import `data.js` themselves). `scoring.js` is pure — no imports, no DOM.

---

## How it works (data flow)

1. `init()` loads the geocode cache from `localStorage`, then `fetchForecast()`
   gets a 14-day hourly forecast for all lakes in **one** Open-Meteo request.
2. `render()` runs: for the selected fish + day it scores every lake, ranks
   them, draws the "best days ahead" week strip and the lake cards.
3. Two best-effort background jobs then run and re-`render()` when done:
   - `fetchNormals()` — historical monthly temperature normals.
   - `geocodeLakes()` — real coordinates + outline polygons from OSM,
     looked up one lake/sec (Nominatim rate limit), cached forever.
4. A lake card's Leaflet map is created lazily, only when its panel is opened.

---

## The bite-score algorithm (`scoring.js`)

Per forecast **hour**, `scoreHour()` builds 0–1 sub-scores and blends them with
species-specific weights:

| Sub-score      | Weight | Idea |
|----------------|--------|------|
| pressure trend | 0.22   | a slow 3 h fall before a front = feeding; sharp moves / post-front rises kill it. **Strongest signal.** |
| light          | 0.20   | dawn/dusk twilight windows are prime; night value is species-dependent |
| temperature    | 0.16   | air temp as a proxy for water temp vs the species' comfort band |
| pressure level | 0.13   | absolute hPa; ~1012–1022 is the comfortable band |
| wind           | 0.12   | a light breeze (6–19 km/h) is best; dead calm and gales are not |
| cloud          | 0.09   | predators favour overcast; generalists like mid cover |
| precip         | 0.08   | light rain can help; heavy rain hurts |

- Pressure-sensitive species lean the two pressure weights up via `species.pressW`.
- The blended 0–1 value is then **contrast-stretched** `(blended-0.4)/0.5` — the
  raw weighted average realistically only spans ~0.4–0.9, so without this every
  day scored 85–100 and ratings were meaningless.
- Finally multiplied by `seasonMul` (per-species monthly activity) and `moonMul`
  (feeding peaks near new/full moon), clamped, ×100.

`bestWindow()` scores all of a day's hours and returns the best contiguous
**3-hour window** — that's the day's headline score and the recommended time.

`spotAdvice()` turns wind + pressure + cloud into where-on-the-lake text
(windward shore + depth zone). On the map, `shorePoint()` walks from the lake
centre along the windward bearing across the real polygon to put the green
"suggested spot" marker on the actual shoreline.

`ratingLabel()` buckets a score: Prime ≥78, Good ≥60, Fair ≥42, Slow <42.

---

## External APIs (all free, no keys)

| API | Used for | Notes |
|-----|----------|-------|
| Open-Meteo Forecast | live 14-day hourly weather | one multi-location request |
| Open-Meteo Archive  | 5-year monthly temp normals | best-effort; failure just hides "(norm)" |
| OSM Nominatim       | real lake coords + outline polygons + depth tag | ≤1 req/sec, looked up sequentially, cached |
| OSM tiles + Leaflet | the map | Leaflet 1.9.4 from unpkg CDN |

---

## Data model (`data.js`)

- **`LAKES`** — 15 lakes. `lat`/`lon` are *fallback* centroids only; real
  coordinates + outline come from geocoding at runtime via the `search` field
  (the Nominatim query string).
- **`SPECIES`** — 10 species, each with: `tempOpt` band, `cloudPref`
  (high/mid/low), `pressW` (0–1 pressure sensitivity), `night` (0–1 willingness
  to feed after dark), `season` (12 monthly multipliers), and a `note`.

## Browser storage (localStorage)

- `fish.favorites` — array of favourited lake ids.
- `fish.geo.v4` — `{ lakeId: { lat, lon, shape?, depth? } }` geocode cache.
  **Bump the `vN` suffix** in `geocode.js` whenever the cached shape changes —
  it forces a clean re-geocode.

---

## Known issues & pending work

- **"Any fish" week strip saturates.** It shows the single best species across
  all lakes, so it trends high. Picking a specific fish discriminates properly.
  Open option: switch "Any fish" aggregation from max → average.
- **Lake depth is sparse.** No free bathymetry API exists; only shown when OSM
  happens to have a `depth`/`max_depth` tag. Real figures could be added
  per-lake in `data.js` if the user supplies them.
- **Geocoding can still miss a lake** if no good OSM match exists. `geocodeOne()`
  already prefers water bodies over same-named villages (this fixed Jandari).
  If a lake has no polygon, the app falls back to the `data.js` centroid and
  shows no outline/area. Fallback plan: hand-traced GeoJSON polygons baked in.
- **The scoring model is a heuristic**, tuned from general fishing knowledge —
  not validated against real catch data. The species profiles in `data.js` are
  the main tuning surface.
- **Never live-tested against the APIs** during initial development (sandbox had
  no network). Worth a real end-to-end check.

## Conventions

- No build, no framework, no dependencies beyond Leaflet (CDN). Keep it that way
  unless there's a strong reason.
- `scoring.js` stays pure (no DOM, no fetch) so it's testable with plain Node.
- Comments explain *why*, not *what*.

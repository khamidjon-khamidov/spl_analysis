# Visualization Dashboard

This document describes every page in the React frontend dashboard, the data each page consumes, the interactions it supports, and the design decisions behind it.

The dashboard is built with **React + Vite**, **react-map-gl / MapLibre GL** for maps, and **Recharts** for statistical charts. All pages are theme-consistent (dark background `#0f0f19`, card surfaces `#1a1a2e`) and respond to the global **Imputation Method** selector in the navbar.

---

## Global Controls

### Imputation Method Selector

A dropdown in the top-right of the navbar allows switching the data source for every page simultaneously. The selected value is stored in `DataSourceContext` and passed as `?source=` to all API calls.

| Option | Backend source | Data table |
|---|---|---|
| Original | `original` | `sp_levels` |
| Historical Median | `historical` | `spl_levels_historical_imp` |
| KNN | `knn` | `spl_levels_knn_imp` |
| Historical + KNN | `combined` | `spl_levels_combined_imp` |
| TimesFM | `timesfm` | `spl_levels_timesfm_imp` |

Switching the method triggers a re-fetch on every page that is currently mounted.

---

## Pages

### 1. Devices — `/devices`

**Purpose:** Give an overview of all 471 sensors — their location, data quality, and imputation coverage.

**Map layer:** One circle marker per device, colored by fill rate for the currently selected source:
- Green `#22c55e` — < 20% missing after imputation
- Amber `#f59e0b` — 20–50% missing
- Red `#ef4444` — > 50% missing

**Marker detail:** A thin left-edge chip (blue `#3b82f6`) marks the 35 test devices used in evaluation. A badge overlay shows `TEST` with the device's group (`A` / `B` / `C`).

**Click popup:** Clicking a marker opens a panel showing:
- Device name and coordinates
- Data start / end dates and total hours
- `hours_with_data` and `missing_hours`
- Fill counts for all four imputation methods

**Bottom bar:** A summary count of green / amber / red devices updates as the source changes.

**API:** `GET /devices/all`

---

### 2. SPL Static — `/spl-static`

**Purpose:** Show a snapshot of SPL readings across all devices at any specific date and hour.

**Controls:**
- Date picker (constrained to `min_date`–`max_date` from `/spl/date-range`)
- Hour selector (0–23)

**Map layer:** Circle markers colored by WHO tier:

| Color | Range |
|---|---|
| `#22c55e` Green | < 45 dB — Safe |
| `#a3e635` Lime | 45–55 dB — Acceptable |
| `#facc15` Yellow | 55–65 dB — Moderate concern |
| `#f97316` Orange | 65–75 dB — High concern |
| `#ef4444` Red | ≥ 75 dB — Dangerous |

**Imputation chip:** A narrow pink left-edge chip on the marker indicates `imputed = 1` (i.e., the displayed value was filled, not measured). Absence of the chip means the reading is original.

**Legend:** A fixed overlay in the top-right lists all five WHO tiers with their colors and dB ranges.

**API:** `GET /spl/static?timestamp=dd-mm-yyyy hh:00&source=`

---

### 3. SPL Daily Analysis — `/spl-daily`

**Purpose:** Animate the spatial SPL distribution hour-by-hour over a selected date range.

**Controls:**
- From / To date pickers (same date constraints as Static page)
- Play / Pause button
- Speed selector: 1×, 2×, 3×, 5×, 10× (intervals: 1000 ms → 100 ms)
- Scrubber slider — drag to jump to any hour without stopping playback
- Sensor count display for the current slot

**Playback:** On play, a `setInterval` advances the slot index at the chosen speed. Reaching the last slot stops playback automatically. Resuming from the last slot resets to the first.

**Map layer:** Same circle marker color scheme as SPL Static, updated each tick.

**Timestamp display:** The current slot's timestamp (`dd-mm-yyyy hh:00`) is shown in a floating overlay top-left of the map.

**API:** `GET /spl/range?start=dd-mm-yyyy&end=dd-mm-yyyy&source=` — returns all hourly slots pre-fetched; playback is purely client-side.

---

### 4. SPL Chart — `/spl-chart`

**Purpose:** Examine the full time series for a single device.

**Controls:**
- Device dropdown — lists all devices, color-coded by average SPL (WHO tier)
- Switching the global source re-fetches the chart for the currently selected device

**Chart (Recharts LineChart):**
- X-axis: timestamp strings
- Y-axis: dB, domain auto-scaled
- Line colored by value at each point using a `linearGradient` or per-segment coloring
- WHO tier reference lines at 45 / 55 / 65 / 75 dB (dashed, labeled)
- Brush zoom: drag handles at the bottom to focus on a sub-range

**Mini-map:** Below the chart, a small MapLibre map centers on the selected device's location with a single highlighted marker.

**API:** `GET /spl/device/{id}?source=`

---

### 5. SPL Heatmap — `/spl-heatmap`

**Purpose:** Show the spatial density of SPL values as an animated heatmap over a date range.

**Map layer:** MapLibre GL `heatmap` type.
- `heatmap-weight` is driven by the normalized SPL value: `(value − 30) / (90 − 30)`, clamped 0–1
- `heatmap-color` interpolates from transparent → green → lime → yellow → orange → red, mirroring WHO tiers
- `heatmap-radius` scales with zoom level (25 px at zoom 9, 60 px at zoom 13)
- `heatmap-intensity` also scales with zoom (0.6 → 1.2)
- `heatmap-opacity`: 0.82

The heatmap gives an intuitive visual of _where_ the city is loudest at each hour.

**Controls:** Same as SPL Daily Analysis — date pickers, play/pause, speed selector, scrubber slider, sensor count.

**Timestamp display:** Floating overlay top-left of the map.

**Legend:** Fixed top-right overlay showing WHO tier color bands and a compact gradient bar.

**API:** `GET /spl/range?start=&end=&source=` — same pre-fetch-and-animate pattern as Daily Analysis.

---

### 6. Analysis — `/analysis`

**Purpose:** Reveal temporal patterns, spatial variation, and health tier distribution across the entire study period.

All charts react to the global **Imputation Method** selector, enabling side-by-side comparison of how each source changes aggregate statistics.

#### 6.1 Average SPL by Hour of Day

**Chart type:** Recharts `LineChart`
**Series:** Weekday (blue) and Weekend (amber dashed)
**Reference lines:** Dashed horizontal lines at the four WHO tier boundaries (45 / 55 / 65 / 75 dB)

Reveals the daily noise cycle — typically a sharp ramp-up from 06:00 with a peak during midday traffic, and a quieter nighttime period.

**API:** `GET /analysis/by-hour?source=`

---

#### 6.2 Hour × Day-of-Week Heatmap

**Chart type:** Custom 7 × 24 CSS grid (no charting library)
**Encoding:** Cell background = WHO-tier color; cell opacity = `0.4 + 0.6 × normalized_intensity` so both hue and brightness convey the level.
**Hover tooltip:** `Sun 14:00 → 63.4 dB`

The 7 rows are Sun–Sat; the 24 columns are midnight–23:00. This makes rush-hour bands and weekend patterns immediately visible.

**API:** `GET /analysis/dow-hour-heatmap?source=`

---

#### 6.3 WHO Tier Breakdown Over Time

**Chart type:** Recharts `AreaChart`, stacked to 100%
**Series:** One filled area per WHO tier (safe → dangerous), stacked bottom-to-top.

Each band shows the fraction of all active sensor-hours in that tier each day. A rising red/orange band indicates days with elevated urban noise.

**API:** `GET /analysis/tier-over-time?source=`

---

#### 6.4 SPL Value Distribution

**Chart type:** Recharts `BarChart`, 2 dB buckets from ~28 to ~94 dB
**Encoding:** Each bar is colored by the WHO tier that bucket falls into.
**Reference lines:** Vertical dashed lines at 45 / 55 / 65 / 75 dB.

Shows whether the fleet of sensors predominantly operates in the safe or concern zones, and how the distribution shifts under different imputation sources.

**API:** `GET /analysis/distribution?source=`

---

#### 6.5 Daily Average SPL Trend

**Chart type:** Recharts `LineChart`
**Annotation:** Faint horizontal reference lines at tier boundaries.

A single line showing the fleet-wide daily average across the full Sep–Dec 2021 study period. Identifies macro-level trends such as quieter periods (holidays, weekends) or unusual spike days.

**API:** `GET /analysis/daily-trend?source=`

---

#### 6.6 Device Ranking

**Chart type:** Two horizontal `BarChart` components (Recharts) side by side — Loudest 15 (red bars) and Quietest 15 (green bars). Bars are colored individually by the WHO tier of each device's average SPL.

**Map:** Below the two bar charts, a MapLibre GL map plots all 30 ranked devices as colored circle markers:
- Red `#ef4444` — loudest 15
- Green `#22c55e` — quietest 15

Clicking a marker opens a popup showing the device name, average SPL, and total reading count. A small legend overlay in the top-left of the map identifies the two groups.

This view makes it easy to see whether the loudest sensors cluster spatially (e.g., along major roads or intersections) and whether the quietest sensors are in residential or park areas.

**API:** `GET /analysis/device-ranking?source=` (returns `lat`, `long`, `avg_spl`, `n` per device)

---

### 7. Compare — `/compare`

**Purpose:** Present the quantitative imputation evaluation — how accurately each method reconstructed masked ground-truth readings.

#### Metric formulas

The page opens with two formula cards explaining the metrics used:

**MAE** (Mean Absolute Error):
```
MAE = (1/n) × Σ |yᵢ − ŷᵢ|
```
Measures average absolute deviation in dB. Intuitive and robust to outliers.

**RMSE** (Root Mean Squared Error):
```
RMSE = √( (1/n) × Σ (yᵢ − ŷᵢ)² )
```
Penalises large individual errors more heavily. Higher than MAE whenever errors are uneven.

#### Method scorecards

Four cards — one per method — showing MAE and RMSE. The best-performing method (TimesFM) is highlighted in green with a callout showing how many times more accurate it is than the next-best.

#### MAE vs RMSE bar chart (overall)

Grouped bar chart comparing all four methods side by side. MAE bars are solid; RMSE bars are semi-transparent. Tooltip shows exact values with white text (dark-theme safe via `itemStyle`).

#### By-group grouped bar chart

The 35 test devices are split into three evaluation groups:
- **A-Connected** — long-history devices with low KNN isolation (spatial fill is easy)
- **B-Isolated** — long-history devices with high KNN isolation (spatial fill is hard)
- **C-ShortHistory** — devices active for ≤ 2000 total hours

A toggle switches between MAE and RMSE views. This reveals how each method degrades under different sensor conditions.

#### Summary table

A full table with all methods and groups. The lowest (best) value in each column is highlighted green.

#### Per-device table

Scrollable table listing every test device with its group, reading count, and MAE for each method. Helps identify individual sensors where a specific method struggles.

**API:** `GET /evaluation/summary` and `GET /evaluation/per-device`

---

## Design Conventions

- **Color theme:** Dark (`#0f0f19` page, `#1a1a2e` cards, `#2a2a4a` borders)
- **WHO tier palette:** `#22c55e` / `#a3e635` / `#facc15` / `#f97316` / `#ef4444` — used consistently across all pages and charts
- **Tooltip dark-theme fix:** All Recharts `<Tooltip>` components use `itemStyle={{ color: '#e2e8f0' }}` and `labelStyle={{ color: '#94a3b8' }}` alongside `contentStyle` to override Recharts' default black text
- **Map tiles:** OpenFreeMap Liberty style (`https://tiles.openfreemap.org/styles/liberty`) — free, no API key required
- **Date format:** API accepts and returns `dd-mm-yyyy` (Estonian convention); ISO `yyyy-mm-dd` is used only internally for sorting

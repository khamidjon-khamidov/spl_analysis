# 3.9 Visualization Dashboard

The visualization component of this project is a React single-page application that provides interactive access to the imputation pipeline's outputs. Its primary purpose is to make the processed data explorable without requiring direct database access — enabling the examination of individual sensor time series, spatial noise patterns at arbitrary timestamps, animated temporal sequences, and quantitative method comparisons. This section describes the application architecture, the global state mechanism that connects the frontend to all four imputation tables, the design of each page, and the API contract between the frontend and the backend.

---

## 3.9.1 Application Architecture

The frontend is built with **React** (Vite build toolchain) and organised around React Router for client-side navigation. Seven routes correspond to seven distinct views of the data. A shared navigation bar is present on every page and contains both the page links and the global imputation method selector — the single control that determines which data source all method-sensitive pages draw from.

The technology stack was selected with two constraints in mind: the dataset is static (no real-time sensor feed) and the deployment target is a local or small-server environment without CDN infrastructure.

**React Router** provides client-side navigation without full page reloads, which is important for the map-heavy pages where re-initialising a MapLibre instance on each navigation would introduce perceptible latency. Components unmount and remount on route changes, but map instances are reinitialised quickly from cached tile data on subsequent visits.

**MapLibre GL JS** (accessed via the `react-map-gl` wrapper) handles all geographic visualisation. MapLibre is the open-source fork of Mapbox GL JS and carries no per-tile API fee. The tile source used throughout the application is the OpenFreeMap Liberty style, a free vector tile service. All five map-bearing pages use a single consistent tile configuration, so the map aesthetic is uniform across views.

**Recharts** provides all chart visualisations — line charts, bar charts, and area charts. It integrates cleanly with React's component model through declarative JSX and supports the brush/zoom interaction needed for the device time series view.

**FastAPI** (Python) serves as the backend. The frontend makes REST requests to endpoints that query the SQLite database and return JSON. No ORM is used; queries are written directly in SQL strings and executed via the `sqlite3` standard library module. The backend is stateless: every request is fully self-contained.

---

## 3.9.2 Global Imputation Method Selector

All five data-presenting pages (Devices, SPL Static, SPL Daily, SPL Chart, SPL Heatmap, Analysis) can display data from any of the five available data sources: the original measured readings, or one of the four imputation tables. A single dropdown in the navigation bar controls which source is active. This control is implemented via a React context.

### DataSourceContext

```jsx
// DataSourceContext.jsx
const DataSourceContext = createContext()

export function DataSourceProvider({ children }) {
  const [source, setSource] = useState('original')
  return (
    <DataSourceContext.Provider value={{ source, setSource }}>
      {children}
    </DataSourceContext.Provider>
  )
}

export function useDataSource() {
  return useContext(DataSourceContext)
}
```

The `source` value is a string key: `'original'`, `'historical'`, `'knn'`, `'combined'`, or `'timesfm'`. The `DataSourceProvider` wraps the entire application in `App.jsx`, making the context available to every component in the tree without prop drilling.

### Backend Resolution

Each API endpoint that returns readings accepts a `source` query parameter. The backend maps the string key to the corresponding database table:

```python
def resolve_table(source: str) -> str:
    tables = {
        "original":   "sp_levels",
        "historical": "spl_levels_historical_imp",
        "knn":        "spl_levels_knn_imp",
        "combined":   "spl_levels_combined_imp",
        "timesfm":    "spl_levels_timesfm_imp",
    }
    if source not in tables:
        raise HTTPException(status_code=400, detail=f"Unknown source: {source}")
    return tables[source]
```

This pattern centralises the table routing at a single function rather than repeating the mapping in each endpoint handler. Changing the active method in the frontend dropdown immediately triggers re-fetches at every page that holds data in state, causing the map markers, charts, and tables to update to the newly selected table's values.

### Evaluation Page Exception

The Evaluation page (`/compare`) does not consume `DataSourceContext`. It compares all four imputation methods simultaneously and therefore fetches data from a dedicated `/evaluation/summary` endpoint that returns pre-aggregated metrics for all methods in a single response. Changing the global method selector has no effect on this page.

---

## 3.9.3 Page Designs

### Devices Page (`/devices`)

**Purpose.** An inventory of all 471 sensors with health indicators based on data completeness. The page serves as an entry point for understanding which devices are well-measured and which have significant gaps.

**Map layer.** All devices are rendered as circle markers on a MapLibre map. Marker colour reflects the device's completeness rate — the fraction of `total_hours` for which a measurement (original or imputed, depending on `source`) exists. Green markers indicate completeness above 95%; yellow indicates 85–95%; red indicates below 85%. When `source` is `'original'`, completeness equals `hours_with_data / total_hours`. When `source` is an imputation method, the denominator remains `total_hours` but the numerator is the imputation table's fill count (`hist_hours_filled`, `knn_hours_filled`, etc.) from the `devices` table, which is populated by the respective imputation script. Switching the method selector updates all marker colours without a page reload.

**Device panel.** Clicking a marker opens a side panel showing the device's name, coordinates, data start/end, total hours, and per-method fill rates. Test devices (those with `is_test = 1`) are marked with a blue chip, and their evaluation group (`test_group`) is shown.

---

### SPL Static Page (`/spl-static`)

**Purpose.** A snapshot view: the user selects a date and hour, and the map shows the SPL reading (or imputed value) for every device at that specific timestamp.

**Controls.** A date picker and an hour selector (0–23) allow the user to specify the target timestamp. The `useDateRange` hook queries `/data/date-range` at page mount to retrieve the minimum and maximum available dates, constraining the date picker to the valid range.

**Map layer.** Devices with a reading at the selected timestamp are rendered as coloured circle markers. Marker colour follows the WHO noise tier palette:
- < 45 dB → green (safe)
- 45–54 dB → lime
- 55–64 dB → yellow
- 65–74 dB → orange
- ≥ 75 dB → red (hazardous)

Devices with no reading at the selected timestamp (whether because the original measurement is absent and the active source is `'original'`, or because an imputation method failed to fill the slot) are rendered as small grey markers. This makes coverage gaps immediately visible spatially.

A legend overlaid on the map explains the colour-to-tier mapping. The imputation provenance chip (`imputed = 0/1/2`) is shown in the popup for the TimesFM source, indicating whether the displayed value is an original measurement, a retained statistical estimate, or a TimesFM forecast.

---

### SPL Daily Page (`/spl-daily`)

**Purpose.** Temporal animation of SPL readings across all devices over a selected date range, advancing one hour per frame.

**Controls.** The user selects a start date and end date (constrained by `useDateRange`). A playback toolbar provides play/pause, a speed selector (1×, 2×, 5×, 10×), and a manual step control. A timestamp display shows the current frame's date and hour in Tallinn local time. A count overlay shows the number of devices in each WHO tier at the current frame.

**Animation implementation.** On play, a `setInterval` advances an index through the pre-fetched array of hourly frames. All data for the selected range is fetched in a single request to `/data/daily-range` before playback begins. This pre-fetch strategy eliminates mid-animation latency: the API call happens once when the date range is confirmed, and playback reads from the in-memory array. At 10× speed (approximately 10 frames per second), the animation covers a 30-day range in under three minutes.

---

### SPL Chart Page (`/spl-chart`)

**Purpose.** Time series view for a single selected device, showing the full sequence of hourly readings (or imputed values) across the study period.

**Device selection.** A dropdown lists all 471 devices by name. Alternatively, the user can click a marker on a small companion map. The two selectors are synchronised: selecting from the dropdown updates the map marker highlight, and clicking a map marker updates the dropdown.

**Chart.** A Recharts `LineChart` renders the hourly time series. The line is coloured dynamically per point by WHO tier — the chart uses multiple `<Line>` segments or a custom dot renderer to achieve per-point colouring. A `<Brush>` component at the bottom of the chart allows zooming into any sub-range without changing the underlying data fetch.

Periods with no reading (gaps in the original `sp_levels` table when `source = 'original'`) appear as breaks in the line. When an imputation source is selected, these gaps are filled and the line is continuous, making the visual difference between sources immediately apparent. A small legend identifies which values are original (blue) and which are imputed (grey, for sources that expose the `imputed` flag).

---

### SPL Heatmap Page (`/spl-heatmap`)

**Purpose.** A continuous spatial heatmap that visualises the intensity distribution of SPL values across the city, animated over time.

**Rendering.** A MapLibre `heatmap` layer is fed a GeoJSON `FeatureCollection` where each feature is a sensor point with a `value` property in the range 30–90 dB. The heatmap weight is proportional to the SPL value, so louder sensors contribute more to the rendered intensity cloud. The colour gradient runs from transparent (low intensity) through green, yellow, and orange to red (high intensity), matching the WHO tier palette used throughout the application.

**Animation.** The same playback mechanism as SPL Daily is used: data is pre-fetched for the selected range, stored in an array indexed by frame, and advanced by a `setInterval`. At each frame, the GeoJSON source is updated via `map.getSource('spl-heatmap').setData(...)`, which triggers a smooth WebGL redraw without reinitialising the layer.

---

### Analysis Page (`/analysis`)

**Purpose.** A multi-metric analytical dashboard that aggregates data across the fleet to reveal temporal and spatial patterns in urban noise.

The page is divided into several sections, each addressing a different analytical question:

**WHO Tier Distribution.** A stacked bar chart or donut chart showing what fraction of all device-hours fall into each WHO noise tier. Computed across all devices for the full study period, segmented by imputation source. This answers the question: at the fleet level, what is the city's overall noise health profile?

**Hourly Profile.** A line chart with 24 data points (one per hour of day), each showing the fleet-wide median SPL for that hour averaged over the full study period. A secondary series shows the interquartile range. This reveals the city's diurnal rhythm — the rise in noise during morning commute hours, the midday plateau, the evening peak, and the late-night decline.

**Day-of-Week Profile.** A bar chart with seven bars showing average fleet-wide SPL by day of week. Weekday vs weekend differences are visible in the pattern, as are any systematic outliers (e.g., a holiday during the study period).

**Device Ranking.** A ranked bar chart of the top 15 loudest and top 15 quietest devices by average SPL over the study period. A companion MapLibre map displays the same 30 devices as markers — red for the loudest, green for the quietest — so the user can see where the extremes are geographically concentrated. Clicking a marker opens a popup with the device name, average SPL, and reading count.

---

### Evaluation Page (`/compare`)

**Purpose.** A side-by-side quantitative comparison of the four imputation methods, displaying the evaluation results computed by `evaluate_imputation.py`.

**Data source.** This page reads from two endpoints: `/evaluation/summary` (pre-aggregated MAE and RMSE per method per group, from `evaluation_summary.csv`) and `/evaluation/per-device` (individual device-level MAE rows, from `evaluation_results_per_device.csv`).

**Summary chart.** A grouped bar chart displays MAE (and optionally RMSE, toggleable) for each method across the four reporting scopes: Overall, Group A (Connected), Group B (Isolated), and Group C (Short History). The chart allows visual inspection of the group-specific patterns described in Section 3.8: KNN's degradation in Group A relative to Historical, the combined method's consistent improvement over its components, and TimesFM's uniform accuracy across all groups.

**Per-device table.** A scrollable table lists the 35 test devices, one row per device, with columns for each method's MAE. Rows are sortable by any column. The `test_group` label (A/B/C) appears as a coloured chip next to each device name. This table allows identifying the specific sensors that drove each method's group-level aggregate — for example, which isolated devices in Group B caused KNN's relatively good performance, or which connected devices in Group A experienced the simultaneous outage pattern that degraded KNN.

**Design rationale.** The Evaluation page is intentionally separate from the Analysis page and does not use `DataSourceContext`. Analysis presents data from a chosen source as a ground truth for exploration; Evaluation presents method accuracy relative to held-out measurements and must show all four methods simultaneously. Coupling the Evaluation view to the global method selector would make it impossible to display the multi-method comparison at all.

---

## 3.9.4 API Design

The backend exposes REST endpoints grouped by function. All endpoints return JSON. All endpoints that return time series data accept a `source` query parameter mapped to a database table via `resolve_table`.

| Endpoint | Method | Parameters | Returns |
|---|---|---|---|
| `/devices` | GET | `source` | All device metadata including fill counts |
| `/data/date-range` | GET | `source` | `{ min_date, max_date }` |
| `/data/snapshot` | GET | `source`, `timestamp` | Device readings at one timestamp |
| `/data/daily-range` | GET | `source`, `start`, `end` | All hourly frames in range, grouped by timestamp |
| `/data/device-series` | GET | `source`, `device_id` | Full time series for one device |
| `/analysis/hourly-profile` | GET | `source` | Fleet median and IQR per hour-of-day |
| `/analysis/daily-profile` | GET | `source` | Fleet median per day-of-week |
| `/analysis/tier-distribution` | GET | `source` | Count of device-hours per WHO tier |
| `/analysis/device-ranking` | GET | `source`, `n` | Top/bottom n devices by average SPL |
| `/evaluation/summary` | GET | — | MAE and RMSE per method per group |
| `/evaluation/per-device` | GET | — | Per-device MAE for all methods |

The `source` parameter is validated at each endpoint via `resolve_table`. Invalid values return HTTP 400 rather than silently querying the wrong table.

**No authentication.** The application is designed for a single researcher's local use. The backend listens on `localhost:8000` and is not exposed to the network. Authentication and rate limiting are therefore out of scope.

**No caching layer.** SQLite reads are fast enough for the dataset size (471 devices × ~2,900 hours × 5 tables ≈ 6.8 million rows) that response times are acceptable without a Redis or in-process cache. The pre-fetch pattern used in the animation pages (fetching the full date range before playback begins) serves as the application's primary latency mitigation.

---

## 3.9.5 Design Conventions

Several visual and interaction conventions are applied consistently across all pages.

**WHO tier palette.** The same five-colour sequence — green, lime, yellow, orange, red — maps to the five WHO noise tiers (< 45, 45–54, 55–64, 65–74, ≥ 75 dB) on every map, chart, and table in the application. The palette is defined once in a shared utility module and imported wherever tier colouring is needed. This consistency ensures that a red marker on the Devices page, a red segment in the Analysis tier distribution, and a red marker on the SPL Static map all carry the same meaning.

**Tooltip styling.** Recharts' default tooltip background is white, which produces low contrast against the dark background used by the application. All chart components override the default tooltip with a dark-themed custom renderer (`contentStyle={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9' }}`). This override is applied at every chart site rather than through a global Recharts theme, since Recharts does not expose a global style context.

**Map tile source.** All MapLibre instances use the OpenFreeMap Liberty style (`https://tiles.openfreemap.org/styles/liberty`). This tile source requires no API key and provides sufficient geographic detail (street names, building outlines, park areas) for sensor location identification within a city context.

**Loading states.** All data-fetching components display a spinner or skeleton while the API request is in flight. This prevents the map or chart from briefly rendering with stale data from the previous `source` selection before the new data arrives.

**Error handling.** API errors (network failure, invalid parameter, empty result set) are caught in `useEffect` fetch callbacks and displayed as an inline error message within the relevant component. The rest of the page remains functional. This is particularly important for the SPL Static page, where a selected timestamp may genuinely have no readings in the original table — the empty-result case is treated as a valid state, not an error.

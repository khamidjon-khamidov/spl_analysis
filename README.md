# Sound Pressure Level — Data Imputation & Visual Analysis

A research project for imputation and animated visualization of Sound Pressure Level (SPL) data in Tallinn, based on IoT sensor data.

**Author:** Khamidjon Khamidov
**Supervisor:** Jaanus Kaugerand

## Overview

Tallinn's IoT sensor network monitors urban noise across major transit arteries. Low-cost sensors are prone to data gaps caused by network failures, power outages, and environmental interference. This project addresses that by:

1. **Extracting and processing raw sensor data** from CSV exports into a local SQLite database
2. **Aggregating hourly SPL values** (median per device per hour) in Estonian time
3. **Detecting faulty or incomplete sensors** by computing missing data hours per device
4. **Imputing missing SPL data** using a four-method pipeline:
   - Historical Median (temporal patterns)
   - KNN (spatial neighbours)
   - Combined Historical + KNN (inverse-variance weighted blend)
   - Google TimesFM (neural time series foundation model)
5. **Visualizing the results** through an interactive dashboard with imputation source switching

## Tech Stack

- **Frontend**: React + Vite, react-map-gl, MapLibre GL (free tiles via OpenFreeMap), Recharts
- **Backend**: Python, FastAPI, SQLite
- **Imputation**: Python scripts — historical median, spatial KNN, combined blend, Google TimesFM 2.5
- **External model**: [Google TimesFM 2.5](https://github.com/google-research/timesfm) (cloned locally in `timesfm/`)

## Project Structure

```
sound_pressure_level/
├── frontend/                  # React dashboard (Vite)
│   └── src/pages/
│       ├── DevicesPage.jsx    # Device map with data quality indicators
│       ├── SPLStaticPage.jsx  # SPL snapshot for a chosen date & hour
│       ├── SPLDailyPage.jsx   # Animated SPL over a date range
│       └── SPLChartPage.jsx   # Per-device SPL line chart
├── backend/                   # FastAPI server (main.py)
├── scripts/
│   ├── ingestion/
│   │   ├── csv_to_sql.py              # Extract unique devices → SPL.db
│   │   └── csv_to_sp_levels.py        # Aggregate hourly SPL → sp_levels table
│   ├── processing/
│   │   ├── compute_missing_hours.py   # Compute coverage stats → devices table
│   │   └── compute_imputation_coverage.py  # Fill-rate per method → devices table
│   ├── imputation/
│   │   ├── impute_historical.py       # Historical median imputation
│   │   ├── impute_knn.py              # Spatial KNN imputation
│   │   ├── impute_historical_and_knn.py  # Combined inverse-variance blend
│   │   └── impute_timesfm.py          # TimesFM re-imputation
│   └── runners/
│       ├── backend_runner.sh          # Start FastAPI backend
│       └── frontend_runner.sh         # Start React frontend
├── timesfm/                   # Google TimesFM clone (do not modify)
├── docs/                      # Method documentation
└── data/
    ├── raw/                   # Raw IoT sensor CSV — not committed (too large)
    └── SPL.db                 # SQLite database — not committed
```

## Database Schema

### `devices` — one row per sensor (471 devices)
| Column | Description |
|---|---|
| `id` | Auto-assigned integer PK |
| `name` | Device name |
| `lat`, `long` | Coordinates |
| `data_start`, `data_end` | First/last timestamps (UTC) |
| `total_hours` | Hours between start and end |
| `hours_with_data` | Hours with at least one reading |
| `missing_hours` | `total_hours - hours_with_data` |
| `hist_hours_filled` | Rows in `spl_levels_historical_imp` for this device |
| `knn_hours_filled` | Rows in `spl_levels_knn_imp` for this device |
| `combined_hours_filled` | Rows in `spl_levels_combined_imp` for this device |
| `timesfm_hours_filled` | Rows in `spl_levels_timesfm_imp` for this device |

### `sp_levels` — original aggregated readings
| Column | Description |
|---|---|
| `device_id` | FK → `devices(id)` |
| `timestamp` | `dd-mm-yyyy hh:00` in Estonian time (Europe/Tallinn) |
| `ts_indexed` | Unix UTC seconds — indexed for fast range queries |
| `value` | Hourly median dB, rounded to integer |
| `imputed` | Always `0` (all rows are original) |

### Imputation tables
All share the same schema as `sp_levels`. `imputed = 0` = original, `imputed = 1` = statistically filled, `imputed = 2` = TimesFM filled.

| Table | Method | Fill rate |
|---|---|---|
| `spl_levels_historical_imp` | Median of last 10 same-hour readings from previous days | 91.9% |
| `spl_levels_knn_imp` | Median of spatial neighbours ≤500 m (fallback ≤1 km) | 98.8% |
| `spl_levels_combined_imp` | Inverse-variance weighted blend of historical + KNN | 99.9% |
| `spl_levels_timesfm_imp` | Combined as base; statistically-imputed slots re-imputed with TimesFM 2.5 (512-step context) | 99.9% |

## Data Pipeline

Run in order after placing the raw CSV in `data/raw/`:

```bash
# Ingestion
python3 scripts/ingestion/csv_to_sql.py
python3 scripts/ingestion/csv_to_sp_levels.py

# Processing
python3 scripts/processing/compute_missing_hours.py

# Imputation (in order)
python3 scripts/imputation/impute_historical.py
python3 scripts/imputation/impute_knn.py
python3 scripts/imputation/impute_historical_and_knn.py
python3 scripts/imputation/impute_timesfm.py   # downloads model on first run (~800 MB)

# Coverage stats
python3 scripts/processing/compute_imputation_coverage.py
```

Raw CSV columns: `name, fk_event_type, value, dt_production, fk_device_type, latitude, longitude`

## Running the App

**Backend** (FastAPI on port 8000):
```bash
./scripts/runners/backend_runner.sh
```

**Frontend** (Vite dev server on port 5173):
```bash
./scripts/runners/frontend_runner.sh
```

Open `http://localhost:5173`.

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /devices/all` | All devices with coordinates, quality stats, and per-method fill rates |
| `GET /spl/date-range` | Min/max date of available data (auto-sets frontend date pickers) |
| `GET /spl/static?timestamp=&source=` | All device readings for a specific hour |
| `GET /spl/range?start=&end=&source=` | All hourly readings for a date range |
| `GET /spl/device/{id}?source=` | All hourly readings for a single device |

`source` parameter accepts: `original` `historical` `knn` `combined` `timesfm`

## Frontend Pages

### Devices
Interactive map of all 471 sensors, color-coded by data completeness for the selected imputation source. Bottom bar shows device counts by quality tier. Click a marker to see the full coverage breakdown across all imputation methods.

| Color | Missing data |
|---|---|
| 🟢 Green | < 20% |
| 🟡 Amber | 20–50% |
| 🔴 Red | > 50% |

### SPL Static
Choose a date and hour — the map updates instantly showing all devices colored by WHO noise standard. A pink left-edge chip on each marker indicates an imputed value; grey means original.

### SPL Daily Analysis
Select a start and end date. All hourly slots animate across the map at a configurable speed (1×, 2×, 3×, 5×, 10×). A scrubber lets you jump to any hour manually.

### SPL Chart
Select a device from a color-coded dropdown. Shows a full line chart with WHO threshold reference lines, per-point health coloring, brush zoom, and a device location mini-map below the chart.

### Imputation Method Selector
A global dropdown in the navbar switches all pages between:
- **Original** — raw sensor readings only
- **Historical Median** — same-hour historical pattern
- **KNN** — spatial neighbours
- **Historical + KNN** — inverse-variance weighted blend
- **TimesFM** — neural foundation model re-imputation

### WHO Noise Health Standard

| Color | Range | Status |
|---|---|---|
| 🟢 Green | < 45 dB | Safe |
| 🟡 Lime | 45–55 dB | Acceptable |
| 🟡 Yellow | 55–65 dB | Moderate concern |
| 🟠 Orange | 65–75 dB | High concern |
| 🔴 Red | ≥ 75 dB | Dangerous |

## Imputation Methods

| Method | Strategy | Avg fill rate |
|---|---|---|
| Historical Median | Median of last 10 available same-hour readings from previous days for the same device | 91.9% |
| KNN | Median of active spatial neighbours within 500 m at the same timestamp (fallback 1 km) | 98.8% |
| Historical + KNN | Inverse-variance weighted blend — the more consistent source gets higher weight | 99.9% |
| TimesFM | Google TimesFM 2.5 (200M params) with 512-step context window; re-imputes all statistically-filled slots | 99.9% |

See `docs/historical_knn.md` for the theoretical background on the inverse-variance weighting approach.

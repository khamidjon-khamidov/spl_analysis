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
5. **Evaluating imputation accuracy** on 35 stratified test devices using masked ground-truth (MAE, RMSE)
6. **Visualizing the results** through an interactive dashboard with imputation source switching

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
│       ├── DevicesPage.jsx        # Device map with data quality indicators
│       ├── SPLStaticPage.jsx      # SPL snapshot for a chosen date & hour
│       ├── SPLDailyPage.jsx       # Animated SPL over a date range
│       ├── SPLChartPage.jsx       # Per-device SPL line chart
│       ├── SPLHeatmapPage.jsx     # Animated density heatmap
│       ├── AnalysisPage.jsx       # SPL pattern & trend analysis charts
│       └── EvaluationPage.jsx     # Imputation method comparison (MAE / RMSE)
├── backend/                   # FastAPI server (main.py)
├── scripts/
│   ├── ingestion/
│   │   ├── csv_to_sql.py                     # Extract unique devices → SPL.db
│   │   └── csv_to_sp_levels.py               # Aggregate hourly SPL → sp_levels table
│   ├── processing/
│   │   ├── compute_missing_hours.py           # Compute coverage stats → devices table
│   │   ├── compute_imputation_coverage.py     # Fill-rate per method → devices table
│   │   └── select_test_devices.py             # Stratified test device selection
│   ├── evaluation/
│   │   └── evaluate_imputation.py             # Masked evaluation → MAE/RMSE CSVs
│   └── runners/
│       ├── backend_runner.sh                  # Start FastAPI backend
│       ├── frontend_runner.sh                 # Start React frontend
│       └── evaluation_runner.sh               # Run evaluation with live log
├── imputation/                # Imputation scripts (standalone)
├── timesfm/                   # Google TimesFM clone (do not modify)
├── docs/                      # Method & results documentation
└── data/
    ├── raw/                   # Raw IoT sensor CSV — not committed (too large)
    ├── evaluation_results.csv # Per-slot masked evaluation output
    ├── evaluation_summary.csv # MAE/RMSE summary per method and group
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
| `is_test` | `1` if selected as evaluation test device |
| `test_group` | `A-Connected`, `B-Isolated`, or `C-ShortHistory` |

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
python3 imputation/impute_historical.py
python3 imputation/impute_knn.py
python3 imputation/impute_historical_and_knn.py
python3 imputation/impute_timesfm.py   # downloads model on first run (~800 MB)

# Coverage stats
python3 scripts/processing/compute_imputation_coverage.py

# Evaluation
python3 scripts/processing/select_test_devices.py
./scripts/runners/evaluation_runner.sh
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

### SPL Data
| Endpoint | Description |
|---|---|
| `GET /devices/all` | All devices with coordinates, quality stats, and per-method fill rates |
| `GET /spl/date-range` | Min/max date of available data |
| `GET /spl/static?timestamp=&source=` | All device readings for a specific hour |
| `GET /spl/range?start=&end=&source=` | All hourly readings for a date range |
| `GET /spl/device/{id}?source=` | All hourly readings for a single device |

### Analysis
| Endpoint | Description |
|---|---|
| `GET /analysis/by-hour?source=` | Average SPL per hour-of-day, split weekday vs weekend |
| `GET /analysis/dow-hour-heatmap?source=` | Average SPL per (day-of-week, hour) cell — 7×24 grid |
| `GET /analysis/distribution?source=` | Reading counts per 2 dB bucket (28–94 dB) |
| `GET /analysis/daily-trend?source=` | Daily average SPL across all devices |
| `GET /analysis/tier-over-time?source=` | Per-day count of sensor-hours in each WHO noise tier |
| `GET /analysis/device-ranking?source=` | Top 15 loudest and quietest devices by average SPL |

### Evaluation
| Endpoint | Description |
|---|---|
| `GET /evaluation/summary` | MAE and RMSE per imputation method and device group |
| `GET /evaluation/per-device` | MAE per method for each individual test device |

`source` parameter accepts: `original` `historical` `knn` `combined` `timesfm`

## Frontend Pages

See [`docs/visualization.md`](docs/visualization.md) for a full description of all pages.

### Quick reference
| Page | Route | Description |
|---|---|---|
| Devices | `/devices` | Map of all 471 sensors, color-coded by data completeness |
| SPL Static | `/spl-static` | Snapshot map for any chosen date and hour |
| SPL Daily | `/spl-daily` | Animated hourly playback over a date range |
| SPL Chart | `/spl-chart` | Per-device time-series line chart |
| SPL Heatmap | `/spl-heatmap` | Animated density heatmap (MapLibre heatmap layer) |
| Analysis | `/analysis` | Aggregate SPL pattern charts (by-hour, tier trends, etc.) |
| Compare | `/compare` | MAE / RMSE evaluation results and method comparison |

## Imputation Methods

| Method | Strategy | Avg fill rate |
|---|---|---|
| Historical Median | Median of last 10 available same-hour readings from previous days for the same device | 91.9% |
| KNN | Median of active spatial neighbours within 500 m at the same timestamp (fallback 1 km) | 98.8% |
| Historical + KNN | Inverse-variance weighted blend — the more consistent source gets higher weight | 99.9% |
| TimesFM | Google TimesFM 2.5 (200M params) with 512-step context window; re-imputes all statistically-filled slots | 99.9% |

## Evaluation Results Summary

Evaluated on 35 stratified test devices (< 5% missing, ≥ 300 original hours) using 20% random masking (17,317 held-out slots, seed = 42):

| Method | MAE (dB) | RMSE (dB) |
|---|---|---|
| Historical Median | 3.32 | 4.61 |
| KNN | 3.54 | 4.89 |
| Historical + KNN (Combined) | 2.70 | 3.77 |
| **TimesFM** | **1.18** | **1.74** |

TimesFM is 2.8× more accurate than the next-best method (Combined) by MAE. See [`docs/evaluation_results.md`](docs/evaluation_results.md) for the full analysis.

## WHO Noise Health Standard

| Color | Range | Status |
|---|---|---|
| Green | < 45 dB | Safe |
| Lime | 45–55 dB | Acceptable |
| Yellow | 55–65 dB | Moderate concern |
| Orange | 65–75 dB | High concern |
| Red | ≥ 75 dB | Dangerous |

## Documentation

| File | Contents |
|---|---|
| [`docs/methodology.md`](docs/methodology.md) | Full thesis methodology — data source, pipeline, imputation methods |
| [`docs/historical.md`](docs/historical.md) | Historical median method — algorithm, rationale, limitations |
| [`docs/knn.md`](docs/knn.md) | Spatial KNN method — Haversine, radius, fallback strategy |
| [`docs/timesfm.md`](docs/timesfm.md) | TimesFM integration — context window, batching, CPU runtime |
| [`docs/evaluation_results.md`](docs/evaluation_results.md) | Full evaluation — test selection, masking, MAE/RMSE, interpretation |
| [`docs/visualization.md`](docs/visualization.md) | All frontend pages — charts, interactions, API mapping |
| [`docs/conclusion.md`](docs/conclusion.md) | Thesis conclusion and future work |

# Sound Pressure Level — Data Imputation & Visual Analysis

A research project for imputation and animated visualization of Sound Pressure Level (SPL) data in Tallinn, based on IoT sensor data.

**Author:** Khamidjon Khamidov
**Supervisor:** Jaanus Kaugerand

## Overview

Tallinn's IoT sensor network monitors urban noise across major transit arteries. Low-cost sensors are prone to data gaps caused by network failures, power outages, and environmental interference. This project addresses that by:

1. **Extracting and processing raw sensor data** from CSV exports into a local SQLite database
2. **Aggregating hourly SPL values** (median per device per hour) in Estonian time
3. **Detecting faulty or incomplete sensors** by computing missing data hours per device
4. **Imputing missing SPL data** using a hybrid pipeline — Self-Imputation (historical patterns), Weighted KNN (spatial neighbors), and Google TimesFM (foundation model for complex gaps)
5. **Visualizing the results** through four interactive pages: device map, static snapshot, daily animation, and per-device chart

## Tech Stack

- **Frontend**: React + Vite, react-map-gl, MapLibre GL (free tiles via OpenFreeMap), Recharts
- **Backend**: Python, FastAPI, SQLite
- **Data pipeline**: Python scripts (CSV parsing, hourly aggregation, missing data analysis)

## Project Structure

```
sound_pressure_level/
├── frontend/          # React dashboard (Vite)
│   └── src/pages/
│       ├── DevicesPage.jsx       # Device map with data quality indicators
│       ├── SPLStaticPage.jsx     # SPL snapshot for a chosen date & hour
│       ├── SPLDailyPage.jsx      # Animated SPL over a date range
│       └── SPLChartPage.jsx      # Per-device SPL line chart
├── backend/           # FastAPI server (main.py)
├── scripts/           # Data pipeline scripts
│   ├── csv_to_sql.py             # Extract unique devices from CSV → SPL.db
│   ├── csv_to_sp_levels.py       # Aggregate hourly SPL values → sp_levels table
│   ├── compute_missing_hours.py  # Compute missing hours per device → devices table
│   ├── xls_to_sql.py             # Legacy: convert devices.xlsx → SQL
│   ├── backend_runner.sh         # Start the FastAPI backend
│   └── frontend_runner.sh        # Start the React frontend
├── imputation/        # Imputation scripts (Self, KNN, TimesFM)
└── data/
    ├── raw/           # Raw IoT sensor files (CSV/Excel) — not committed (too large)
    ├── sql/           # Generated SQL scripts
    └── SPL.db         # SQLite database — not committed
```

## Database Schema

**`devices`** — one row per sensor
| Column | Description |
|---|---|
| `id` | Auto-assigned integer PK |
| `name` | Device name |
| `lat`, `long` | Coordinates |
| `data_start`, `data_end` | First and last recorded timestamps (UTC) |
| `total_hours` | Total hours between start and end |
| `hours_with_data` | Hours that have at least one reading |
| `missing_hours` | `total_hours - hours_with_data` |

**`sp_levels`** — one row per device per hour
| Column | Description |
|---|---|
| `id` | Auto PK |
| `device_id` | FK → `devices(id)` |
| `timestamp` | `dd-mm-yyyy hh:00` in Estonian time (Europe/Tallinn) |
| `value` | Median dB of all readings in that hour |

## Data Pipeline

Run these scripts in order after placing the raw CSV in `data/raw/`:

```bash
# 1. Extract unique devices → data/SPL.db (devices table)
python3 scripts/csv_to_sql.py

# 2. Aggregate hourly SPL values → sp_levels table
python3 scripts/csv_to_sp_levels.py

# 3. Compute missing hours → updates devices table
python3 scripts/compute_missing_hours.py
```

Raw CSV columns: `name, fk_event_type, value, dt_production, fk_device_type, latitude, longitude`

## Running the App

**Backend** (FastAPI on port 8000):
```bash
./scripts/backend_runner.sh
```

**Frontend** (Vite dev server on port 5173):
```bash
./scripts/frontend_runner.sh
```

Open `http://localhost:5173`.

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /devices/all` | All devices with coordinates and data quality stats |
| `GET /spl/static?timestamp=dd-mm-yyyy hh:00` | All device readings for a specific hour |
| `GET /spl/range?start=dd-mm-yyyy&end=dd-mm-yyyy` | All hourly readings for a date range, ordered by slot |
| `GET /spl/device/{id}` | All hourly readings for a single device |
| `GET /docs` | Auto-generated Swagger UI |

## Frontend Pages

### Devices
Interactive map of all 214 sensors, color-coded by data completeness. Click a marker to see the device's full quality breakdown.

| Color | Missing data | Status |
|---|---|---|
| 🟢 Green | < 20% | Healthy |
| 🟡 Amber | 20–50% | Degraded |
| 🔴 Red | > 50% | Faulty |

### SPL Static
Choose a date and hour — the map updates instantly showing all devices colored by WHO noise standard. Grey markers indicate no data at that hour.

### SPL Daily Analysis
Select a start and end date. All hourly slots animate across the map at a configurable speed (1×, 2×, 3×, 5×, 10×). A scrubber lets you jump to any hour manually.

### SPL Chart
Select a device from a color-coded dropdown (color = data quality). Shows a full Recharts line chart with:
- WHO noise threshold reference lines at 45 / 55 / 65 / 75 dB
- Per-point color based on health level
- Brush zoom to focus on any date sub-range
- Device location mini-map below the chart

### WHO Noise Health Standard (used across all pages)

| Color | Range | Status |
|---|---|---|
| 🟢 Green | < 45 dB | Safe |
| 🟡 Lime | 45–55 dB | Acceptable |
| 🟡 Yellow | 55–65 dB | Moderate concern |
| 🟠 Orange | 65–75 dB | High concern |
| 🔴 Red | ≥ 75 dB | Dangerous |

## Imputation Methods

| Method | Type | Use Case |
|---|---|---|
| Self-Imputation | Temporal | Fills gaps using the sensor's own historical patterns |
| Weighted KNN | Spatial | Estimates values from geographically adjacent sensors |
| Google TimesFM | Foundation Model | Handles long-duration or complex gaps |

Accuracy is validated via **Synthetic Gap Analysis** using RMSE and MAE metrics.

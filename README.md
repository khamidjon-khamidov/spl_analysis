# Sound Pressure Level — Data Imputation & Visual Analysis

A research project for imputation and animated visualization of Sound Pressure Level (SPL) data in Tallinn, based on IoT sensor data.

**Author:** Khamidjon Khamidov
**Supervisor:** Jaanus Kaugerand

## Overview

Tallinn's IoT sensor network monitors urban noise across major transit arteries. Low-cost sensors are prone to data gaps caused by network failures, power outages, and environmental interference. This project addresses that by:

1. **Extracting and processing raw sensor data** from CSV exports into a local SQLite database
2. **Detecting faulty or incomplete sensors** by computing missing data hours per device
3. **Imputing missing SPL data** using a hybrid pipeline — Self-Imputation (historical patterns), Weighted KNN (spatial neighbors), and Google TimesFM (foundation model for complex gaps)
4. **Visualizing the results** as an interactive noise map with color-coded device health indicators

## Tech Stack

- **Frontend**: React + Vite, react-map-gl, MapLibre GL (free tiles via OpenFreeMap)
- **Backend**: Python, FastAPI, SQLite
- **Data pipeline**: Python scripts (CSV parsing, missing data analysis)

## Project Structure

```
sound_pressure_level/
├── frontend/          # React dashboard (Vite)
├── backend/           # FastAPI server
├── scripts/           # Data pipeline scripts
│   ├── csv_to_sql.py          # Extract unique devices from CSV → SPL.db
│   ├── compute_missing_hours.py  # Compute missing hours per device → SPL.db
│   ├── xls_to_sql.py          # Legacy: convert devices.xlsx → SQL
│   ├── backend_runner.sh      # Start the FastAPI backend
│   └── frontend_runner.sh     # Start the React frontend
├── imputation/        # Imputation scripts (Self, KNN, TimesFM)
└── data/
    ├── raw/           # Raw IoT sensor files (CSV/Excel) — not committed (too large)
    ├── sql/           # Generated SQL scripts
    └── SPL.db         # SQLite database — not committed
```

## Data Pipeline

1. Place raw CSV in `data/raw/` (columns: `name, fk_event_type, value, dt_production, fk_device_type, latitude, longitude`)
2. Run `python3 scripts/csv_to_sql.py` — extracts 214 unique devices into `data/SPL.db`
3. Run `python3 scripts/compute_missing_hours.py` — adds `data_start`, `data_end`, `total_hours`, `hours_with_data`, `missing_hours` columns to the `devices` table

## Running the App

**Backend** (FastAPI on port 8000):
```bash
./scripts/backend_runner.sh
```

**Frontend** (Vite dev server on port 5173):
```bash
./scripts/frontend_runner.sh
```

Then open `http://localhost:5173` and click **Devices** in the menu.

## API

| Endpoint | Description |
|---|---|
| `GET /devices/all` | All devices with coordinates and data quality stats |
| `GET /docs` | Auto-generated Swagger UI |

## Devices Map

The Devices page shows all sensors on an interactive map. Markers are color-coded by data completeness:

| Color | Missing data | Status |
|---|---|---|
| 🟢 Green | < 20% | Healthy |
| 🟡 Amber | 20 – 50% | Degraded |
| 🔴 Red | > 50% | Faulty |

Clicking a marker shows a popup with the device's full data quality breakdown.

## Imputation Methods

| Method | Type | Use Case |
|---|---|---|
| Self-Imputation | Temporal | Fills gaps using the sensor's own historical patterns |
| Weighted KNN | Spatial | Estimates values from geographically adjacent sensors |
| Google TimesFM | Foundation Model | Handles long-duration or complex gaps |

Accuracy is validated via **Synthetic Gap Analysis** using RMSE and MAE metrics.

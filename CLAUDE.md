# Sound Pressure Level — Project Guide

## Project Overview

This project is about **imputation and visual analysis of sound pressure level data**. Raw data files are processed through imputation scripts, converted to SQL, and visualized via a web interface.

## Tech Stack

- **Frontend**: React
- **Backend**: Python
- **Imputation**: Python scripts (in `imputation/`)

## Project Structure

```
sound_pressure_level/
├── frontend/          # React application
├── backend/           # Python backend (API / data serving)
├── imputation/        # Python scripts for data imputation
├── scripts/           # Data ingestion, processing, and runner scripts
├── timesfm/           # Clone of Google TimesFM (open-source time series foundation model)
├── docs/              # Project documentation and method explanations
└── data/
    ├── raw/           # Raw source files (Excel, CSV, etc.)
    └── sql/           # Converted SQL output files (generated)
```

## Data Pipeline

1. Raw files live in `data/raw/` (e.g., `all_acoustic_sensor_data_210901_211231.csv`)
2. Imputation scripts in `imputation/` process and fill missing values
3. Processed data is converted to SQL and written to `data/sql/`
4. The Python backend serves the data from `data/sql/`
5. The React frontend visualizes the data

## External Models

- **`timesfm/`** — Local clone of [Google TimesFM](https://github.com/google-research/timesfm), an open-source time series foundation model. Used for time series forecasting/imputation experiments on SPL data. Do not modify files inside this directory.

## Database Layout (`data/SPL.db` — SQLite)

### `devices`
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-assigned, sorted by name |
| `name` | TEXT UNIQUE | Sensor name |
| `lat` | REAL | Latitude |
| `long` | REAL | Longitude |
| `data_start` | TEXT | `'YYYY-MM-DD HH:MM:SS UTC'` of first reading |
| `data_end` | TEXT | `'YYYY-MM-DD HH:MM:SS UTC'` of last reading |
| `total_hours` | INTEGER | Hours between data_start and data_end inclusive |
| `hours_with_data` | INTEGER | Distinct hours with at least one reading |
| `missing_hours` | INTEGER | `total_hours - hours_with_data` |
| `hist_hours_filled` | INTEGER | Rows in `spl_levels_historical_imp` for this device |
| `knn_hours_filled` | INTEGER | Rows in `spl_levels_knn_imp` for this device |
| `combined_hours_filled` | INTEGER | Rows in `spl_levels_combined_imp` for this device |
| `timesfm_hours_filled` | INTEGER | Rows in `spl_levels_timesfm_imp` for this device |

### `sp_levels` — original aggregated readings
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `device_id` | INTEGER FK | → `devices(id)` |
| `timestamp` | TEXT | `'dd-mm-yyyy hh:00'` Estonian time (Europe/Tallinn) |
| `ts_indexed` | INTEGER | Unix timestamp (UTC seconds) of the hour — **indexed** |
| `value` | INTEGER | Hourly median dB, rounded to integer |
| `imputed` | INTEGER | Always `0` (all rows are original) |

Indexes: `idx_sp_levels_ts` on `ts_indexed`, `idx_sp_levels_device` on `device_id`

### Imputation tables
All three share the same schema as `sp_levels`. `imputed = 0` means copied from original, `imputed = 1` means filled by the method.

| Table | Method |
|---|---|
| `spl_levels_historical_imp` | Median of last 10 available same-hour readings from previous days |
| `spl_levels_knn_imp` | Median of spatial neighbours ≤500 m (fallback ≤1 km) at same timestamp |
| `spl_levels_combined_imp` | Inverse-variance weighted blend of historical + KNN |
| `spl_levels_timesfm_imp` | Combined table as base; statistically-imputed slots re-imputed with Google TimesFM 2.5. `imputed=0` original, `imputed=1` kept statistical (< 72h context), `imputed=2` TimesFM |

Indexes on each: `ts_indexed` and `device_id`

### Timestamp conventions
- `timestamp` TEXT column: `'dd-mm-yyyy hh:00'` in **Tallinn local time** (Europe/Tallinn, EEST=UTC+3 / EET=UTC+2)
- `ts_indexed` INTEGER: Unix UTC seconds of that same hour — use this for all range queries and arithmetic

## Conventions

- Imputation logic belongs in `imputation/` as standalone Python scripts
- Do not put business logic in `backend/` that belongs in `imputation/`
- SQL files in `data/sql/` are generated — do not edit them manually
- Raw files in `data/raw/` are source of truth — do not modify them

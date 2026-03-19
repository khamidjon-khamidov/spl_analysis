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
└── data/
    ├── raw/           # Raw source files (Excel, CSV, etc.)
    └── sql/           # Converted SQL output files (generated)
```

## Data Pipeline

1. Raw files live in `data/raw/` (e.g., `devices.xlsx`, `event.xlsx`, `imputation_map.xlsx`)
2. Imputation scripts in `imputation/` process and fill missing values
3. Processed data is converted to SQL and written to `data/sql/`
4. The Python backend serves the data from `data/sql/`
5. The React frontend visualizes the data

## Conventions

- Imputation logic belongs in `imputation/` as standalone Python scripts
- Do not put business logic in `backend/` that belongs in `imputation/`
- SQL files in `data/sql/` are generated — do not edit them manually
- Raw files in `data/raw/` are source of truth — do not modify them

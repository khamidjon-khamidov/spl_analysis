# 3.1 System Architecture

## 3.1.1 Overview

The system is structured as a four-layer research pipeline that transforms raw IoT sensor exports into an interactive visual analysis and imputation evaluation tool. The four layers — **data ingestion and processing**, **storage**, **backend API**, and **frontend visualization** — are loosely coupled: each has a single well-defined responsibility and communicates with adjacent layers through explicit, narrow interfaces. The pipeline scripts write to the database via file path; the backend reads from the database via SQL; the frontend consumes the backend exclusively over HTTP. No layer reaches across its boundary.

Figure 3.1 illustrates the complete data flow from raw sensor export to interactive dashboard.

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │  RAW INPUT                                                           │
 │                                                                      │
 │  data/raw/all_acoustic_sensor_data_210901_211231.csv                 │
 │  471 sensors · ~3 M rows · Sep–Dec 2021                              │
 └────────────────────────────┬─────────────────────────────────────────┘
                              │ csv_to_sql.py
                              │ csv_to_sp_levels.py
                              ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  STORAGE LAYER  —  data/SPL.db  (SQLite)                             │
 │                                                                      │
 │   devices            sp_levels          spl_levels_historical_imp   │
 │   (471 rows)         (original          spl_levels_knn_imp          │
 │   coords · stats     readings)          spl_levels_combined_imp     │
 │   is_test · group                       spl_levels_timesfm_imp      │
 └──────────┬───────────────────────────────────────┬───────────────────┘
            │                                       │
            │ compute_missing_hours.py              │ impute_historical.py
            │ select_test_devices.py                │ impute_knn.py
            │                                       f│ impute_historical_and_knn.py
            ▼                                       │ impute_timesfm.py
 ┌──────────────────────────────┐                   │
 │  PIPELINE LAYER              │ ◀─────────────────┘
 │  scripts/  +  imputation/    │
 │                              │  evaluate_imputation.py
 │  standalone Python scripts   │        │
 │  no dependency on backend    │        ▼
 └──────────────────────────────┘  data/evaluation_results.csv
                                   data/evaluation_summary.csv
                                          │
                              ┌───────────┘
                              │ reads SPL.db + CSVs
                              ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  BACKEND LAYER  —  backend/main.py  (FastAPI · port 8000)            │
 │                                                                      │
 │   /spl/*              /analysis/*            /evaluation/*           │
 │   ─────────────       ──────────────────      ───────────────────    │
 │   static              by-hour                summary                 │
 │   range               dow-hour-heatmap        per-device             │
 │   device/{id}         distribution                                   │
 │   date-range          daily-trend                                    │
 │                       tier-over-time                                 │
 │                       device-ranking                                 │
 │                                                                      │
 │   resolve_table(source) maps all endpoints to the correct table      │
 └────────────────────────────┬─────────────────────────────────────────┘
                              │ HTTP / JSON
                              ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  FRONTEND LAYER  —  frontend/src/  (React + Vite · port 5173)        │
 │                                                                      │
 │   DataSourceContext  ◀──  global imputation method selector          │
 │        │                                                             │
 │        └── re-fetches all mounted pages on source change             │
 │                                                                      │
 │   DevicesPage     SPLStaticPage    SPLDailyPage    SPLChartPage       │
 │   SPLHeatmapPage  AnalysisPage     EvaluationPage                    │
 │                                                                      │
 │   MapLibre GL  ·  Recharts  ·  react-router-dom                      │
 └──────────────────────────────────────────────────────────────────────┘
```

*Figure 3.1 — System architecture. Arrows show the direction of data flow. Pipeline scripts write to storage; the backend reads from storage; the frontend consumes the backend exclusively via HTTP. No layer bypasses this contract.*

---

## 3.1.2 Component Responsibilities and Boundaries

### Raw Input

The raw data is a single CSV file exported from Tallinn's IoT platform, containing approximately three million individual sensor readings from 471 acoustic devices over the period September–December 2021. This file is treated as read-only throughout the project. All processing is applied downstream, so the ingestion can be re-run from scratch at any time without risk to the source data.

### Storage Layer

The central artifact of the system is a single SQLite database (`data/SPL.db`). It holds all device metadata in the `devices` table, original aggregated readings in `sp_levels`, and four imputation tables — one per method. After the pipeline completes, the database transitions to a read-only role: the backend queries it but never writes to it during normal operation.

Two CSV files (`evaluation_results.csv`, `evaluation_summary.csv`) live alongside the database and store the output of the evaluation script. They are written once by the evaluation script and subsequently consumed read-only by the backend. Storing evaluation output as flat CSV rather than as database tables keeps the evaluation stage independent of the database schema and allows the results to be inspected or redistributed without a database client.

### Pipeline Layer

The pipeline layer consists of standalone Python scripts in `scripts/` and `imputation/`. Each script performs a single transformation — ingestion, hourly aggregation, imputation, evaluation — and writes its output to the storage layer. The scripts are executed manually in a fixed order and have no dependency on the backend or frontend. This isolation has two important consequences: the pipeline can be re-run partially (e.g., re-running only one imputation method after a parameter change) without restarting any service, and it can be validated independently of the rest of the system.

The imputation scripts are further decoupled from one another. Each reads from `sp_levels` and `devices` only, except for the TimesFM script, which uses the combined imputation table as its base. This dependency is explicit and documented; all other methods are fully independent.

### Backend Layer

The backend is a single FastAPI application that exposes the database as a structured JSON REST API. It is stateless: every request opens a fresh SQLite connection, executes one query, and closes the connection. No caching, no sessions, no background tasks. This is deliberate — for a single-user research tool, the added complexity of a caching layer is not justified, and stateless requests are trivially safe to restart or redeploy.

All endpoints accept a `source` query parameter. A single `resolve_table(source)` function maps this parameter to the appropriate database table name, which is then substituted into the SQL query. This ensures the imputation method switch is handled in exactly one place for all 14 endpoints, eliminating the risk of inconsistency.

The three endpoint groups have clean boundaries: `/spl/*` serves map and chart data (raw readings and imputed readings), `/analysis/*` serves aggregate statistics computed entirely in SQL, and `/evaluation/*` reads from the CSV files and never touches the database. These boundaries make it straightforward to extend, test, or replace any group independently.

### Frontend Layer

The frontend is a React single-page application. A global `DataSourceContext` stores the currently selected imputation method. When the user changes the method in the navbar dropdown, every mounted page component re-fetches its data automatically. This design means the imputation source switch is implemented once, in context, rather than being wired into each of the seven page components individually.

The frontend communicates with the backend exclusively through HTTP `fetch` calls. It has no direct access to the database file and no knowledge of the underlying table structure. This boundary ensures that the API can evolve (e.g., adding caching or switching to PostgreSQL) without any changes to the frontend.

---

## 3.1.3 Technology Choices and Justification

### SQLite

SQLite was preferred over a client–server database (PostgreSQL, MySQL) for three reasons specific to this research context.

**Self-contained deployment.** The entire processed dataset — device metadata, five million hourly readings across 471 sensors, four imputation tables — fits in a single `.db` file of approximately 500 MB. The system requires no server process, no credentials, and no configuration file. Reproducing the environment on another machine means copying one file.

**Read-only workload after pipeline completion.** Once the pipeline has run, the database is never written by the backend. SQLite handles concurrent reads efficiently and without locking overhead, which is all that is required here. The complexity of connection pooling, replication, and write-ahead logging — all necessary for a multi-user write-heavy application — is not warranted.

**Sufficient query performance at this scale.** The largest table (`spl_levels_combined_imp`) holds approximately 3.5 million rows. With indexes on `device_id` and `ts_indexed`, all API queries return within 100 ms on a standard laptop. Aggregate analysis queries (group-by, case-when tier counts, distribution buckets) run in under 300 ms. These response times are within interactive thresholds without any caching layer.

The notable limitation of SQLite in this project is the text-encoded timestamp column (`dd-mm-yyyy hh:00`), which is incompatible with SQLite's native date functions. This is addressed by maintaining a parallel `ts_indexed` integer column (Unix UTC seconds) for all range comparisons; the text column is used only for display. Both columns are populated at ingestion time and kept in sync throughout the pipeline.

### Python and FastAPI

Python was used for both the pipeline scripts and the backend because the imputation methods depend on scientific Python libraries (`numpy`, `pandas`, `scikit-learn`) and because Google TimesFM exposes only a Python API. Keeping backend and pipeline in the same language eliminates a language boundary and allows utility functions (distance calculations, timestamp parsing) to be shared.

FastAPI was chosen over Flask for two reasons. First, it generates OpenAPI documentation automatically from type annotations, which was useful during development for inspecting endpoint contracts without writing a separate client. Second, its query parameter validation — type coercion, required/optional declaration, description strings — is handled declaratively with no boilerplate, keeping the API code concise. The entire backend fits in approximately 330 lines with no configuration files, migrations, or ORM setup.

### React, Vite, MapLibre GL, and Recharts

**React** was chosen for the frontend because the component model maps naturally onto the dashboard's structure: each of the seven pages is an independent component managing its own data-fetching lifecycle, and the global imputation selector is a single shared context with no prop-drilling. State changes propagate to exactly the components that need them without manual event wiring.

**Vite** replaced Create React App as the build tool for its substantially faster hot-module replacement during development. For a project with frequent UI iteration, build latency is a meaningful friction cost.

**MapLibre GL** (via `react-map-gl`) was chosen over Mapbox or Google Maps because it is fully open-source, requires no API key, and imposes no usage limits. Tile data is served by OpenFreeMap under the ODbL licence. This makes the entire visualization stack reproducible without any third-party account or billing arrangement — an important property for a research artefact intended to be shared. MapLibre also provides a native `heatmap` layer type used by the SPL Heatmap page, which offloads density interpolation and colour mapping to the GPU.

**Recharts** was chosen for statistical charts because chart components are plain JSX trees, which integrates naturally with React's rendering model and makes conditional rendering, dynamic data updates, and layout composition straightforward. It provides the chart types required — line, area, bar, horizontal bar — with sufficient customisation depth for a dark-themed dashboard without requiring a separate theming system.

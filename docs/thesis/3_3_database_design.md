# 3.3 Database Design

The system stores all sensor data, device metadata, imputed values, and coverage statistics in a single SQLite database (`data/SPL.db`). This section describes the table schema and the relationships between tables, explains the rationale for the dual timestamp representation used throughout, and documents the indexing strategy that keeps API query latency within interactive bounds.

---

## 3.3.1 Schema Overview

The database contains six tables: one device registry, one original readings table, and four imputation tables. Figure 3.2 shows the entity-relationship diagram.

```
                          devices
          ┌───────────────────────────────────────────────┐
          │ PK  id               INTEGER                  │
          │     name             TEXT UNIQUE              │
          │     lat, long        REAL                     │
          │     data_start       TEXT  (YYYY-MM-DD UTC)   │
          │     data_end         TEXT  (YYYY-MM-DD UTC)   │
          │     total_hours      INTEGER                  │
          │     hours_with_data  INTEGER                  │
          │     missing_hours    INTEGER                  │
          │     hist_hours_filled    INTEGER              │
          │     knn_hours_filled     INTEGER              │
          │     combined_hours_filled INTEGER             │
          │     timesfm_hours_filled  INTEGER             │
          │     is_test          INTEGER  (0 / 1)         │
          │     test_group       TEXT                     │
          └───────────────────┬───────────────────────────┘
                              │ 1
                              │
                              │ N  (device_id FK)
          ┌───────────────────┴──────────────────────────────────────────────────────┐
          │                                                                          │
   sp_levels                  spl_levels_             spl_levels_    spl_levels_    spl_levels_
   (original)                 historical_imp          knn_imp        combined_imp   timesfm_imp
   ──────────────             ──────────────          ───────────    ────────────   ────────────
   PK id                      PK id                   PK id          PK id          PK id
   FK device_id ──────────    FK device_id            FK device_id   FK device_id   FK device_id
      timestamp TEXT             timestamp TEXT           …              …              …
   IDX ts_indexed INT         IDX ts_indexed INT
      value    INTEGER           value    INTEGER
      imputed  INTEGER=0         imputed  0/1            0/1            0/1            0/1/2
```

*Figure 3.2 — Database schema. All five readings tables share an identical column set. The `imputed` flag meaning differs for the TimesFM table (see Section 3.3.3).*

### `devices`

The device registry holds one row per physical sensor. It is populated by `csv_to_sql.py` with the four core columns (`id`, `name`, `lat`, `long`) and extended by later pipeline scripts using `ALTER TABLE ... ADD COLUMN`:

- `data_start`, `data_end`, `total_hours`, `hours_with_data`, `missing_hours` — added by `compute_missing_hours.py`
- `hist_hours_filled`, `knn_hours_filled`, `combined_hours_filled`, `timesfm_hours_filled` — added by `compute_imputation_coverage.py`; each records the number of rows the corresponding imputation table contains for that device
- `is_test`, `test_group` — added by `select_test_devices.py`; used to mark the 35 evaluation devices and their stratification group

Using `ALTER TABLE` to extend the schema incrementally means each pipeline script is self-contained: it adds exactly the columns it is responsible for, without needing to know the full final schema in advance. This makes individual scripts safe to re-run after schema additions without breaking existing columns.

### `sp_levels`

The original readings table holds one row per `(device, hour)` pair produced by the aggregation step. The `imputed` column is always `0` — every row in this table is a measured value. This table is never modified after ingestion; it serves as the immutable ground truth for all evaluation and as the source for the imputation scripts.

### Imputation Tables

The four imputation tables (`spl_levels_historical_imp`, `spl_levels_knn_imp`, `spl_levels_combined_imp`, `spl_levels_timesfm_imp`) share an identical column set with `sp_levels`. Each table is a complete, independent snapshot of all device-hours within each device's active period — both measured hours (copied from `sp_levels`) and filled hours (computed by the method). This design means the backend can serve any imputation source by simply substituting the table name in the query, with no joins across methods required.

The `imputed` flag encodes the provenance of each row:

| Table | `imputed = 0` | `imputed = 1` | `imputed = 2` |
|---|---|---|---|
| `sp_levels` | Original (always) | — | — |
| `spl_levels_historical_imp` | Copied from original | Filled by historical median | — |
| `spl_levels_knn_imp` | Copied from original | Filled by KNN | — |
| `spl_levels_combined_imp` | Copied from original | Filled by combined blend | — |
| `spl_levels_timesfm_imp` | Copied from original | Kept statistical (< MIN_CONTEXT before slot) | Re-imputed by TimesFM |

The three-value flag in `spl_levels_timesfm_imp` distinguishes slots that TimesFM was able to re-impute (sufficient context exists) from slots that were retained from the combined table unchanged because the sensor had too few prior readings to build a reliable context window. This distinction is used in the SPL Static page to render an imputation chip only for filled values, and it supports future analysis of where TimesFM had insufficient context.

---

## 3.3.2 Timestamp Dual-Representation

Every readings row stores the same moment in time in two different representations:

| Column | Format | Example | Purpose |
|---|---|---|---|
| `timestamp` | `TEXT dd-mm-yyyy hh:00` | `01-09-2021 14:00` | Display; day-of-week extraction |
| `ts_indexed` | `INTEGER` Unix UTC seconds | `1630497600` | Range queries; arithmetic; index |

**Why local time in `timestamp`.** The analysis domain is urban noise patterns — traffic cycles, working-hour noise, nighttime quiet — which are all defined in human local time. Storing the display timestamp in Estonian time (`Europe/Tallinn`) means every SQL query that groups by hour-of-day or day-of-week (`strftime('%w', ...)`, `substr(timestamp, 12, 2)`) operates directly on the correct local-time value without any runtime conversion. The alternative — storing UTC and converting in SQL — would require a `datetime(ts, 'unixepoch', 'localtime')` call on every row, which is slower and depends on the server's system timezone being configured correctly.

**Why UTC unix seconds in `ts_indexed`.** The text `timestamp` column cannot be used for efficient range queries or arithmetic. SQLite's `strftime` and `datetime` functions accept ISO 8601 format (`yyyy-mm-dd`), not the `dd-mm-yyyy` format used here. A range query on `timestamp` would require a string transformation on every candidate row, making index use impossible. `ts_indexed` avoids this: it is a plain integer, supports the full set of arithmetic and comparison operators, and is indexed. All range-based queries in the API (`WHERE ts_indexed >= ? AND ts_indexed <= ?`), all inter-slot gap computations in the imputation scripts, and the `data_start`/`data_end` coverage statistics are computed exclusively from `ts_indexed`.

**Consistency guarantee.** Both columns are populated from the same `datetime` object in the ingestion script — `timestamp` from `strftime("%d-%m-%Y %H:00")` and `ts_indexed` from `int(dt_tallinn.timestamp())` — so they are always in sync. No downstream script or query ever attempts to convert between the two; each column is used only for its designated purpose.

---

## 3.3.3 Index Strategy

Ten indexes are created across the six tables, two per readings table:

| Index name | Table | Column | Query type served |
|---|---|---|---|
| `idx_sp_levels_ts` | `sp_levels` | `ts_indexed` | Range queries: `/spl/range`, `/spl/static` |
| `idx_sp_levels_device` | `sp_levels` | `device_id` | Per-device queries: `/spl/device/{id}` |
| `idx_hist_ts` | `spl_levels_historical_imp` | `ts_indexed` | Same as above, for historical source |
| `idx_hist_device` | `spl_levels_historical_imp` | `device_id` | Same as above |
| `idx_knn_ts` | `spl_levels_knn_imp` | `ts_indexed` | Same, KNN source |
| `idx_knn_device` | `spl_levels_knn_imp` | `device_id` | Same |
| `idx_combined_ts` | `spl_levels_combined_imp` | `ts_indexed` | Same, combined source |
| `idx_combined_device` | `spl_levels_combined_imp` | `device_id` | Same |
| `idx_timesfm_ts` | `spl_levels_timesfm_imp` | `ts_indexed` | Same, TimesFM source |
| `idx_timesfm_device` | `spl_levels_timesfm_imp` | `device_id` | Same |

**`ts_indexed` index — range queries.** The most data-intensive API call is `/spl/range`, which fetches all sensor readings for every hour in a date window. Without an index, this requires a full table scan across ~3.5 million rows. With the B-tree index on `ts_indexed`, SQLite locates the first matching row in O(log n) time and reads sequentially to the end of the range. For a typical three-day request (72 slots × ~300 active sensors ≈ 21,600 rows), this reduces query time from several seconds to under 100 ms.

**`device_id` index — per-device queries.** The `/spl/device/{id}` endpoint and all imputation scripts that build per-device time series use `WHERE device_id = ?`. Without an index, each such query scans the entire table. With the index, SQLite retrieves only the rows for the requested device. This is critical for the imputation scripts, which execute this lookup for every one of the 471 devices.

**No composite index on `(device_id, ts_indexed)`.** A composite index would serve the pattern `WHERE device_id = ? AND ts_indexed BETWEEN ? AND ?` — used by the imputation scripts' lookback windows — marginally better than two single-column indexes. However, the single-column indexes are sufficient for the dataset size and avoid the additional write cost and storage overhead of a composite index. If the dataset were scaled to multiple years or thousands of devices, a composite index would become worthwhile.

**`devices` table — no index.** The `devices` table contains 471 rows. SQLite performs a full scan of a 471-row table faster than using a B-tree index, so no index is created. All joins between `devices` and the readings tables are driven by the readings-side index; the device lookup is a hash or linear scan on the small table.

**Index creation timing.** Indexes are created immediately after the `CREATE TABLE` statement and before any data is inserted. This is intentional: creating an index on an already-populated table requires SQLite to build the entire B-tree in one pass, which is no faster than incremental insertion but locks the table for longer. Creating the index first has no measurable cost on an empty table.

# 3.2 Data Ingestion and Pre-processing

Data ingestion is the first stage of the pipeline. Its responsibility is to transform the raw sensor export — a single flat CSV file — into a normalised, indexed SQLite database ready for imputation and analysis. The stage is split into two scripts that run sequentially: `csv_to_sql.py` builds the device registry, and `csv_to_sp_levels.py` aggregates the raw readings into hourly observations. A third script, `compute_missing_hours.py`, follows the imputation stage to characterise data completeness per device. Together they produce all rows in the `devices` and `sp_levels` tables.

---

## 3.2.1 Raw CSV Structure and Encoding

The source file (`data/raw/all_acoustic_sensor_data_210901_211231.csv`) is a UTF-8 encoded comma-separated export covering the period 1 September 2021 to 31 December 2021. Each row represents a single sensor reading. The file contains approximately three million rows across 471 unique devices. The relevant columns are:

| Column | Type | Description |
|---|---|---|
| `name` | string | Unique device identifier (alphanumeric label assigned by the platform) |
| `value` | float | Instantaneous SPL reading in dB |
| `dt_production` | string | Timestamp of the reading as recorded by the sensor, including UTC offset |
| `latitude` | float | Sensor latitude in decimal degrees (WGS 84) |
| `longitude` | float | Sensor longitude in decimal degrees (WGS 84) |
| `fk_event_type` | string | Event classification — not used in this project |
| `fk_device_type` | string | Sensor model classification — not used in this project |

The file is opened with Python's `csv.DictReader` and `encoding="utf-8"`. Rows where `latitude` or `longitude` cannot be parsed as a float are silently skipped during device extraction; rows where `value` or `dt_production` cannot be parsed are skipped during aggregation. In both cases a running counter records the number of skipped rows for diagnostic output.

---

## 3.2.2 Timestamp Parsing and Time Zone Handling

The `dt_production` field encodes timestamps with an explicit UTC offset but lacks a consistent format across the dataset. Two variants appear:

- `2021-09-01 14:32:07.123456+03:00` — with fractional seconds and colon-separated offset
- `2021-09-01 14:32:07+0300` — without fractional seconds, offset without colon

Python's `datetime.strptime` does not accept both formats with a single format string. The ingestion script normalises the offset before parsing: a regular expression strips the colon from `+HH:MM` offsets (producing `+HHMM`) and expands bare `+HH` offsets to `+HHMM`. The format string then selects `%Y-%m-%d %H:%M:%S.%f%z` or `%Y-%m-%d %H:%M:%S%z` depending on whether a decimal point is present:

```python
def parse_dt(s):
    s = re.sub(r'([+-])(\d{2}):(\d{2})$', lambda m: m.group(1)+m.group(2)+m.group(3), s)
    s = re.sub(r'([+-])(\d{2})$',         lambda m: m.group(1)+m.group(2)+'00', s)
    fmt = "%Y-%m-%d %H:%M:%S.%f%z" if '.' in s else "%Y-%m-%d %H:%M:%S%z"
    return datetime.strptime(s, fmt)
```

Once a timezone-aware `datetime` object is obtained, it is converted to **Estonian local time** (`Europe/Tallinn`, EEST = UTC+3 in summer, EET = UTC+2 in winter) using Python's `zoneinfo` module. The conversion is performed by `dt.astimezone(ZoneInfo("Europe/Tallinn"))`. Minutes, seconds, and microseconds are then set to zero, truncating each reading to its containing hour boundary in local time.

Estonian time was chosen as the reference rather than UTC because the analysis targets urban noise patterns — traffic cycles, working hours, nighttime quiet periods — which are all defined in local time. Storing timestamps in UTC and converting at query time would add complexity to every SQL query without benefit; storing them in local time makes the heatmap, by-hour chart, and day-of-week analysis directly interpretable without conversion.

Two representations of each timestamp are stored for different query purposes:

- `timestamp TEXT` — the human-readable string `dd-mm-yyyy hh:00` in Estonian local time, used for display in the frontend and for day-of-week extraction (via SQLite's `strftime` on a reformatted ISO string).
- `ts_indexed INTEGER` — the Unix UTC seconds of the same moment (obtained from `int(dt_tallinn.timestamp())`), used for all range comparisons, index-accelerated lookups, and arithmetic such as computing inter-reading gaps. This column is indexed.

The dual representation avoids runtime conversion in SQL at the cost of a small storage overhead. The text column is incompatible with SQLite's native date functions (which require ISO format), so the text column is never used in range queries; `ts_indexed` handles all such cases.

---

## 3.2.3 Device Deduplication and Coordinate Normalisation

The raw CSV contains one row per reading, so each device appears thousands of times. The device extraction script (`csv_to_sql.py`) performs a single streaming pass over the file to collect unique device names and their coordinates, storing the **first-seen** latitude and longitude for each device.

A small number of devices exhibit coordinate drift — successive readings report slightly different coordinates, most likely due to GPS jitter or platform metadata updates. To detect this, coordinates are compared with a tolerance of `1e-5` degrees (approximately one metre at Estonian latitudes). If a device's coordinates deviate beyond this threshold across readings, a warning is printed but the first-seen coordinates are retained. This policy is appropriate because the sensors are physically fixed installations; any coordinate change larger than one metre is assumed to be a metadata artefact rather than a physical relocation.

After deduplication, devices are sorted alphabetically by name and assigned a sequential integer `id` starting from 1. Sorting ensures that `id` assignments are deterministic across re-runs of the script, which is important for reproducibility: all downstream tables reference devices by integer `id`, so any change in the assignment mapping would invalidate the database.

The resulting `devices` table contains 471 rows, one per unique sensor, with `id`, `name`, `lat`, and `long` columns. Additional columns (`data_start`, `data_end`, `total_hours`, `hours_with_data`, `missing_hours`, and per-method fill counts) are added by later pipeline scripts via `ALTER TABLE`.

---

## 3.2.4 Hourly Aggregation

With the device registry in place, the aggregation script (`csv_to_sp_levels.py`) makes a second streaming pass over the raw CSV to group readings into one-hour buckets.

For each valid row, the script:

1. Looks up the device's integer `id` from an in-memory dictionary loaded from the `devices` table.
2. Parses and converts the timestamp to Estonian local time, then truncates it to the hour boundary.
3. Appends the `value` to the bucket keyed by `(device_id, timestamp_str, ts_unix)`.

All ~3 million rows are streamed into memory-resident bucket lists before any aggregation is performed. The bucket key includes both timestamp representations to avoid recomputing `ts_unix` during the write stage.

Once all rows are read, each bucket is reduced to a **median** value, rounded to the nearest integer:

```python
value = round(statistics.median(vals))
```

**Median over mean** was chosen for two reasons. First, SPL sensors occasionally produce transient spike readings caused by brief loud events (a passing vehicle, a door slam) that are not representative of the ambient noise level for that hour. The median is resistant to such outliers; the mean would inflate the hourly estimate. Second, the median corresponds to a physically meaningful quantity — the level exceeded by half the readings in that hour — which aligns with standard acoustic measurement practice.

The `value` column stores the result as an integer (dB rounded to the nearest whole number). Sub-integer precision would imply a measurement accuracy that the low-cost sensors do not support; integer storage also reduces the table size and simplifies tier classification queries.

The final `sp_levels` table is populated with one row per `(device_id, hour)` pair. The `imputed` column is set to `0` for every row, distinguishing original readings from imputed values in the downstream tables. Two indexes are created at this stage: one on `ts_indexed` for fast range queries and one on `device_id` for per-device lookups.

---

## 3.2.5 Missing Hour Detection

After the imputation tables are populated, `compute_missing_hours.py` characterises data completeness for each device. It does not re-read the CSV; it works entirely from `sp_levels` using `ts_indexed`.

For each device, a single aggregate query retrieves:

- `MIN(ts_indexed)` — the Unix timestamp of the device's first reading (`data_start`)
- `MAX(ts_indexed)` — the Unix timestamp of the device's last reading (`data_end`)
- `COUNT(DISTINCT ts_indexed)` — the number of distinct hours for which at least one reading exists (`hours_with_data`)

`total_hours` is then computed as:

```
total_hours = (ts_end − ts_start) / 3600 + 1
```

The `+1` accounts for the inclusive endpoints: a device with readings only at hours 0 and 1 spans two hours, not one. `missing_hours` is the difference:

```
missing_hours = max(0, total_hours − hours_with_data)
```

The `max(0, ...)` guard handles the edge case where rounding in `ts_indexed` causes `hours_with_data` to marginally exceed `total_hours`.

These three values (`total_hours`, `hours_with_data`, `missing_hours`) are written back to the `devices` table via `UPDATE`. They serve two downstream purposes: they drive the colour-coding of device markers on the Devices page, and they are used by the test device selection script to filter candidates by missing rate.

Across all 471 devices, the fleet-wide missing rate is approximately **26%** — meaning roughly one in four expected hourly readings is absent from the raw dataset. This motivates the imputation pipeline described in Section 3.4.

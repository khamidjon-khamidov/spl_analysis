# Methodology

## 3. Methodology

### 3.1 Data Source: Tallinn IoT Acoustic Sensor Network

The primary data source for this study is the acoustic monitoring network operated within the city of Tallinn, Estonia. The network consists of **471 low-cost IoT sound pressure level sensors** deployed across major transit arteries, residential districts, and public spaces. Each sensor is a fixed installation with a known geographic position (latitude, longitude) recorded in decimal degrees.

**Coverage period:** 1 September 2021 – 31 December 2021 (122 days).

**Sampling characteristics:**
- Sensors produce sub-minute readings of instantaneous sound pressure level in decibels (dB).
- Raw readings are timestamped in UTC with a timezone offset included in the `dt_production` field.
- The event type field (`fk_event_type`) identifies the measurement category; only acoustic SPL events are retained.
- Device type is encoded in `fk_device_type`; all devices in the study are of the same type (low-cost MEMS microphone-based IoT sensors).

**Raw CSV schema:** `name, fk_event_type, value, dt_production, fk_device_type, latitude, longitude`

The network provides dense spatial coverage of Tallinn's urban core, with typical inter-sensor distances of 200–800 m in central areas and up to several kilometres at the city periphery. All sensor coordinates are static for the duration of the dataset, with the exception of a small number of devices whose GPS coordinates were found to differ by more than 1×10⁻⁵ degrees (~1 m) across records; these coordinate changes were flagged and the first-seen coordinate was retained.

---

### 3.2 Data Pre-processing

Raw sensor data requires several transformation and cleaning steps before it can be used for analysis or imputation. The pre-processing pipeline is implemented as a sequence of standalone Python scripts.

#### 3.2.1 Device Extraction and Deduplication

The raw CSV may contain multiple records per device name. A device catalogue is constructed by scanning all rows and extracting unique device names with their first-observed coordinates. Devices with inconsistent coordinates across records are flagged with a warning. The resulting 471 devices are assigned sequential integer identifiers sorted alphabetically by name and stored in the `devices` table of a local SQLite database (`data/SPL.db`).

#### 3.2.2 Timestamp Normalisation and Timezone Handling

Raw timestamps (`dt_production`) are stored in ISO 8601 format with UTC offset, but they vary in sub-format (with or without fractional seconds, with colon-separated or compact offsets). A robust parser normalises all formats to timezone-aware Python `datetime` objects.

Because Tallinn observes **Eastern European Time** (EET, UTC+2 in winter; EEST, UTC+3 in summer), all timestamps are converted to the `Europe/Tallinn` timezone before aggregation. This ensures that the resulting hourly bins align with local human activity patterns — peak traffic at 08:00 Tallinn time, not 06:00 or 05:00 UTC. The conversion uses Python's `zoneinfo` module with the IANA timezone database, which correctly handles the DST transition within the dataset period (EEST → EET on 31 October 2021 at 04:00 local).

Each timestamp is then **floor-truncated to the hour** (minutes, seconds, and microseconds zeroed), producing a two-part key: a human-readable string (`dd-mm-yyyy hh:00`) used for display, and a Unix UTC integer timestamp (`ts_indexed`) used for all arithmetic and indexing.

#### 3.2.3 Hourly Aggregation and Outlier Handling

Within each (device, hour) bucket, multiple sub-minute raw readings may exist. These are aggregated to a single representative value using the **median**. The median is preferred over the mean for two reasons:

1. **Robustness to transient spikes**: a brief loud event (passing vehicle, alarm) can produce one or two extreme readings within an hour that would inflate the mean but are absorbed by the median.
2. **Alignment with perceptual noise exposure**: sustained average noise level is better characterised by the typical value in a period than by a spike-inflated average.

The resulting value is rounded to the nearest integer (dB resolution), matching the precision of the original sensor hardware.

Rows where the `value` field cannot be parsed as a float, or where the device name is not in the device catalogue, are silently skipped and counted as `skipped` in the pipeline log.

#### 3.2.4 Coverage Statistics

After aggregation, per-device data coverage is computed directly from the `sp_levels` table using SQL aggregation over `ts_indexed`:

- **`data_start`** / **`data_end`**: earliest and latest hourly timestamps for each device.
- **`total_hours`**: `(ts_end − ts_start) / 3600 + 1` — the number of distinct hour slots in the device's active lifespan.
- **`hours_with_data`**: count of distinct `ts_indexed` values per device — hours with at least one reading.
- **`missing_hours`**: `total_hours − hours_with_data`.

Across the full network, the original dataset contains approximately **877,000 device-hours** of readings out of a theoretical maximum, with missing rates ranging from 0% (perfectly reliable sensors) to over 90% (sensors that were offline for the majority of the coverage period).

---

### 3.3 Imputation Framework

#### 3.3.1 Characterising Missingness

Missing data in IoT acoustic networks does not arise uniformly. Two distinct mechanisms are identifiable in this dataset:

**Missing Completely at Random (MCAR):** Individual dropped readings caused by transient network failures, packet loss, or brief power interruptions. These gaps are short (one to a few hours), distributed irregularly across time and devices, and are not correlated with the acoustic conditions being measured. The fact that the sensor was offline is independent of what the sound level would have been.

**Systematic / Structural Gaps:** Extended outages caused by hardware failure, sensor replacement, power supply problems, or deliberate decommissioning. These gaps can span days to weeks and are concentrated in specific devices. Crucially, the device's acoustic environment continues to exist during the outage — it is only the measurement that is absent, not the phenomenon. These gaps are not MCAR but they are plausibly **Missing At Random (MAR)**: the probability of absence is related to device-specific reliability, not to the underlying noise level at that location.

A third category — sensors that are systematically offline precisely because of the noise conditions they would measure (e.g., sensors taken offline during a construction project) — would constitute **Missing Not at Random (MNAR)** and is not addressable by standard imputation. This study assumes that systematic gaps in this dataset are MAR, as no evidence of deliberate noise-correlated sensor withdrawal was found.

#### 3.3.2 Imputation Methods

Four imputation methods are implemented and evaluated, in order of increasing complexity:

**Method 1: Historical Median**

For each missing (device, hour) slot, the median of the last 10 available readings for the same device at the same hour-of-day (from any prior days) is used as the imputed value. This exploits the strong daily periodicity of urban noise (rush hours, quiet nights) while remaining device-specific. It does not require data from any other sensor.

*Fill rate: 91.9%.* Failures occur when a device has no prior recordings at a given hour (cold-start problem at the beginning of the dataset).

See `docs/historical.md` for full algorithmic detail.

**Method 2: Spatial KNN**

For each missing slot, the median of readings from spatially neighbouring sensors at the same timestamp is used. Neighbours are defined by Haversine distance: the primary search radius is **500 m** (minimum 3 neighbours required); if fewer than 3 are found, the search expands to a **1,000 m** fallback radius. This exploits the spatial correlation of urban noise — nearby sensors on the same street experience similar traffic conditions simultaneously.

*Fill rate: 98.8%.* Failures are confined to isolated sensors with no active neighbours at the same timestamp.

See `docs/knn.md` for full algorithmic detail.

**Method 3: Historical + KNN (Inverse-Variance Weighted Blend)**

The two statistical methods are combined using **inverse-variance weighting**, the optimal linear fusion strategy under the assumption that both estimators are unbiased and their errors are independent:

$$\hat{x} = \frac{w_{\text{hist}} \cdot \hat{x}_{\text{hist}} + w_{\text{knn}} \cdot \hat{x}_{\text{knn}}}{w_{\text{hist}} + w_{\text{knn}}}, \quad w_i = \frac{1}{\max(\sigma_i^2,\ 1.0)}$$

where $\sigma_i^2$ is the sample variance of the respective source's input readings. A variance floor of 1.0 dB² prevents infinite weights from near-constant samples. When only one source is available, it is used directly.

*Fill rate: 99.9%.* The combined method almost entirely eliminates the complementary failure modes of the two individual methods.

See `docs/historical_knn.md` for the theoretical derivation and worked example.

**Method 4: Google TimesFM (Neural Re-imputation)**

The combined table (99.9% filled) is used as a fixed context source. All slots that were statistically imputed (imputed = 1) are re-imputed using **Google TimesFM 2.5**, a 200M-parameter decoder-only transformer pre-trained on large-scale real-world time series. For each such slot, the 512 most recent hourly values from the combined table are passed as context; the model forecasts the value at the missing slot with horizon = 1.

Slots with fewer than 72 hours of preceding context (device too new) retain their statistical estimate. The model runs in **Option A (fixed context)** mode: the combined table is never modified during forecasting, so all context windows are independent and can be batched.

*Fill rate: 99.9%.* The primary benefit over Method 3 is not coverage but **temporal coherence**: the neural model incorporates recent trajectory and captures short-term trends that the statistical methods cannot.

See `docs/timesfm.md` for full algorithmic detail and processing statistics.

#### 3.3.3 Method Selection Rationale

The four methods form a deliberate progression from simple to complex:

| Dimension | Historical | KNN | Combined | TimesFM |
|---|---|---|---|---|
| Temporal awareness | Yes | No | Yes | Yes (learned) |
| Spatial awareness | No | Yes | Yes | No |
| Cold-start handling | No | Yes | Partial | Partial |
| Computational cost | Very low | Low | Low | High (CPU: ~13 h) |
| Fill rate | 91.9% | 98.8% | 99.9% | 99.9% |

Each method is stored in its own database table and remains available in the dashboard at runtime, allowing direct visual comparison across all methods simultaneously.

---

### 3.4 Visualization Stack

The visualization component is implemented as a web application with a Python backend and a React frontend, designed for interactive exploration of the imputed dataset.

**Backend:** FastAPI (Python) serves a SQLite database via five REST endpoints. Queries use the indexed `ts_indexed` (Unix UTC integer) column for all range filters, avoiding string-based timestamp comparison. The imputation source is selected at query time via a `source` parameter that resolves to the appropriate database table, so no data copying or pre-joining is required between methods.

**Frontend:** React (Vite) with the following libraries:

- **react-map-gl / MapLibre GL** — WebGL-accelerated map rendering with free vector tiles (OpenFreeMap). Sensor positions are rendered as labelled markers coloured by SPL health tier or data completeness percentage.
- **Recharts** — Line charts for per-device SPL time series with brush-zoom, WHO threshold reference lines, and per-point health colouring.
- **React context (DataSourceContext)** — Global state for the selected imputation method, propagated to all pages without prop drilling; switching methods triggers re-fetches across the entire dashboard simultaneously.

**Dashboard pages:**

| Page | Purpose |
|---|---|
| Devices | Map of all 471 sensors coloured by data completeness (green / amber / red) for the selected imputation method |
| SPL Static | Snapshot map for a chosen date and hour; markers coloured by WHO noise health tier; imputed values visually distinguished |
| SPL Daily Analysis | Animated playback of hourly SPL maps across a user-selected date range; configurable speed (1×–10×) with manual scrubber |
| SPL Chart | Per-device line chart with full time series, WHO reference lines, and device location mini-map |

**WHO noise health tiers used for visualisation:**

| Colour | Range | Classification |
|---|---|---|
| Green | < 45 dB | Safe |
| Lime | 45–55 dB | Acceptable |
| Yellow | 55–65 dB | Moderate concern |
| Orange | 65–75 dB | High concern |
| Red | ≥ 75 dB | Dangerous |

The frontend is a local development application (Vite dev server on port 5173, FastAPI on port 8000) intended for research use. No mapping data is processed client-side beyond rendering; all imputation, aggregation, and querying is performed server-side or as offline preprocessing.

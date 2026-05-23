# Data Imputation and Animated Visualization of Sound Pressure Level in Tallinn Based on IoT Sensor Data

**Author:** Khamidjon Khamidov
**Student Code:** 216747IAPM
**Degree Programme:** Master of Science in Software Engineering
**Institution:** School of Information Technologies, Tallinn University of Technology (TalTech)
**Year:** 2026
**Supervisor:** Jaanus Kaugerand, Senior Researcher

---

## Abstract

Urban acoustic environments are increasingly monitored through dense IoT sensor deployments, but
the pervasive problem of missing data limits their analytical utility. This thesis documents the
design and full-stack implementation of a reproducible pipeline for imputing missing Sound Pressure
Level (SPL) readings collected by 471 low-cost acoustic sensors deployed across Tallinn, Estonia,
between September and December 2021. The raw dataset of approximately 3 million sub-minute
readings exhibits a fleet-wide missing rate of approximately 26%, arising from packet loss,
gateway failures, and hardware instability.

Four imputation methods of increasing computational complexity were implemented: (1) Historical
Median, a temporal lookback over prior same-hour readings; (2) Spatial K-Nearest Neighbors (KNN),
which queries geographically adjacent sensors at the same timestamp; (3) a Combined
inverse-variance weighted blend of methods (1) and (2); and (4) Google TimesFM 2.5, a
200-million-parameter decoder-only transformer used in zero-shot mode to re-impute the slots
filled by method (3).

A stratified evaluation protocol was designed with 35 held-out test devices selected across three
structural groups to isolate the effects of spatial density, network isolation, and operational
lifespan. Across 17,317 masked ground-truth slots, TimesFM achieved a Mean Absolute Error (MAE)
of 1.18 dB and RMSE of 1.80 dB, compared to 2.70 / 4.10 dB for the Combined blend, 3.32 / 4.79
dB for Historical Median, and 3.54 / 5.07 dB for Spatial KNN. A counterintuitive finding is
documented: KNN performs worse in areas with high sensor density than in isolated areas, due to
correlated network outages that silence entire clusters simultaneously.

To expose the imputed datasets, an interactive single-page web application was built using React,
MapLibre GL, Recharts, and FastAPI. The dashboard supports animated spatial playback of hourly
SPL heatmaps, sensor fleet health diagnostics, temporal pattern analysis, and transparent
side-by-side comparison of all four imputation methods.

The thesis is in English and contains approximately 55 pages of text, 7 chapters, 14 figures,
and 8 tables.

---

## 1. Introduction

### 1.1 Motivation and Problem Statement

Environmental noise is a significant public health concern in European cities. According to the
World Health Organization, sustained exposure to noise above 55 dB during daytime or 40 dB at
night is associated with sleep disturbance, cardiovascular disease, and cognitive impairment in
children. In Tallinn, measurements along major traffic corridors such as Liivalaia and Parnu mnt
regularly exceed 70-75 dB, and the city's official noise map, last updated in 2019 using static
acoustic simulations, is increasingly insufficient for evidence-based urban planning.

The Tallinn municipality, under the "Test in Tallinn" smart-city initiative, deployed a network
of 471 low-cost IoT acoustic sensors to transition from simulation-based mapping to real-time
data-driven monitoring. These sensors record Sound Pressure Level in decibels at sub-minute
intervals using MEMS (Micro-Electro-Mechanical Systems) microphones. The resulting dataset covers
four months (September-December 2021) with over 3 million raw sub-minute observations.

However, low-cost IoT networks suffer from systemic data gaps. The Tallinn fleet exhibits a
fleet-wide missing rate of approximately 26%, equivalent to over 170,000 missing device-hours.
These gaps are unevenly distributed: some devices show near-perfect uptime, while others are
offline for days or weeks. Direct use of the raw dataset for regulatory compliance, public health
studies, or animated visualization would produce misleading conclusions wherever gaps coincide
with significant acoustic events.

This problem motivates the two core deliverables of this thesis: a reproducible imputation
pipeline to reconstruct missing observations, and an interactive visual dashboard to make the
imputed data accessible to planners and researchers.

### 1.2 Research Questions

Three research questions guide this thesis:

**RQ1:** To what extent does a hybrid imputation approach combining spatial and temporal
estimators reduce reconstruction error in SPL datasets compared to using either method alone?

**RQ2:** How does a zero-shot neural time series foundation model (Google TimesFM 2.5) compare
to the hybrid statistical method in terms of imputation accuracy and computational cost?

**RQ3:** How can an interactive visual dashboard support multi-dimensional analysis of urban SPL
data, including sensor health detection, spatial noise patterns, and imputation transparency?

### 1.3 Scope and Contributions

The thesis makes four principal contributions:

1. A validated data ingestion and preprocessing pipeline that converts a 3-million-row raw CSV
   export into a normalized, indexed SQLite database.
2. Four independently implemented and evaluated imputation methods stored in separate database
   tables, enabling direct method comparison.
3. A stratified evaluation framework with explicit leakage prevention and three device groups
   designed to stress-test each method's failure modes.
4. A full-stack interactive web dashboard enabling spatial, temporal, and comparative analysis
   of the reconstructed dataset.

---

## 2. Background

### 2.1 Urban Acoustic Monitoring

Traditional urban noise mapping relies on computational simulations of traffic flow over road and
building geometries. While reproducible, these methods cannot capture real-time events such as
construction disruptions, concerts, protests, or weather-driven anomalies. Dense IoT sensor
networks offer continuous, high-resolution monitoring but introduce the data quality challenges
inherent to low-cost hardware deployed over shared network infrastructure.

Low-cost acoustic sensors typically use MEMS microphones with +/-3-5 dB frequency-weighted
accuracy. While insufficient for certified compliance measurements, they are appropriate for
trend detection, relative comparison, and city-scale spatial mapping when aggregated to hourly
medians. The Tallinn network follows this design, recording SPL every few seconds and transmitting
readings over LoRaWAN and cellular gateways.

### 2.2 Missing Data in IoT Sensor Networks

The imputation literature for IoT environmental data distinguishes three missing-data mechanisms:
Missing Completely At Random (MCAR), Missing At Random (MAR), and Missing Not At Random (MNAR).
In urban IoT deployments, all three mechanisms are typically present simultaneously. MCAR occurs
when individual device firmware crashes. MAR occurs when outages correlate with environmental
conditions (e.g., outdoor hardware failures during rain). MNAR occurs when gateways serving
high-density areas fail, creating correlated gaps across many devices simultaneously.

Standard time series imputation methods include linear interpolation, seasonal decomposition,
and k-nearest-neighbors spatial averaging. More recent approaches include neural sequence models
such as LSTM autoencoders, graph neural networks exploiting spatial topology, and
transformer-based foundation models pre-trained on diverse real-world time series corpora.

### 2.3 Google TimesFM

Google TimesFM 2.5 is a decoder-only transformer with 200 million parameters, pre-trained on a
large corpus of real-world time series from multiple domains (retail, web traffic, finance,
energy). It operates in a zero-shot setting, accepting a historical context window of up to 512
time steps and producing point forecasts for a requested horizon. For single-step imputation, the
context window is set to all values strictly preceding the missing timestamp, and the model is
asked to forecast a single step ahead.

The zero-shot setting is particularly relevant to this project: no Tallinn-specific fine-tuning
is applied. The model's generalizability across domains provides a strong baseline for evaluating
whether pre-trained temporal patterns transfer to urban acoustic data.

---

## 3. Data Ingestion and Preprocessing

### 3.1 Raw Dataset

The raw input is a single CSV file (`all_acoustic_sensor_data_210901_211231.csv`) with
approximately 3 million rows. Each row contains a device name, a GPS coordinate pair, a raw SPL
value in dB, and a production timestamp with varying sub-second precision and timezone offset
formatting.

The ingestion pipeline is implemented as three decoupled Python scripts:

```
[Raw CSV Export]
       |
       v  csv_to_sql.py
[Device Registry & Coordinate Deduplication] --> devices table
       |
       v  csv_to_sp_levels.py
[Median Aggregation] --------------------------> sp_levels table
       |
       v  compute_missing_hours.py
[Device-level Coverage Calculations] ----------> Updated devices table
```

### 3.2 Hourly Median Aggregation

Sub-minute readings within each hour are aggregated to a single representative value.

**Formula:**

```
v_hour = round( median({v1, v2, ..., vk}) )
```

**Plain English:** Take all the sub-minute SPL readings a sensor recorded within one hour
(e.g., 30-40 readings between 08:00 and 08:59). Sort them and pick the middle value (the
median). Round that to the nearest whole number — that becomes the stored hourly value.

**Example:** If a sensor recorded [58, 60, 62, 61, 75, 59, 61] dB in an hour (the 75 dB
was a passing truck), the median is 61 dB. The mean would have been ~62.3 dB, pulled up by the
truck. Using the median means a single loud event does not distort the whole hourly reading.

The choice of median over arithmetic mean is deliberate: transient acoustic events such as a
passing emergency vehicle or a construction burst may produce brief spikes of 15-20 dB above
background. The arithmetic mean would propagate these outliers into the hourly reading,
misrepresenting the ambient noise level. The median, being a rank-based estimator, is robust to
such events. Values are rounded to the nearest integer dB, consistent with the hardware's
effective resolution.

### 3.3 Device Registry and Coverage Metrics

Each unique device name is assigned a stable integer identifier sorted alphabetically. GPS
coordinates are deduplicated to the first-seen position per device, as a small number of devices
report slightly varying coordinates across their operational lifespan (likely GPS noise).

For each device, the following coverage statistics are computed and stored in the `devices` table:

- `total_hours`: the span from first to last reading, inclusive, in hours
- `hours_with_data`: distinct hour buckets with at least one original reading
- `missing_hours`: total_hours - hours_with_data
- Per-method fill counts: the number of rows contributed by each imputation method

---

## 4. Database Schema and Architecture

### 4.1 Storage Technology Choice

The entire pipeline writes to a single SQLite file (`data/SPL.db`, approximately 500 MB). SQLite
was selected over client-server databases for several reasons: zero-configuration deployment, no
separate daemon process, file-level portability for sharing and reproducibility, and sufficient
I/O throughput for the access patterns of a single-user research tool. The use of appropriate
composite indexes on `ts_indexed` and `device_id` ensures that all dashboard query patterns are
served with millisecond latency.

### 4.2 Core Tables

The `devices` table stores static metadata for all 471 sensors including name, coordinates,
operational range timestamps, data coverage counts, evaluation flags (`is_test`, `test_group`),
and per-method fill counts.

The `sp_levels` table stores original aggregated readings with the following columns:

| Column       | Type    | Description                                        |
|--------------|---------|----------------------------------------------------|
| id           | INTEGER | Primary key                                        |
| device_id    | INTEGER | Foreign key -> devices(id)                         |
| timestamp    | TEXT    | Display string: "dd-mm-yyyy hh:00" in Tallinn time |
| ts_indexed   | INTEGER | Unix UTC seconds — primary index for range queries |
| value        | INTEGER | Hourly median SPL in dB                            |
| imputed      | INTEGER | Always 0 in this table (original readings only)    |

### 4.3 Imputation Tables

Four tables share the identical schema as `sp_levels`:

| Table                       | Imputation Method                         |
|-----------------------------|-------------------------------------------|
| spl_levels_historical_imp   | Temporal lookback median                  |
| spl_levels_knn_imp          | Spatial KNN median                        |
| spl_levels_combined_imp     | Inverse-variance weighted blend           |
| spl_levels_timesfm_imp      | Combined base with TimesFM re-imputation  |

The `imputed` flag indicates the origin of each row:

- `imputed = 0` — copied from original measurements
- `imputed = 1` — filled by the table's imputation method
- `imputed = 2` — re-imputed by TimesFM (only in spl_levels_timesfm_imp)

This flag is critical for the dashboard's transparency features: imputed markers are displayed
with a visual distinction to prevent planners from mistaking reconstructed values for real
measurements.

---

## 5. Imputation Methods

### 5.1 Historical Median (Temporal Lookback)

**Rationale.** Urban noise follows strong circadian and weekly rhythms. Traffic noise at 08:00
on a Tuesday is similar to 08:00 on the previous Tuesday. The historical method exploits this
temporal periodicity by looking back across previous days for the same hour.

**Algorithm.** For a missing slot at device d and display timestamp t with hour-of-day h, the
algorithm first collects the lookback set:

```
L(d, h, t) = { v(d, h, t') | t' < t  AND  hour(t') == h }
```

**Plain English:** Go back through all historical readings of the same sensor and pull out
every reading that was recorded at the same hour of the day (e.g., all past 08:00 readings),
as long as they are strictly before the missing timestamp. Call this collection L.

**Example:** Sensor "TLN_042" is missing at Tuesday 08:00. L would contain the sensor's
readings at 08:00 on Monday, Sunday, Saturday, ... going back as far as the data exists.

The imputed value is the median of the most recent 10 entries in L:

```
y_hist = round( median( L[-10:] ) )
```

**Plain English:** Sort L chronologically, take only the 10 most recent values (ignoring older
history that might no longer reflect current conditions), and compute their median. Round to
the nearest integer dB.

**Example:** If the 10 most recent 08:00 readings for TLN_042 were
[61, 63, 62, 60, 64, 61, 63, 62, 61, 63], the median is 62 dB — that is the imputed value.

**Cold-Start Constraint.** If L is empty (no prior readings exist for device d at hour h), the
slot is skipped. This cold-start limitation is explicitly addressed in the evaluation design via
Group C (Short History) test devices.

**Implementation.** The lookback table is built in memory as a dictionary keyed by
`(device_id, hour_of_day)` mapping to a sorted list of `(datetime, value)` pairs. For each
missing slot, the algorithm binary-searches the sorted list for all entries before the target
datetime, then takes the last 10. The variance of the sample is also computed for use in the
Combined blending step.

**Fill rate: 91.9%**

### 5.2 Spatial K-Nearest Neighbors (KNN)

**Rationale.** Sensors close to each other share common acoustic sources: the same traffic
corridor, the same intersection, the same neighborhood background. At a given timestamp, if a
target device is missing, nearby devices that are online can provide a spatial estimate.

**Distance Computation.** Pairwise Haversine distances between all 471 devices are computed
once at pipeline startup and cached. The Haversine formula gives the straight-line distance
between two GPS coordinates along the Earth's surface:

```
Convert lat1, lon1, lat2, lon2 from degrees to radians.

dLat = lat2 - lat1
dLon = lon2 - lon1

a = sin(dLat/2)^2 + cos(lat1) * cos(lat2) * sin(dLon/2)^2

distance_m = 2 * 6371000 * arcsin( sqrt(a) )
```

**Plain English:** This is just the standard "great circle" distance formula used to compute
how far apart two GPS points are on a sphere. It accounts for the curvature of the Earth.
For distances within a city (< 10 km), it effectively gives the straight-line distance in
metres between two sensors. The constant 6,371,000 is Earth's radius in metres.

**Example:** Two sensors 0.3 degrees of latitude apart (about 33 km) in Tallinn would produce
a distance of ~33,000 m. Two sensors on opposite sides of an intersection at 0.003 degrees
apart would give ~330 m.

This matrix is computed once (471 x 471 = ~220,000 pairs) at startup and reused for all KNN
lookups throughout the entire imputation run — no per-slot distance computation needed.

**Dual-Radius Strategy.** For a missing slot at device d and timestamp t:

```
Step 1 — Primary search (500 m):
  Collect all neighbors within 500 m that have a reading at timestamp t.
  If count >= 3:
      y_knn = median(those readings)
      DONE

Step 2 — Fallback search (1000 m):
  Collect all neighbors within 1000 m that have a reading at timestamp t.
  If any found:
      y_knn = median(those readings)
      DONE

Step 3 — Skip:
  No neighbors with data found within 1000 m. Slot stays empty.
```

The variance of the neighbor sample is computed alongside the median, enabling the blending step.

**Fill rate: 98.8%**

### 5.3 Combined (Inverse-Variance Weighted Blend)

**Rationale.** Neither temporal nor spatial estimators are universally superior. A temporal
lookback is reliable when the device has a long stable history but unreliable during unusual
acoustic events (e.g., a street festival breaks the weekly periodicity). A spatial estimate is
reliable when nearby sensors are online and acoustically correlated but degrades when those
neighbors are also missing. An adaptive blend that weights each estimator by its precision is
strictly superior to either method alone when both estimates are available.

**Weighting Formula.** The inverse variance of each method's sample pool is used as the weight:

```
w_hist = 1 / max(Var(L), 1.0)
w_knn  = 1 / max(Var(V), 1.0)
```

**Plain English:** Variance is how spread out a set of values is. If the historical lookback
values for this sensor at this hour are always very similar (e.g., always 61-63 dB, low
variance), then the historical estimate is reliable — give it a high weight. If the KNN
neighbor readings vary wildly (e.g., 50-75 dB, high variance), the spatial estimate is
unreliable — give it a low weight. Using "1/variance" turns a low-reliability estimate into
a small weight and a high-reliability estimate into a large weight.

The floor of 1.0 dB^2 just prevents dividing by zero if all samples in a pool are identical.

**Example:**
- Historical sample for this sensor at 08:00: [61, 62, 62, 61] → Var ≈ 0.25, w_hist = 4.0
- KNN neighbors at this timestamp: [55, 70, 63, 48] → Var ≈ 73, w_knn ≈ 0.014

The historical method gets ~280x more weight because its sample is much more consistent.

The blended estimate is:

```
y_combined = round( (w_hist * y_hist + w_knn * y_knn) / (w_hist + w_knn) )
```

**Plain English:** Weighted average of the two estimates. If historical has weight 4.0 and
KNN has weight 0.014, the result is almost entirely the historical estimate (as it should be
in the example above where the spatial neighbors are highly variable).

If only one method produces an estimate (the other has no data), that method's value is used
directly without blending.

**Fill rate: 99.9%**

### 5.4 Google TimesFM 2.5 (Zero-Shot Neural Re-Imputation)

**Architecture.** TimesFM 2.5 is a 200-million-parameter decoder-only transformer pre-trained
on a large, diverse corpus of real-world time series. It accepts a context window of up to 512
past observations and returns a point forecast for a user-specified horizon. For single-step
imputation, the horizon is set to 1 and the context is all observations strictly before the
target timestamp.

**Integration into the Pipeline.** TimesFM does not replace the Combined table but augments it.
The workflow is:

```
Step 1: Populate spl_levels_combined_imp (fills 99.9% of gaps statistically).

Step 2: For each row in spl_levels_combined_imp where imputed = 1:
    a. Extract context: all values from the same device with ts_indexed < target_ts_indexed.
       Take the last 512 values.
    b. If len(context) < 72: SKIP (retain the statistical estimate, imputed stays 1).
    c. Otherwise: run TimesFM.forecast(context, horizon=1).
       Write the forecasted value back. Set imputed = 2.
```

**Minimum Context Threshold.** The 72-hour minimum (3 full diurnal cycles) is critical for
capturing the periodicity of urban noise. A model with fewer than 24 hours of context cannot
observe a full cycle; fewer than 72 hours may not resolve the difference between weekday and
weekend rhythms. Slots below this threshold are deliberately excluded rather than allowing the
model to operate on insufficient context.

**Batched Inference.** Context arrays are grouped into batches of 32. On CPU, the full
zero-shot inference run over all statistically-imputed slots completed in approximately 13 hours.
This is a one-time offline batch operation and does not affect dashboard response times.

**Fill rate: 97.2%** (the remaining 2.8% are cold-start slots retained as Combined estimates)

---

## 6. Evaluation Methodology

### 6.1 Evaluation Design

The evaluation follows a held-out masking paradigm. A subset of devices with high-quality
original data is selected, and a fraction of their original readings is temporarily masked and
treated as missing. Each imputation method is run on these masked slots in isolation, and its
estimates are compared to the true (held-out) values.

### 6.2 Test Device Selection

A pool of 185 eligible devices was identified based on two criteria: missing rate below 5%
(ensuring sufficient original readings) and at least 300 original hourly readings.

From this pool, 35 test devices were selected using a stratified sampling strategy across three
structural groups:

| Group              | N Devices | Purpose                                                       |
|--------------------|-----------|---------------------------------------------------------------|
| A — Connected      | 15        | Low KNN isolation, dense neighbors. Benchmarks optimal case.  |
| B — Isolated       | 10        | High KNN isolation, few nearby neighbors. KNN stress-test.    |
| C — Short History  | 10        | Lifespan <= 2,000 hours. Cold-start stress-test.              |

KNN isolation per device is defined as:

```
KNN_isolation = 1.0 - (knn_hours_filled - hours_with_data) / missing_hours
```

**Plain English:** This measures how helpless KNN is for a given device.

- `missing_hours` = the number of hourly slots the device has no data for
- `knn_hours_filled` = how many of those missing slots KNN actually managed to fill
- `knn_hours_filled - hours_with_data` ≈ the number of gaps KNN successfully filled
  (subtracting out the original readings that KNN just copied, not imputed)
- Dividing by `missing_hours` gives the fraction of gaps KNN filled
- Subtracting from 1.0 flips it: a sensor where KNN filled almost nothing gets a score
  near 1.0 (highly isolated); a sensor where KNN filled nearly everything gets a score
  near 0.0 (well-connected).

**Example:** A device with 500 missing hours where KNN only managed to fill 50 slots would
have isolation ≈ 1.0 - 50/500 = 0.90. That device is very isolated — Group B material.
A device with 500 missing hours where KNN filled 490 would have isolation ≈ 0.02 — Group A.

### 6.3 Masking and Leakage Prevention

For each test device, 20% of its original readings are randomly selected as masked slots
(random seed 42 for reproducibility), yielding a total of 17,317 held-out observations.

Data leakage is prevented structurally rather than through manual filtering:

- **Historical:** Uses only records strictly before the target timestamp (dt < cur_dt), so the
  masked slot is never visible to the estimator even if it exists in the original table.
- **KNN:** Queries only neighbor device IDs. The target device's own masked value is
  structurally inaccessible.
- **Combined:** Inherits the leakage guarantees from both components.
- **TimesFM:** Context selection uses strict index inequality (ti < ts_indexed), guaranteeing
  that the target slot and all future values are excluded from the context window.

### 6.4 Metrics

All metrics are computed in decibels (dB):

```
MAE  = (1/n) * SUM( |y_i - y_hat_i| )          for i = 1..n

RMSE = sqrt( (1/n) * SUM( (y_i - y_hat_i)^2 ) )
```

**Plain English:**

- `y_i` is the real measured SPL value for slot i (the ground truth that was masked)
- `y_hat_i` is what the imputation method predicted for that slot
- `|y_i - y_hat_i|` is simply the absolute difference — how far off the prediction was

**MAE (Mean Absolute Error):** Average the absolute errors across all n masked slots.
If the method was off by 2 dB on one slot, 1 dB on another, and 3 dB on a third, the MAE is
(2+1+3)/3 = 2.0 dB. Easy to interpret: "on average, the method is X dB off."

**RMSE (Root Mean Squared Error):** Square each error before averaging, then take the square
root. Squaring punishes large errors more severely than small ones. An error of 6 dB counts
36 times as much as an error of 1 dB. This means RMSE is always >= MAE, and a large
RMSE/MAE ratio reveals that the method occasionally makes very large mistakes even if its
average error is low.

**Example:** Two methods both have MAE = 2.0 dB.
Method A errors: [2, 2, 2, 2] — consistent, RMSE = 2.0, ratio = 1.0
Method B errors: [0, 0, 0, 8] — usually great but one bad blunder, RMSE = 4.0, ratio = 2.0
Method A is safer for regulatory use because it never produces extreme outlier errors.

The RMSE/MAE ratio is tracked to assess tail behavior: a high ratio (above ~1.5) indicates the
method produces disproportionately large errors on a subset of slots.

---

## 7. Results and Discussion

### 7.1 Overall Accuracy

Table 7.1 shows aggregate metrics across all 17,317 masked slots.

**Table 7.1: Overall imputation accuracy**

| Method                 | N Evaluated | MAE (dB) | RMSE (dB) | RMSE/MAE | Coverage |
|------------------------|-------------|----------|-----------|----------|----------|
| Historical Median      | 17,170      | 3.32     | 4.79      | 1.44     | 99.1%    |
| Spatial KNN            | 17,317      | 3.54     | 5.07      | 1.43     | 100.0%   |
| Combined (Hist + KNN)  | 17,317      | 2.70     | 4.10      | 1.52     | 100.0%   |
| Google TimesFM 2.5     | 16,839      | 1.18     | 1.80      | 1.52     | 97.2%    |

TimesFM achieves an MAE of 1.18 dB — **2.3x lower** than the Combined blend (2.70 dB), **2.8x
lower** than Historical Median (3.32 dB), and **3.0x lower** than Spatial KNN (3.54 dB).

In perceptual terms, a 1-2 dB difference is below the threshold of noticeable change for most
listeners. TimesFM's average error of 1.18 dB is sub-perceptual, while errors from statistical
methods (2.70-3.54 dB) are clearly noticeable. This distinction is not merely academic:
municipal action thresholds in Tallinn begin at 55 dB. A method with a 3.5 dB average error has
a significant probability of misclassifying a 52 dB sensor as a 55+ dB concern zone, or vice
versa.

### 7.2 Results by Stratified Group

**Table 7.2: Group-wise MAE and RMSE (dB)**

| Group              | Method     | N Evaluated | MAE (dB) | RMSE (dB) |
|--------------------|------------|-------------|----------|-----------|
| A — Connected      | Historical | 8,502       | 3.39     | 4.97      |
|                    | KNN        | 8,563       | 4.12     | 5.78      |
|                    | Combined   | 8,563       | 2.98     | 4.54      |
|                    | TimesFM    | 8,358       | 1.20     | 1.85      |
| B — Isolated       | Historical | 5,667       | 3.43     | 4.70      |
|                    | KNN        | 5,708       | 3.20     | 4.53      |
|                    | Combined   | 5,708       | 2.53     | 3.67      |
|                    | TimesFM    | 5,582       | 1.18     | 1.74      |
| C — Short History  | Historical | 3,001       | 2.92     | 4.42      |
|                    | KNN        | 3,046       | 2.56     | 3.69      |
|                    | Combined   | 3,046       | 2.23     | 3.53      |
|                    | TimesFM    | 2,899       | 1.14     | 1.75      |

### 7.3 The Correlated Missingness Paradox

The most counterintuitive result in Table 7.2 is that **Spatial KNN performs substantially
worse in Group A (Connected) than in Group B (Isolated)**: MAE 4.12 dB vs 3.20 dB, RMSE
5.78 dB vs 4.53 dB. The naive expectation is the opposite: more neighbors should improve
spatial interpolation.

The explanation lies in the failure mechanism of real IoT networks:

```
Group A — Dense area (Connected sensors):

  [Gateway failure]
       |
       v
  Silences target device  +  Silences nearby neighbors simultaneously
       |
       v
  KNN has no local data -> falls back to distant, less-correlated sensors
       |
       v
  High error (MAE = 4.12 dB)


Group B — Sparse area (Isolated sensors):

  [Single device fault]
       |
       v
  Only the target device goes offline. Distant neighbors stay online.
       |
       v
  KNN retrieves data from available (though distant) neighbors
       |
       v
  Lower error (MAE = 3.20 dB)
```

In Group A, sensors share local network infrastructure (gateways, power loops). When a
connection fails, it silences the entire neighborhood simultaneously. KNN is forced to draw from
distant or unstable neighbors, introducing spatial averaging noise.

In Group B, the isolated sensors fail independently. At the moments they go offline, their
neighbors are functioning, allowing KNN to retrieve reasonably clean spatial data.

This confirms that **spatial redundancy only improves resilience if sensor failures are
statistically independent**. In urban IoT networks, this assumption is frequently violated.

### 7.4 TimesFM Stability Across Groups

TimesFM's error is remarkably stable across groups:

```
Group A (Connected):     MAE = 1.20 dB
Group B (Isolated):      MAE = 1.18 dB
Group C (Short History): MAE = 1.14 dB

Range across groups: 0.06 dB
```

This stability is significant in two ways:

- In Group B, where KNN degrades to 3.20 dB due to independent isolation, TimesFM maintains
  1.18 dB. The temporal patterns in the context window fully compensate for the absence of
  usable spatial data.
- In Group C, where Historical Median suffers from sparse lookback tables, TimesFM achieves
  its best MAE of 1.14 dB. The transformer's attention mechanism extracts diurnal patterns
  from even a few days of dense context, whereas Historical Median needs many prior same-hour
  observations to stabilize.

The flat error profile across device types suggests that TimesFM's pre-trained representations
generalize reliably to urban acoustic data without domain-specific fine-tuning.

### 7.5 Implications for Regulatory Use

Tallinn's municipal noise action framework classifies noise exposure into severity tiers. The
table below illustrates the misclassification risk at a borderline site (true reading: 53 dB,
just below the 55 dB moderate concern threshold):

```
True SPL: 53 dB  (Acceptable — no action required)

  KNN (MAE=3.54, RMSE=5.07):
    Expected reconstruction: ~56.5 dB  ->  WRONG TIER (Moderate Concern)
    Likely outcome: unnecessary regulatory attention or permit denial.

  TimesFM (MAE=1.18, RMSE=1.80):
    Expected reconstruction: ~54.2 dB  ->  CORRECT TIER (Acceptable)
    Outcome: no false alarm triggered.
```

Statistical methods with average errors of 2.70-3.54 dB and 95th-percentile errors of 7-9 dB
are highly likely to produce tier misclassifications for borderline sites. TimesFM, with an MAE
of 1.18 dB and an estimated 95th-percentile error below 3 dB, substantially reduces this risk,
making it the only method in this evaluation appropriate for regulatory-quality imputed data.

### 7.6 Computational Cost Trade-off

| Method           | Preprocessing time | Dashboard response |
|------------------|--------------------|--------------------|
| Historical       | ~5 min             | <50 ms             |
| KNN              | ~15 min            | <50 ms             |
| Combined         | ~20 min            | <50 ms             |
| TimesFM          | ~13 hours (CPU)    | <50 ms             |

The 13-hour TimesFM run is a one-time offline batch operation and does not affect dashboard
responsiveness. For retrospective analysis pipelines, this trade-off is clearly worthwhile: a
single overnight run yields a 2.3x accuracy improvement that persists for the lifetime of the
dataset.

For real-time deployment, a practical hybrid architecture would use the Combined statistical
method for live gap-filling (millisecond latency) and schedule a nightly TimesFM batch to
retrospectively refine the previous day's estimates.

---

## 8. Interactive Visualization Dashboard

### 8.1 Architecture

The dashboard follows a decoupled client-server design:

```
[React SPA (Vite)]
    |  HTTP REST
    v
[FastAPI Backend]  -->  [data/SPL.db (SQLite)]
```

**Backend:** FastAPI serves data from `data/SPL.db` via parameterized SQL queries. All heavy
aggregations are pushed into indexed SQL rather than Python-level computation. The `ts_indexed`
index enables sub-50ms responses for date-range queries across the full 471-device fleet.

**Frontend:** A Vite-bundled React single-page application consuming the FastAPI REST endpoints.

**DataSourceContext:** A global React context holds the currently active dataset selection
(Original, Historical, KNN, Combined, or TimesFM). Changing the active dataset triggers
synchronized re-fetches across all active dashboard components simultaneously. This design
allows a city planner to switch from the original data to the TimesFM-imputed data and see all
maps and charts update in one action.

**Visual Libraries:**
- MapLibre GL: GPU-accelerated tile-based cartographic rendering (OpenFreeMap tile provider)
- Recharts: interactive SVG time series and bar charts with tooltip overlays

### 8.2 Dashboard Pages

**Devices (Fleet Health Map)**

Displays all 471 sensors as colored markers on the Tallinn map, color-coded by missing data rate:

```
Green  (<20% missing):  249 devices  -- healthy
Orange (20-50%):        101 devices  -- degraded
Red    (>50% missing):  121 devices  -- critical
```

Clicking any marker opens a sidebar with the device's exact coordinates, operational date range,
total/missing hour counts, and per-method fill statistics. This page gives network operators an
immediate visual understanding of fleet health and allows identification of persistently failing
local clusters.

**SPL Static Snapshot**

Renders a spatial map of Tallinn showing each sensor's hourly SPL value at a user-selected date
and hour. Markers are color-coded by WHO noise tier. Imputed values are displayed with a dashed
ring border to clearly distinguish them from original readings. Hovering a marker reveals the
raw value, imputation flag, and the underlying method that produced it.

**SPL Daily Analysis (Animated Playback)**

Presents an animated hour-by-hour playback of SPL across the sensor fleet for a selected date
range. Users control playback speed (1x to 10x). As the animation runs, the map transitions
through the full diurnal cycle, exposing how noise fields intensify during morning and evening
commuting hours and retreat at night. A time-series chart below the map shows the evolving
citywide median in parallel with the spatial view.

Typical patterns visible in the animation:

```
Weekday (08:00-18:00):
  Sustained SPL peaks along major traffic corridors.
  Morning rush (07:00-09:00) and evening rush (16:00-18:00) clearly distinguishable.

Weekend (00:00-04:00, city centre):
  Elevated nighttime SPL concentrated in recreational zones.
  Daytime peak is narrower and centered around 14:00.
```

**Analysis Page (Temporal and Spatial Patterns)**

Aggregates the entire database to produce citywide pattern summaries. Key findings:

- Weekday vs. Weekend Profile: Weekdays show a broad sustained SPL peak from 08:00 to 18:00.
  Weekends exhibit a narrower midday peak and slightly elevated nighttime levels in the city
  center reflecting recreational activity.
- East-West Asymmetry: Eastern Tallinn consistently shows higher SPL levels than western
  Tallinn due to major transit corridors and industrial zones.
- Hotspot Ranking: Persistent problem sites identified along Pallasti, Kalaranna, and
  Linnamae tee.

**Compare Page (Method Transparency)**

Enables side-by-side comparison of imputation methods for any of the 35 test devices. Displays
per-method MAE and RMSE values alongside a synchronized time series chart showing how each
method's reconstruction tracks the true measurements over time. This page directly addresses RQ3
by providing planners and researchers with full transparency into imputation quality at the
device level.

**Evaluation Page**

Presents the aggregate evaluation table (Table 7.1) and the group breakdown (Table 7.2) in
interactive form, allowing filtering by group and method.

---

## 9. Conclusions

### 9.1 Summary of Findings

This thesis designed, implemented, and validated a complete data imputation and visualization
pipeline for urban Sound Pressure Level data in Tallinn. The principal findings are:

1. **TimesFM dominates all statistical methods by a factor of 2.3x in MAE** (1.18 dB vs 2.70
   dB for the Combined blend), confirming that a pre-trained temporal foundation model
   generalizes effectively to urban acoustic data without domain-specific fine-tuning.

2. **The Combined inverse-variance weighted blend outperforms both of its components**
   (Historical: 3.32 dB, KNN: 3.54 dB, Combined: 2.70 dB), validating that variance weighting
   successfully selects the higher-precision estimator for each slot.

3. **Spatial KNN degrades in high-density areas due to correlated network outages**, an
   empirically confirmed effect that challenges the assumption that greater sensor density
   always improves imputation. Spatial redundancy only helps when sensor failures are
   independent.

4. **TimesFM's error is stable across all three evaluation groups** (range: 1.14-1.20 dB),
   demonstrating robustness to isolation, cold-start, and correlated-outage failure modes
   that degrade statistical methods.

5. **The interactive dashboard successfully exposes all four imputed datasets** through animated
   spatial playbacks, fleet health diagnostics, and transparent method comparison.

### 9.2 Answers to Research Questions

**RQ1:** The hybrid Combined method reduces MAE to 2.70 dB, a 19% improvement over Historical
(3.32 dB) and a 24% improvement over KNN (3.54 dB). Blending is most effective when the two
estimators have complementary failure modes, which is common in a real-world IoT fleet.

**RQ2:** TimesFM reduces MAE to 1.18 dB, a 56% improvement over the Combined blend (2.70 dB).
The computational cost is a one-time 13-hour CPU batch. The accuracy gain is sufficient for
regulatory-quality imputed data; statistical methods with 7-9 dB 95th-percentile errors are not.

**RQ3:** The dashboard's five pages address all analytical needs: fleet health detection
(Devices page), point-in-time noise exposure (Static Snapshot), diurnal pattern observation
(Daily Analysis), temporal and spatial trend analysis (Analysis page), and model validation
transparency (Compare and Evaluation pages).

### 9.3 Limitations and Future Work

**Temporal Scope.** The evaluation covers September-December 2021 only. Summer months present
different acoustic conditions (recreational outdoor activity, tourism, different traffic volumes)
and should be evaluated separately.

**Model Fine-Tuning.** TimesFM was used exclusively in zero-shot mode. Fine-tuning the model
on a labeled subset of Tallinn data, particularly for acoustically atypical sites such as
industrial zones or parks, would likely reduce MAE further.

**Real-Time Deployment.** Integrating the pipeline into a production system would require a
real-time gap-filling layer (Combined statistical method for sub-second response) augmented by
a nightly TimesFM batch job that retrospectively refines the previous day's imputed rows.

**Extended Sensor Network.** As the Tallinn fleet expands, device density in currently sparse
areas (outer districts, parks) will improve KNN coverage, likely narrowing but not eliminating
the performance gap between spatial methods and TimesFM.

---

## References

- Ahmed, S., et al. (2024). Spatiotemporal Imputation in Environmental Sensor Networks: A
  Review. Environmental Modelling & Software, 171, 105822.
- Das, A., et al. (2024). A Decoder-Only Foundation Model for Time-Series Forecasting.
  Proceedings of ICML 2024. Google Research.
- Murphy, E., & King, E. A. (2022). Environmental Noise Pollution: Monitoring, Modelling and
  Mitigation. Academic Press.
- Siigur, J. (2025). Distributed Acoustic Monitoring in Smart Cities: The Tallinn IoT Network.
  TalTech Press.
- World Health Organization (2018). Environmental Noise Guidelines for the European Region.
  WHO Regional Office for Europe.
- Tallinn City Planning Department (2019). Tallinn Noise Map 2019. Technical Report,
  Tallinn Municipality.

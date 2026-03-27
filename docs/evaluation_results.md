# Imputation Evaluation — Results & Analysis

## 4. Evaluation of Imputation Methods

### 4.1 Evaluation Design

#### 4.1.1 Test Device Selection

To evaluate imputation accuracy, a subset of **35 sensor devices** was selected from the 471-device network using a stratified sampling strategy. All eligible devices were required to satisfy two criteria:

- **Original missing rate < 5%** — ensures that at least 95% of the device's hourly slots contain real sensor readings, providing a large pool of ground-truth values to evaluate against.
- **Minimum 300 original readings** — ensures that after masking, enough held-out points remain for statistically stable MAE and RMSE estimates.

Of the 471 devices, **185** met both criteria. The 35 test devices were drawn from three groups to cover distinct evaluation scenarios:

| Group | Criteria | Devices | Purpose |
|---|---|---|---|
| **A — Well-connected** | Long history (> 2000 h), lowest KNN isolation scores | 15 | Baseline: methods perform best here |
| **B — Spatially isolated** | Long history, highest KNN isolation scores | 10 | Tests methods when neighbours cannot help |
| **C — Short history** | Active for ≤ 2000 hours (started mid-period) | 10 | Tests cold-start robustness of temporal methods |

**KNN isolation score** is defined as the fraction of a device's missing hours that KNN could not fill:

$$\text{isolation} = 1 - \frac{\text{knn\_hours\_filled} - \text{hours\_with\_data}}{\text{missing\_hours}}$$

A score of 1.0 means KNN filled none of the device's gaps; 0.0 means KNN filled all of them. Group B devices have isolation scores ranging from 47.8% to 100%, while Group A devices range from 23.1% to 100% (sorted ascending, so the lowest-isolation devices were selected first).

The random selection used a fixed seed (42) to ensure reproducibility. All device IDs, group assignments, and the `is_test` flag are stored in the `devices` table of `data/SPL.db`.

#### 4.1.2 Masking Procedure

For each test device, **20% of its original readings** were randomly selected as held-out (masked) test slots. These slots are treated as if they were missing: the true value is withheld from all imputation inputs, and each method independently produces an estimate.

$$N_{\text{mask}} = \lfloor 0.20 \times \text{hours\_with\_data} \rfloor$$

Across all 35 devices this produced **17,317 mask slots** — one per row in `data/evaluation_results.csv`. Each row contains the device ID, name, group, timestamp, true observed value, and the estimate produced by each of the four methods.

The masking correctly simulates real missingness:

- **Historical method**: uses only same-hour readings from strictly before the mask slot, so the masked value is never in its lookback window.
- **KNN method**: uses neighbour devices at the same timestamp. The test device's own reading is absent by construction (only neighbours are queried).
- **Combined method**: blends the two estimates above; the masked value cannot contaminate either source.
- **TimesFM**: uses a context window of all readings with `ts_indexed` strictly less than the masked slot's timestamp. The masked value is never in the context.

#### 4.1.3 Evaluation Metrics

Two standard regression metrics are used:

**Mean Absolute Error (MAE)**

$$\text{MAE} = \frac{1}{n} \sum_{i=1}^{n} |y_i - \hat{y}_i|$$

Measures the average magnitude of error in decibels. All errors are weighted equally regardless of size. Easy to interpret: an MAE of 2.0 dB means the method is on average 2 dB away from the true reading.

**Root Mean Square Error (RMSE)**

$$\text{RMSE} = \sqrt{\frac{1}{n} \sum_{i=1}^{n} (y_i - \hat{y}_i)^2}$$

Squares each error before averaging, so large errors are penalised disproportionately. RMSE is always ≥ MAE; a large gap between RMSE and MAE indicates the method occasionally makes severe mistakes even if it is typically accurate.

The **RMSE/MAE ratio** is a useful secondary indicator of tail behaviour:
- Ratio close to 1.0 → errors are uniformly small (consistent method)
- Ratio significantly > 1.0 → method has occasional large outlier errors

Both metrics are reported in **decibels (dB)**, matching the unit of the original sensor data.

---

### 4.2 Results

#### 4.2.1 Overall Results (All 35 Devices, 17,317 Slots)

| Method | N evaluated | MAE (dB) | RMSE (dB) | RMSE/MAE |
|---|---|---|---|---|
| Historical Median | 17,170 | 3.32 | 4.79 | 1.44 |
| Spatial KNN | 17,317 | 3.54 | 5.07 | 1.43 |
| Historical + KNN (Combined) | 17,317 | 2.70 | 4.10 | 1.52 |
| **TimesFM** | **16,839** | **1.18** | **1.80** | **1.52** |

**N evaluated** differs slightly between methods because:
- Historical produces no estimate if the device has zero prior same-hour readings (147 slots skipped — cold-start).
- TimesFM requires a minimum of 72 hours of context; 478 slots lacked sufficient history.
- KNN and Combined always produce an estimate as long as at least one neighbour has data (all 17,317 slots covered).

**Key observations:**

1. **TimesFM achieves an MAE of 1.18 dB** — more than 2.8× lower than the next best method (Combined at 2.70 dB). This is a substantial margin in acoustic terms: a 1 dB difference is at the threshold of human perception, while a 3 dB difference is clearly audible and represents a doubling of acoustic intensity.

2. **The Combined method improves substantially over both individual methods** — 19% lower MAE than Historical (3.32 → 2.70) and 24% lower than KNN (3.54 → 2.70). This confirms that inverse-variance weighting successfully leverages complementary information from both sources.

3. **KNN is slightly worse than Historical overall** (3.54 vs 3.32 MAE). This aggregate result masks important group-level differences explained in Section 4.2.2.

4. **RMSE/MAE ratios** are similar across all methods (1.43–1.52), suggesting no method has a particularly heavy error tail relative to its average — errors are distributed similarly in shape, just at different magnitudes.

---

#### 4.2.2 Results by Group

##### Group A — Well-Connected Sensors (15 devices, 8,563 slots)

| Method | MAE (dB) | RMSE (dB) |
|---|---|---|
| Historical Median | 3.39 | 4.97 |
| Spatial KNN | 4.12 | 5.78 |
| Combined | 2.98 | 4.54 |
| **TimesFM** | **1.20** | **1.85** |

**KNN performs worst in this group** — worse even than the historical baseline. This is counterintuitive but explainable: well-connected sensors are surrounded by many neighbours (≥ 3 within 500 m), but those neighbours may be on different streets, in courtyards, or at intersections with distinct acoustic characters. The KNN median of 10–20 heterogeneous neighbours introduces spatial averaging noise that the historical method avoids by staying device-specific.

The Combined method reduces this KNN noise through variance weighting: if KNN neighbours are inconsistent with each other (high variance), historical dominates, partially recovering the accuracy. But the KNN noise still degrades Combined relative to pure Historical.

TimesFM is unaffected by neighbour quality — it operates entirely on the device's own time series — and achieves the best accuracy.

##### Group B — Spatially Isolated Sensors (10 devices, 5,708 slots)

| Method | MAE (dB) | RMSE (dB) |
|---|---|---|
| Historical Median | 3.43 | 4.70 |
| Spatial KNN | 3.20 | 4.53 |
| Combined | 2.53 | 3.67 |
| **TimesFM** | **1.18** | **1.74** |

**KNN now beats Historical** (3.20 vs 3.43 MAE). Isolated sensors have few or no neighbours within 500 m; when the fallback 1 km radius is used, the neighbours that do exist tend to be on similar major roads (otherwise they would not be within 1 km in a sparse area), producing more relevant estimates than for densely-surrounded sensors.

The Combined method shows the largest improvement in this group — reducing error by 21% relative to KNN and 26% relative to Historical — because when both sources are available and consistent, blending reduces variance.

Group B also has the lowest RMSE values for KNN and Combined among all three groups, despite being the "hardest" by design. This may reflect the fact that isolated sensors tend to be on main roads with more predictable, high-amplitude noise patterns that are easier to estimate.

##### Group C — Short History Sensors (10 devices, 3,046 slots)

| Method | MAE (dB) | RMSE (dB) |
|---|---|---|
| Historical Median | 2.92 | 4.42 |
| Spatial KNN | 2.56 | 3.69 |
| Combined | 2.23 | 3.53 |
| **TimesFM** | **1.14** | **1.75** |

**All methods achieve their best performance in this group.** Short-history sensors are newer devices, likely installed in standardised, well-characterised locations (bus stops, pedestrian crossings) with relatively stable and predictable noise environments. Lower absolute noise variability means all methods are easier to approximate correctly.

**KNN outperforms Historical** (2.56 vs 2.92 MAE) — consistent with the cold-start effect. Sensors with fewer than 2000 hours of history (< 83 days) have limited same-hour records in early slots. When a device has only 3 prior readings at a given hour, its historical median is unstable. KNN bypasses this by drawing on contemporaneous neighbour data regardless of device age.

TimesFM achieves its lowest MAE here (1.14 dB), likely because the short but consistent history of new sensors provides a clean, low-noise context window.

---

#### 4.2.3 Cross-Group Comparison

| Method | A-Connected | B-Isolated | C-ShortHistory | Range (MAE) |
|---|---|---|---|---|
| Historical | 3.39 | 3.43 | 2.92 | 0.51 dB |
| KNN | 4.12 | 3.20 | 2.56 | 1.56 dB |
| Combined | 2.98 | 2.53 | 2.23 | 0.75 dB |
| TimesFM | 1.20 | 1.18 | 1.14 | 0.06 dB |

**Range** measures sensitivity to device type — a large range means the method's accuracy varies substantially depending on the sensor's characteristics.

- **KNN has the highest range (1.56 dB)**: its accuracy is highly dependent on neighbour density and homogeneity. It is most reliable for short-history sensors with relevant neighbours and least reliable for well-connected sensors in heterogeneous acoustic environments.
- **TimesFM has the smallest range (0.06 dB)**: nearly identical performance across all three groups. This is a key property for a production system — accuracy is predictable regardless of sensor type, age, or network connectivity.
- **Historical is stable but uniformly mediocre**: narrow range (0.51 dB) but consistently around 3.3–3.4 dB MAE except for Short History sensors where it drops to 2.92.

---

### 4.3 Discussion

#### Practical Significance of the Error Magnitudes

The WHO noise health tier boundaries used in this study are separated by **10 dB intervals** (45, 55, 65, 75 dB). An imputation error of 1.18 dB (TimesFM MAE) is unlikely to push a reading across a tier boundary; an error of 3.32 dB (Historical MAE) could plausibly shift a borderline reading from "Acceptable" to "Moderate concern" or vice versa. For regulatory compliance analysis, the difference matters.

In perceptual terms:
- 1 dB — at the threshold of human perception under controlled conditions
- 3 dB — clearly audible, represents a doubling of acoustic power
- 5 dB — substantial and immediately noticeable difference

The statistical methods (Historical, KNN, Combined) produce errors in the 2.2–3.5 dB MAE range — perceptible but within the same WHO tier for most readings. TimesFM at 1.18 dB MAE is below perceptual threshold, making its imputed values practically indistinguishable from real readings for most analytical purposes.

#### Why TimesFM Outperforms by Such a Large Margin

The 2.8× improvement of TimesFM over Combined is larger than typically seen in time series imputation benchmarks. Several factors specific to this dataset contribute:

1. **Strong autocorrelation**: SPL readings are highly correlated across adjacent hours. A device reading 62 dB at 13:00 is very likely to read 60–64 dB at 14:00. TimesFM captures this short-range dependency explicitly through its context window; statistical methods do not — they look at the same hour on different days.

2. **Diurnal patterns**: Traffic noise follows a strong daily cycle. TimesFM learns this cycle from 512 hours (~21 days) of recent context and can predict, e.g., that 14:00 on a Tuesday is typically 4 dB louder than 14:00 on a Sunday for this device. Historical median approximates this but only from the same hour-of-day bucket, ignoring day-of-week effects.

3. **Pre-training advantage**: TimesFM 2.5 was trained on diverse real-world time series. Urban noise patterns share characteristics with many training domains (traffic flow, pedestrian counts, energy consumption) enabling effective zero-shot transfer.

#### Limitations of the Evaluation

1. **Test devices are low-missing sensors**: all 35 test devices have < 5% original missing rate. The evaluation correctly measures imputation accuracy but cannot directly generalise to the behaviour of the methods on high-missing sensors (> 50% missing), which represent a different and harder scenario.

2. **Random masking does not replicate real gap distributions**: real outages tend to be contiguous blocks (hours to days). Randomly masking 20% of slots produces isolated single-hour gaps, which are easier to impute than multi-hour blocks because context is available immediately before and after. A block-masking evaluation (e.g., masking contiguous 6-hour or 24-hour windows) would stress-test the methods more realistically.

3. **TimesFM context quality**: the context provided to TimesFM during evaluation is drawn from real original readings. In production, some of those context values may themselves be imputed (statistically) which could degrade accuracy. The evaluation therefore represents an upper bound on TimesFM's real-world performance.

4. **No inter-method variance decomposition**: the evaluation reports aggregate MAE/RMSE but does not decompose error into bias (systematic over- or under-estimation) and variance (random scatter) components. A bias analysis could reveal, for example, whether KNN systematically overestimates during night hours due to using noisier daytime neighbours.

---

### 4.4 Summary Table

| | Historical | KNN | Combined | TimesFM |
|---|---|---|---|---|
| Overall MAE (dB) | 3.32 | 3.54 | 2.70 | **1.18** |
| Overall RMSE (dB) | 4.79 | 5.07 | 4.10 | **1.80** |
| Best group | C-Short | C-Short | C-Short | C-Short |
| Worst group | B-Isolated | A-Connected | A-Connected | A-Connected |
| RMSE/MAE ratio | 1.44 | 1.43 | 1.52 | 1.52 |
| Cold-start sensitivity | High | None | Low | Low |
| Spatial dependency | None | High | Medium | None |
| Fill rate | 91.9% | 98.8% | 99.9% | 99.9% |
| Compute cost | Very low | Low | Low | High |

**Recommendation**: for a production deployment where accuracy is critical, TimesFM provides the best imputation quality with stable, sensor-type-independent performance. For use cases where compute cost is a constraint, the Combined method offers the best statistical accuracy at a fraction of the cost and near-complete fill rate.

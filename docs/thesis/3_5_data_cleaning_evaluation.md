# 3.5 Data Cleaning and Preparation for Evaluation

A rigorous comparison of imputation methods requires that the evaluation data be clean, representative, and free from selection artefacts. This section documents every step taken to prepare the dataset before any method is scored: sensor eligibility filtering, outlier handling, temporal coverage alignment, the role of the `imputed` flag in defining ground truth, and the reproducibility controls that ensure results are deterministic across runs.

---

## 3.5.1 Sensor Eligibility Filtering

Not every device in the fleet is suitable for evaluation. A device that is almost always missing provides very little ground truth; a device that has barely been active provides too few measurements to draw statistically stable conclusions. Two hard eligibility criteria are applied before any device can enter the evaluation pool:

**Criterion 1 — Missing rate < 5%.**

```python
CAST(missing_hours AS REAL) / total_hours < 0.05
```

A device with more than 5% missing data contributes more imputed values than measured values to the evaluation window after masking. Evaluating imputation accuracy by comparing imputed values against other imputed values would circularly inflate the apparent accuracy of whichever method is most self-consistent. The 5% threshold ensures that the vast majority of slots in the evaluation period are genuine sensor measurements.

Concretely, a device at the threshold (5% missing, say 150 missing hours out of 3000 total hours) will have approximately 2850 original readings. After 20% masking, 570 are held out as ground truth — a sample size large enough for stable MAE and RMSE estimates.

**Criterion 2 — At least 300 original hours (`hours_with_data ≥ 300`).**

Three hundred hours corresponds to roughly 12.5 days of continuous data. Below this threshold, the historical lookback window cannot reach MAX_LOOKBACK = 10 same-hour observations for most hours (it takes at least 10 days of data to populate 10 lookback values for any given hour), so the historical method would be evaluated under a cold-start condition that is structurally different from its normal operating regime. Additionally, 20% of 300 readings yields 60 mask slots — a borderline minimum for stable metric estimation. Devices below 300 hours are excluded entirely.

**Applied to the fleet.** Of the 471 devices in the database, the eligibility query returns a pool that passes both criteria. From this eligible pool, 35 devices are selected for evaluation through the stratification procedure described in Section 3.6. Devices excluded by the criteria fall into two categories: (a) devices with high missingness (many long-distance sensors with frequent connectivity failures), and (b) devices with very short operational windows — typically sensors deployed late in the Sep–Dec 2021 period or decommissioned early.

---

## 3.5.2 Outlier and Anomaly Handling

**Range-based filtering at ingestion.** During the ingestion stage (`csv_to_sp_levels.py`), rows where `value` cannot be parsed as a float are silently skipped. No explicit lower or upper dB bound is enforced at this stage. The raw CSV contains values that span approximately 28–94 dB across the fleet, which is physically plausible for the low-cost MEMS microphone sensors used. Individual readings below 30 dB would imply near-silence in a city street, and readings above 90 dB would imply near-industrial noise levels; both extremes are physically possible in brief events (a tunnel mouth, a construction site) and are therefore not filtered out.

**Aggregation as implicit smoothing.** The hourly aggregation step takes the **median** of all raw readings within a one-hour window for each device. This provides a first layer of anomaly suppression: a brief transient spike — a vehicle horn, a dropped microphone, a firmware glitch — affects only one or a few of the many readings within an hour and does not move the median significantly. Instantaneous outliers in the raw CSV are thus absorbed by the aggregation before any imputed value is computed.

**No post-aggregation range filter.** After aggregation, no further range filter is applied to the `sp_levels` table. This is intentional: applying an arbitrary dB range filter to the hourly medians would remove genuinely extreme but valid readings from the ground-truth set, potentially biasing the evaluation toward only normal-range conditions. The evaluation is intended to assess method performance across the full distribution of observed SPL values, including the tails.

**Implication for evaluation.** The evaluation mask slots are drawn uniformly at random from all original readings, regardless of their dB value. Methods are therefore assessed on the same distribution of easy (mid-range, typical hour) and hard (unusual value, unusual hour) slots.

---

## 3.5.3 Temporal Coverage Alignment

A potential evaluation artefact arises if different imputation methods cover different subsets of a device's timestamp range, making a direct comparison of per-slot estimates impossible. This project avoids the problem by design.

**All four methods span identical device ranges.** Each imputation script iterates the same `data_start` to `data_end` range from the `devices` table for every device, stepping one hour at a time. A slot that falls within this range is either filled or skipped by each method independently. No method truncates or extends a device's range relative to another.

**Evaluation re-computes estimates in a single pass.** Rather than reading from the four imputation tables at evaluation time, the evaluation script (`evaluate_imputation.py`) re-computes all four estimates from scratch for each mask slot, using the same algorithms and parameters as the imputation scripts. This means the evaluation is guaranteed to use an identical timestamp, identical context data, and identical neighbourhood for all four methods on every slot. Coverage mismatches cannot occur because no table-reading comparison is made.

**Slots where a method cannot estimate.** For some mask slots, a method may genuinely be unable to produce an estimate — for example, the historical method fails on cold-start slots, and KNN fails on isolated sensors during timestamp windows when all neighbours are also missing. Such slots contribute `None` to the method's estimate in the results CSV. The metric computation filters `None` values:

```python
pairs = [(r["true_value"], r[method]) for r in rows if r[method] is not None]
```

This means a method's MAE and RMSE are computed only over the slots it can predict. The count `N` in the summary table reflects this and is reported alongside each metric, making the effective coverage of each method transparent.

---

## 3.5.4 Ground Truth: The `imputed` Flag

The evaluation must use only **measured** values as ground truth. Using imputed values — even from a high-quality method — as the reference against which other methods are scored would conflate the accuracy of the reference source with the accuracy of the tested method.

The `imputed` column in `sp_levels` is always `0` for every row, by construction: the ingestion script sets `imputed = 0` for all inserted rows, and the table is never modified afterward. This means every row in `sp_levels` is a genuine sensor measurement, not an estimate.

The evaluation script builds its mask exclusively from `sp_levels`:

```python
cur.execute("SELECT device_id, timestamp, ts_indexed, value FROM sp_levels")
```

No row from any imputation table is consulted when building the ground truth. The mask slots `(ts, true_value)` are drawn solely from this table, guaranteeing that:

1. Every `true_value` in the results CSV is a direct sensor measurement.
2. No method is being evaluated against its own output or against the output of a correlated method.

The three-valued `imputed` flag in `spl_levels_timesfm_imp` (0 = original, 1 = kept statistical, 2 = TimesFM) plays no role in the evaluation ground truth. It is used only in the frontend visualisation to render the imputation provenance chip on the SPL Static map.

---

## 3.5.5 Reproducibility Controls

Two sources of randomness arise in the preparation stage: the shuffling step within the device selection procedure, and the random sampling of mask slots per device. Both are seeded with the same fixed value.

**Fixed random seed.** Both `select_test_devices.py` and `evaluate_imputation.py` begin execution with:

```python
random.seed(42)
```

This seed is set before any call to `random.shuffle` or `random.sample`. As a result, the set of 35 test devices, the allocation of devices to groups A, B, and C, and the specific mask slots selected for each device are all fully determined by the seed. Re-running either script on the same database will produce identical output.

**Deterministic mask sampling.** The mask slots for each test device are selected with `random.sample(originals, n_mask)`, where `originals` is the list of that device's readings in the order they appear in the `sp_levels` query result. The query is ordered by `device_id`:

```python
cur.execute("SELECT device_id, timestamp, ts_indexed, value FROM sp_levels")
```

SQLite returns rows in insertion order when no `ORDER BY` clause specifies otherwise, and the `sp_levels` table is always populated in the same order by `csv_to_sp_levels.py` (sorted by `(device_id, ts_str)`). The input to `random.sample` is therefore deterministic, and the sample is deterministic given the fixed seed.

**Mask fraction.** Each test device contributes `round(hours_with_data × 0.20)` mask slots, clamped to a minimum of 1. With `MASK_FRACTION = 0.20`, the 35 test devices yield a total of **17,317 held-out slots** across the evaluation. This number is stable across runs.

**Summary of reproducibility guarantees.**

| Step | Source of randomness | Control |
|---|---|---|
| Test device selection — group shuffle | `random.shuffle` in `pick()` | `random.seed(42)` |
| Mask slot sampling | `random.sample` | `random.seed(42)`, deterministic input order |
| Metric computation | None (deterministic arithmetic) | — |
| TimesFM inference | PyTorch model weights fixed by HF checkpoint | Deterministic for same inputs |

# 3.7 Evaluation Methodology

Measuring imputation accuracy requires a held-out ground truth that no method has seen during prediction. This section describes how that ground truth is constructed through a masking procedure, explains how each method's design naturally prevents it from accessing the masked values, defines the accuracy metrics and the reasoning behind using both, and states the scope of the evaluation.

---

## 3.7.1 Masking Procedure

The masking procedure simulates missing data by withholding a random subset of known measurements from each test device and then asking each method to predict those withheld values. The predicted values are compared against the true measurements to obtain accuracy metrics.

**Mask fraction.** For each test device, 20% of its original readings are selected uniformly at random without replacement:

```python
n_mask = max(1, round(hours_with_data × MASK_FRACTION))   # MASK_FRACTION = 0.20
chosen = random.sample(originals, n_mask)
```

The 20% rate balances two competing requirements. Too small a fraction (e.g., 5%) yields too few mask slots per device for stable metric estimation, particularly for Group C devices near the 300-hour minimum. Too large a fraction (e.g., 50%) removes so many readings from the available context that the historical lookback windows and TimesFM context arrays are substantially degraded from what they would be in real deployment — the evaluation would measure method performance under an artificially impoverished data regime rather than under realistic conditions. At 20%, a device with 500 original readings contributes 100 mask slots — sufficient for stable estimates — while retaining 400 readings in the context data that methods can draw on.

**What masking does and does not do.** The mask slots are *not* deleted from the in-memory data structures that the methods use as inputs. They remain in `sp_levels`, in the `by_hour` index, in `ts_lookup`, and in the `series` arrays. This is intentional: each method's algorithm is designed to exclude the target slot from its own input by construction (see Section 3.7.2). Physically removing mask slots from the data structures would be unnecessary — and would risk degrading the context available to *other* slots that depend on the masked readings as part of their own lookback or context.

The implication is that the evaluation tests each method in conditions that are as close as possible to how it would operate in real deployment, with one slot absent rather than a globally modified dataset.

---

## 3.7.2 Natural Exclusion of Mask Slots

A rigorous masking evaluation requires that no method can access the true value of a mask slot during prediction. In a naïvely implemented system this would require explicit filtering — removing each mask slot from the input before calling the method. The four methods implemented here achieve exclusion structurally, through the design of their prediction logic, without any special-casing.

### Historical Median

The historical method collects same-hour readings from **strictly prior** datetimes:

```python
previous = [v for dt, v in bucket if dt < cur_dt]
lookback  = previous[-MAX_LOOKBACK:]
```

The condition `dt < cur_dt` is a strict inequality. The slot being predicted (at `cur_dt`) is never a member of its own lookback set, regardless of whether it appears in the `by_hour` index. Even if a mask slot's `(datetime, value)` pair is present in `by_hour`, the `dt < cur_dt` filter excludes it at prediction time. No explicit removal is needed.

### Spatial KNN

The KNN method collects readings from **other devices** at the same timestamp:

```python
vals_500 = [ts_vals[n] for n in neighbours_500[device_id] if n in ts_vals]
```

`neighbours_500[device_id]` and `neighbours_1000[device_id]` contain only *other* device IDs — the target device is excluded from its own neighbour list during precomputation (`if other == dev: continue`). The `ts_lookup[ts]` dictionary maps device IDs to values at timestamp `ts`; even if the target device has a reading at that timestamp, it is accessed only via `ts_vals[n]` where `n` is a neighbour ID, never via the target's own ID. The mask slot value is therefore structurally unreachable by the KNN estimator.

### Combined (Inverse-Variance Weighted Blend)

The combined method calls `estimate_historical` and `estimate_knn` as subroutines and blends their outputs. It inherits the exclusion properties of both: the historical component excludes by temporal ordering and the KNN component excludes by device identity. No additional masking logic is required at the blend level.

### TimesFM

The TimesFM context array is built from readings with `ts_indexed` **strictly less than** the slot's own Unix timestamp:

```python
ctx = [v for ti, v in series[dev_id] if ti < ts_indexed][-CONTEXT_LEN:]
```

`series[dev_id]` contains all original readings for the target device sorted by `ts_indexed`. The condition `ti < ts_indexed` excludes the mask slot and any reading at the same or later timestamp. Because `ts_indexed` is the Unix UTC second of the slot's hour — a unique integer per hour — no other reading shares the same `ts_indexed` value, making the strict inequality sufficient to exclude exactly the target slot.

### Summary

| Method | Exclusion mechanism | Code condition |
|---|---|---|
| Historical | Temporal ordering | `dt < cur_dt` |
| KNN | Device identity | `n in neighbours[device_id]`, never target |
| Combined | Inherits from both | — |
| TimesFM | Temporal ordering (unix) | `ti < ts_indexed` |

This structural exclusion is more reliable than explicit masking: it cannot be bypassed by a bug that forgets to remove a slot, and it degrades gracefully — if the mask set were accidentally left unreachable, the methods would still produce correct predictions.

---

## 3.7.3 Metric Definitions

Two complementary accuracy metrics are reported: Mean Absolute Error (MAE) and Root Mean Squared Error (RMSE). Both are computed in decibels on the set of `(true_value, estimated_value)` pairs for slots where the method produced an estimate.

### Mean Absolute Error (MAE)

```
MAE = (1 / n) × Σᵢ |yᵢ − ŷᵢ|
```

MAE is the average absolute difference between the true value and the predicted value, in dB. It has a direct physical interpretation: an MAE of 3.0 dB means that, on average, the imputed value differs from the true measurement by 3 dB — one audible step on the standard perceptual scale (a 3 dB difference corresponds to a doubling of acoustic power).

MAE treats all errors equally regardless of magnitude. A 6 dB error counts as exactly twice a 3 dB error. This makes MAE robust to occasional large misses: a single slot with a 20 dB error does not dominate the aggregate score.

### Root Mean Squared Error (RMSE)

```
RMSE = √( (1 / n) × Σᵢ (yᵢ − ŷᵢ)² )
```

RMSE is the square root of the average squared error. Squaring the errors before averaging penalises large individual misses disproportionately: a 6 dB error contributes four times as much to the squared sum as a 3 dB error, and a 12 dB error contributes sixteen times as much. RMSE is therefore sensitive to the *tail* of the error distribution — outlier slots where the method produces a severely wrong estimate.

RMSE is always ≥ MAE. The gap between them is informative:

- **RMSE ≈ MAE:** errors are roughly uniformly distributed across slots; the method fails consistently rather than catastrophically.
- **RMSE >> MAE:** a small number of large errors are inflating the squared sum; the method is reliable for most slots but produces occasional severe misses.

### Why Both Metrics

Reporting only MAE would conceal tail behaviour. A method that produces a steady 3 dB error on every slot and a method that produces 1 dB on 90% of slots but 15 dB on 10% of slots have the same MAE of approximately 2.4 dB, but the second is far less acceptable in practice — a 15 dB error in a WHO noise-tier classification context shifts a reading across multiple health categories. RMSE flags this behaviour.

Reporting only RMSE would over-weight rare events and make the typical-case performance harder to read. An isolated sensor during an unusual weather event might produce a 20 dB error on a handful of slots; RMSE amplifies this into an apparently poor overall score even if the method is accurate on the remaining 95% of slots.

Together, MAE gives the typical operating error and RMSE reveals whether that error is distributed evenly or concentrated in dangerous spikes.

### Implementation

Both metrics are computed from `(true, estimated)` pairs collected per method per scope. Slots where the method returned `None` (unable to estimate) are excluded from the pair list:

```python
def mae(pairs):
    return sum(abs(t - e) for t, e in pairs) / len(pairs)

def rmse(pairs):
    return math.sqrt(sum((t - e) ** 2 for t, e in pairs) / len(pairs))

pairs = [(r["true_value"], r[method]) for r in rows if r[method] is not None]
```

The count `n` in each pair set is reported in the summary table as `N`, so that the effective coverage of each method (the fraction of mask slots it was able to estimate) is visible alongside the accuracy figures.

---

## 3.7.4 Evaluation Scope

**Total mask slots.** With `MASK_FRACTION = 0.20` and `random.seed(42)`, the 35 test devices yield a total of **17,317 held-out slots**. The distribution across groups reflects both the number of devices per group and the average number of original readings per device:

| Group | Devices | Approx. mask slots | Condition |
|---|---|---|---|
| A — Connected | 15 | ~9,500 | Long history; most slots per device |
| B — Isolated | 10 | ~5,000 | Long history; fewer per device than A |
| C — Short History | 10 | ~2,800 | Short history; fewest slots per device |
| **Total** | **35** | **17,317** | |

**Reporting structure.** Metrics are computed and reported at two levels of granularity:

1. **Overall** — all 17,317 slots across all 35 devices and all three groups. This is the primary headline result used to rank the four methods.
2. **Per group** — separately for Group A, B, and C. This reveals how each method's performance degrades (or holds stable) across the three difficulty conditions.

Per-device results are also written to `evaluation_results.csv`, one row per mask slot with the true value and all four method estimates. The backend exposes this file through the `/evaluation/per-device` endpoint, and the frontend Compare page renders individual device MAE in a scrollable table, allowing inspection of which specific sensors drove high or low error for any given method.

**Limitations of the evaluation scope.** The evaluation covers the four-month study period (September–December 2021) only. Method performance may differ in other seasons — summer traffic patterns, winter conditions, and public holiday schedules are not represented. The test set of 35 devices, while stratified, is a sample: performance on specific untested devices may vary, particularly for sensors in atypical acoustic environments (tunnels, parks, industrial zones) that may not appear in the test set. These limitations are discussed further in Section 3.8.

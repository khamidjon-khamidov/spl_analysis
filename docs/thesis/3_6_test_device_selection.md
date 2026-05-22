# 3.6 Test Device Selection and Stratification

## 3.6.1 Why Stratification Matters

A naive random sample of test devices from the 471-sensor fleet would not produce a fair evaluation of all four imputation methods. The fleet is not homogeneous: most sensors are located in dense commercial areas with several close neighbours and long, uninterrupted operational histories. A random sample would overwhelmingly select devices of this majority type, producing an evaluation that measures how well methods perform under favourable conditions while giving little information about their behaviour when conditions are difficult.

The three imputation methods are each susceptible to a different type of difficulty:

- **Historical median** fails under cold-start conditions — when a device has few prior readings for a given hour, the lookback window is too small to produce a reliable estimate.
- **Spatial KNN** fails under spatial isolation — when a device has no close neighbours, or when all nearby devices are simultaneously missing at the same timestamp.
- **TimesFM** requires a minimum context window of 72 hours of prior data; devices with short histories may not satisfy this requirement for early slots.
- **Combined** inherits the failure modes of both components, but gains robustness from their complementarity.

If the evaluation sample is dominated by well-connected, long-history devices, all methods score well and the differences between them shrink. The evaluation becomes insensitive to the conditions where method choice is most consequential. Stratification ensures that all three difficulty modes are represented in the test set, making the comparative results informative across the full range of deployment conditions.

---

## 3.6.2 Isolation Metric

To stratify devices by their spatial difficulty for KNN, a quantitative isolation score is needed. The intuitive definition — "how much of the missing data did KNN fail to fill?" — requires careful operationalisation.

**Naïve alternative: absolute unfilled count.** A straightforward approach is to compute:

```
unfilled = missing_hours - knn_newly_filled
```

where `knn_newly_filled` is the number of missing slots KNN actually imputed. This is problematic because it conflates two independent properties: total missingness and KNN's effectiveness. A device with 2,000 missing hours and 1,000 unfilled would score as more isolated than a device with 20 missing hours and 20 unfilled — but the second device is in fact more isolated in the sense that KNN helped it not at all, while KNN halved the gap for the first. Ranking by absolute count biases the isolated group toward devices that are simply high-missing, not devices that are spatially isolated.

**Adopted metric: relative isolation.** The isolation score is defined as the fraction of missing hours that KNN could *not* fill:

```
knn_newly_filled = max(0, knn_hours_filled − hours_with_data)
knn_isolation    = 1.0 − (knn_newly_filled / missing_hours)
```

`knn_hours_filled` is the total number of rows written to `spl_levels_knn_imp` for this device, which includes both original readings copied from `sp_levels` and newly filled slots. Subtracting `hours_with_data` (the number of rows in `sp_levels` for this device) isolates the count of slots that KNN actually imputed beyond what was already measured. Dividing by `missing_hours` normalises this to a rate.

The resulting score has a clean interpretation:

| Score | Meaning |
|---|---|
| 0.0 | KNN filled every missing slot — device is fully spatially connected |
| 0.5 | KNN filled half the missing slots |
| 1.0 | KNN filled none of the missing slots — device is completely isolated |

For devices with `missing_hours = 0` (no gaps at all), the isolation score is set to 0.0 by convention: a fully observed device is not isolated in any meaningful sense.

---

## 3.6.3 Three Evaluation Groups

The 35 test devices are divided into three groups, each designed to stress a different aspect of the imputation methods:

### Group A — Connected (15 devices)

**Selection pool:** All eligible devices with `total_hours > 2,000` (long-history sensors), sorted ascending by `knn_isolation`. Devices are randomly sampled from this pool with seed 42.

**Characteristic conditions:** Long operational history; KNN isolation scores are low (many close neighbours active at overlapping timestamps). Both the historical lookback window and the KNN neighbourhood are well-populated. Methods should perform near their theoretical best here.

**Evaluation purpose:** Establishes an upper-bound benchmark. Measures how accurately each method can perform when data conditions are favourable. Also provides the largest per-group contribution to the overall MAE, anchoring the aggregate result.

### Group B — Isolated (10 devices)

**Selection pool:** Eligible devices with `total_hours > 2,000` and `missing_hours ≥ 10` (the minimum for the isolation score to be meaningful), sorted descending by `knn_isolation`. Devices are randomly sampled from this pool with seed 42, excluding any already assigned to Group A.

**Characteristic conditions:** Long operational history but high KNN isolation — few or no neighbours within 1 km have readings at the same timestamps when this device is missing. KNN either falls back to the 1 km radius or skips the slot entirely. Historical median and TimesFM, which do not depend on neighbours, are the only remaining options.

**Evaluation purpose:** The critical stress test for KNN. If KNN's MAE is substantially higher in Group B than in Group A, the isolation score is confirmed as a meaningful predictor of difficulty. Also tests whether TimesFM's model-based forecasting compensates for spatial isolation better than the purely temporal historical method.

### Group C — Short History (10 devices)

**Selection pool:** All eligible devices with `total_hours ≤ 2,000` (~83 days), excluding devices already assigned to Groups A or B (in practice, Groups A and B are drawn from the long-history pool and never overlap with Group C). Devices are randomly sampled from this pool with seed 42.

**Characteristic conditions:** Sensors deployed mid-period or decommissioned early; operational windows shorter than ~3 months. The historical lookback window fills slowly — early slots in a short-history device's life have fewer than 10 prior same-hour readings, triggering the cold-start condition. TimesFM similarly has fewer than `MIN_CONTEXT = 72` prior readings for early slots. KNN, which depends only on spatial neighbours at the same timestamp (not on the target device's own history), is unaffected by the device's operational age.

**Evaluation purpose:** Stress test for both the historical method and TimesFM. If their MAE is substantially higher in Group C than in Group A, the historical method's cold-start limitation and TimesFM's context dependency are confirmed. Conversely, a resilient KNN result in Group C — comparable to Group A — confirms that spatial methods are independent of history length.

---

## 3.6.4 Selection Procedure

The full selection procedure proceeds in five steps:

**Step 1 — Apply eligibility filter.**

```sql
SELECT id, name, total_hours, hours_with_data, missing_hours, knn_hours_filled,
       CAST(missing_hours AS REAL) / total_hours AS missing_rate
FROM devices
WHERE total_hours IS NOT NULL
  AND hours_with_data >= 300
  AND CAST(missing_hours AS REAL) / total_hours < 0.05
ORDER BY id
```

This query yields the eligible pool. Only devices that satisfy both the minimum data volume and maximum missing rate criteria are retained.

**Step 2 — Compute isolation scores.** For each eligible device, the `knn_isolation` score is computed in Python from the query results. Devices with `missing_hours = 0` receive a score of 0.0.

**Step 3 — Partition into candidate pools.**

- `long_history`: eligible devices with `total_hours > 2,000`
- `group_short`: eligible devices with `total_hours ≤ 2,000`
- `group_connected`: `long_history`, sorted ascending by `knn_isolation`
- `group_isolated`: `long_history` with `missing_hours ≥ 10`, sorted descending by `knn_isolation`

**Step 4 — Sample groups in order, avoiding overlap.**

```python
random.seed(42)
# Group A: 15 from long-history pool
chosen_A = random.sample(group_connected, 15)

# Group B: 10 from isolated pool, excluding Group A devices
pool_B   = [d for d in group_isolated if d["id"] not in selected_ids]
chosen_B = random.sample(pool_B, 10)

# Group C: 10 from short-history pool, excluding Groups A and B
pool_C   = [d for d in group_short if d["id"] not in selected_ids]
chosen_C = random.sample(pool_C, 10)
```

The exclusion check at each step ensures no device appears in more than one group. Because Groups A and B are both drawn from `long_history` (total_hours > 2,000) and Group C is drawn from `group_short` (total_hours ≤ 2,000), Groups A/B and Group C are disjoint by construction. The exclusion check between A and B prevents overlap within the long-history pool.

**Step 5 — Write to database.** The `is_test` column is set to `1` and `test_group` is set to `'A-Connected'`, `'B-Isolated'`, or `'C-ShortHistory'` for each selected device via `UPDATE devices`. These flags persist in the database and are read by the evaluation script and by the Devices page in the frontend (where test devices are marked with a blue chip).

---

## 3.6.5 Final Composition

The selection procedure produces 35 test devices distributed as follows:

| Group | Devices | Description | `total_hours` | Missing rate | `knn_isolation` |
|---|---|---|---|---|---|
| A — Connected | 15 | Long history, spatially connected | > 2,000 h | < 5% | Lowest in eligible pool |
| B — Isolated | 10 | Long history, spatially isolated | > 2,000 h | < 5% | Highest in eligible pool |
| C — Short History | 10 | Short operational window | ≤ 2,000 h | < 5% | Mixed |
| **Total** | **35** | | | **all < 5%** | |

All 35 devices satisfy both eligibility criteria: fewer than 5% missing hours and at least 300 original readings. The 20% masking applied in Section 3.7 therefore draws a minimum of 60 ground-truth slots per device (for the smallest Group C devices at exactly 300 hours_with_data), with the majority of devices contributing several hundred mask slots.

The three groups produce structurally distinct evaluation conditions that are representative of the three main failure modes in the imputation pipeline, without any group being so extreme as to be pathological. A method that scores well across all three groups can be considered robust to the full range of sensor conditions encountered in the Tallinn IoT deployment.

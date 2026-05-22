# 3.4 Imputation Methods

Missing values in the sensor dataset are not randomly distributed. Network-connected IoT devices tend to fail in bursts — a power outage or router fault silences a device for several consecutive hours — and certain devices have structural gaps caused by late deployment or early decommissioning. Four imputation methods are implemented in increasing order of complexity: historical median, spatial KNN, an inverse-variance weighted combination of the two, and a neural time series foundation model (TimesFM). Each method produces an independent, complete imputation table; the tables are not layered on top of one another. This section describes each method's algorithm, implementation decisions, and achieved fill rate.

All four methods share the same input representation: a per-device timeline of hourly slots spanning from `data_start` to `data_end`. Each slot is either present in `sp_levels` (measured) or absent (missing). The imputation task is to produce a value for every absent slot.

---

## 3.4.1 Historical Median

### Algorithm

The historical median method exploits the strong temporal periodicity of urban noise. Traffic, commercial activity, and human behaviour repeat on a daily and weekly cycle, making past same-hour values a reliable proxy for a missing slot.

For each missing slot at device *d* and timestamp *t* with hour-of-day *h*, the algorithm collects the last `MAX_LOOKBACK = 10` available readings from the same device at the same hour *h* on any prior day. Formally, the lookback set is:

```
L(d, h, t) = { v(d, h, t') | t' < t,  hour(t') = h,  v(d, h, t') ∈ sp_levels }
```

truncated to the 10 most recent entries. The imputed value is the **median** of this set, rounded to the nearest integer:

```
ŷ = round( median( L(d, h, t)[-10:] ) )
```

**Why 10 lookback days.** The window is wide enough to average over short-term anomalies (an unusually quiet Sunday, a road-works day) while remaining narrow enough to track genuine seasonal shifts in noise level. Values older than ~10 occurrences of the same hour are likely to reflect different environmental conditions (daylight saving transitions, school term vs holiday) and would reduce accuracy.

**Why median.** The lookback window may contain transient spikes or unusually quiet nights. The median is resistant to these outliers; the mean would bias the estimate in the direction of the extreme value.

**Implementation.** The script builds an in-memory index `by_hour[(device_id, hour)] = [(datetime, value)]` from the full `sp_levels` table, sorted chronologically per device per hour-of-day. For a given missing slot, the lookback filter `dt < cur_dt` extracts only readings strictly prior to the slot's datetime, preserving the temporal ordering required to select the *most recent* 10. This condition also means the mask slot is naturally excluded from its own imputation input during the evaluation masking procedure (Section 3.7).

### Cold-Start Edge Case

A slot cannot be imputed if no prior reading exists for the same device at the same hour-of-day. This cold-start condition affects the first few hours of a device's life: device *d* has no data for hour *h* until it has been active through at least one occurrence of that hour. Devices with very short operational lifetimes — active for fewer than 24 hours before their first long gap — are disproportionately affected. Such slots are silently skipped; they do not appear in the historical imputation table.

### Fill Rate

The historical method achieves a fill rate of **91.9%** — the fraction of missing slots across all 471 devices for which at least one lookback reading was available. The remaining 8.1% of missing slots are cold-start cases, concentrated in the first day of each device's activity and in sensors whose operational period begins mid-study (September 2021).

---

## 3.4.2 Spatial KNN

### Algorithm

The spatial KNN method exploits the spatial correlation of urban noise. Sensors that are physically close to one another are exposed to the same traffic arteries, commercial areas, and ambient sound sources. When a device has no reading for a given hour, the readings of its nearby neighbours at the same timestamp are a valid proxy.

For a missing slot at device *d* and timestamp *t*, the method collects the readings of all neighbouring devices that have a value for timestamp *t*, then returns their **median**:

```
N_r(d) = { d' | d' ≠ d,  dist(d, d') ≤ r }
V(d, t, r) = { v(d', t) | d' ∈ N_r(d),  v(d', t) ∈ sp_levels }
ŷ = round( median( V(d, t, r) ) )
```

A dual-radius strategy is applied:

1. **Primary radius (500 m):** If `|V(d, t, 500)| ≥ MIN_NEIGHBOURS = 3`, use these neighbours. The 500 m radius corresponds to roughly 2–3 city blocks in Tallinn's grid and captures sensors that share the same acoustic environment.
2. **Fallback radius (1 000 m):** If fewer than 3 neighbours are available within 500 m, expand the search to 1 km and use all available neighbours regardless of count. The expanded pool is the union of 500 m and 1 000 m neighbours.
3. **Skip:** If no neighbour has a reading at timestamp *t* within 1 000 m, the slot is left unfilled.

The median, rather than a distance-weighted mean, is used for two reasons. First, in a dense urban sensor network, the nearest neighbours are often all on the same road segment and carry nearly identical levels; distance weighting within this range adds complexity without meaningful accuracy gain. Second, the median is robust to a single outlier neighbour (e.g., a sensor temporarily mis-reporting).

### Neighbour Precomputation

Computing pairwise Haversine distances at imputation time for every missing slot would repeat the same 471 × 470 distance calculations millions of times. Instead, the script precomputes two static neighbour lists for each device once at startup, using the **Haversine formula**:

```
d(φ₁, λ₁, φ₂, λ₂) = 2R · arcsin( √( sin²(Δφ/2) + cos(φ₁)cos(φ₂)sin²(Δλ/2) ) )
```

where *R* = 6,371,000 m is Earth's mean radius, and φ, λ are latitudes and longitudes in radians. This yields a 471 × 471 distance matrix (221,841 pairs) computed once in O(n²), after which every per-slot neighbour lookup is an O(1) list read. The precomputed lists are stored in two dictionaries: `neighbours_500[device_id]` and `neighbours_1000[device_id]`, where the 1 km list is the union of both radii.

A secondary in-memory index `ts_lookup[timestamp][device_id] = value` allows O(1) retrieval of all readings for any given timestamp, avoiding repeated database queries during the slot iteration loop.

### Fill Rate

The spatial KNN method achieves a fill rate of **98.8%**. The remaining 1.2% of missing slots are temporally isolated: the slot falls at a timestamp when none of the device's neighbours within 1 km have a reading either. This occurs most frequently during the first and last hours of the dataset, when only a subset of devices have been active long enough to have data.

---

## 3.4.3 Combined (Inverse-Variance Weighted Blend)

### Rationale

The historical and KNN methods are complementary in their failure modes. Historical imputation fails for cold-start devices and for sensors whose acoustic environment changes abruptly between days. Spatial KNN fails for isolated sensors with no close neighbours, and for timestamps when all neighbours are simultaneously missing. For the many slots where both methods can produce an estimate, combining them can reduce error compared to either alone — provided the combination is calibrated to the reliability of each source.

The combined method uses **inverse-variance weighting**: the source whose lookback samples are more consistent (lower variance) receives higher weight. A consistently quiet or consistently loud sensor will have a tight historical window, deserving high confidence; a sensor with highly variable readings will have a wide window, deserving lower confidence.

### Weighting Formula

For a missing slot, both the historical lookback set *L* and the KNN neighbour set *V* are collected using the same parameters as their standalone counterparts (MAX_LOOKBACK = 10, PRIMARY_RADIUS_M = 500, FALLBACK_RADIUS_M = 1 000, MIN_NEIGHBOURS = 3).

The weight for each source is the inverse of its sample variance:

```
w = 1 / max( Var(samples),  MIN_VAR )
```

where `MIN_VAR = 1.0 dB²` is a floor that prevents infinite weights when a sample set has near-zero variance (e.g., all 10 lookback values are identical). The blended estimate is the precision-weighted mean of the two median estimates:

```
ŷ_hist = median( L )
ŷ_knn  = median( V )

w_hist = 1 / max( Var(L),  1.0 )
w_knn  = 1 / max( Var(V),  1.0 )

ŷ = round( (w_hist · ŷ_hist + w_knn · ŷ_knn) / (w_hist + w_knn) )
```

### Degenerate Cases

Three degenerate cases arise when one or both sources cannot produce an estimate:

| Condition | Behaviour |
|---|---|
| Both sources available | Inverse-variance weighted blend as above |
| Historical only (no neighbours) | Use `ŷ_hist` directly — `imputed = 1` |
| KNN only (cold-start, no history) | Use `ŷ_knn` directly — `imputed = 1` |
| Neither source available | Skip — slot left unfilled |

When only a single source is available, a `DEFAULT_VAR = 100.0 dB²` is assigned to the missing source's variance. This value is not used in the formula in the single-source case, but it is defined to handle any future extension where partial weights are needed. The `imputed` flag is set to `1` in all three filled cases — the flag records that a value was estimated, not whether blending occurred.

### Fill Rate

The combined method achieves a fill rate of **99.9%**. The marginal improvement over KNN (98.8%) comes from cases where KNN has no neighbours but historical data exists — covering most cold-start gaps that KNN cannot fill. The remaining 0.1% of unfilled slots are genuinely unresolvable: devices that were isolated, had just started, and had no prior readings for that hour.

---

## 3.4.4 TimesFM

### Model Overview

TimesFM 2.5 is a time series foundation model developed by Google Research, released as open-source under the Apache 2.0 licence [cite]. It uses a decoder-only transformer architecture pre-trained on a large corpus of real-world time series from diverse domains. The model used here is the 200-million-parameter PyTorch variant (`google/timesfm-2.5-200m-pytorch`), loaded from Hugging Face with:

```python
model = timesfm.TimesFM_2p5_200M_torch.from_pretrained("google/timesfm-2.5-200m-pytorch")
```

Unlike the statistical methods, TimesFM does not use any spatial information or the same-hour periodicity assumption. It instead learns the temporal dynamics of each device's individual time series and forecasts the next value given a window of recent history.

### Role in the Pipeline

TimesFM is not applied to all missing slots. The combined imputation table (`spl_levels_combined_imp`) already achieves 99.9% fill rate using statistical methods. TimesFM's role is to **re-impute** the subset of slots that were statistically filled (i.e., `imputed = 1` in the combined table) where sufficient historical context exists. The combined table is used as the base and is never modified during forecasting — TimesFM reads from it but writes to a separate table (`spl_levels_timesfm_imp`).

The three-valued `imputed` flag in `spl_levels_timesfm_imp` distinguishes outcomes:

| `imputed` | Meaning |
|---|---|
| `0` | Original measured value — copied as-is from combined |
| `1` | Kept statistical estimate — < MIN_CONTEXT hours of context before this slot |
| `2` | Re-imputed by TimesFM |

### Context Window Strategy

For each slot queued for TimesFM, a context array of up to `CONTEXT_LEN = 512` values is extracted from the device's combined series, using all rows with `ts_indexed < slot_ts_indexed`. Taking values strictly before the slot's Unix timestamp guarantees that the model never sees the true value it is predicting — an essential requirement for unbiased evaluation.

```python
ctx = [v for ti, v in dev_series if ti < ts_indexed][-CONTEXT_LEN:]
```

If fewer than `MIN_CONTEXT = 72` prior values are available (i.e., the device has fewer than 72 hours of history before this slot), the slot is not sent to TimesFM and the statistical estimate is retained as `imputed = 1`. The 72-hour threshold was chosen to ensure the model receives at least three full daily cycles, which is the minimum for the transformer to identify diurnal patterns reliably.

The model is configured with `max_context = 512`, `max_horizon = 128` (the minimum valid horizon for this model variant, as it must be a multiple of the output patch length), and `normalize_inputs = True`. The forecast is requested with `horizon = 1`; only the first forecast step is used as the imputed value.

### Batched Inference

Running a separate forward pass for each of the ~310,000 queued slots would be prohibitively slow. The script collects all context arrays up front, then processes them in batches:

```python
batch_size = model.global_batch_size or 32
for i in range(0, total, batch_size):
    batch_ctx   = forecast_contexts[i : i + batch_size]
    point_fc, _ = model.forecast(horizon=1, inputs=batch_ctx)
    for j, (device_id, ts, ts_indexed) in enumerate(batch_meta):
        value = round(float(point_fc[j, 0]))
```

This approach passes all context arrays for a batch through the transformer in a single forward pass, exploiting parallelism across the batch dimension. The model's `global_batch_size` attribute returns the hardware-optimal batch size; a fallback of 32 is used if the attribute is absent. On CPU, the full inference run across ~310,000 slots takes approximately **13 hours**; on GPU, this would reduce to under 30 minutes.

### Fill Rate

Because TimesFM operates on top of the combined table (99.9% filled), and only replaces `imputed = 1` slots that have sufficient context, the final fill rate is also **99.9%**. The distinction from the combined method lies not in coverage but in accuracy: by replacing statistical estimates with model-based forecasts, TimesFM reduces the MAE from 2.70 dB (Combined) to 1.18 dB — a 2.8× improvement — as measured in the evaluation described in Section 3.7.

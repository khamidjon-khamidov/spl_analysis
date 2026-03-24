# TimesFM Imputation — Logic, Results & Discussion

## Overview

After statistical imputation (historical median and KNN) achieves 99.9% fill-rate via the combined method, a residual set of slots remains that were filled with statistical estimates (imputed = 1). These slots — roughly 26% of all data points — were re-imputed using **Google TimesFM 2.5**, a 200M-parameter neural time series foundation model, to replace statistical guesses with learned temporal patterns.

---

## Model

**Google TimesFM 2.5** (200M parameters, PyTorch backend)

- HuggingFace model ID: `google/timesfm-2.5-200m-pytorch`
- Architecture: decoder-only transformer trained on real-world time series across many domains
- Input: a fixed-length context window of past observations
- Output: point forecast for future steps (horizon)

This project uses it in a **one-step-ahead** fashion: for each slot to re-impute, the model predicts the value at that exact timestamp given the 512 most recent available hours.

---

## Imputation Strategy (Option A — Fixed Context)

The key design decision was **Option A (fixed context)**: the combined table (`spl_levels_combined_imp`) is treated as a read-only base and is never modified during forecasting. All context windows are built from this frozen table upfront, before any model calls.

This avoids the problem of sequential dependency (where imputing slot T changes the context for slot T+1), allows full batch parallelism, and produces deterministic results regardless of slot processing order.

### Algorithm

1. **Load** `spl_levels_combined_imp` into memory (device_id → sorted time series of `(ts_indexed, value)` pairs).
2. **For each device**, iterate over every hourly slot from `data_start` to `data_end`:
   - If the slot has `imputed = 0` (original): copy as-is → **keep original**.
   - If the slot has `imputed = 1` (statistical estimate):
     - Extract the last 512 values from the frozen combined series strictly before this slot.
     - If fewer than **72 values** are available (insufficient context): keep the statistical estimate → **kept statistical**.
     - Otherwise: queue for TimesFM → **re-impute with TimesFM**.
   - If the slot is missing from combined entirely: same context check; if enough history exists, queue for TimesFM.
3. **Batch** all queued slots through the model (batch_size = `model.global_batch_size`, typically 32).
4. **Write** results to `spl_levels_timesfm_imp`.

### Parameters

| Parameter | Value | Rationale |
|---|---|---|
| Context window (`CONTEXT_LEN`) | 512 steps | 21 days of hourly data; covers weekly seasonality |
| Minimum context (`MIN_CONTEXT`) | 72 hours | 3 days minimum; below this the model has too little signal |
| Horizon | 1 step | One-step-ahead prediction per slot |
| `normalize_inputs` | True | Scales input to unit range before feeding the model |
| `infer_is_positive` | True | Hints that SPL values are non-negative |
| `fix_quantile_crossing` | True | Ensures quantile output is monotone |
| `max_horizon` | 128 | Must be a multiple of output patch length (128) |

---

## Results

All 471 devices, Sep–Dec 2021 dataset (122 days × 24 hours × 471 devices theoretical maximum).

| Category | Count | Description |
|---|---|---|
| `imputed = 0` | 877,178 | Original sensor readings, copied unchanged |
| `imputed = 1` | 7,137 | Statistical estimates kept (< 72h context) |
| `imputed = 2` | 310,684 | Re-imputed by TimesFM |
| **Total rows** | **1,194,999** | Written to `spl_levels_timesfm_imp` |

### Fill Rate Comparison

| Method | Fill Rate |
|---|---|
| Historical Median | 91.9% |
| Spatial KNN | 98.8% |
| Historical + KNN (Combined) | 99.9% |
| TimesFM (this method) | 99.9% |

TimesFM does not increase the overall fill rate significantly over the combined method — its purpose is to **improve the quality** of the 310,684 statistically-imputed slots by replacing flat historical medians or spatial averages with temporally-coherent model predictions.

The 7,137 slots kept as statistical estimates are devices with fewer than 72 hours of preceding data (i.e., sensors that started recording less than 3 days before the slot in question).

---

## Discussion

### Why re-impute with a neural model?

Statistical methods like historical median and KNN are fast and reliable for coverage, but they have structural limitations:

- **Historical median** uses the same-hour readings from previous days. On weekdays it works well, but it misses anomalous events, trends, and the specific temporal trajectory of a sensor.
- **KNN** uses spatial neighbours at the same timestamp. It captures current-moment noise environment well, but ignores the temporal history of the individual device.

TimesFM conditions on the actual recent history of each sensor (up to 512 hours), which means it captures:

- Local trends (e.g., gradual increase toward rush hour)
- Autocorrelation (recent values predict nearby future values)
- Daily and weekly patterns as seen by that specific sensor

### Limitations

- **One-step horizon**: each slot is predicted independently. Forecasting further ahead is more uncertain; here we only ever ask for horizon=1, so accuracy is maximised.
- **No ground truth for evaluation**: since the slots being re-imputed are genuinely missing, there is no way to directly measure imputation accuracy on this dataset without held-out evaluation (e.g., artificially masking known values). This is left for future work.
- **CPU-only inference**: the model ran on CPU. GPU would reduce runtime by 10–20×.
- **Context quality**: the 512-step context comes from the combined table, which itself contains statistical estimates. If those estimates are poor (e.g., all-median context), the model's output quality degrades accordingly.

---

## Processing Time

The script ran on a local machine (Apple MacBook Pro, CPU-only, no GPU acceleration).

- **Dependencies installed**: NumPy, PyTorch, SafeTensors, HuggingFace Hub
- **Model size**: ~800 MB (downloaded from HuggingFace on first run)
- **Total slots processed**: 310,684 (queued for TimesFM)
- **Batch size**: 32 (model.global_batch_size)
- **Total model calls**: ~9,709 batches

**Approximate wall-clock time: ~13 hours on CPU.**

This is consistent with CPU-only PyTorch inference for a 200M-parameter transformer at ~1–2 batches/second throughput. GPU inference (e.g., CUDA or MPS) would reduce this to under 1 hour.

---

## Output Table Schema

```sql
CREATE TABLE spl_levels_timesfm_imp (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   INTEGER NOT NULL REFERENCES devices(id),
    timestamp   TEXT    NOT NULL,   -- 'dd-mm-yyyy hh:00' Tallinn local time
    ts_indexed  INTEGER NOT NULL,   -- Unix UTC seconds (indexed)
    value       INTEGER NOT NULL,   -- Rounded dB value
    imputed     INTEGER NOT NULL DEFAULT 0
    -- 0 = original, 1 = kept statistical, 2 = TimesFM
);
CREATE INDEX idx_timesfm_ts     ON spl_levels_timesfm_imp (ts_indexed);
CREATE INDEX idx_timesfm_device ON spl_levels_timesfm_imp (device_id);
```

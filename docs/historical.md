# Historical Median Imputation — Logic, Results & Discussion

## Overview

The historical median method is the simplest and fastest imputation strategy in this pipeline. It exploits the strong **daily periodicity** of urban noise: rush-hour traffic sounds similar on Monday at 08:00 whether it is this week or last week. When a sensor reading is missing, the method looks back at the same hour-of-day from previous days for that same device and uses the median of those readings as the estimate.

---

## Algorithm

For every (device, hour) slot between a device's `data_start` and `data_end`:

1. **If a reading exists** in `sp_levels` → copy it as-is (`imputed = 0`).
2. **If the slot is missing**:
   - Collect all previous readings for this device at the same hour-of-day (e.g. all past Mondays at 08:00 for a slot that is Monday 08:00).
   - Take the last **10** of these readings (most recent history, chronologically sorted).
   - Compute their **median**.
   - Write the rounded integer as the imputed value (`imputed = 1`).
3. **If no prior readings exist at this hour** (device is too new, or this hour has never been recorded before) → skip the slot (leave missing).

### Parameters

| Parameter | Value | Rationale |
|---|---|---|
| `MAX_LOOKBACK` | 10 readings | Balances recency vs. sample size; older readings are less representative |
| Aggregation | Median | Robust to occasional outliers (e.g. one-off noise events) |
| Output type | Integer | Rounded to match original sensor resolution |

### Why Median Instead of Mean?

Urban noise readings can include transient spikes (construction, accidents, events). The median is resistant to these outliers — a single anomalous reading at 80 dB does not pull the imputed value away from the typical 62 dB level the same way a mean would.

---

## Results

Sep–Dec 2021 dataset, 471 devices.

| Category | Count | Description |
|---|---|---|
| `imputed = 0` | ~877,000 | Original sensor readings, copied unchanged |
| `imputed = 1` | ~218,000 | Filled by historical median |
| Skipped | ~99,000 | No prior same-hour data (early in device lifetime) |
| **Total rows** | **~1,095,000** | Written to `spl_levels_historical_imp` |

**Fill rate: 91.9%**

The ~8.1% gap is concentrated in devices that have few or no prior readings at a given hour — typically sensors that started recording recently, or devices that only operate during certain hours of the day. Once a device has been active for a few days, almost all its future missing slots can be filled historically.

---

## Discussion

### Strengths

- **Fast**: runs entirely in memory on the original `sp_levels` table; no coordinate lookups, no cross-device queries.
- **Device-specific**: the estimate reflects the acoustic character of that exact sensor's location — a microphone beside a highway gets a highway-level imputation, not an average of all sensors in the city.
- **Handles long outages well**: even if a device is offline for a week, the method pulls from the week before that, and the week before that, up to 10 readings deep.

### Limitations

- **Cannot fill early slots**: the very first hours a device is active have no historical record to draw from. These slots remain missing (8.1% of the dataset).
- **Misses short-term trends**: if noise levels in an area have been gradually increasing due to construction starting this week, the historical median from last week will underestimate the current level.
- **No spatial awareness**: two neighbouring sensors may have very different fill values for the same timestamp even if they are 50m apart, because each uses only its own past.
- **Same-hour assumption**: weekday vs. weekend differences within the same hour are ignored. A Monday-08:00 median is sometimes used to fill a Sunday-08:00 slot if Sunday readings are scarce.

---

## Output Table Schema

```sql
CREATE TABLE spl_levels_historical_imp (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   INTEGER NOT NULL REFERENCES devices(id),
    timestamp   TEXT    NOT NULL,   -- 'dd-mm-yyyy hh:00' Tallinn local time
    ts_indexed  INTEGER NOT NULL,   -- Unix UTC seconds (indexed)
    value       INTEGER NOT NULL,   -- Rounded dB value
    imputed     INTEGER NOT NULL DEFAULT 0
    -- 0 = original reading, 1 = historical median estimate
);
CREATE INDEX idx_hist_ts     ON spl_levels_historical_imp (ts_indexed);
CREATE INDEX idx_hist_device ON spl_levels_historical_imp (device_id);
```

# Spatial KNN Imputation — Logic, Results & Discussion

## Overview

The spatial KNN (K-Nearest Neighbours) method fills missing sensor readings by looking at **what neighbouring sensors recorded at the same moment**. The core assumption is that urban noise is spatially correlated over short distances: two microphones 200m apart on the same street typically report similar dB levels during the same hour.

This approach is complementary to the historical method — where historical median exploits **time** patterns (same hour, past days), KNN exploits **space** patterns (same time, nearby devices).

---

## Algorithm

For every (device, hour) slot between a device's `data_start` and `data_end`:

1. **If a reading exists** in `sp_levels` → copy it as-is (`imputed = 0`).
2. **If the slot is missing**:
   - Find all other devices within **500 m** that have a reading at this exact timestamp.
   - If at least **3 neighbours** are found within 500 m → take the **median** of their values (`imputed = 1`).
   - Otherwise, expand the search to **1,000 m** and take the median of all neighbours found at that radius.
   - If still no neighbours have data at this timestamp → skip the slot (leave missing).

### Distance Calculation

Distances between sensors use the **Haversine formula**, which accounts for the Earth's curvature:

```
a = sin²(Δlat/2) + cos(lat1) × cos(lat2) × sin²(Δlon/2)
d = 2R × arcsin(√a)     where R = 6,371,000 m
```

Neighbour lists are precomputed once before the main loop (O(n²) pairwise pass over 471 devices), then reused for every timestamp. This makes the main imputation loop efficient.

### Parameters

| Parameter | Value | Rationale |
|---|---|---|
| Primary radius | 500 m | Sensors this close share the same acoustic environment |
| Fallback radius | 1,000 m | Expands coverage for isolated sensors; still close enough for correlation |
| Minimum neighbours | 3 | Below 3, a single outlier reading could dominate the median |
| Aggregation | Median | Robust to one sensor with an unusual spike |
| Output type | Integer | Rounded to match original sensor resolution |

### Why Two Radii?

Not all sensors are evenly distributed. Dense urban areas (city centre) have many sensors within 500m of each other. But some sensors at the edges of Tallinn are more isolated and may have no neighbours within 500m. A single fallback radius of 1km captures these without widening the search for well-covered areas.

---

## Results

Sep–Dec 2021 dataset, 471 devices.

| Category | Count | Description |
|---|---|---|
| `imputed = 0` | ~877,000 | Original sensor readings, copied unchanged |
| `imputed = 1` (≤ 500 m) | ~216,000 | Filled from primary-radius neighbours |
| `imputed = 1` (≤ 1,000 m) | ~93,000 | Filled from fallback-radius neighbours |
| Skipped | ~14,000 | No neighbours had data at that timestamp |
| **Total rows** | **~1,186,000** | Written to `spl_levels_knn_imp` |

**Fill rate: 98.8%**

KNN achieves significantly higher coverage than historical median (91.9%) because it only fails when *all* nearby sensors are also offline simultaneously — which is rare. Historical median fails whenever a device is new (no prior history at that hour), which is common at the start of the dataset.

---

## Discussion

### Strengths

- **High fill rate**: spatial correlation in a dense city sensor network is strong. As long as the network as a whole is functioning, individual sensor gaps can almost always be filled.
- **Captures current conditions**: because KNN uses readings from the *same timestamp*, it reflects what is actually happening at that moment (rush hour, rain, special event) rather than a historical average.
- **No cold-start problem**: even a brand-new sensor with zero history can be imputed immediately if neighbours are present.

### Limitations

- **Isolated sensors fail**: devices at the outskirts with no neighbours within 1km cannot be filled. The ~1.2% unfilled slots are concentrated here.
- **Simultaneous outages**: if a power failure or network outage affects an entire district, all sensors in that area go offline together, leaving KNN with no source to draw from.
- **Spatial assumption may break down**: a sensor inside a school courtyard and another 300m away on a main road may report very different levels even at the same timestamp. The median of neighbours smooths out such micro-environment differences.
- **No temporal context**: KNN ignores the device's own history entirely. If a sensor has been steadily recording 55 dB all day and suddenly drops offline, KNN might return 68 dB if the neighbourhood is noisier at that moment — missing the device-specific baseline.

---

## Output Table Schema

```sql
CREATE TABLE spl_levels_knn_imp (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   INTEGER NOT NULL REFERENCES devices(id),
    timestamp   TEXT    NOT NULL,   -- 'dd-mm-yyyy hh:00' Tallinn local time
    ts_indexed  INTEGER NOT NULL,   -- Unix UTC seconds (indexed)
    value       INTEGER NOT NULL,   -- Rounded dB value
    imputed     INTEGER NOT NULL DEFAULT 0
    -- 0 = original reading, 1 = spatial KNN estimate
);
CREATE INDEX idx_knn_ts     ON spl_levels_knn_imp (ts_indexed);
CREATE INDEX idx_knn_device ON spl_levels_knn_imp (device_id);
```

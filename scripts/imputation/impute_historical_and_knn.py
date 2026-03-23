#!/usr/bin/env python3
"""
Creates spl_levels_combined_imp table using inverse-variance weighted fusion
of historical-median and spatial-KNN imputation.

For every (device, hour) slot between a device's data_start and data_end:
  - If a reading exists in sp_levels → copy it as-is            (imputed = 0)
  - If missing → compute both estimates and blend by precision:

      Historical estimate: median of last 10 available same-hour
                           readings from previous days for this device.
      KNN estimate:        median of neighbour readings (≤500 m,
                           fallback ≤1 000 m) at the same timestamp.

      weight = 1 / max(sample_variance, MIN_VAR)

      combined = (w_hist × hist_est + w_knn × knn_est) / (w_hist + w_knn)

  - If only one source is available → use it directly            (imputed = 1)
  - If neither source has data → skip (leave missing)

See docs/historical_knn.md for the theoretical background.

Columns:
  id         INTEGER  PK
  device_id  INTEGER  FK -> devices(id)
  timestamp  TEXT     'dd-mm-yyyy hh:00' Estonian time
  value      REAL     (rounded to integer)
  imputed    INTEGER  0 = original, 1 = imputed
"""

import sqlite3
import os
import math
import statistics
from collections import defaultdict
from datetime import datetime, timedelta

DB_PATH           = os.path.join(os.path.dirname(__file__), "../../data/SPL.db")
PRIMARY_RADIUS_M  = 500
FALLBACK_RADIUS_M = 1_000
MIN_NEIGHBOURS    = 3
MAX_LOOKBACK      = 10
MIN_VAR           = 1.0    # dB² floor — prevents infinite weights from tiny samples
DEFAULT_VAR       = 100.0  # dB² assigned when only 1 sample (variance undefined)


# ── Helpers ──────────────────────────────────────────────────────────────────

def haversine(lat1, lon1, lat2, lon2):
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi    = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def safe_variance(samples):
    """Sample variance with a floor of MIN_VAR. Returns DEFAULT_VAR for n < 2."""
    if len(samples) < 2:
        return DEFAULT_VAR
    return max(statistics.variance(samples), MIN_VAR)


def blend(hist_samples, knn_samples):
    """
    Inverse-variance weighted blend of two sample sets.
    Returns (value, used_hist, used_knn).
    """
    has_hist = len(hist_samples) > 0
    has_knn  = len(knn_samples)  > 0

    if has_hist and has_knn:
        hist_est = statistics.median(hist_samples)
        knn_est  = statistics.median(knn_samples)
        w_hist   = 1.0 / safe_variance(hist_samples)
        w_knn    = 1.0 / safe_variance(knn_samples)
        value    = (w_hist * hist_est + w_knn * knn_est) / (w_hist + w_knn)
        return value, True, True

    if has_hist:
        return statistics.median(hist_samples), True, False

    if has_knn:
        return statistics.median(knn_samples), False, True

    return None, False, False


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # ── Device positions ─────────────────────────────────────────────────────
    cur.execute("SELECT id, lat, long FROM devices")
    geo        = {row[0]: (row[1], row[2]) for row in cur.fetchall()}
    device_ids = list(geo.keys())

    # ── Neighbour lists ──────────────────────────────────────────────────────
    print("Computing neighbour lists …")
    neighbours_500  = {}
    neighbours_1000 = {}

    for dev in device_ids:
        lat1, lon1 = geo[dev]
        p, f = [], []
        for other in device_ids:
            if other == dev:
                continue
            d = haversine(lat1, lon1, *geo[other])
            if d <= PRIMARY_RADIUS_M:
                p.append(other)
            elif d <= FALLBACK_RADIUS_M:
                f.append(other)
        neighbours_500[dev]  = p
        neighbours_1000[dev] = p + f

    # ── Load original readings ───────────────────────────────────────────────
    print("Loading sp_levels …")
    cur.execute("SELECT device_id, timestamp, value FROM sp_levels")

    existing  = {}                   # (device_id, ts) -> value
    by_hour   = defaultdict(list)    # (device_id, hour_int) -> [(datetime, value)]
    ts_lookup = {}                   # ts -> {device_id: value}

    for device_id, ts, value in cur.fetchall():
        existing[(device_id, ts)] = value
        dt = datetime.strptime(ts, "%d-%m-%Y %H:00")
        by_hour[(device_id, dt.hour)].append((dt, value))
        ts_lookup.setdefault(ts, {})[device_id] = value

    for key in by_hour:
        by_hour[key].sort(key=lambda x: x[0])

    print(f"  {len(existing)} readings across {len({k[0] for k in existing})} devices.")

    # ── Device ranges ────────────────────────────────────────────────────────
    cur.execute("SELECT id, data_start, data_end FROM devices WHERE data_start IS NOT NULL")
    devices = cur.fetchall()

    # ── Build output rows ────────────────────────────────────────────────────
    print("Imputing missing slots …")
    rows  = []
    stats = {
        "copied":       0,
        "both":         0,   # blended from hist + knn
        "hist_only":    0,
        "knn_only":     0,
        "skipped":      0,
    }

    for device_id, data_start, data_end in devices:
        start_dt = datetime.strptime(data_start[:16], "%Y-%m-%d %H:%M").replace(minute=0)
        end_dt   = datetime.strptime(data_end[:16],   "%Y-%m-%d %H:%M").replace(minute=0)

        cur_dt = start_dt
        while cur_dt <= end_dt:
            ts = cur_dt.strftime("%d-%m-%Y %H:00")

            if (device_id, ts) in existing:
                rows.append((device_id, ts, round(existing[(device_id, ts)]), 0))
                stats["copied"] += 1
            else:
                # Historical samples
                bucket   = by_hour.get((device_id, cur_dt.hour), [])
                previous = [v for dt, v in bucket if dt < cur_dt]
                hist_samples = previous[-MAX_LOOKBACK:]

                # KNN samples
                ts_vals      = ts_lookup.get(ts, {})
                knn_vals_500 = [ts_vals[n] for n in neighbours_500[device_id]  if n in ts_vals]
                knn_vals_1k  = [ts_vals[n] for n in neighbours_1000[device_id] if n in ts_vals]

                # Use primary radius if enough neighbours, else fallback
                if len(knn_vals_500) >= MIN_NEIGHBOURS:
                    knn_samples = knn_vals_500
                else:
                    knn_samples = knn_vals_1k

                value, used_hist, used_knn = blend(hist_samples, knn_samples)

                if value is None:
                    stats["skipped"] += 1
                else:
                    rows.append((device_id, ts, round(value), 1))
                    if used_hist and used_knn:
                        stats["both"] += 1
                    elif used_hist:
                        stats["hist_only"] += 1
                    else:
                        stats["knn_only"] += 1

            cur_dt += timedelta(hours=1)

    print(f"  Copied:              {stats['copied']:>7}")
    print(f"  Blended (hist+knn):  {stats['both']:>7}")
    print(f"  Historical only:     {stats['hist_only']:>7}")
    print(f"  KNN only:            {stats['knn_only']:>7}")
    print(f"  Skipped:             {stats['skipped']:>7}  (no data from either source)")

    # ── Write to DB ──────────────────────────────────────────────────────────
    print("Writing spl_levels_combined_imp …")
    cur.execute("DROP TABLE IF EXISTS spl_levels_combined_imp")
    cur.execute("""
        CREATE TABLE spl_levels_combined_imp (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER NOT NULL REFERENCES devices(id),
            timestamp TEXT    NOT NULL,
            value     REAL    NOT NULL,
            imputed   INTEGER NOT NULL DEFAULT 0
        )
    """)
    cur.executemany(
        "INSERT INTO spl_levels_combined_imp (device_id, timestamp, value, imputed) VALUES (?, ?, ?, ?)",
        rows,
    )
    con.commit()
    con.close()

    total = stats["copied"] + stats["both"] + stats["hist_only"] + stats["knn_only"]
    print(f"Done. {total} rows written.")


if __name__ == "__main__":
    main()

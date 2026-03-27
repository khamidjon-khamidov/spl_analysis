#!/usr/bin/env python3
"""
Held-out evaluation of all four imputation methods on the 35 test devices.

For each test device (is_test = 1):
  1. Randomly sample MASK_FRACTION of its original readings as held-out slots.
  2. Compute the estimate each method would produce for those slots,
     treating them as missing (the true value is excluded from all inputs).
  3. Compare estimates to true values → MAE and RMSE.

Results are printed per method overall and per group, then written to:
  data/evaluation_results.csv   — one row per mask slot with all estimates
  data/evaluation_summary.csv   — MAE/RMSE per method × group
"""

import sys
import os
import sqlite3
import math
import random
import statistics
import csv
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../timesfm/src"))
import numpy as np
import torch
import timesfm

DB_PATH      = os.path.join(os.path.dirname(__file__), "../../data/SPL.db")
RESULTS_CSV  = os.path.join(os.path.dirname(__file__), "../../data/evaluation_results.csv")
SUMMARY_CSV  = os.path.join(os.path.dirname(__file__), "../../data/evaluation_summary.csv")

RANDOM_SEED       = 42
MASK_FRACTION     = 0.20      # fraction of each device's originals to mask
HF_MODEL_ID       = "google/timesfm-2.5-200m-pytorch"
CONTEXT_LEN       = 512
MIN_CONTEXT       = 72
PRIMARY_RADIUS_M  = 500
FALLBACK_RADIUS_M = 1_000
MIN_NEIGHBOURS    = 3
MAX_LOOKBACK      = 10
MIN_VAR           = 1.0
DEFAULT_VAR       = 100.0
TALLINN           = ZoneInfo("Europe/Tallinn")

METHODS = ["historical", "knn", "combined", "timesfm"]


# ── Distance ──────────────────────────────────────────────────────────────────

def haversine(lat1, lon1, lat2, lon2):
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi    = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


# ── Variance helper ───────────────────────────────────────────────────────────

def safe_variance(samples):
    if len(samples) < 2:
        return DEFAULT_VAR
    return max(statistics.variance(samples), MIN_VAR)


# ── Per-slot estimates ────────────────────────────────────────────────────────

def estimate_historical(device_id, cur_dt, by_hour):
    """Median of last MAX_LOOKBACK same-hour readings strictly before cur_dt."""
    bucket   = by_hour.get((device_id, cur_dt.hour), [])
    previous = [v for dt, v in bucket if dt < cur_dt]
    lookback = previous[-MAX_LOOKBACK:]
    if not lookback:
        return None, None
    est = statistics.median(lookback)
    var = safe_variance(lookback)
    return est, var


def estimate_knn(device_id, ts, neighbours_500, neighbours_1000, ts_lookup):
    """Median of spatial neighbours at the same timestamp."""
    ts_vals   = ts_lookup.get(ts, {})
    vals_500  = [ts_vals[n] for n in neighbours_500[device_id]  if n in ts_vals]
    vals_1000 = [ts_vals[n] for n in neighbours_1000[device_id] if n in ts_vals]

    if len(vals_500) >= MIN_NEIGHBOURS:
        samples = vals_500
    elif vals_1000:
        samples = vals_1000
    else:
        return None, None

    est = statistics.median(samples)
    var = safe_variance(samples)
    return est, var


def estimate_combined(hist_est, hist_var, knn_est, knn_var):
    """Inverse-variance weighted blend."""
    has_hist = hist_est is not None
    has_knn  = knn_est  is not None

    if has_hist and has_knn:
        w_hist = 1.0 / max(hist_var, MIN_VAR)
        w_knn  = 1.0 / max(knn_var,  MIN_VAR)
        return (w_hist * hist_est + w_knn * knn_est) / (w_hist + w_knn)
    if has_hist:
        return hist_est
    if has_knn:
        return knn_est
    return None


# ── Metrics ───────────────────────────────────────────────────────────────────

def mae(pairs):
    if not pairs:
        return float("nan")
    return sum(abs(t - e) for t, e in pairs) / len(pairs)


def rmse(pairs):
    if not pairs:
        return float("nan")
    return math.sqrt(sum((t - e) ** 2 for t, e in pairs) / len(pairs))


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    random.seed(RANDOM_SEED)

    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    # ── Load test devices ─────────────────────────────────────────────────────
    cur.execute("""
        SELECT id, name, lat, long,
               COALESCE(test_group, 'unknown') AS grp
        FROM devices
        WHERE is_test = 1
        ORDER BY id
    """)
    test_devices = [dict(r) for r in cur.fetchall()]
    test_ids = {d["id"] for d in test_devices}
    print(f"Test devices loaded: {len(test_devices)}")

    # ── Load all device positions ─────────────────────────────────────────────
    cur.execute("SELECT id, lat, long FROM devices")
    geo        = {r["id"]: (r["lat"], r["long"]) for r in cur.fetchall()}
    device_ids = list(geo.keys())

    # ── Precompute neighbour lists ────────────────────────────────────────────
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

    # ── Load sp_levels ────────────────────────────────────────────────────────
    print("Loading sp_levels …")
    cur.execute("SELECT device_id, timestamp, ts_indexed, value FROM sp_levels")
    rows_raw = cur.fetchall()

    existing   = {}                  # (device_id, ts) -> (ts_indexed, value)
    by_hour    = defaultdict(list)   # (device_id, hour_int) -> [(naive_dt, value)]
    ts_lookup  = {}                  # ts -> {device_id: value}
    series     = defaultdict(list)   # device_id -> [(ts_indexed, value)]

    for r in rows_raw:
        device_id, ts, ts_indexed, value = r["device_id"], r["timestamp"], r["ts_indexed"], r["value"]
        existing[(device_id, ts)] = (ts_indexed, value)
        dt = datetime.strptime(ts, "%d-%m-%Y %H:00")
        by_hour[(device_id, dt.hour)].append((dt, value))
        ts_lookup.setdefault(ts, {})[device_id] = value
        series[device_id].append((ts_indexed, value))

    for key in by_hour:
        by_hour[key].sort(key=lambda x: x[0])
    for dev in series:
        series[dev].sort(key=lambda x: x[0])

    print(f"  {len(existing)} readings across {len(series)} devices.")

    # ── Select mask slots ─────────────────────────────────────────────────────
    print(f"\nSelecting mask slots ({MASK_FRACTION:.0%} of originals per test device) …")
    mask_slots = []   # (device_id, name, grp, ts, ts_indexed, true_value, cur_dt)

    for d in test_devices:
        dev_id = d["id"]
        originals = [(ts, ts_idx, val)
                     for (did, ts), (ts_idx, val) in existing.items()
                     if did == dev_id]
        n_mask = max(1, round(len(originals) * MASK_FRACTION))
        chosen = random.sample(originals, min(n_mask, len(originals)))
        for ts, ts_idx, true_val in chosen:
            cur_dt = datetime.strptime(ts, "%d-%m-%Y %H:00")
            mask_slots.append((dev_id, d["name"], d["grp"], ts, ts_idx, true_val, cur_dt))

    print(f"  Total mask slots: {len(mask_slots)}")

    # ── Compute statistical estimates ─────────────────────────────────────────
    print("\nComputing historical and KNN estimates …")

    results = []   # list of dicts, one per mask slot

    for device_id, name, grp, ts, ts_indexed, true_val, cur_dt in mask_slots:
        hist_est, hist_var = estimate_historical(device_id, cur_dt, by_hour)
        knn_est,  knn_var  = estimate_knn(device_id, ts, neighbours_500, neighbours_1000, ts_lookup)
        comb_est           = estimate_combined(hist_est, hist_var, knn_est, knn_var)

        results.append({
            "device_id":   device_id,
            "name":        name,
            "group":       grp,
            "timestamp":   ts,
            "ts_indexed":  ts_indexed,
            "true_value":  true_val,
            "historical":  hist_est,
            "knn":         knn_est,
            "combined":    comb_est,
            "timesfm":     None,   # filled below
        })

    # ── TimesFM estimates ─────────────────────────────────────────────────────
    print(f"Loading TimesFM from {HF_MODEL_ID} …")
    torch.set_float32_matmul_precision("high")
    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(HF_MODEL_ID)
    model.compile(timesfm.ForecastConfig(
        max_context=CONTEXT_LEN,
        max_horizon=128,
        normalize_inputs=True,
        infer_is_positive=True,
        fix_quantile_crossing=True,
    ))
    print("Model ready.")

    # Build context arrays for slots that have enough history
    tf_indices  = []   # index into results list
    tf_contexts = []   # parallel context arrays

    for i, row in enumerate(results):
        dev_id     = row["device_id"]
        ts_indexed = row["ts_indexed"]
        ctx = [v for ti, v in series[dev_id] if ti < ts_indexed][-CONTEXT_LEN:]
        if len(ctx) >= MIN_CONTEXT:
            tf_indices.append(i)
            tf_contexts.append(np.array(ctx, dtype=np.float32))

    print(f"Running TimesFM on {len(tf_indices)} / {len(results)} slots …")
    batch_size = model.global_batch_size or 32

    for i in range(0, len(tf_indices), batch_size):
        batch_idx = tf_indices[i : i + batch_size]
        batch_ctx = tf_contexts[i : i + batch_size]
        point_fc, _ = model.forecast(horizon=1, inputs=batch_ctx)
        for j, res_idx in enumerate(batch_idx):
            results[res_idx]["timesfm"] = round(float(point_fc[j, 0]))
        if i % (batch_size * 50) == 0:
            print(f"  {i}/{len(tf_indices)}", flush=True)

    print(f"  TimesFM done.")

    # ── Write results CSV ─────────────────────────────────────────────────────
    print(f"\nWriting {RESULTS_CSV} …")
    fieldnames = ["device_id", "name", "group", "timestamp", "true_value",
                  "historical", "knn", "combined", "timesfm"]
    with open(RESULTS_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in results:
            w.writerow({k: row[k] for k in fieldnames})

    # ── Compute and print metrics ─────────────────────────────────────────────
    groups = sorted({r["group"] for r in results})

    # Collect (true, estimated) pairs per method × scope
    def collect_pairs(rows, method):
        return [(r["true_value"], r[method])
                for r in rows if r[method] is not None]

    print("\n" + "=" * 68)
    print(f"{'EVALUATION RESULTS':^68}")
    print("=" * 68)

    summary_rows = []

    for scope_label, scope_rows in [("ALL", results)] + [(g, [r for r in results if r["group"] == g]) for g in groups]:
        print(f"\n── {scope_label} ({len(scope_rows)} slots) ──")
        print(f"  {'Method':<12}  {'N':>5}  {'MAE (dB)':>10}  {'RMSE (dB)':>10}")
        print(f"  {'-'*12}  {'-----':>5}  {'----------':>10}  {'----------':>10}")
        for method in METHODS:
            pairs = collect_pairs(scope_rows, method)
            m = mae(pairs)
            r = rmse(pairs)
            print(f"  {method:<12}  {len(pairs):>5}  {m:>10.3f}  {r:>10.3f}")
            summary_rows.append({
                "scope":  scope_label,
                "method": method,
                "n":      len(pairs),
                "mae":    round(m, 4) if not math.isnan(m) else "",
                "rmse":   round(r, 4) if not math.isnan(r) else "",
            })

    print("\n" + "=" * 68)

    # ── Write summary CSV ─────────────────────────────────────────────────────
    print(f"Writing {SUMMARY_CSV} …")
    with open(SUMMARY_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["scope", "method", "n", "mae", "rmse"])
        w.writeheader()
        w.writerows(summary_rows)

    con.close()
    print("Done.")


if __name__ == "__main__":
    main()

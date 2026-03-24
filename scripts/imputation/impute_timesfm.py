#!/usr/bin/env python3
"""
Creates spl_levels_timesfm_imp table.

Uses spl_levels_combined_imp as the base (99.9% filled) and re-imputes
all statistically-imputed slots with Google TimesFM 2.5 (Option A — fixed
context: the combined table is never modified during forecasting).

  imputed = 0 → original value, copied as-is from combined
  imputed = 1 → kept statistical estimate (< MIN_CONTEXT hours before slot)
  imputed = 2 → re-imputed by TimesFM

Context window: last CONTEXT_LEN values from combined strictly before the
slot, truncated/padded by TimesFM internally.

Columns: same schema as other imputation tables.
"""

import sys
import os
import sqlite3
import numpy as np
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../timesfm/src"))
import torch
import timesfm

DB_PATH     = os.path.join(os.path.dirname(__file__), "../../data/SPL.db")
HF_MODEL_ID = "google/timesfm-2.5-200m-pytorch"
CONTEXT_LEN = 512
MIN_CONTEXT = 72   # skip slot if fewer than this many hours precede it
TALLINN     = ZoneInfo("Europe/Tallinn")


def fmt_ts(dt):
    return dt.strftime("%d-%m-%Y %H:00")


def ts_to_unix(ts_str):
    dt = datetime.strptime(ts_str, "%d-%m-%Y %H:00").replace(tzinfo=TALLINN)
    return int(dt.timestamp())


def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # ── Load combined table ───────────────────────────────────────────────────
    print("Loading spl_levels_combined_imp …")
    cur.execute("""
        SELECT device_id, timestamp, ts_indexed, value, imputed
        FROM spl_levels_combined_imp
        ORDER BY device_id, ts_indexed
    """)
    rows = cur.fetchall()

    # (device_id, ts_str) -> (ts_indexed, value, imputed)
    combined = {}
    # device_id -> sorted [(ts_indexed, value)] for context lookup
    series = defaultdict(list)

    for device_id, ts, ts_indexed, value, imp in rows:
        combined[(device_id, ts)] = (ts_indexed, value, imp)
        series[device_id].append((ts_indexed, value))

    print(f"  {len(combined)} rows across {len(series)} devices.")

    # ── Load device ranges ────────────────────────────────────────────────────
    cur.execute("SELECT id, data_start, data_end FROM devices WHERE data_start IS NOT NULL")
    devices = cur.fetchall()

    # ── Load TimesFM model ────────────────────────────────────────────────────
    print(f"Loading TimesFM from {HF_MODEL_ID} …")
    torch.set_float32_matmul_precision("high")
    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(HF_MODEL_ID)
    model.compile(timesfm.ForecastConfig(
        max_context=CONTEXT_LEN,
        max_horizon=128,          # must be multiple of output_patch_len (128)
        normalize_inputs=True,
        infer_is_positive=True,
        fix_quantile_crossing=True,
    ))
    print("Model ready.")

    # ── Collect slots ─────────────────────────────────────────────────────────
    print("Collecting slots …")

    kept_rows   = []   # rows to write directly (original + low-context imputed)
    to_forecast = []   # (device_id, ts, ts_indexed) queued for TimesFM
    forecast_contexts = []  # parallel context arrays for to_forecast

    stats = {"original": 0, "queued": 0, "kept_stat": 0, "missing_queued": 0}

    for device_id, data_start, data_end in devices:
        start_dt  = datetime.strptime(data_start[:16], "%Y-%m-%d %H:%M").replace(minute=0)
        end_dt    = datetime.strptime(data_end[:16],   "%Y-%m-%d %H:%M").replace(minute=0)
        dev_series = series[device_id]  # sorted by ts_indexed ascending

        cur_dt = start_dt
        while cur_dt <= end_dt:
            ts  = fmt_ts(cur_dt)
            row = combined.get((device_id, ts))

            if row is not None:
                ts_indexed, value, imp = row
                if imp == 0:
                    # Original — keep as-is
                    kept_rows.append((device_id, ts, ts_indexed, value, 0))
                    stats["original"] += 1
                else:
                    # Statistically imputed — try to re-impute with TimesFM
                    ctx = [v for ti, v in dev_series if ti < ts_indexed][-CONTEXT_LEN:]
                    if len(ctx) >= MIN_CONTEXT:
                        to_forecast.append((device_id, ts, ts_indexed))
                        forecast_contexts.append(np.array(ctx, dtype=np.float32))
                        stats["queued"] += 1
                    else:
                        # Not enough history — keep statistical estimate
                        kept_rows.append((device_id, ts, ts_indexed, value, 1))
                        stats["kept_stat"] += 1
            else:
                # Missing from combined too — try TimesFM
                ts_indexed = ts_to_unix(ts)
                ctx = [v for ti, v in dev_series if ti < ts_indexed][-CONTEXT_LEN:]
                if len(ctx) >= MIN_CONTEXT:
                    to_forecast.append((device_id, ts, ts_indexed))
                    forecast_contexts.append(np.array(ctx, dtype=np.float32))
                    stats["missing_queued"] += 1
                # else: fully skip — no data anywhere near this slot

            cur_dt += timedelta(hours=1)

    print(f"  Original (keep):          {stats['original']:>7}")
    print(f"  Queued for TimesFM:       {stats['queued']:>7}")
    print(f"  Queued (was missing):     {stats['missing_queued']:>7}")
    print(f"  Kept statistical:         {stats['kept_stat']:>7}")

    # ── Run TimesFM in batches ────────────────────────────────────────────────
    total = len(to_forecast)
    print(f"Running TimesFM on {total} slots …")

    timesfm_rows = []
    batch_size   = model.global_batch_size or 32

    for i in range(0, total, batch_size):
        batch_meta    = to_forecast[i : i + batch_size]
        batch_ctx     = forecast_contexts[i : i + batch_size]
        point_fc, _   = model.forecast(horizon=1, inputs=batch_ctx)

        for j, (device_id, ts, ts_indexed) in enumerate(batch_meta):
            value = round(float(point_fc[j, 0]))
            timesfm_rows.append((device_id, ts, ts_indexed, value, 2))

        if i % (batch_size * 200) == 0:
            print(f"  {i}/{total}", flush=True)

    print(f"  TimesFM done. {len(timesfm_rows)} values produced.")

    # ── Write to DB ───────────────────────────────────────────────────────────
    all_rows = kept_rows + timesfm_rows
    print("Writing spl_levels_timesfm_imp …")
    cur.execute("DROP TABLE IF EXISTS spl_levels_timesfm_imp")
    cur.execute("""
        CREATE TABLE spl_levels_timesfm_imp (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id   INTEGER NOT NULL REFERENCES devices(id),
            timestamp   TEXT    NOT NULL,
            ts_indexed  INTEGER NOT NULL,
            value       INTEGER NOT NULL,
            imputed     INTEGER NOT NULL DEFAULT 0
        )
    """)
    cur.execute("CREATE INDEX idx_timesfm_ts     ON spl_levels_timesfm_imp (ts_indexed)")
    cur.execute("CREATE INDEX idx_timesfm_device ON spl_levels_timesfm_imp (device_id)")
    cur.executemany(
        "INSERT INTO spl_levels_timesfm_imp "
        "(device_id, timestamp, ts_indexed, value, imputed) VALUES (?, ?, ?, ?, ?)",
        all_rows,
    )
    con.commit()

    # ── Update devices table ──────────────────────────────────────────────────
    print("Updating devices.timesfm_hours_filled …")
    existing_cols = {row[1] for row in cur.execute("PRAGMA table_info(devices)")}
    if "timesfm_hours_filled" not in existing_cols:
        cur.execute("ALTER TABLE devices ADD COLUMN timesfm_hours_filled INTEGER")
    cur.execute("""
        UPDATE devices SET timesfm_hours_filled = (
            SELECT COUNT(*) FROM spl_levels_timesfm_imp
            WHERE spl_levels_timesfm_imp.device_id = devices.id
        )
    """)
    con.commit()
    con.close()

    print(f"Done. {len(all_rows)} rows written.")
    print(f"  imputed=0 (original):    {stats['original']:>7}")
    print(f"  imputed=1 (kept stat):   {stats['kept_stat']:>7}")
    print(f"  imputed=2 (TimesFM):     {len(timesfm_rows):>7}")


if __name__ == "__main__":
    main()

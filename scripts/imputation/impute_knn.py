#!/usr/bin/env python3
"""
Creates spl_levels_knn_imp table.

For every (device, hour) slot between a device's data_start and data_end:
  - If a reading exists in sp_levels → copy it as-is        (imputed = 0)
  - If missing → find neighbours within 500 m that have a
    reading for the same timestamp, compute their median     (imputed = 1)
  - Fallback: if fewer than 3 neighbours within 500 m,
    expand search to 1 km                                   (imputed = 1)
  - If still no neighbours → skip (leave missing)

Columns:
  id          INTEGER  PK
  device_id   INTEGER  FK -> devices(id)
  timestamp   TEXT     'dd-mm-yyyy hh:00' Estonian time
  ts_indexed  INTEGER  Unix timestamp (UTC seconds) — indexed for fast range queries
  value       INTEGER  rounded to integer
  imputed     INTEGER  0 = original, 1 = imputed
"""

import sqlite3
import os
import math
import statistics
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

DB_PATH           = os.path.join(os.path.dirname(__file__), "../../data/SPL.db")
PRIMARY_RADIUS_M  = 500
FALLBACK_RADIUS_M = 1_000
MIN_NEIGHBOURS    = 3
TALLINN           = ZoneInfo("Europe/Tallinn")


def haversine(lat1, lon1, lat2, lon2):
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi    = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def ts_to_unix(ts_str):
    """'dd-mm-yyyy hh:00' (Tallinn local) -> Unix timestamp (UTC seconds)"""
    dt = datetime.strptime(ts_str, "%d-%m-%Y %H:00").replace(tzinfo=TALLINN)
    return int(dt.timestamp())


def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # ── Load device positions ────────────────────────────────────────────────
    cur.execute("SELECT id, lat, long FROM devices")
    geo        = {row[0]: (row[1], row[2]) for row in cur.fetchall()}
    device_ids = list(geo.keys())

    # ── Precompute neighbour lists ───────────────────────────────────────────
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
    cur.execute("SELECT device_id, timestamp, ts_indexed, value FROM sp_levels")
    existing  = {}   # (device_id, ts) -> (value, ts_indexed)
    ts_lookup = {}   # ts -> {device_id: value}

    for device_id, ts, ts_indexed, value in cur.fetchall():
        existing[(device_id, ts)] = (value, ts_indexed)
        ts_lookup.setdefault(ts, {})[device_id] = value

    print(f"  {len(existing)} readings across {len({k[0] for k in existing})} devices.")

    # ── Load device ranges ───────────────────────────────────────────────────
    cur.execute("SELECT id, data_start, data_end FROM devices WHERE data_start IS NOT NULL")
    devices = cur.fetchall()

    # ── Build output rows ────────────────────────────────────────────────────
    print("Imputing missing slots …")
    rows  = []   # (device_id, ts, ts_indexed, value, imputed)
    stats = {"copied": 0, "imp_500": 0, "imp_1000": 0, "skipped": 0}

    for device_id, data_start, data_end in devices:
        start_dt = datetime.strptime(data_start[:16], "%Y-%m-%d %H:%M").replace(minute=0)
        end_dt   = datetime.strptime(data_end[:16],   "%Y-%m-%d %H:%M").replace(minute=0)

        cur_dt = start_dt
        while cur_dt <= end_dt:
            ts = cur_dt.strftime("%d-%m-%Y %H:00")

            if (device_id, ts) in existing:
                value, ts_idx = existing[(device_id, ts)]
                rows.append((device_id, ts, ts_idx, round(value), 0))
                stats["copied"] += 1
            else:
                ts_vals  = ts_lookup.get(ts, {})
                ts_idx   = ts_to_unix(ts)

                vals_500 = [ts_vals[n] for n in neighbours_500[device_id] if n in ts_vals]
                if len(vals_500) >= MIN_NEIGHBOURS:
                    rows.append((device_id, ts, ts_idx, round(statistics.median(vals_500)), 1))
                    stats["imp_500"] += 1
                else:
                    vals_1000 = [ts_vals[n] for n in neighbours_1000[device_id] if n in ts_vals]
                    if vals_1000:
                        rows.append((device_id, ts, ts_idx, round(statistics.median(vals_1000)), 1))
                        stats["imp_1000"] += 1
                    else:
                        stats["skipped"] += 1

            cur_dt += timedelta(hours=1)

    print(f"  Copied:              {stats['copied']:>7}")
    print(f"  Imputed (≤500 m):    {stats['imp_500']:>7}")
    print(f"  Imputed (≤1 000 m):  {stats['imp_1000']:>7}")
    print(f"  Skipped:             {stats['skipped']:>7}  (no neighbours with data)")

    # ── Write to DB ──────────────────────────────────────────────────────────
    print("Writing spl_levels_knn_imp …")
    cur.execute("DROP TABLE IF EXISTS spl_levels_knn_imp")
    cur.execute("""
        CREATE TABLE spl_levels_knn_imp (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id   INTEGER NOT NULL REFERENCES devices(id),
            timestamp   TEXT    NOT NULL,
            ts_indexed  INTEGER NOT NULL,
            value       INTEGER NOT NULL,
            imputed     INTEGER NOT NULL DEFAULT 0
        )
    """)
    cur.execute("CREATE INDEX idx_knn_ts     ON spl_levels_knn_imp (ts_indexed)")
    cur.execute("CREATE INDEX idx_knn_device ON spl_levels_knn_imp (device_id)")
    cur.executemany(
        "INSERT INTO spl_levels_knn_imp (device_id, timestamp, ts_indexed, value, imputed) VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    con.commit()
    con.close()

    total = stats["copied"] + stats["imp_500"] + stats["imp_1000"]
    print(f"Done. {total} rows written.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Creates spl_levels_historical_imp table.

For every (device, hour) slot between a device's data_start and data_end:
  - If a reading exists in sp_levels  → copy it as-is       (imputed = 0)
  - If missing → find the last 10 available readings for the
                 same hour-of-day from any previous days of the
                 same device, compute their median             (imputed = 1)
  - If no previous readings exist at all → skip (leave missing)

Columns:
  id         INTEGER  PK
  device_id  INTEGER  FK -> devices(id)
  timestamp  TEXT     'dd-mm-yyyy hh:00' Estonian time
  value      REAL
  imputed    INTEGER  0 = original, 1 = imputed
"""

import sqlite3
import os
import statistics
from collections import defaultdict
from datetime import datetime, timedelta

DB_PATH      = os.path.join(os.path.dirname(__file__), "../data/SPL.db")
MAX_LOOKBACK = 10   # maximum number of previous available readings to use


def parse_ts(ts):
    """'dd-mm-yyyy hh:00' -> datetime"""
    return datetime.strptime(ts, "%d-%m-%Y %H:00")


def fmt_ts(dt):
    """datetime -> 'dd-mm-yyyy hh:00'"""
    return dt.strftime("%d-%m-%Y %H:00")


def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # ── Load existing readings ───────────────────────────────────────────────
    print("Loading sp_levels …")
    cur.execute("SELECT device_id, timestamp, value FROM sp_levels")

    existing   = {}                        # (device_id, ts_str)  -> value
    # (device_id, hour_int) -> sorted list of (datetime, value)
    by_hour    = defaultdict(list)

    for device_id, ts, value in cur.fetchall():
        existing[(device_id, ts)] = value
        dt = parse_ts(ts)
        by_hour[(device_id, dt.hour)].append((dt, value))

    # Sort each bucket chronologically once
    for key in by_hour:
        by_hour[key].sort(key=lambda x: x[0])

    print(f"  {len(existing)} readings across {len({k[0] for k in existing})} devices.")

    # ── Load device ranges ───────────────────────────────────────────────────
    cur.execute("SELECT id, data_start, data_end FROM devices WHERE data_start IS NOT NULL")
    devices = cur.fetchall()

    # ── Build output rows ────────────────────────────────────────────────────
    print("Imputing missing slots …")
    rows  = []          # (device_id, ts_str, value, imputed)
    stats = {"copied": 0, "imputed": 0, "skipped": 0}

    for device_id, data_start, data_end in devices:
        start_dt = datetime.strptime(data_start[:16], "%Y-%m-%d %H:%M").replace(minute=0)
        end_dt   = datetime.strptime(data_end[:16],   "%Y-%m-%d %H:%M").replace(minute=0)

        cur_dt = start_dt
        while cur_dt <= end_dt:
            ts  = fmt_ts(cur_dt)
            key = (device_id, ts)

            if key in existing:
                rows.append((device_id, ts, existing[key], 0))
                stats["copied"] += 1
            else:
                # Collect up to MAX_LOOKBACK readings for same hour on previous days
                bucket = by_hour.get((device_id, cur_dt.hour), [])
                # Keep only entries strictly before cur_dt, take the most recent ones
                previous = [v for dt, v in bucket if dt < cur_dt]
                lookback = previous[-MAX_LOOKBACK:]  # last N available

                if lookback:
                    imputed_value = statistics.median(lookback)
                    rows.append((device_id, ts, imputed_value, 1))
                    stats["imputed"] += 1
                else:
                    stats["skipped"] += 1

            cur_dt += timedelta(hours=1)

    print(f"  Copied:  {stats['copied']:>7}")
    print(f"  Imputed: {stats['imputed']:>7}")
    print(f"  Skipped: {stats['skipped']:>7}  (no prior data for that hour)")

    # ── Write to DB ──────────────────────────────────────────────────────────
    print("Writing spl_levels_historical_imp …")
    cur.execute("DROP TABLE IF EXISTS spl_levels_historical_imp")
    cur.execute("""
        CREATE TABLE spl_levels_historical_imp (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id  INTEGER NOT NULL REFERENCES devices(id),
            timestamp  TEXT    NOT NULL,
            value      REAL    NOT NULL,
            imputed    INTEGER NOT NULL DEFAULT 0
        )
    """)
    cur.executemany(
        "INSERT INTO spl_levels_historical_imp (device_id, timestamp, value, imputed) "
        "VALUES (?, ?, ?, ?)",
        rows
    )
    con.commit()
    con.close()

    print(f"Done. {stats['copied'] + stats['imputed']} rows written.")


if __name__ == "__main__":
    main()

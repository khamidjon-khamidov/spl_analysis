#!/usr/bin/env python3
"""
Compute per-device data coverage stats from sp_levels and write them
back to the devices table.

Uses ts_indexed (Unix timestamp) for all date arithmetic — no CSV re-read needed.

Columns added/updated in devices:
  data_start        TEXT     'YYYY-MM-DD HH:MM:SS UTC' of first reading
  data_end          TEXT     'YYYY-MM-DD HH:MM:SS UTC' of last reading
  total_hours       INTEGER  hours between data_start and data_end inclusive
  hours_with_data   INTEGER  distinct hours that have at least one record
  missing_hours     INTEGER  total_hours - hours_with_data
"""

import sqlite3
import os
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "../../data/SPL.db")


def unix_to_utc_str(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # Add columns to devices if not already present
    existing = {row[1] for row in cur.execute("PRAGMA table_info(devices)")}
    new_cols = {
        "data_start":      "TEXT",
        "data_end":        "TEXT",
        "total_hours":     "INTEGER",
        "hours_with_data": "INTEGER",
        "missing_hours":   "INTEGER",
    }
    for col, dtype in new_cols.items():
        if col not in existing:
            cur.execute(f"ALTER TABLE devices ADD COLUMN {col} {dtype}")
    con.commit()

    # Aggregate stats per device directly from sp_levels using ts_indexed
    print("Computing coverage stats from sp_levels ...")
    cur.execute("""
        SELECT
            device_id,
            MIN(ts_indexed)            AS ts_start,
            MAX(ts_indexed)            AS ts_end,
            COUNT(DISTINCT ts_indexed) AS hours_with_data
        FROM sp_levels
        GROUP BY device_id
    """)
    rows = cur.fetchall()
    print(f"  {len(rows)} devices found in sp_levels.")

    updated = 0
    for device_id, ts_start, ts_end, hours_with_data in rows:
        total_hours   = int((ts_end - ts_start) // 3600) + 1
        missing_hours = max(0, total_hours - hours_with_data)
        data_start    = unix_to_utc_str(ts_start)
        data_end      = unix_to_utc_str(ts_end)

        cur.execute("""
            UPDATE devices
            SET data_start      = ?,
                data_end        = ?,
                total_hours     = ?,
                hours_with_data = ?,
                missing_hours   = ?
            WHERE id = ?
        """, (data_start, data_end, total_hours, hours_with_data, missing_hours, device_id))
        updated += cur.rowcount

        if missing_hours > 0:
            pct = missing_hours / total_hours * 100
            print(f"  device {device_id:>4d}  {missing_hours:4d} missing / {total_hours:4d} total  ({pct:.1f}%)")

    con.commit()

    cur.execute("SELECT SUM(missing_hours), SUM(total_hours) FROM devices WHERE total_hours IS NOT NULL")
    total_missing, total_span = cur.fetchone()
    con.close()

    print(f"\nUpdated {updated} devices.")
    print(f"Total missing hours: {total_missing} / {total_span} ({total_missing / total_span * 100:.1f}%)")


if __name__ == "__main__":
    main()

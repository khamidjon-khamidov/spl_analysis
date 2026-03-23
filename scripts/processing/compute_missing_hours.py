#!/usr/bin/env python3
"""
For each device, compute:
  - data_start        : earliest timestamp
  - data_end          : latest timestamp
  - total_hours       : full hours between start and end (inclusive)
  - hours_with_data   : distinct hours that have at least one record
  - missing_hours     : total_hours - hours_with_data

Results are added as columns to the devices table in data/SPL.db.
"""

import csv
import sqlite3
import os
from datetime import datetime, timezone, timedelta
from collections import defaultdict

INPUT_FILE = os.path.join(os.path.dirname(__file__), "../data/raw/all_acoustic_sensor_data_230501_230831.csv")
OUTPUT_DB  = os.path.join(os.path.dirname(__file__), "../../data/SPL.db")


def parse_dt(s):
    """Parse timestamps like '2023-05-01 00:00:34+03' or '2023-05-01 00:00:34.123456+03'."""
    import re
    s = s.strip()
    # Normalise tz offset: +03 -> +0300, +03:00 -> +0300
    s = re.sub(r'([+-])(\d{2}):(\d{2})$', lambda m: m.group(1) + m.group(2) + m.group(3), s)
    s = re.sub(r'([+-])(\d{2})$', lambda m: m.group(1) + m.group(2) + '00', s)
    fmt = "%Y-%m-%d %H:%M:%S.%f%z" if '.' in s else "%Y-%m-%d %H:%M:%S%z"
    dt = datetime.strptime(s, fmt)
    return dt.astimezone(timezone.utc)


def floor_hour(dt):
    """Truncate datetime to the hour."""
    return dt.replace(minute=0, second=0, microsecond=0)


def main():
    # device name -> set of hour-floored datetimes
    hour_sets  = defaultdict(set)
    # device name -> (min_dt, max_dt)
    time_range = {}

    print(f"Reading {INPUT_FILE} ...")
    with open(INPUT_FILE, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row["name"].strip()
            raw_dt = row["dt_production"].strip()
            try:
                dt = parse_dt(raw_dt)
            except Exception as e:
                print(f"  [warn] Could not parse '{raw_dt}': {e}")
                continue

            hour_sets[name].add(floor_hour(dt))

            if name not in time_range:
                time_range[name] = [dt, dt]
            else:
                if dt < time_range[name][0]:
                    time_range[name][0] = dt
                if dt > time_range[name][1]:
                    time_range[name][1] = dt

    print(f"Processed {len(hour_sets)} devices.\n")

    # Compute stats per device
    stats = {}
    for name, (start, end) in time_range.items():
        total_hours = int((end - start).total_seconds() // 3600) + 1
        hours_with_data = len(hour_sets[name])
        missing_hours = max(0, total_hours - hours_with_data)
        stats[name] = {
            "data_start":      start.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "data_end":        end.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "total_hours":     total_hours,
            "hours_with_data": hours_with_data,
            "missing_hours":   missing_hours,
        }
        if missing_hours > 0:
            pct = missing_hours / total_hours * 100
            print(f"  {name:10s}  {missing_hours:4d} missing / {total_hours:4d} total  ({pct:.1f}%)")

    # Add columns to devices table if they don't exist
    con = sqlite3.connect(OUTPUT_DB)
    cur = con.cursor()
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

    # Update each device row
    updated = 0
    for name, s in stats.items():
        cur.execute("""
            UPDATE devices
            SET data_start      = ?,
                data_end        = ?,
                total_hours     = ?,
                hours_with_data = ?,
                missing_hours   = ?
            WHERE name = ?
        """, (s["data_start"], s["data_end"], s["total_hours"], s["hours_with_data"], s["missing_hours"], name))
        updated += cur.rowcount

    con.commit()

    # Summary
    cur.execute("SELECT SUM(missing_hours), SUM(total_hours) FROM devices WHERE total_hours IS NOT NULL")
    total_missing, total_span = cur.fetchone()
    con.close()

    print(f"\nUpdated {updated} devices in {OUTPUT_DB}")
    print(f"Total missing hours across all devices: {total_missing} / {total_span} ({total_missing/total_span*100:.1f}%)")


if __name__ == "__main__":
    main()

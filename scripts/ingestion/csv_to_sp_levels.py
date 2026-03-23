#!/usr/bin/env python3
"""
Read raw CSV and populate the sp_levels table in data/SPL.db.

sp_levels columns:
  id         INTEGER PRIMARY KEY
  device_id  INTEGER  FK -> devices(id)
  timestamp  TEXT     'dd-mm-yyyy hh:00' in Estonian time (Europe/Tallinn)
  value      REAL     median of all readings in that hour for that device
"""

import csv
import sqlite3
import os
import re
import statistics
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

INPUT_FILE = os.path.join(os.path.dirname(__file__), "../data/raw/all_acoustic_sensor_data_230501_230831.csv")
OUTPUT_DB  = os.path.join(os.path.dirname(__file__), "../data/SPL.db")

TALLINN = ZoneInfo("Europe/Tallinn")


def parse_dt(s):
    s = s.strip()
    s = re.sub(r'([+-])(\d{2}):(\d{2})$', lambda m: m.group(1) + m.group(2) + m.group(3), s)
    s = re.sub(r'([+-])(\d{2})$',         lambda m: m.group(1) + m.group(2) + '00', s)
    fmt = "%Y-%m-%d %H:%M:%S.%f%z" if '.' in s else "%Y-%m-%d %H:%M:%S%z"
    return datetime.strptime(s, fmt)


def floor_to_hour_tallinn(dt):
    """Convert to Tallinn time and truncate to hour, return formatted string."""
    dt_tallinn = dt.astimezone(TALLINN)
    return dt_tallinn.strftime("%d-%m-%Y %H:00")


def main():
    # Load device name -> id mapping from DB
    con = sqlite3.connect(OUTPUT_DB)
    cur = con.cursor()
    device_map = {row[0]: row[1] for row in cur.execute("SELECT name, id FROM devices")}
    print(f"Loaded {len(device_map)} devices from DB.")

    # Create sp_levels table
    cur.execute("DROP TABLE IF EXISTS sp_levels")
    cur.execute("""
        CREATE TABLE sp_levels (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER NOT NULL REFERENCES devices(id),
            timestamp TEXT    NOT NULL,
            value     REAL    NOT NULL
        )
    """)
    con.commit()

    # Aggregate: (device_id, timestamp_str) -> list of values
    print(f"Reading {INPUT_FILE} ...")
    buckets = defaultdict(list)
    skipped = 0

    with open(INPUT_FILE, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row["name"].strip()
            device_id = device_map.get(name)
            if device_id is None:
                skipped += 1
                continue
            try:
                dt = parse_dt(row["dt_production"])
                val = float(row["value"])
            except Exception:
                skipped += 1
                continue

            ts = floor_to_hour_tallinn(dt)
            buckets[(device_id, ts)].append(val)

    print(f"Aggregating {len(buckets)} (device, hour) buckets ...")

    rows = [
        (device_id, ts, statistics.median(vals))
        for (device_id, ts), vals in sorted(buckets.items())
    ]

    cur.executemany(
        "INSERT INTO sp_levels (device_id, timestamp, value) VALUES (?, ?, ?)", rows
    )
    con.commit()
    con.close()

    print(f"Done. {len(rows)} rows inserted into sp_levels. {skipped} raw rows skipped.")


if __name__ == "__main__":
    main()

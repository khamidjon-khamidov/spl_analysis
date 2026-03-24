#!/usr/bin/env python3
"""
Read raw CSV and populate the sp_levels table in data/SPL.db.

sp_levels columns:
  id          INTEGER PRIMARY KEY
  device_id   INTEGER  FK -> devices(id)
  timestamp   TEXT     'dd-mm-yyyy hh:00' in Estonian time (Europe/Tallinn)
  ts_indexed  INTEGER  Unix timestamp (UTC seconds) of the hour — indexed for fast range queries
  value       REAL     median of all readings in that hour for that device
  imputed     INTEGER  0 for all original readings
"""

import csv
import sqlite3
import os
import re
import statistics
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

INPUT_FILE = os.path.join(os.path.dirname(__file__), "../../data/raw/all_acoustic_sensor_data_210901_211231.csv")
OUTPUT_DB  = os.path.join(os.path.dirname(__file__), "../../data/SPL.db")

TALLINN = ZoneInfo("Europe/Tallinn")


def parse_dt(s):
    s = s.strip()
    s = re.sub(r'([+-])(\d{2}):(\d{2})$', lambda m: m.group(1) + m.group(2) + m.group(3), s)
    s = re.sub(r'([+-])(\d{2})$',         lambda m: m.group(1) + m.group(2) + '00', s)
    fmt = "%Y-%m-%d %H:%M:%S.%f%z" if '.' in s else "%Y-%m-%d %H:%M:%S%z"
    return datetime.strptime(s, fmt)


def floor_to_hour_tallinn(dt):
    """Convert to Tallinn time, truncate to hour.
    Returns (timestamp_str 'dd-mm-yyyy hh:00', unix_timestamp int).
    """
    dt_tallinn = dt.astimezone(TALLINN).replace(minute=0, second=0, microsecond=0)
    ts_str     = dt_tallinn.strftime("%d-%m-%Y %H:00")
    ts_unix    = int(dt_tallinn.timestamp())
    return ts_str, ts_unix


def main():
    con = sqlite3.connect(OUTPUT_DB)
    cur = con.cursor()
    device_map = {row[0]: row[1] for row in cur.execute("SELECT name, id FROM devices")}
    print(f"Loaded {len(device_map)} devices from DB.")

    cur.execute("DROP TABLE IF EXISTS sp_levels")
    cur.execute("""
        CREATE TABLE sp_levels (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id   INTEGER NOT NULL REFERENCES devices(id),
            timestamp   TEXT    NOT NULL,
            ts_indexed  INTEGER NOT NULL,
            value       REAL    NOT NULL,
            imputed     INTEGER NOT NULL DEFAULT 0
        )
    """)
    cur.execute("CREATE INDEX idx_sp_levels_ts ON sp_levels (ts_indexed)")
    cur.execute("CREATE INDEX idx_sp_levels_device ON sp_levels (device_id)")
    con.commit()

    print(f"Reading {INPUT_FILE} ...")
    buckets = defaultdict(list)   # (device_id, ts_str, ts_unix) -> [values]
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
                dt  = parse_dt(row["dt_production"])
                val = float(row["value"])
            except Exception:
                skipped += 1
                continue

            ts_str, ts_unix = floor_to_hour_tallinn(dt)
            buckets[(device_id, ts_str, ts_unix)].append(val)

    print(f"Aggregating {len(buckets)} (device, hour) buckets ...")

    rows = [
        (device_id, ts_str, ts_unix, round(statistics.median(vals)), 0)
        for (device_id, ts_str, ts_unix), vals in sorted(buckets.items())
    ]

    cur.executemany(
        "INSERT INTO sp_levels (device_id, timestamp, ts_indexed, value, imputed) VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    con.commit()
    con.close()

    print(f"Done. {len(rows)} rows inserted into sp_levels. {skipped} raw rows skipped.")


if __name__ == "__main__":
    main()

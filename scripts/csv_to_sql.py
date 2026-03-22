#!/usr/bin/env python3
"""
Extract unique devices from the raw CSV and save to data/SPL.db (devices table).

CSV columns: name, fk_event_type, value, dt_production, fk_device_type, latitude, longitude

Behaviour:
  - Duplicate device names are merged into one row using the first seen coordinates.
  - If a device's coordinates change across records, a warning is printed.
  - The devices table gets an auto-assigned integer id.
"""

import csv
import sqlite3
import os

INPUT_FILE = os.path.join(os.path.dirname(__file__), "../data/raw/all_acoustic_sensor_data_230501_230831.csv")
OUTPUT_DB  = os.path.join(os.path.dirname(__file__), "../data/SPL.db")

# Tolerance in degrees (~1 metre at these latitudes)
COORD_TOLERANCE = 1e-5


def coords_differ(lat1, lon1, lat2, lon2):
    return abs(lat1 - lat2) > COORD_TOLERANCE or abs(lon1 - lon2) > COORD_TOLERANCE


def main():
    os.makedirs(os.path.dirname(OUTPUT_DB), exist_ok=True)

    # name -> (lat, lon, coord_changed, list_of_seen_coords)
    devices = {}

    print(f"Reading {INPUT_FILE} ...")
    with open(INPUT_FILE, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row["name"].strip()
            try:
                lat = float(row["latitude"])
                lon = float(row["longitude"])
            except ValueError:
                continue

            if name not in devices:
                devices[name] = {"lat": lat, "lon": lon, "coord_changed": False}
            else:
                stored = devices[name]
                if not stored["coord_changed"] and coords_differ(stored["lat"], stored["lon"], lat, lon):
                    stored["coord_changed"] = True
                    print(
                        f"  [warn] '{name}' coordinate changed: "
                        f"({stored['lat']:.6f}, {stored['lon']:.6f}) -> ({lat:.6f}, {lon:.6f})"
                    )

    print(f"\nUnique devices found: {len(devices)}")

    moved = [n for n, d in devices.items() if d["coord_changed"]]
    if moved:
        print(f"Devices with coordinate changes ({len(moved)}): {', '.join(moved)}")
    else:
        print("No devices had coordinate changes.")

    # Build rows: auto id, name, lat, lon
    rows = [
        (i + 1, name, data["lat"], data["lon"])
        for i, (name, data) in enumerate(sorted(devices.items()))
    ]

    # Write SQLite
    if os.path.exists(OUTPUT_DB):
        os.remove(OUTPUT_DB)
    con = sqlite3.connect(OUTPUT_DB)
    cur = con.cursor()
    cur.execute("""
        CREATE TABLE devices (
            id      INTEGER PRIMARY KEY,
            name    TEXT    NOT NULL UNIQUE,
            lat     REAL    NOT NULL,
            long    REAL    NOT NULL
        )
    """)
    cur.executemany("INSERT INTO devices (id, name, lat, long) VALUES (?, ?, ?, ?)", rows)
    con.commit()
    con.close()

    print(f"\nSQLite DB written: {OUTPUT_DB}")
    print(f"Done. {len(rows)} devices saved.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Adds per-imputation-method coverage columns to the devices table.

For each method, counts how many rows exist in the imputation table
per device and stores it alongside the existing original coverage stats.

Columns added/updated in devices:
  hist_hours_filled     INTEGER  rows in spl_levels_historical_imp for this device
  knn_hours_filled      INTEGER  rows in spl_levels_knn_imp for this device
  combined_hours_filled INTEGER  rows in spl_levels_combined_imp for this device
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "../../data/SPL.db")

METHODS = [
    ("hist_hours_filled",     "spl_levels_historical_imp"),
    ("knn_hours_filled",      "spl_levels_knn_imp"),
    ("combined_hours_filled", "spl_levels_combined_imp"),
]


def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # Add columns if not present
    existing = {row[1] for row in cur.execute("PRAGMA table_info(devices)")}
    for col, _ in METHODS:
        if col not in existing:
            cur.execute(f"ALTER TABLE devices ADD COLUMN {col} INTEGER")
    con.commit()

    for col, table in METHODS:
        print(f"Computing {col} from {table} …")
        cur.execute(f"""
            UPDATE devices
            SET {col} = (
                SELECT COUNT(*) FROM {table}
                WHERE {table}.device_id = devices.id
            )
        """)
        con.commit()
        print(f"  Done. {cur.rowcount} devices updated.")

    # Summary
    cur.execute("""
        SELECT
            AVG(CAST(hist_hours_filled     AS REAL) / total_hours) * 100,
            AVG(CAST(knn_hours_filled      AS REAL) / total_hours) * 100,
            AVG(CAST(combined_hours_filled AS REAL) / total_hours) * 100
        FROM devices WHERE total_hours > 0
    """)
    h, k, c = cur.fetchone()
    print(f"\nAverage fill rate across all devices:")
    print(f"  Historical: {h:.1f}%")
    print(f"  KNN:        {k:.1f}%")
    print(f"  Combined:   {c:.1f}%")

    con.close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Adds an 'imputed' column to spl_levels_historical_imp.
Sets imputed = 0 if (device_id, timestamp) exists in sp_levels,
sets imputed = 1 if it does not (i.e. the value was imputed).
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "../../data/SPL.db")


def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # Add column if not already present
    existing = {row[1] for row in cur.execute("PRAGMA table_info(spl_levels_historical_imp)")}
    if "imputed" not in existing:
        cur.execute("ALTER TABLE spl_levels_historical_imp ADD COLUMN imputed INTEGER NOT NULL DEFAULT 0")
        print("Column 'imputed' added.")
    else:
        print("Column 'imputed' already exists, updating values.")

    # Set imputed = 0 where (device_id, timestamp) exists in sp_levels
    cur.execute("""
        UPDATE spl_levels_historical_imp
        SET imputed = 0
        WHERE EXISTS (
            SELECT 1 FROM sp_levels s
            WHERE s.device_id = spl_levels_historical_imp.device_id
              AND s.timestamp  = spl_levels_historical_imp.timestamp
        )
    """)
    original_count = cur.rowcount

    # Set imputed = 1 where (device_id, timestamp) does NOT exist in sp_levels
    cur.execute("""
        UPDATE spl_levels_historical_imp
        SET imputed = 1
        WHERE NOT EXISTS (
            SELECT 1 FROM sp_levels s
            WHERE s.device_id = spl_levels_historical_imp.device_id
              AND s.timestamp  = spl_levels_historical_imp.timestamp
        )
    """)
    imputed_count = cur.rowcount

    con.commit()
    con.close()

    print(f"Done.")
    print(f"  imputed = 0 (original): {original_count}")
    print(f"  imputed = 1 (imputed):  {imputed_count}")


if __name__ == "__main__":
    main()

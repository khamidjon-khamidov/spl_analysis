#!/usr/bin/env python3
"""
Rounds the value column to integers in both sp_levels and spl_levels_historical_imp.
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "../../data/SPL.db")


def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    for table in ("sp_levels", "spl_levels_historical_imp"):
        cur.execute(f"UPDATE {table} SET value = ROUND(value)")
        print(f"{table}: {cur.rowcount} rows updated.")

    con.commit()
    con.close()
    print("Done.")


if __name__ == "__main__":
    main()

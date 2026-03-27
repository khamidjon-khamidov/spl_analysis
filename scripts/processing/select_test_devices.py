#!/usr/bin/env python3
"""
Select 30–50 test devices for imputation evaluation.

All eligible devices must have < 5% original missing rate so that masking
leaves ample ground-truth readings for stable MAE/RMSE computation.

Stratified across three groups to ensure diversity across evaluation scenarios:

  Group A — Well-connected, long history
             Low KNN isolation (< 20%) AND total_hours above Q1.
             These are the "easy" benchmark sensors — plenty of neighbours
             and a full history record. Methods should perform best here.

  Group B — Spatially isolated
             High KNN isolation (top-N by isolation score).
             KNN struggles here; historical and TimesFM should shine.

  Group C — Short history
             total_hours in bottom quartile of the eligible pool.
             Historical median struggles here (cold-start); KNN and
             TimesFM should outperform it.

Isolation metric:
  knn_isolation = 1 - (knn_newly_filled / missing_hours)
  knn_newly_filled = knn_hours_filled - hours_with_data
  0.0 = KNN filled all gaps  |  1.0 = KNN filled none of the gaps

Adds an `is_test` INTEGER column to devices (1 = test, 0 = not test).
Prints a summary table of selected devices and group breakdown.
Random seed is fixed for reproducibility.
"""

import sqlite3
import os
import random

DB_PATH     = os.path.join(os.path.dirname(__file__), "../../data/SPL.db")
RANDOM_SEED = 42

MAX_MISSING_RATE   = 0.05   # only devices with < 5% original missing
MIN_ORIGINAL_HOURS = 300    # and at least 300 ground-truth readings

# Target group sizes
N_CONNECTED = 15   # Group A — well-connected, long history
N_ISOLATED  = 10   # Group B — spatially isolated
N_SHORT     = 10   # Group C — short history


def pick(pool, n, already_selected):
    """Pick up to n devices from pool that are not already selected."""
    candidates = [d for d in pool if d["id"] not in already_selected]
    random.shuffle(candidates)
    return candidates[:n]


def main():
    random.seed(RANDOM_SEED)

    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    # ── Add is_test and test_group columns if missing ────────────────────────
    existing_cols = {row[1] for row in cur.execute("PRAGMA table_info(devices)")}
    if "is_test" not in existing_cols:
        cur.execute("ALTER TABLE devices ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0")
        con.commit()
        print("Added column: is_test")
    if "test_group" not in existing_cols:
        cur.execute("ALTER TABLE devices ADD COLUMN test_group TEXT")
        con.commit()
        print("Added column: test_group")

    # Reset any prior selection
    cur.execute("UPDATE devices SET is_test = 0, test_group = NULL")
    con.commit()
    print("Reset existing is_test / test_group columns.")

    # ── Load all eligible devices ─────────────────────────────────────────────
    cur.execute("""
        SELECT
            d.id,
            d.name,
            d.total_hours,
            d.hours_with_data,
            d.missing_hours,
            d.knn_hours_filled,
            CAST(d.missing_hours AS REAL) / d.total_hours AS missing_rate
        FROM devices d
        WHERE d.total_hours  IS NOT NULL
          AND d.hours_with_data >= ?
          AND CAST(d.missing_hours AS REAL) / d.total_hours < ?
        ORDER BY d.id
    """, (MIN_ORIGINAL_HOURS, MAX_MISSING_RATE))
    all_devices = [dict(row) for row in cur.fetchall()]

    # Compute isolation score for each device:
    #   knn_isolation = fraction of missing hours that KNN could NOT fill
    #   0.0 = KNN filled all gaps (well-connected)
    #   1.0 = KNN filled none of the gaps (truly isolated)
    for d in all_devices:
        if d["missing_hours"] > 0:
            knn_newly_filled = max(0, d["knn_hours_filled"] - d["hours_with_data"])
            d["knn_isolation"] = 1.0 - knn_newly_filled / d["missing_hours"]
        else:
            d["knn_isolation"] = 0.0

    print(f"\nEligible devices (< {MAX_MISSING_RATE*100:.0f}% missing, "
          f">= {MIN_ORIGINAL_HOURS} original hours): {len(all_devices)}")

    # ── Partition into groups ─────────────────────────────────────────────────
    # Short history: sensors active for less than half the study period (~1464 h)
    # These clearly started mid-period and stress the historical method's cold-start.
    SHORT_HISTORY_MAX = 2000
    group_short = [d for d in all_devices if d["total_hours"] <= SHORT_HISTORY_MAX]

    # Long-history pool: everything else (full or near-full duration sensors)
    long_history = [d for d in all_devices if d["total_hours"] > SHORT_HISTORY_MAX]

    # Group A: most well-connected — lowest knn_isolation, long history
    # Sort ascending by isolation so the most connected are first
    group_connected = sorted(long_history, key=lambda d: d["knn_isolation"])

    # Group B: most isolated — highest knn_isolation, long history,
    # at least 10 missing hours so isolation score is meaningful
    group_isolated = sorted(
        [d for d in long_history if d["missing_hours"] >= 10],
        key=lambda d: d["knn_isolation"], reverse=True
    )

    print(f"\nGroup A — Well-connected, long history: {len(group_connected)} candidates "
          f"(lowest isolation first: {group_connected[0]['knn_isolation']:.1%})")
    print(f"Group B — Spatially isolated (sorted):  {len(group_isolated)} candidates "
          f"(highest isolation first: {group_isolated[0]['knn_isolation']:.1%})")
    print(f"Group C — Short history (<=2000 h):     {len(group_short)} candidates")

    # ── Select devices, avoiding duplicates across groups ────────────────────
    selected = {}   # id -> device dict

    def select_group(pool, n, label):
        chosen = pick(pool, n, selected)
        for d in chosen:
            d["group"] = label
            selected[d["id"]] = d
        print(f"  {label}: picked {len(chosen)} / {n} requested")
        return chosen

    print("\nSelecting:")
    select_group(group_connected, N_CONNECTED, "A-Connected")
    select_group(group_isolated,  N_ISOLATED,  "B-Isolated")
    select_group(group_short,     N_SHORT,     "C-ShortHistory")

    total = len(selected)
    print(f"\nTotal test devices selected: {total}")

    # ── Write is_test = 1 and test_group to DB ───────────────────────────────
    cur.executemany(
        "UPDATE devices SET is_test = 1, test_group = ? WHERE id = ?",
        [(d["group"], d["id"]) for d in selected.values()]
    )
    con.commit()

    # ── Print summary table ───────────────────────────────────────────────────
    print(f"\n{'ID':>4}  {'Name':<35}  {'Group':<16}  {'TotalH':>6}  {'Missing%':>8}  {'KNN isolation':>13}")
    print("-" * 92)
    for d in sorted(selected.values(), key=lambda x: x["group"] + x["name"]):
        print(
            f"{d['id']:>4}  {d['name']:<35}  {d['group']:<16}  "
            f"{d['total_hours']:>6}  {d['missing_rate']*100:>7.1f}%  {d['knn_isolation']:>12.1%}"
        )

    con.close()
    print(f"\nDone. {total} devices marked is_test = 1 in devices table.")


if __name__ == "__main__":
    main()

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import sqlite3
import csv
import os

DB_PATH      = os.path.join(os.path.dirname(__file__), "../data/SPL.db")
SUMMARY_CSV  = os.path.join(os.path.dirname(__file__), "../data/evaluation_summary.csv")
RESULTS_CSV  = os.path.join(os.path.dirname(__file__), "../data/evaluation_results.csv")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def resolve_table(source: str) -> str:
    if source == "historical":
        return "spl_levels_historical_imp"
    if source == "knn":
        return "spl_levels_knn_imp"
    if source == "combined":
        return "spl_levels_combined_imp"
    if source == "timesfm":
        return "spl_levels_timesfm_imp"
    return "sp_levels"


@app.get("/spl/static")
def get_spl_static(
    timestamp: str = Query(..., description="dd-mm-yyyy hh:00"),
    source: str = Query("original", description="original | historical"),
):
    table = resolve_table(source)
    con = get_db()
    rows = con.execute(f"""
        SELECT d.id, d.name, d.lat, d.long, s.value, s.imputed
        FROM {table} s
        JOIN devices d ON d.id = s.device_id
        WHERE s.timestamp = ?
    """, (timestamp,)).fetchall()
    con.close()
    return [dict(row) for row in rows]


@app.get("/spl/range")
def get_spl_range(
    start:  str = Query(..., description="dd-mm-yyyy"),
    end:    str = Query(..., description="dd-mm-yyyy"),
    source: str = Query("original", description="original | historical"),
):
    def to_date(s):
        try:
            d, m, y = s.split("-")
            return datetime(int(y), int(m), int(d))
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid date: '{s}'. Expected dd-mm-yyyy.")

    start_dt = to_date(start)
    end_dt   = to_date(end)
    if end_dt < start_dt:
        raise HTTPException(status_code=400, detail="end must be >= start")

    slots = []
    cur_dt = start_dt
    while cur_dt <= end_dt:
        for h in range(24):
            slots.append(cur_dt.strftime("%d-%m-%Y") + f" {h:02d}:00")
        cur_dt += timedelta(days=1)

    table = resolve_table(source)
    con = get_db()
    rows = con.execute(f"""
        SELECT d.id, d.name, d.lat, d.long, s.timestamp, s.value, s.imputed
        FROM {table} s
        JOIN devices d ON d.id = s.device_id
        WHERE s.timestamp >= ? AND s.timestamp <= ?
    """, (slots[0], slots[-1])).fetchall()
    con.close()

    by_ts = {}
    for row in rows:
        ts = row["timestamp"]
        by_ts.setdefault(ts, []).append({
            "id": row["id"], "name": row["name"],
            "lat": row["lat"], "long": row["long"], "value": row["value"],
            "imputed": row["imputed"]
        })
    return [{"timestamp": ts, "readings": by_ts.get(ts, [])} for ts in slots]


@app.get("/spl/device/{device_id}")
def get_spl_device(
    device_id: int,
    source: str = Query("original", description="original | historical"),
):
    table = resolve_table(source)
    con = get_db()
    rows = con.execute(f"""
        SELECT timestamp, value, imputed
        FROM {table}
        WHERE device_id = ?
        ORDER BY timestamp
    """, (device_id,)).fetchall()
    con.close()
    return [dict(row) for row in rows]


@app.get("/spl/date-range")
def get_date_range():
    con = get_db()
    row = con.execute("SELECT MIN(ts_indexed), MAX(ts_indexed) FROM sp_levels").fetchone()
    con.close()
    if not row or row[0] is None:
        raise HTTPException(status_code=404, detail="No data in sp_levels")
    tallinn = ZoneInfo("Europe/Tallinn")
    min_date = datetime.fromtimestamp(row[0], tz=tallinn).strftime("%Y-%m-%d")
    max_date = datetime.fromtimestamp(row[1], tz=tallinn).strftime("%Y-%m-%d")
    return {"min_date": min_date, "max_date": max_date}


@app.get("/analysis/by-hour")
def get_by_hour(source: str = Query("original")):
    """Average SPL per hour-of-day, split by weekday vs weekend (Tallinn local time)."""
    table = resolve_table(source)
    con = get_db()
    rows = con.execute(f"""
        SELECT
            CAST(substr(timestamp, 12, 2) AS INTEGER) AS hour,
            strftime('%w',
                substr(timestamp, 7, 4) || '-' ||
                substr(timestamp, 4, 2) || '-' ||
                substr(timestamp, 1, 2)
            ) AS dow,
            AVG(value) AS avg_spl,
            COUNT(*)   AS n
        FROM {table}
        GROUP BY hour, dow
    """).fetchall()
    con.close()
    by_hour = {}
    for r in rows:
        h = r["hour"]
        if h not in by_hour:
            by_hour[h] = {"hour": h, "wd_sum": 0, "wd_n": 0, "we_sum": 0, "we_n": 0}
        if r["dow"] in ("0", "6"):
            by_hour[h]["we_sum"] += r["avg_spl"] * r["n"]
            by_hour[h]["we_n"]  += r["n"]
        else:
            by_hour[h]["wd_sum"] += r["avg_spl"] * r["n"]
            by_hour[h]["wd_n"]  += r["n"]
    return [
        {
            "hour":    h,
            "weekday": round(d["wd_sum"] / d["wd_n"], 2) if d["wd_n"] else None,
            "weekend": round(d["we_sum"] / d["we_n"], 2) if d["we_n"] else None,
        }
        for h, d in sorted(by_hour.items())
    ]


@app.get("/analysis/dow-hour-heatmap")
def get_dow_hour_heatmap(source: str = Query("original")):
    """Average SPL per (day-of-week, hour) cell for a 7×24 heatmap."""
    table = resolve_table(source)
    con = get_db()
    rows = con.execute(f"""
        SELECT
            CAST(strftime('%w',
                substr(timestamp, 7, 4) || '-' ||
                substr(timestamp, 4, 2) || '-' ||
                substr(timestamp, 1, 2)
            ) AS INTEGER)                       AS dow,
            CAST(substr(timestamp, 12, 2) AS INTEGER) AS hour,
            ROUND(AVG(value), 2)                AS avg_spl
        FROM {table}
        GROUP BY dow, hour
    """).fetchall()
    con.close()
    return [dict(r) for r in rows]


@app.get("/analysis/distribution")
def get_distribution(source: str = Query("original")):
    """Count of readings per 2-dB bucket from 28 to 94 dB."""
    table = resolve_table(source)
    con = get_db()
    rows = con.execute(f"""
        SELECT
            (CAST(value AS INTEGER) / 2) * 2 AS bucket,
            COUNT(*)                          AS count
        FROM {table}
        GROUP BY bucket
        ORDER BY bucket
    """).fetchall()
    con.close()
    return [dict(r) for r in rows]


@app.get("/analysis/daily-trend")
def get_daily_trend(source: str = Query("original")):
    """Daily average SPL across all devices over the study period."""
    table = resolve_table(source)
    con = get_db()
    rows = con.execute(f"""
        SELECT
            substr(timestamp, 7, 4) || '-' ||
            substr(timestamp, 4, 2) || '-' ||
            substr(timestamp, 1, 2)  AS date_iso,
            substr(timestamp, 1, 10) AS date_display,
            ROUND(AVG(value), 2)     AS avg_spl,
            COUNT(*)                 AS n
        FROM {table}
        GROUP BY date_iso
        ORDER BY date_iso
    """).fetchall()
    con.close()
    return [dict(r) for r in rows]


@app.get("/analysis/tier-over-time")
def get_tier_over_time(source: str = Query("original")):
    """Per-day count of device-hours in each WHO noise tier."""
    table = resolve_table(source)
    con = get_db()
    rows = con.execute(f"""
        SELECT
            substr(timestamp, 7, 4) || '-' ||
            substr(timestamp, 4, 2) || '-' ||
            substr(timestamp, 1, 2)  AS date_iso,
            substr(timestamp, 1, 10) AS date_display,
            SUM(CASE WHEN value < 45             THEN 1 ELSE 0 END) AS safe,
            SUM(CASE WHEN value >= 45 AND value < 55 THEN 1 ELSE 0 END) AS acceptable,
            SUM(CASE WHEN value >= 55 AND value < 65 THEN 1 ELSE 0 END) AS moderate,
            SUM(CASE WHEN value >= 65 AND value < 75 THEN 1 ELSE 0 END) AS high,
            SUM(CASE WHEN value >= 75             THEN 1 ELSE 0 END) AS dangerous,
            COUNT(*) AS total
        FROM {table}
        GROUP BY date_iso
        ORDER BY date_iso
    """).fetchall()
    con.close()
    return [dict(r) for r in rows]


@app.get("/analysis/device-ranking")
def get_device_ranking(source: str = Query("original")):
    """Top 15 loudest and quietest devices by average SPL."""
    table = resolve_table(source)
    con = get_db()
    rows = con.execute(f"""
        SELECT
            d.id, d.name, d.lat, d.long,
            ROUND(AVG(s.value), 2) AS avg_spl,
            COUNT(*)               AS n
        FROM {table} s
        JOIN devices d ON d.id = s.device_id
        GROUP BY s.device_id
        HAVING COUNT(*) >= 100
        ORDER BY avg_spl DESC
    """).fetchall()
    con.close()
    all_rows = [dict(r) for r in rows]
    return {
        "loudest":  all_rows[:15],
        "quietest": all_rows[-15:][::-1],
    }


@app.get("/evaluation/summary")
def get_evaluation_summary():
    if not os.path.exists(SUMMARY_CSV):
        raise HTTPException(status_code=404, detail="evaluation_summary.csv not found")
    with open(SUMMARY_CSV, newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["n"]    = int(r["n"])
        r["mae"]  = float(r["mae"])  if r["mae"]  else None
        r["rmse"] = float(r["rmse"]) if r["rmse"] else None
    return rows


@app.get("/evaluation/per-device")
def get_evaluation_per_device():
    if not os.path.exists(RESULTS_CSV):
        raise HTTPException(status_code=404, detail="evaluation_results.csv not found")
    methods = ["historical", "knn", "combined", "timesfm"]
    device_stats = {}
    with open(RESULTS_CSV, newline="") as f:
        for row in csv.DictReader(f):
            key = (int(row["device_id"]), row["name"], row["group"])
            if key not in device_stats:
                device_stats[key] = {m: [] for m in methods}
            true_val = float(row["true_value"])
            for m in methods:
                if row[m]:
                    device_stats[key][m].append(abs(true_val - float(row[m])))

    result = []
    for (device_id, name, group), errs in device_stats.items():
        entry = {"device_id": device_id, "name": name, "group": group}
        for m in methods:
            vals = errs[m]
            entry[f"{m}_mae"]  = round(sum(vals) / len(vals), 3) if vals else None
            entry[f"{m}_n"]    = len(vals)
        result.append(entry)
    result.sort(key=lambda x: x["name"])
    return result


@app.get("/devices/all")
def get_all_devices():
    con = get_db()
    rows = con.execute("""
        SELECT id, name, lat, long,
               data_start, data_end,
               total_hours, hours_with_data, missing_hours,
               hist_hours_filled, knn_hours_filled, combined_hours_filled, timesfm_hours_filled,
               is_test
        FROM devices
    """).fetchall()
    con.close()
    return [dict(row) for row in rows]

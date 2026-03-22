from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "../data/SPL.db")

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


@app.get("/spl/static")
def get_spl_static(timestamp: str = Query(..., description="dd-mm-yyyy hh:00")):
    con = get_db()
    rows = con.execute("""
        SELECT d.id, d.name, d.lat, d.long, s.value
        FROM sp_levels s
        JOIN devices d ON d.id = s.device_id
        WHERE s.timestamp = ?
    """, (timestamp,)).fetchall()
    con.close()
    return [dict(row) for row in rows]


@app.get("/spl/range")
def get_spl_range(
    start: str = Query(..., description="dd-mm-yyyy"),
    end:   str = Query(..., description="dd-mm-yyyy"),
):
    from datetime import datetime, timedelta
    from fastapi import HTTPException
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

    # Build list of all timestamps in range ("dd-mm-yyyy hh:00")
    slots = []
    cur_dt = start_dt
    while cur_dt <= end_dt:
        for h in range(24):
            slots.append(cur_dt.strftime("%d-%m-%Y") + f" {h:02d}:00")
        cur_dt += timedelta(days=1)

    con = get_db()
    rows = con.execute("""
        SELECT d.id, d.name, d.lat, d.long, s.timestamp, s.value
        FROM sp_levels s
        JOIN devices d ON d.id = s.device_id
        WHERE s.timestamp >= ? AND s.timestamp <= ?
    """, (slots[0], slots[-1])).fetchall()
    con.close()

    by_ts = {}
    for row in rows:
        ts = row["timestamp"]
        by_ts.setdefault(ts, []).append({
            "id": row["id"], "name": row["name"],
            "lat": row["lat"], "long": row["long"], "value": row["value"]
        })
    # Return ordered list of {timestamp, readings}
    return [{"timestamp": ts, "readings": by_ts.get(ts, [])} for ts in slots]


@app.get("/spl/device/{device_id}")
def get_spl_device(device_id: int):
    con = get_db()
    rows = con.execute("""
        SELECT timestamp, value
        FROM sp_levels
        WHERE device_id = ?
        ORDER BY timestamp
    """, (device_id,)).fetchall()
    con.close()
    return [dict(row) for row in rows]


@app.get("/devices/all")
def get_all_devices():
    con = get_db()
    rows = con.execute("""
        SELECT id, name, lat, long,
               data_start, data_end,
               total_hours, hours_with_data, missing_hours
        FROM devices
    """).fetchall()
    con.close()
    return [dict(row) for row in rows]

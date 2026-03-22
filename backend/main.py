from fastapi import FastAPI
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

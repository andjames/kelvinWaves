#!/usr/bin/env python3
"""Fetch a compact, local NOAA cache for the scrollytelling demo.

The browser demo reads this file only; it never calls NOAA. This script fetches
one product at a time with a short delay, matches six-minute observations to
hourly tide predictions, and stores hourly non-tidal residuals in centimeters.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
STATIONS = [
    ("San Diego", "9410170", 0), ("Los Angeles", "9410660", 120),
    ("Santa Barbara", "9411340", 205), ("Port San Luis", "9412110", 295),
    ("Monterey", "9413450", 405), ("San Francisco", "9414290", 505),
    ("Point Reyes", "9415020", 555), ("Arena Cove", "9416841", 645),
    ("North Spit", "9418767", 805), ("Crescent City", "9419750", 950),
]


def chunks(start: dt.date, end: dt.date):
    cursor = start
    while cursor <= end:
        stop = min(cursor + dt.timedelta(days=28), end)
        yield cursor, stop
        cursor = stop + dt.timedelta(days=1)


def request(product: str, station_id: str, begin: dt.date, end: dt.date):
    params = {
        "product": product, "application": "pacific_pulse", "station": station_id,
        "begin_date": begin.strftime("%Y%m%d"), "end_date": end.strftime("%Y%m%d"),
        "datum": "MLLW", "time_zone": "gmt", "units": "metric", "format": "json",
    }
    if product == "predictions":
        params["interval"] = "h"
    url = f"{API}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=60) as response:
        payload = json.load(response)
    if payload.get("error"):
        raise RuntimeError(payload["error"].get("message", "NOAA API error"))
    return payload.get("predictions") if product == "predictions" else payload.get("data", [])


def finite(value):
    try:
        return value not in (None, "") and float(value) == float(value)
    except (TypeError, ValueError):
        return False


def fetch_station(name, station_id, miles, start, end):
    observed, predictions = [], []
    for begin, stop in chunks(start, end):
        observed.extend(request("water_level", station_id, begin, stop) or [])
        time.sleep(0.25)
        predictions.extend(request("predictions", station_id, begin, stop) or [])
        time.sleep(0.25)
    tides = {row["t"][:13]: float(row["v"]) for row in predictions if row.get("t") and finite(row.get("v"))}
    values = defaultdict(list)
    for row in observed:
        if row.get("t") and finite(row.get("v")):
            values[row["t"][:13]].append(float(row["v"]))
    hours = [{"t": f"{hour}:00:00Z", "r": round((sum(readings) / len(readings) - tides[hour]) * 100, 4)}
             for hour, readings in sorted(values.items()) if hour in tides]
    print(f"{name}: {len(hours)} matched hourly residuals")
    return {"name": name, "id": station_id, "miles": miles, "hours": hours}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2026-08-01")
    parser.add_argument("--end", default=dt.date.today().isoformat())
    parser.add_argument("--output", default="src/data/demo-noaa-cache.json")
    args = parser.parse_args()
    start, end = dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end)
    records = [fetch_station(*station, start, end) for station in STATIONS]
    payload = {"source": "NOAA CO-OPS observed water level minus hourly predictions", "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "start": args.start, "end": args.end, "stations": records}
    output = Path(args.output)
    output.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"Wrote {output} ({output.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Flatten the demo's hourly NOAA residual cache into a portable CSV file."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


FIELDS = (
    "timestamp_utc",
    "station_name",
    "station_id",
    "coast_miles_from_san_diego",
    "residual_cm",
    "source",
    "generated_at",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="src/data/demo-noaa-cache.json")
    parser.add_argument("--output", default="src/data/demo-noaa-cache.csv")
    args = parser.parse_args()

    source = Path(args.input)
    output = Path(args.output)
    payload = json.loads(source.read_text(encoding="utf-8"))
    rows = []
    for station in payload.get("stations", []):
        for hour in station.get("hours", []):
            rows.append({
                "timestamp_utc": hour.get("t"),
                "station_name": station.get("name"),
                "station_id": station.get("id"),
                "coast_miles_from_san_diego": station.get("miles"),
                "residual_cm": hour.get("r"),
                "source": payload.get("source"),
                "generated_at": payload.get("generated_at"),
            })

    rows.sort(key=lambda row: (row["timestamp_utc"] or "", row["coast_miles_from_san_diego"] or 0))
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows):,} hourly station observations to {output}")


if __name__ == "__main__":
    main()

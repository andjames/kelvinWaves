#!/usr/bin/env python3
"""Write a compact Copernicus NRT sea-level-anomaly extract for Pacific Pulse.

Run from the project root:
  python scripts/fetch_satellite_sla.py
"""

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import copernicusmarine

DATASET = "cmems_obs-sl_glo_phy-ssh_nrt_allsat-l4-duacs-0.125deg_P1D"
START = "2026-09-01T00:00:00"
POINTS = [
    ("San Diego offshore", 32.50, -118.00),
    ("Los Angeles offshore", 33.75, -118.50),
    ("Monterey offshore", 36.65, -122.25),
    ("San Francisco offshore", 37.80, -123.00),
]


def require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing {name}; add it to .env and source the file first.")
    return value


def load_dotenv() -> None:
    """Read the two local credentials without requiring shell sourcing."""
    dotenv = Path(".env")
    if not dotenv.exists():
        return
    for line in dotenv.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> None:
    load_dotenv()
    username = require("COPERNICUSMARINE_SERVICE_USERNAME")
    password = require("COPERNICUSMARINE_SERVICE_PASSWORD")
    end = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00")
    dataset = copernicusmarine.open_dataset(
        dataset_id=DATASET,
        username=username,
        password=password,
        variables=["sla"],
        minimum_longitude=-125.0,
        maximum_longitude=-117.0,
        minimum_latitude=32.0,
        maximum_latitude=39.5,
        start_datetime=START,
        end_datetime=end,
        coordinates_selection_method="nearest",
    )
    rows = []
    for station, latitude, longitude in POINTS:
        sample = dataset["sla"].sel(latitude=latitude, longitude=longitude, method="nearest")
        for timestamp, value in zip(sample.time.values, sample.values):
            number = float(value)
            if math.isfinite(number):
                rows.append({
                    "station": station,
                    "date": str(timestamp)[:10],
                    "lat": latitude,
                    "lon": longitude,
                    "sla_cm": round(number * 100, 2),
                })
    payload = {
        "source": "Copernicus Marine / DUACS NRT L4",
        "dataset": DATASET,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "points": rows,
    }
    output = Path("dist/satellite-sla.json")
    output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(rows)} satellite point-days to {output}")


if __name__ == "__main__":
    main()

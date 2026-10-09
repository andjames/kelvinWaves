# Satellite extract contract

The browser calls `GET /api/satellite-sla?start=YYYY-MM-DD&end=YYYY-MM-DD`. A scheduled server-side job subsets Copernicus Marine NRT L4 product `SEALEVEL_GLO_PHY_L4_NRT_008_046` to four fixed offshore California grid cells, then returns only:

```json
{"source":"Copernicus Marine / DUACS NRT L4","updated_at":"2026-10-08T12:00:00Z","points":[{"station":"San Diego offshore","date":"2026-10-08","lat":32.5,"lon":-118.0,"sla_cm":4.2}]}
```

Configure the job with `COPERNICUSMARINE_SERVICE_USERNAME` and `COPERNICUSMARINE_SERVICE_PASSWORD`. Keep both runtime-only; never commit or send them to the browser. Until the endpoint is configured, the site shows an explicit unavailable state rather than sample values.

For this static MVP, create an isolated environment once, then run the extractor:

```bash
rm -rf .venv-satellite
python -m venv .venv-satellite
.venv-satellite/bin/python -m pip install --upgrade pip
.venv-satellite/bin/pip install -r requirements-satellite.txt
.venv-satellite/bin/python scripts/fetch_satellite_sla.py
```

It reads the root `.env`, writes `dist/satellite-sla.json`, and the visualization loads that file when the API endpoint is absent. The isolated environment lets pip install a mutually compatible NumPy 2 scientific stack rather than inherit incompatible compiled packages from Anaconda.

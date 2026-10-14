# Pacific Pulse / Kelvin Waves

A static D3 investigation of non-tidal sea-level residuals at California NOAA tide gauges, with Copernicus satellite context.

## Work from `src/`

`src/` is the editable source tree. `dist/` is generated output for static hosting and should not be edited directly.

```
src/
  index.html                 # Main dashboard entry point
  dashboard/                 # Dashboard chart logic and styles
  demo.html                  # Scrollytelling entry point
  demo/                      # Scene controller, chart hooks, scroll hooks, styles
  data/                      # Local NOAA / Copernicus extracts used by the site
scripts/                     # Data refresh and build scripts
tests/                       # Pipeline and analysis tests
```

## Commands

```sh
npm run build  # Copy src/ to dist/ for deployment
npm run dev    # Build, then serve dist/ at http://localhost:4173
npm test       # Run analysis and pipeline contract tests
```

## Refreshing local data

The browser uses local data extracts to avoid repeatedly querying NOAA. Refresh them, then rebuild:

```sh
python scripts/fetch_demo_noaa_cache.py
python scripts/flatten_demo_noaa_cache.py
python scripts/fetch_satellite_sla.py
npm run build
```

The NOAA cache can also be flattened independently with `npm run data:csv`. Its CSV has one hourly observation per row, ordered by UTC timestamp and coastal distance. The extract scripts write directly to `src/data/`; their results are included in the next static build. Credentials remain in `.env` and are not copied into `dist/`.

The scrollytelling demo prefers the Action-refreshed NOAA JSON on GitHub Raw so an embedded copy can receive daily gauge updates without republishing its host page. It falls back to its bundled `data/demo-noaa-cache.json` during local development or if the remote cache is unavailable.

## Reusable conclusion scene

`src/components/kelvin-conclusion.css` is a self-contained conclusion component. Its markup uses only `kelvin-conclusion*` classes and it supplies its own layout, typography, video treatment, and grain animation. To reuse it elsewhere, copy that CSS file, the corresponding section markup in `src/demo.html`, and a video asset; update the `<source>` path for the destination project.

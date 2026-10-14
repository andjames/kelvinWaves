/*
  Distances are cumulative miles along a hand-traced California shoreline route,
  rather than straight-line station separation. They are deliberately rounded to
  the nearest 5 mi and are useful for chart placement only. A future data update
  should replace `coastMi` with a reproducible NOAA shoreline-polyline calculation
  before publishing any numerical speed result.
*/
const stationRegistry = [
  ['San Diego', '9410170', 0, true],
  ['Los Angeles', '9410660', 120, true],
  ['Santa Barbara', '9411340', 205, false],
  ['Port San Luis', '9412110', 295, false],
  ['Monterey', '9413450', 405, true],
  ['San Francisco', '9414290', 505, true],
  ['Point Reyes', '9415020', 555, false],
  ['Arena Cove', '9416841', 645, false],
  ['North Spit', '9418767', 805, false],
  ['Crescent City', '9419750', 950, false]
];
const stations = stationRegistry.map(([name, id, coastMi, primary]) => ({ name, id, coastMi, mi: coastMi, primary }));
const primaryStations = stations.filter(station => station.primary);

const $ = selector => document.querySelector(selector);
const fmt = d3.utcFormat('%d %b');
const dayKey = d3.utcFormat('%Y-%m-%d');
const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
const pacificDayParts = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const pacificHour = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' });
const fmtPacific = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC_TIME_ZONE, day: '2-digit', month: 'short' });
function pacificDayKey(date) {
  const parts = Object.fromEntries(pacificDayParts.formatToParts(date).filter(d => d.type !== 'literal').map(d => [d.type, d.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function dateFromDayKey(key) { return new Date(`${key}T00:00:00Z`); }
const today = dateFromDayKey(pacificDayKey(new Date()));
const firstDay = new Date(Date.UTC(2026, 7, 1));
const days = d3.utcDay.range(firstDay, d3.utcDay.offset(today, 1));
let series = [], current = days.length - 1, auditSeries = [], showReference = true, propagationWindow = 14, propagationSmoothing = 12, propagationBaseline = 'trailing', propagationMode = 'interpolated', comparisonMode = 'actual', selectedCandidate = null, propagationAnalysis = null;

document.querySelector('.sources h2').textContent = 'Measures over models.';
document.querySelector('.sources p').textContent = 'The main chart requests NOAA CO-OPS water-level observations and tide predictions in your browser. The satellite panel reads a locally generated Copernicus extract for broad offshore context; it does not independently corroborate this candidate signal.';
document.querySelector('.dash-head h2').textContent = 'Northbound residual';
document.querySelector('.chart-card .card-top > span').innerHTML = 'NON-TIDAL SEA-LEVEL RESIDUAL <b>CM</b>';
$('#heatmap').setAttribute('aria-label', 'Latitude versus time chart of California non-tidal sea-level residuals in centimeters');
const calendarPanel = document.createElement('div');
calendarPanel.className = 'calendar-panel';
calendarPanel.innerHTML = '<div class="calendar-heading">CALENDAR VIEW / RESIDUAL INTENSITY</div><div id="calendarHeatmap"></div>';
$('#heatmap').insertAdjacentElement('afterend', calendarPanel);
const calendarStylesheet = document.createElement('link'); calendarStylesheet.rel = 'stylesheet'; calendarStylesheet.href = 'dashboard/calendar.css'; document.head.appendChild(calendarStylesheet);
const propagationPanel = document.createElement('section');
propagationPanel.className = 'propagation-panel'; propagationPanel.id = 'method';
propagationPanel.innerHTML = '<div class="propagation-copy"><div><div class="eyebrow">COASTAL PROPAGATION EXPLORER</div><h2>Do short-term disturbances move north?</h2></div><div><p id="propagationDescription">Color shows a 12-hour residual minus its trailing 14-day local baseline, in 3-hour bins. A warm diagonal moving northward is a possible timing pattern—not proof of a Kelvin wave. The spaces between stations are interpolated from valid gauge pairs.</p></div></div><div id="propagationViz" aria-label="Distance-scaled, south-to-north Hovmöller-style view of filtered coastal residuals"></div><section id="eventAnalysis" class="event-analysis" aria-live="polite"></section><div id="stationDiagnostics" class="station-diagnostics" aria-live="polite"></div>';
calendarPanel.insertAdjacentElement('afterend', propagationPanel);
const propagationStylesheet = document.createElement('link'); propagationStylesheet.rel = 'stylesheet'; propagationStylesheet.href = 'dashboard/propagation.css'; document.head.appendChild(propagationStylesheet);
const auditPanel = document.createElement('section');
auditPanel.className = 'audit-panel';
auditPanel.innerHTML = '<div class="audit-intro"><div class="eyebrow">INPUT AUDIT / VALIDATED COASTAL NETWORK</div><h2>Observed versus predicted tide</h2><p>Hourly NOAA samples used by the residual calculation at every validated station. The vertical gap between lines is the unsmoothed residual; each chart shows the latest 14 days.</p><label class="reference-control" for="referenceToggle"><input id="referenceToggle" type="checkbox" checked> Same dates, 2025 observed reference <span>· dotted</span></label></div><div id="auditGrid" class="audit-grid"></div>';
document.querySelector('.sources').insertAdjacentElement('afterend', auditPanel);
const auditStylesheet = document.createElement('link'); auditStylesheet.rel = 'stylesheet'; auditStylesheet.href = 'dashboard/audit.css'; document.head.appendChild(auditStylesheet);

$('#rangeLabel').textContent = `SIGNAL FIELD / 01 AUG 2026 — ${fmt(today).toUpperCase()} 2026`;
$('#windowValue').textContent = `01 Aug–${fmt(today)}`;

function requestRange(start, end) {
  return `begin_date=${d3.utcFormat('%Y%m%d')(start)}&end_date=${d3.utcFormat('%Y%m%d')(end)}`;
}

async function requestProduct(station, product, start = firstDay, end = today) {
  const chunks = [];
  // Start one UTC day early so Sep. 1 Pacific-time has all of its hours.
  let chunkStart = start === firstDay ? d3.utcDay.offset(start, -1) : start;
  while (chunkStart <= end) {
    const chunkEnd = d3.utcDay.offset(chunkStart, 29);
    chunks.push([chunkStart, chunkEnd > end ? end : chunkEnd]);
    chunkStart = d3.utcDay.offset(chunkEnd, 1);
  }
  const results = await Promise.all(chunks.map(async ([a, b]) => {
    const interval = product === 'predictions' ? '&interval=h' : '';
    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=${product}&application=pacific_pulse&${requestRange(a, b)}&datum=MLLW&station=${station}&time_zone=gmt&units=metric&format=json${interval}`;
    const response = await fetch(url);
    const json = await response.json();
    if (!response.ok || json.error) throw new Error(json.error?.message || `NOAA returned ${response.status}`);
    return json.data || json.predictions || [];
  }));
  return results.flat();
}

async function requestStationMetadata(station) {
  const response = await fetch(`https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${station}.json`);
  const json = await response.json();
  if (!response.ok || json.error) throw new Error(json.error?.message || `Metadata returned ${response.status}`);
  return json.stations?.[0] || json;
}

function prepareStation(water, predictions, hours) {
  const paired = KelvinAnalysis.pairedHourly(water, predictions);
  const hourly = paired.map(record => ({
    date: new Date(`${record.time.replace(' ', 'T')}Z`), observed: record.observed * 100, predicted: record.predicted * 100,
    observations: record.observations, flags: record.flags, quality: record.quality
  })).sort((a, b) => a.date - b.date);
  const daily = d3.rollup(hourly, rows => {
    // At least 18 hourly pairs, distributed across all four quarters of the
    // local Pacific day. This rejects a dense but partial data delivery.
    const complete = KelvinAnalysis.completeLocalDay(rows.map(row => ({ localHour: +pacificHour.format(row.date) })));
    return { value: d3.mean(rows, d => d.observed - d.predicted), pairs: rows.length, complete };
  }, d => pacificDayKey(d.date));
  const raw = days.map(date => {
    const record = daily.get(dayKey(date));
    // The current Pacific day is always provisional, even if it has already
    // crossed the coverage threshold while the day is still underway.
    const isLiveDay = +date === +today;
    const complete = Boolean(record?.complete) && !isLiveDay;
    return { date, value: complete ? record.value : null, provisionalValue: record?.value ?? null, pairs: record?.pairs ?? 0, complete };
  });
  const period = Math.max(1, Math.round(hours / 24));
  const values = raw.map((point, index) => {
    const windowDays = raw.slice(Math.max(0, index - period + 1), index + 1);
    if (windowDays.length !== period || windowDays.some(d => !d.complete)) return { ...point, value: null };
    const windowDayKeys = new Set(windowDays.map(d => dayKey(d.date)));
    const windowHours = hourly.filter(d => windowDayKeys.has(pacificDayKey(d.date)));
    if (windowHours.length < period * 18) return { ...point, value: null };
    return { ...point, value: d3.mean(windowHours, d => d.observed - d.predicted) };
  });
  const propagationValues = values.map((point, index) => {
    const baselinePoints = values.slice(Math.max(0, index - 13), index + 1).filter(d => Number.isFinite(d.value));
    const baseline = baselinePoints.length >= 10 ? d3.mean(baselinePoints, d => d.value) : null;
    return { ...point, baseline, value: Number.isFinite(point.value) && Number.isFinite(baseline) ? point.value - baseline : null };
  });
  const latest = raw.at(-1);
  const provisional = latest && !latest.complete && latest.pairs ? { date: latest.date, value: latest.provisionalValue, pairs: latest.pairs } : null;
  const expectedHours = Math.max(1, Math.round((+today - +firstDay) / 36e5));
  const coverage = hourly.length / expectedHours;
  return { values, propagationValues, hourly, provisional, coverage, waterRows: water.filter(d => KelvinAnalysis.validValue(d.v)).length, predictionRows: predictions.length };
}

function prepareReference(water) {
  return [...d3.rollup(water, rows => d3.mean(rows, d => +d.v) * 100, d => `${d.t.slice(0, 13)}:00`)]
    .map(([time, observed]) => {
      const sourceDate = new Date(`${time.replace(' ', 'T')}Z`);
      return { date: new Date(Date.UTC(sourceDate.getUTCFullYear() + 1, sourceDate.getUTCMonth(), sourceDate.getUTCDate(), sourceDate.getUTCHours())), observed };
    })
    .sort((a, b) => a.date - b.date);
}

function buildPropagationBins(hourly, smoothingHours, baselineMode) {
  const binMs = 3 * 60 * 60 * 1000, smoothingMs = smoothingHours * 60 * 60 * 1000;
  const bins = [...d3.rollup(hourly, rows => d3.mean(rows, d => d.observed - d.predicted), d => Math.floor(+d.date / binMs) * binMs)]
    .map(([time, raw]) => ({ date: new Date(+time), raw }))
    .sort((a, b) => a.date - b.date);
  const short = bins.map(bin => {
    const window = smoothingHours === 0
      ? hourly.filter(point => +point.date >= +bin.date && +point.date < +bin.date + binMs)
      : hourly.filter(point => Math.abs(+point.date - (+bin.date + binMs / 2)) <= smoothingMs / 2);
    const ordered = [...window].sort((a, b) => a.date - b.date);
    const required = smoothingHours === 0 ? 1 : Math.max(4, Math.ceil(smoothingHours * .65));
    // A mean is not allowed to bridge a substantial outage. Missing bins stay missing.
    const value = window.length >= required && KelvinAnalysis.continuous(ordered, 3 * 60 * 60 * 1000) ? d3.mean(window, point => point.observed - point.predicted) : null;
    return { ...bin, short: value };
  });
  const baselineMs = 14 * 24 * 60 * 60 * 1000, minimumBaselineBins = Math.ceil(14 * 24 / 3 * .7);
  return short.map(bin => {
    if (baselineMode === 'none') return { ...bin, baseline: null, value: Number.isFinite(bin.short) ? bin.short : null };
    const baseline = baselineMode === 'centered'
      ? KelvinAnalysis.centeredMean(short, bin.date, baselineMs, minimumBaselineBins, point => point.short)
      : KelvinAnalysis.trailingMean(short, bin.date, baselineMs, minimumBaselineBins, point => point.short);
    return { ...bin, baseline, value: Number.isFinite(bin.short) && Number.isFinite(baseline) ? bin.short - baseline : null };
  });
}

function updatePropagationDescription() {
  $('#propagationDescription').textContent = 'Color shows a 12-hour residual minus its trailing 14-day local baseline, in 3-hour bins. A warm diagonal moving northward is a possible timing pattern—not proof of a Kelvin wave. The spaces between stations are interpolated from valid gauge pairs.';
}

function correlation(pairs) {
  return KelvinAnalysis.correlation(pairs);
}

function analyzePropagation(fields) {
  const reference = fields[0];
  if (!reference) return null;
  const referencePoints = reference.field.filter(d => Number.isFinite(d.value));
  const ranked = [...referencePoints].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const candidates = [];
  ranked.forEach(point => {
    if (candidates.length < 8 && candidates.every(existing => Math.abs(+existing.date - +point.date) >= 12 * 36e5)) candidates.push(point);
  });
  if (!candidates.length) return { candidates: [], rows: [] };
  if (!selectedCandidate || !candidates.some(d => +d.date === +selectedCandidate)) selectedCandidate = candidates[0].date;
  const eventStart = +selectedCandidate - 36 * 36e5, eventEnd = +selectedCandidate + 36 * 36e5;
  const referenceSamples = reference.field.filter(d => +d.date >= eventStart && +d.date <= eventEnd && Number.isFinite(d.value));
  const rows = fields.map((station, index) => {
    // Both arrays contain only direct station observations at their original timestamps.
    // The spatially interpolated display mode never enters this calculation.
    const lagResult = KelvinAnalysis.bestLag(referenceSamples, station.field.filter(d => Number.isFinite(d.value)), 24, 3 * 36e5);
    const allScores = lagResult.scores.filter(score => Number.isFinite(score.r));
    const zero = lagResult.zero || { r: null, pairs: 0 };
    const best = index === 0 ? { lag: 0, r: 1, pairs: referenceSamples.length } : lagResult.best || { lag: null, r: null, pairs: 0 };
    const runnerUp = index === 0 ? null : d3.greatest(allScores.filter(score => score.lag !== best.lag), d => d.r);
    const expected = best.lag == null ? +selectedCandidate : +selectedCandidate + best.lag * 3 * 36e5;
    const matching = station.field.filter(d => Number.isFinite(d.value) && +d.date >= expected - 12 * 36e5 && +d.date <= expected + 12 * 36e5);
    const peak = matching.length ? (candidates.find(d => +d.date === +selectedCandidate).value >= 0 ? d3.greatest(matching, d => d.value) : d3.least(matching, d => d.value)) : null;
    const lagHours = best.lag == null ? null : best.lag * 3;
    const weak = index > 0 && (best.pairs < 8 || best.r < .45);
    // A non-zero best lag that barely improves on zero, or has an almost equal
    // neighboring solution, should not be presented as a measured arrival time.
    const unstable = index > 0 && !weak && lagHours !== 0 && ((best.r - (zero.r ?? -1)) < .08 || (best.r - (runnerUp?.r ?? -1)) < .03);
    return { station, lagHours, r: best.r, zeroR: zero.r, pairs: best.pairs, peak, weak, unstable };
  });
  const usable = rows.slice(1).filter(row => row.lagHours != null && !row.weak && !row.unstable);
  const monotonic = usable.length >= 2 && usable.every((row, index) => index === 0 || row.lagHours >= usable[index - 1].lagHours);
  return { candidates, rows, selected: candidates.find(d => +d.date === +selectedCandidate), adequate: usable.length >= 2 && monotonic, eventStart: new Date(eventStart), eventEnd: new Date(eventEnd), referencePairs: referenceSamples.length };
}

function renderLagProfile(mount, rows) {
  const width = mount.clientWidth, height = Math.max(155, rows.length * 27 + 42), margin = { top: 23, right: 58, bottom: 25, left: 122 };
  const svg = d3.select(mount).append('svg').attr('width', width).attr('height', height).attr('aria-label', 'Estimated time lag by coastal station');
  const x = d3.scaleLinear().domain([-72, 72]).range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(rows.map(row => row.station.name)).range([margin.top, height - margin.bottom]).padding(.35);
  svg.selectAll('.lag-guide').data([-72, -48, -24, 0, 24, 48, 72]).join('line').attr('x1', x).attr('x2', x).attr('y1', margin.top - 8).attr('y2', height - margin.bottom).attr('stroke', d => d === 0 ? '#d85d51' : '#c7d4cf').attr('stroke-width', d => d === 0 ? 1.5 : .7).attr('stroke-dasharray', d => d === 0 ? null : '2 3');
  svg.selectAll('.lag-axis').data([-72, -48, -24, 0, 24, 48, 72]).join('text').attr('x', x).attr('y', 11).attr('text-anchor', 'middle').attr('fill', d => d === 0 ? '#b54b43' : '#60787d').attr('font-family', 'DM Mono').attr('font-size', 8).text(d => d === 0 ? '0 h' : `${d > 0 ? '+' : ''}${d}`);
  svg.selectAll('.lag-station').data(rows).join('text').attr('x', margin.left - 9).attr('y', row => y(row.station.name) + y.bandwidth() / 2 + 3).attr('text-anchor', 'end').attr('fill', '#31545e').attr('font-family', 'DM Mono').attr('font-size', 9).text(row => row.station.name);
  svg.selectAll('.lag-track').data(rows).join('line').attr('x1', x(-72)).attr('x2', x(72)).attr('y1', row => y(row.station.name) + y.bandwidth() / 2).attr('y2', row => y(row.station.name) + y.bandwidth() / 2).attr('stroke', '#d4ddd7').attr('stroke-width', .7);
  const measurable = rows.filter(row => row.lagHours != null);
  svg.selectAll('.lag-dot').data(measurable).join('circle').attr('cx', row => x(row.lagHours)).attr('cy', row => y(row.station.name) + y.bandwidth() / 2).attr('r', row => row.weak || row.unstable ? 4 : 5.5).attr('fill', row => row.weak || row.unstable ? '#eef1eb' : row.lagHours === 0 ? '#31545e' : '#d85d51').attr('stroke', row => row.weak || row.unstable ? '#a87a63' : '#183d48').attr('stroke-width', 1.2).attr('stroke-dasharray', row => row.weak || row.unstable ? '2 1' : null).append('title').text(row => `${row.station.name}: ${row.lagHours > 0 ? '+' : ''}${row.lagHours} h; ${row.pairs} paired bins${row.weak ? '; weak' : row.unstable ? '; unstable' : ''}`);
  svg.selectAll('.lag-value').data(measurable).join('text').attr('x', row => x(row.lagHours) + 8).attr('y', row => y(row.station.name) + y.bandwidth() / 2 + 3).attr('fill', row => row.weak || row.unstable ? '#8a5e4d' : '#31545e').attr('font-family', 'DM Mono').attr('font-size', 8).text(row => `${row.lagHours > 0 ? '+' : ''}${row.lagHours} h · n=${row.pairs}${row.weak ? ' · weak' : row.unstable ? ' · unstable' : ''}`);
  const unavailable = rows.filter(row => row.lagHours == null);
  svg.selectAll('.lag-unavailable').data(unavailable).join('text').attr('x', x(0)).attr('y', row => y(row.station.name) + y.bandwidth() / 2 + 4).attr('text-anchor', 'middle').attr('fill', '#8a5e4d').attr('font-family', 'DM Mono').attr('font-size', 13).text('×').append('title').text(row => `${row.station.name}: insufficient matched observations for a lag estimate`);
  svg.selectAll('.lag-unavailable-label').data(unavailable).join('text').attr('x', x(0) + 9).attr('y', row => y(row.station.name) + y.bandwidth() / 2 + 3).attr('fill', '#8a5e4d').attr('font-family', 'DM Mono').attr('font-size', 8).text('insufficient data');
  svg.append('text').attr('x', x(-72)).attr('y', height - 4).attr('fill', '#60787d').attr('font-family', 'DM Mono').attr('font-size', 8).text('earlier than reference');
  svg.append('text').attr('x', x(72)).attr('y', height - 4).attr('text-anchor', 'end').attr('fill', '#60787d').attr('font-family', 'DM Mono').attr('font-size', 8).text('later than reference');
}

function renderEventAnalysis(analysis) {
  const el = $('#eventAnalysis');
  if (!el) return;
  if (!analysis?.selected) { el.innerHTML = '<div class="eyebrow">EVENT ANALYSIS</div><p>No candidate event can be evaluated: the selected view has insufficient valid residual bins.</p>'; return; }
  const options = analysis.candidates.map(point => `<option value="${+point.date}" ${+point.date === +analysis.selected.date ? 'selected' : ''}>${fmtPacific.format(point.date)} ${pacificHour.format(point.date)}:00 · ${point.value >= 0 ? '+' : ''}${point.value.toFixed(1)} cm</option>`).join('');
  const lines = analysis.rows.map(row => `<tr><td>${row.station.name}</td><td>${row.peak ? `${fmtPacific.format(row.peak.date)} ${pacificHour.format(row.peak.date)}:00` : '—'}</td><td>${row.lagHours == null ? '—' : `${row.lagHours > 0 ? '+' : ''}${row.lagHours} h`}</td><td>${row.r == null ? '—' : row.r.toFixed(2)}</td><td>${row.zeroR == null ? '—' : row.zeroR.toFixed(2)}</td><td>${row.pairs}</td></tr>`).join('');
  const stableNonzero = analysis.rows.slice(1).filter(row => row.lagHours && !row.weak && !row.unstable);
  const verdict = analysis.adequate ? 'Several stations show stable, progressively later lags; inspect the sensitivity controls before treating this as a traveling disturbance.' : stableNonzero.length ? 'Some non-zero lags appear, but they are not a consistent northward progression.' : 'Most stations align without a measurable delay; no consistent northward progression detected.';
  el.innerHTML = `<div class="event-heading"><div><div class="eyebrow">EXPLORATORY EVENT ANALYSIS</div><h3>Estimated timing by station</h3></div><label class="propagation-control">Candidate at ${analysis.rows[0]?.station.name || 'reference'} <select id="candidateSelect">${options}</select></label></div><p><b>${verdict}</b> Selected window: ${fmtPacific.format(analysis.eventStart)} ${pacificHour.format(analysis.eventStart)}:00–${fmtPacific.format(analysis.eventEnd)} ${pacificHour.format(analysis.eventEnd)}:00 Pacific · ${analysis.referencePairs} valid reference bins. Positive lags mean the comparison station’s matched observed signal occurs later than the reference.</p><div id="lagProfile" class="lag-profile"></div><p class="lag-key">Solid dots are usable estimates. Hollow dots are weak or unstable; they should not be read as definitive delays. Spatial interpolation is never used in this calculation.</p><details class="analysis-details"><summary>Show analysis details</summary><div class="diagnostic-table-wrap"><table><thead><tr><th>Station</th><th>Candidate peak</th><th>Best lag</th><th>Best r</th><th>Zero-lag r</th><th>Paired bins</th></tr></thead><tbody>${lines}</tbody></table></div></details><p class="distance-note">Estimated speed is withheld: coastal distances have not yet been verified from a reproducible shoreline polyline. Lag-aligned mode shifts only the display; it never changes the original timestamps.</p>`;
  renderLagProfile($('#lagProfile'), analysis.rows);
  $('#candidateSelect')?.addEventListener('change', event => { selectedCandidate = new Date(+event.target.value); renderPropagation(); });
}

function renderStationDiagnostics(diagnostics) {
  const el = $('#stationDiagnostics');
  if (!el) return;
  const included = diagnostics.filter(d => d.included);
  const excluded = diagnostics.filter(d => !d.included);
  const rows = diagnostics.map(d => `<tr><td>${d.name}</td><td>${d.id}</td><td>${d.included ? 'Included' : 'Excluded'}</td><td>${d.coverage == null ? '—' : `${Math.round(d.coverage * 100)}%`}</td><td>${d.reason}</td></tr>`).join('');
  el.innerHTML = `<details><summary>Station validation · ${included.length} included, ${excluded.length} excluded</summary><p>Observed and predicted values are matched at hourly timestamps in UTC. Inclusion requires at least 70% matched coverage across the requested period; partial live days remain provisional. NOAA quality/flag fields are retained with the matched samples for audit, rather than silently converted to values.</p><p class="distance-note">Coastal positions use rounded, route-following California shoreline estimates—not straight-line distances. They are suitable for visual ordering; a reproducible NOAA shoreline polyline is required before treating any calculated speed as a published measurement.</p><div class="diagnostic-table-wrap"><table><thead><tr><th>Station</th><th>NOAA ID</th><th>Status</th><th>Matched</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function updateFinding() {
  $('#statusText').textContent = 'EXPLORATORY ANALYSIS';
  $('#lag').innerHTML = 'Select an event<br><em>then inspect lags</em>';
  $('#finding').textContent = 'The propagation explorer tests individual disturbances against unshifted data. It does not infer a traveling signal from each station’s largest value across the full record.';
}

async function load() {
  $('#statusText').textContent = 'CONNECTING TO NOAA';
  $('#chartNote').textContent = 'Requesting observed water level and predicted tides from NOAA CO-OPS…';
  const hours = +$('#window').value;
  const auditStart = d3.utcDay.offset(today, -14);
  const referenceStart = new Date(Date.UTC(auditStart.getUTCFullYear() - 1, auditStart.getUTCMonth(), auditStart.getUTCDate()));
  const referenceEnd = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));
  const results = await Promise.all(stations.map(async station => {
    try {
      const [water, predictions, referenceWater, metadata] = await Promise.all([
        requestProduct(station.id, 'water_level'), requestProduct(station.id, 'predictions'),
        requestProduct(station.id, 'water_level', referenceStart, referenceEnd).catch(() => []),
        requestStationMetadata(station.id).catch(error => ({ metadataError: error.message }))
      ]);
      const prepared = prepareStation(water, predictions, hours);
      const adequate = prepared.coverage >= .7;
      const metadataNote = metadata.metadataError ? `; metadata check unavailable (${metadata.metadataError})` : '; metadata returned';
      return adequate
        ? { included: true, station: { ...station, ...prepared, metadata, reference: prepareReference(referenceWater) }, diagnostic: { ...station, included: true, coverage: prepared.coverage, reason: `Matched observed and predicted hourly values${metadataNote}` } }
        : { included: false, diagnostic: { ...station, included: false, coverage: prepared.coverage, reason: `Insufficient matched hourly coverage (<70%)${metadataNote}` } };
    } catch (error) {
      return { included: false, diagnostic: { ...station, included: false, coverage: null, reason: error.message || 'NOAA request failed' } };
    }
  }));
  series = results.filter(result => result.included).map(result => result.station);
  renderStationDiagnostics(results.map(result => result.diagnostic));
  const primaryReturned = series.filter(station => station.primary).length;
  $('#stationCount').textContent = `${primaryReturned} / ${primaryStations.length}`;
  if (!primaryReturned) throw new Error('No primary station records returned');
  $('#chartNote').textContent = `Observed water level − predicted astronomical tide; ${hours}-hour time-aware rolling mean. Daily points require ≥18 hourly pairs across all four 6-hour blocks; partial live days are dashed and excluded from the trend. ${series.length} of ${stations.length} gauges passed matched-coverage validation; exclusions are listed below the propagation view.`;
  $('#timeSlider').max = days.length - 1;
  setTime(Math.min(current, days.length - 1));
  auditSeries = series.map(station => ({ name: station.name, hourly: station.hourly, reference: station.reference }));
  updateFinding(); render();
}

function render() { renderHeatmap(); renderCalendar(); renderPropagation(); renderAudit(); }
function renderHeatmap() {
  const el = $('#heatmap'), width = el.clientWidth, height = el.clientHeight, margin = { top: 20, right: 135, bottom: 34, left: 50 };
  d3.select(el).selectAll('*').remove();
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  const values = series.flatMap(s => s.values.map(d => d.value).filter(Number.isFinite).concat(Number.isFinite(s.provisional?.value) ? [s.provisional.value] : []));
  let [minimum, maximum] = d3.extent(values);
  if (minimum === maximum) { minimum -= 1; maximum += 1; }
  const padding = Math.max(2, (maximum - minimum) * .12);
  const x = d3.scaleUtc().domain(d3.extent(days)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([minimum - padding, maximum + padding]).range([height - margin.bottom, margin.top]);
  const colors = ['#ef806e', '#7fc8bf', '#a99bd0', '#efba72'];
  const directLabels = [];
  document.querySelector('.legend').innerHTML = '<span>PRIMARY RESIDUALS / CM · PALE = CONTEXT · DASHED = PARTIAL DAY</span>';
  svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)).tickFormat(d => `${d.toFixed(0)}`)).call(g => g.select('.domain').remove()).call(g => g.selectAll('.tick line').attr('stroke', '#315866')).call(g => g.selectAll('.tick text').attr('fill', '#a6c5c3').attr('font-family', 'DM Mono').attr('font-size', 9));
  series.forEach((station, index) => {
    const color = station.primary ? colors[primaryStations.findIndex(candidate => candidate.id === station.id)] : '#91b4ba';
    const area = d3.area().defined(d => Number.isFinite(d.value)).x(d => x(d.date)).y0(height - margin.bottom).y1(d => y(d.value)).curve(d3.curveMonotoneX);
    const line = d3.line().defined(d => Number.isFinite(d.value)).x(d => x(d.date)).y(d => y(d.value)).curve(d3.curveMonotoneX);
    if (station.primary) svg.append('path').datum(station.values).attr('d', area).attr('fill', color).attr('fill-opacity', .16);
    svg.append('path').datum(station.values).attr('d', line).attr('fill', 'none').attr('stroke', color).attr('stroke-width', station.primary ? 2.4 : 1.15).attr('stroke-opacity', station.primary ? 1 : .42);
    const last = station.values.filter(d => Number.isFinite(d.value)).at(-1);
    if (station.provisional && last) {
      svg.append('path').datum([last, station.provisional]).attr('d', line).attr('fill', 'none').attr('stroke', color).attr('stroke-width', station.primary ? 2.2 : 1.1).attr('stroke-opacity', station.primary ? 1 : .42).attr('stroke-dasharray', '5 4');
      if (station.primary) svg.append('circle').attr('cx', x(station.provisional.date)).attr('cy', y(station.provisional.value)).attr('r', 3.5).attr('fill', color).attr('stroke', '#123f4d').attr('stroke-width', 1.25).append('title').text(`${station.name} · provisional (${station.provisional.pairs} hourly pairs) · ${station.provisional.value.toFixed(1)} cm`);
    }
    const labelPoint = station.provisional || last;
    if (station.primary && labelPoint) directLabels.push({ name: station.name, color, point: labelPoint, targetY: y(labelPoint.value) });
    svg.selectAll(`.point-${index}`).data(station.values.filter(d => Number.isFinite(d.value))).join('circle').attr('class', `point-${index}`).attr('cx', d => x(d.date)).attr('cy', d => y(d.value)).attr('r', 7).attr('fill', 'transparent').append('title').text(d => `${station.name}${station.primary ? '' : ' · context'} · ${fmt(d.date)} · ${d.value.toFixed(1)} cm`);
  });
  // Keep direct labels readable as the live endpoints converge. A small,
  // deterministic relaxation is more stable than a force simulation here.
  const labelTop = margin.top + 8, labelBottom = height - margin.bottom - 8, labelGap = 17;
  directLabels.sort((a, b) => a.targetY - b.targetY);
  directLabels.forEach((label, index) => { label.y = Math.max(label.targetY, index ? directLabels[index - 1].y + labelGap : labelTop); });
  for (let index = directLabels.length - 1; index >= 0; index -= 1) {
    const next = directLabels[index + 1];
    directLabels[index].y = Math.min(directLabels[index].y, index === directLabels.length - 1 ? labelBottom : next.y - labelGap);
  }
  const labelX = width - margin.right + 12;
  const labels = svg.append('g').attr('class', 'direct-labels');
  labels.selectAll('path').data(directLabels).join('path').attr('d', d => `M${x(d.point.date) + 4},${d.targetY}L${labelX - 4},${d.y}`).attr('fill', 'none').attr('stroke', d => d.color).attr('stroke-width', .9).attr('stroke-opacity', .72);
  labels.selectAll('text').data(directLabels).join('text').attr('x', labelX).attr('y', d => d.y + 3.5).attr('fill', d => d.color).attr('font-family', 'DM Mono').attr('font-weight', 600).attr('font-size', 10).text(d => d.name);
  svg.selectAll('.date-tick').data(d3.utcMonday.every(1).range(days[0], d3.utcDay.offset(days.at(-1), 1))).join('text').attr('class', 'date-tick').attr('x', d => x(d)).attr('y', height - 11).attr('text-anchor', 'middle').attr('fill', '#a6c5c3').attr('font-family', 'DM Mono').attr('font-size', 9).text(d => fmt(d));
  const marker = svg.append('line').attr('y1', margin.top).attr('y2', height - margin.bottom).attr('stroke', '#fff').attr('stroke-width', 1.5);
  window.mark = time => marker.attr('x1', x(days[time])).attr('x2', x(days[time]));
  mark(current);
}

function renderCalendar() {
  const el = $('#calendarHeatmap'), width = el.clientWidth, height = el.clientHeight, margin = { top: 4, right: 15, bottom: 28, left: 105 };
  d3.select(el).selectAll('*').remove();
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  const focus = series;
  const values = focus.flatMap(s => s.values.map(d => d.value).filter(Number.isFinite));
  let [minimum, maximum] = d3.extent(values); if (minimum === maximum) { minimum -= 1; maximum += 1; }
  const x = d3.scaleBand().domain(d3.range(days.length)).range([margin.left, width - margin.right]).padding(.035);
  const y = d3.scaleBand().domain(focus.map(d => d.name)).range([margin.top, height - margin.bottom]).padding(.1);
  const color = d3.scaleLinear().domain([minimum, (minimum + maximum) / 2, maximum]).range(['#287c9a', '#e8eadb', '#d6574f']).clamp(true);
  svg.selectAll('rect').data(focus.flatMap(s => s.values.map((v, i) => ({ s, ...v, i })))).join('rect').attr('x', d => x(d.i)).attr('y', d => y(d.s.name)).attr('width', x.bandwidth()).attr('height', y.bandwidth()).attr('fill', d => Number.isFinite(d.value) ? color(d.value) : '#224b59').append('title').text(d => `${d.s.name} · ${fmt(d.date)} · ${Number.isFinite(d.value) ? `${d.value.toFixed(1)} cm` : 'no data'}`);
  svg.selectAll('.row').data(focus).join('text').attr('x', margin.left - 9).attr('y', d => y(d.name) + y.bandwidth() / 2 + 4).attr('text-anchor', 'end').attr('fill', '#d4e1de').attr('font-family', 'DM Mono').attr('font-size', 9).text(d => d.name);
  svg.selectAll('.tick').data(d3.utcMonday.every(1).range(days[0], d3.utcDay.offset(days.at(-1), 1))).join('text').attr('x', d => x(days.findIndex(day => +day === +d)) + x.bandwidth() / 2).attr('y', height - 8).attr('text-anchor', 'middle').attr('fill', '#a6c5c3').attr('font-family', 'DM Mono').attr('font-size', 8).text(d => fmt(d));
  const marker = svg.append('line').attr('y1', margin.top).attr('y2', height - margin.bottom).attr('stroke', '#fff').attr('stroke-width', 1.25);
  const waveMarker = window.mark;
  window.mark = time => { waveMarker(time); marker.attr('x1', x(time) + x.bandwidth() / 2).attr('x2', x(time) + x.bandwidth() / 2); };
  window.markThroughCalendar = window.mark;
  window.mark(current);
}

function renderPropagation() {
  const el = $('#propagationViz'), rows = [...series].sort((a, b) => a.mi - b.mi);
  if (!rows.length) return;
  updatePropagationDescription();
  const viewDays = propagationWindow === 'all' ? days : days.slice(Math.max(0, current - propagationWindow + 1), current + 1);
  const viewDayKeys = new Set(viewDays.map(dayKey));
  const fields = rows.map(station => ({ ...station, field: buildPropagationBins(station.hourly, propagationSmoothing, propagationBaseline).filter(point => viewDayKeys.has(pacificDayKey(point.date)) ) }));
  propagationAnalysis = analyzePropagation(fields);
  renderEventAnalysis(propagationAnalysis);
  const lags = new Map((propagationAnalysis?.rows || []).map(row => [row.station.id, row.lagHours || 0]));
  const displayFields = comparisonMode === 'aligned'
    ? fields.map(station => ({ ...station, field: station.field.map(point => ({ ...point, date: new Date(+point.date - (lags.get(station.id) || 0) * 36e5) })) }))
    : fields;
  const width = el.clientWidth, height = 390, margin = { top: 22, right: 22, bottom: 37, left: 132 };
  d3.select(el).selectAll('*').remove();
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  const allValues = displayFields.flatMap(station => station.field.map(d => d.value).filter(Number.isFinite));
  const absoluteValues = allValues.map(value => Math.abs(value)).sort(d3.ascending);
  const limit = Math.max(3, d3.quantileSorted(absoluteValues, .9) || 3);
  const allTimes = displayFields.flatMap(station => station.field.map(point => point.date));
  if (!allTimes.length) return;
  const [startTime, endTime] = d3.extent(allTimes);
  const x = d3.scaleUtc().domain([startTime, new Date(+endTime + 3 * 60 * 60 * 1000)]).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, station => station.mi)]).range([margin.top + 9, height - margin.bottom - 9]);
  const color = d3.scaleQuantize().domain([-limit, limit]).range(['#1e6684', '#277d9b', '#4f99ae', '#83b9bf', '#bad6d2', '#e3e8db', '#ecd9ca', '#e5b4a5', '#dc8879', '#d85d51', '#bd3f3c']);
  const plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
  svg.selectAll('.prop-distance').data(d3.range(0, 801, 100)).join('line').attr('class', 'prop-distance').attr('x1', margin.left).attr('x2', width - margin.right).attr('y1', d => y(d)).attr('y2', d => y(d)).attr('stroke', '#cbd6d0').attr('stroke-width', .7);
  const binWidth = Math.max(1, x(new Date(+startTime + 3 * 60 * 60 * 1000)) - x(startTime) + .25);
  if (propagationMode === 'observed') {
    svg.append('g').selectAll('.prop-observed').data(displayFields.flatMap(station => station.field.filter(point => Number.isFinite(point.value)).map(point => ({ station, point })))).join('rect').attr('class', 'prop-observed').attr('x', d => x(d.point.date)).attr('y', d => y(d.station.mi) - 8).attr('width', binWidth).attr('height', 16).attr('fill', d => color(d.point.value)).append('title').text(d => `${d.station.name} · ${fmtPacific.format(d.point.date)} ${pacificHour.format(d.point.date)}:00 · ${d.point.value.toFixed(1)} cm${propagationBaseline === 'none' ? ' raw residual' : ' vs local baseline'}${comparisonMode === 'aligned' ? ' · displayed lag-aligned' : ''}`);
  } else {
    const stationValues = new Map(displayFields.map(station => [station.name, new Map(station.field.map(point => [+point.date, point.value]))]));
    const timeBins = d3.utcHour.every(3).range(startTime, new Date(+endTime + 3 * 60 * 60 * 1000));
    const bridges = rows.slice(1).flatMap((north, index) => {
      const south = rows[index];
      return timeBins.map(time => ({ south, north, time, southValue: stationValues.get(south.name).get(+time), northValue: stationValues.get(north.name).get(+time) })).filter(d => Number.isFinite(d.southValue) && Number.isFinite(d.northValue));
    });
    const defs = svg.append('defs');
    defs.selectAll('.prop-gradient').data(bridges).join('linearGradient').attr('class', 'prop-gradient').attr('id', (_, index) => `propagation-gradient-${index}`).attr('gradientUnits', 'userSpaceOnUse').attr('x1', d => x(d.time)).attr('x2', d => x(d.time)).attr('y1', d => y(d.south.mi)).attr('y2', d => y(d.north.mi)).each(function(d) { const gradient = d3.select(this); gradient.append('stop').attr('offset', '0%').attr('stop-color', color(d.southValue)); gradient.append('stop').attr('offset', '100%').attr('stop-color', color(d.northValue)); });
    svg.append('g').selectAll('.prop-bridge').data(bridges).join('rect').attr('class', 'prop-bridge').attr('x', d => x(d.time)).attr('y', d => y(d.south.mi)).attr('width', binWidth).attr('height', d => y(d.north.mi) - y(d.south.mi)).attr('fill', (_, index) => `url(#propagation-gradient-${index})`).attr('opacity', .94);
  }
  svg.selectAll('.prop-station-guide').data(rows).join('line').attr('class', 'prop-station-guide').attr('x1', margin.left).attr('x2', width - margin.right).attr('y1', d => y(d.mi)).attr('y2', d => y(d.mi)).attr('stroke', '#31545e').attr('stroke-opacity', .26).attr('stroke-dasharray', '2 3');
  svg.selectAll('.prop-row').data(rows).join('text').attr('class', 'prop-row').attr('x', margin.left - 9).attr('y', d => y(d.mi) + 3).attr('text-anchor', 'end').attr('fill', '#31545e').attr('font-family', 'DM Mono').attr('font-size', 9).text(d => `${d.name} · ${d.mi} mi`);
  const tickEvery = Math.max(1, Math.ceil([...new Set(allTimes.map(time => +time))].length / 8));
  const tickDates = [...new Set(allTimes.map(time => +time))].map(time => new Date(time)).filter((date, index, list) => index === 0 || index === list.length - 1 || index % tickEvery === 0);
  svg.selectAll('.prop-date').data(tickDates).join('text').attr('class', 'prop-date').attr('x', d => x(d)).attr('y', height - 10).attr('text-anchor', 'middle').attr('fill', '#60787d').attr('font-family', 'DM Mono').attr('font-size', 8).text(d => `${fmtPacific.format(d)} ${pacificHour.format(d)}h`);
  svg.append('text').attr('x', 11).attr('y', margin.top + 4).attr('fill', '#60787d').attr('font-family', 'DM Mono').attr('font-size', 8).text('COAST MILES');
  const baselineLabel = propagationBaseline === 'none' ? 'RAW RESIDUAL' : propagationBaseline === 'centered' ? 'CENTERED 14D' : 'TRAILING 14D';
  svg.append('text').attr('x', width - margin.right).attr('y', margin.top + 4).attr('text-anchor', 'end').attr('fill', '#60787d').attr('font-family', 'DM Mono').attr('font-size', 8).text(`3H BINS · ${baselineLabel} · INTERPOLATED ONLY BETWEEN VALID PAIRS · ACTUAL UTC · ±${limit.toFixed(1)} CM`);
  const marker = svg.append('line').attr('y1', margin.top).attr('y2', height - margin.bottom).attr('stroke', '#31545e').attr('stroke-width', 1.1);
  const priorMark = window.markThroughCalendar || window.mark;
  window.mark = time => { priorMark(time); const point = displayFields[0].field.filter(d => pacificDayKey(d.date) === dayKey(days[time])).at(-1); if (point) marker.attr('x1', x(point.date)).attr('x2', x(point.date)); };
  window.mark(current);
}

function renderAudit() {
  const grid = $('#auditGrid'); grid.innerHTML = '';
  auditSeries.forEach((station, index) => {
    const card = document.createElement('article'); card.className = 'audit-chart';
    card.innerHTML = `<div class="card-top"><span>${station.name.toUpperCase()} <b>· CM MLLW</b></span><span>2025 OBSERVED · DOTTED</span></div><div class="audit-mount"></div>`;
    grid.appendChild(card);
    const el = card.querySelector('.audit-mount'); const data = station.hourly.slice(-14 * 24);
    if (!data.length) { el.textContent = 'No matched hourly pairs.'; return; }
    const width = el.clientWidth, height = el.clientHeight, margin = { top: 16, right: 14, bottom: 28, left: 43 };
    const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
    const x = d3.scaleUtc().domain(d3.extent(data, d => d.date)).range([margin.left, width - margin.right]);
    const reference = showReference ? station.reference.filter(d => d.date >= data[0].date && d.date <= data.at(-1).date) : [];
    const levels = data.flatMap(d => [d.observed, d.predicted]).concat(reference.map(d => d.observed)); const [minimum, maximum] = d3.extent(levels);
    const y = d3.scaleLinear().domain([minimum - 8, maximum + 8]).range([height - margin.bottom, margin.top]);
    svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(3).tickSize(-(width - margin.left - margin.right))).call(g => g.select('.domain').remove()).call(g => g.selectAll('.tick line').attr('stroke', '#d4ddd7')).call(g => g.selectAll('.tick text').attr('fill', '#6c7f80').attr('font-family', 'DM Mono').attr('font-size', 8));
    const line = field => d3.line().x(d => x(d.date)).y(d => y(d[field])).curve(d3.curveMonotoneX);
    if (reference.length) svg.append('path').datum(reference).attr('d', line('observed')).attr('fill', 'none').attr('stroke', '#a89d91').attr('stroke-width', 1.25).attr('stroke-dasharray', '2 4').attr('opacity', .9);
    svg.append('path').datum(data).attr('d', line('predicted')).attr('fill', 'none').attr('stroke', '#6188a0').attr('stroke-width', 1.4).attr('stroke-dasharray', '4 3');
    svg.append('path').datum(data).attr('d', line('observed')).attr('fill', 'none').attr('stroke', '#d85d51').attr('stroke-width', 1.8);
    svg.selectAll('.audit-day').data(d3.utcDay.every(4).range(data[0].date, d3.utcDay.offset(data.at(-1).date, 1))).join('text').attr('class', 'audit-day').attr('x', d => x(d)).attr('y', height - 8).attr('text-anchor', 'middle').attr('fill', '#6c7f80').attr('font-family', 'DM Mono').attr('font-size', 8).text(d => fmtPacific.format(d));
  });
}

function setTime(value) { current = +value; $('#timeSlider').value = current; $('#timeLabel').textContent = fmt(days[current]); if (window.mark) mark(current); }
$('#timeSlider').addEventListener('input', event => { setTime(event.target.value); if (series.length) renderPropagation(); });
$('#refresh').addEventListener('click', () => load().catch(showFailure));
$('#window').addEventListener('change', () => load().catch(showFailure));
$('#referenceToggle').addEventListener('change', event => { showReference = event.target.checked; renderAudit(); });
window.addEventListener('resize', render);
function showFailure(error) { console.error(error); $('#statusText').textContent = 'NOAA REQUEST FAILED'; $('#chartNote').textContent = 'The NOAA request could not be completed. Refresh to retry; no substitute data are shown.'; }
const satelliteScript = document.createElement('script');
satelliteScript.src = 'dashboard/satellite.js';
satelliteScript.onload = () => { window.loadSatelliteContext?.({ start: dayKey(firstDay), end: dayKey(today) }); load().catch(showFailure); };
satelliteScript.onerror = () => load().catch(showFailure);
document.head.appendChild(satelliteScript);

const stations = [
  ['San Diego', '9410170', 0], ['Los Angeles', '9410660', 125],
  ['Monterey', '9413450', 345], ['San Francisco', '9414290', 415]
].map(([name, id, mi]) => ({ name, id, mi }));

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
const firstDay = new Date(Date.UTC(2026, 8, 1));
const days = d3.utcDay.range(firstDay, d3.utcDay.offset(today, 1));
let series = [], current = 0, auditSeries = [], showReference = true;

document.querySelector('.station-card h2').innerHTML = 'Four coastal gauges,<br>one testable signal.';
document.querySelector('.station-card p').textContent = 'The detection transect is San Diego, Los Angeles, Monterey, and San Francisco. Satellite altimetry is separate offshore context—not a second detector.';
document.querySelector('.sources h2').textContent = 'Measures over models.';
document.querySelector('.sources p').textContent = 'The main chart requests NOAA CO-OPS water-level observations and tide predictions in your browser. The satellite panel reads a locally generated Copernicus extract for broad offshore context; it does not independently corroborate this candidate signal.';
const calendarPanel = document.createElement('div');
calendarPanel.className = 'calendar-panel';
calendarPanel.innerHTML = '<div class="calendar-heading">CALENDAR VIEW / RESIDUAL INTENSITY</div><div id="calendarHeatmap"></div>';
$('#heatmap').insertAdjacentElement('afterend', calendarPanel);
const calendarStylesheet = document.createElement('link'); calendarStylesheet.rel = 'stylesheet'; calendarStylesheet.href = 'calendar.css'; document.head.appendChild(calendarStylesheet);
const auditPanel = document.createElement('section');
auditPanel.className = 'audit-panel';
auditPanel.innerHTML = '<div class="audit-intro"><div class="eyebrow">INPUT AUDIT / ALL FOUR STATIONS</div><h2>Observed versus predicted tide</h2><p>Hourly NOAA samples used by the residual calculation. The vertical gap between lines is the unsmoothed residual; each chart shows the latest 14 days.</p><label class="reference-control" for="referenceToggle"><input id="referenceToggle" type="checkbox" checked> Same dates, 2025 observed reference <span>· dotted</span></label></div><div id="auditGrid" class="audit-grid"></div>';
document.querySelector('.sources').insertAdjacentElement('afterend', auditPanel);
const auditStylesheet = document.createElement('link'); auditStylesheet.rel = 'stylesheet'; auditStylesheet.href = 'audit.css'; document.head.appendChild(auditStylesheet);

$('#rangeLabel').textContent = `SIGNAL FIELD / 01 SEP 2026 — ${fmt(today).toUpperCase()} 2026`;
$('#windowValue').textContent = `01 Sep–${fmt(today)}`;

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

function prepareStation(water, predictions, hours) {
  const predicted = new Map(predictions.map(d => [d.t, +d.v]));
  const hourlyWater = d3.rollup(water, v => d3.mean(v, d => +d.v), d => `${d.t.slice(0, 13)}:00`);
  const hourly = [...hourlyWater].filter(([time]) => predicted.has(time)).map(([time, observed]) => ({
    date: new Date(`${time.replace(' ', 'T')}Z`), observed: observed * 100, predicted: predicted.get(time) * 100
  })).sort((a, b) => a.date - b.date);
  const daily = d3.rollup(hourly, rows => {
    const hoursPresent = new Set(rows.map(d => +pacificHour.format(d.date)));
    const sixHourBlocks = new Set(rows.map(d => Math.floor(+pacificHour.format(d.date) / 6)));
    const firstHour = d3.min(hoursPresent), lastHour = d3.max(hoursPresent);
    // At least 18 hourly pairs, distributed across all four quarters of the
    // local Pacific day. This rejects a dense but partial data delivery.
    const complete = rows.length >= 18 && sixHourBlocks.size === 4 && lastHour - firstHour >= 18;
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
  const latest = raw.at(-1);
  const provisional = latest && !latest.complete && latest.pairs ? { date: latest.date, value: latest.provisionalValue, pairs: latest.pairs } : null;
  return { values, hourly, provisional };
}

function prepareReference(water) {
  return [...d3.rollup(water, rows => d3.mean(rows, d => +d.v) * 100, d => `${d.t.slice(0, 13)}:00`)]
    .map(([time, observed]) => {
      const sourceDate = new Date(`${time.replace(' ', 'T')}Z`);
      return { date: new Date(Date.UTC(sourceDate.getUTCFullYear() + 1, sourceDate.getUTCMonth(), sourceDate.getUTCDate(), sourceDate.getUTCHours())), observed };
    })
    .sort((a, b) => a.date - b.date);
}

function findCandidate() {
  const peaks = series.map(station => ({
    ...station,
    peak: d3.greatest(station.values.filter(d => Number.isFinite(d.value)), d => d.value)
  })).filter(d => d.peak);
  const links = [];
  for (let i = 1; i < peaks.length; i += 1) {
    const south = peaks[i - 1], north = peaks[i];
    const elapsedDays = d3.utcDay.count(south.peak.date, north.peak.date);
    const pace = elapsedDays > 0 ? (north.mi - south.mi) / elapsedDays : 0;
    links.push({ south, north, elapsedDays, pace, valid: pace >= 75 && pace <= 250 });
  }
  let run = 0, longest = 0, validPaces = [];
  links.forEach(link => { if (link.valid) { run += 1; validPaces.push(link.pace); longest = Math.max(longest, run); } else run = 0; });
  return { peaks, isCandidate: longest >= 2, pace: validPaces.length ? Math.round(d3.median(validPaces)) : null };
}

function updateFinding() {
  const { isCandidate, pace } = findCandidate();
  if (isCandidate) {
    $('#statusText').textContent = 'CANDIDATE NORTHBOUND EVENT';
    $('#lag').innerHTML = `~${pace} mi/day<br><em>peak sequence</em>`;
    $('#finding').textContent = 'At least three adjacent stations reached their strongest positive residual in northward order within the broad expected speed band.';
  } else {
    $('#statusText').textContent = 'STRICT PEAK TEST: NO MATCH';
    $('#lag').innerHTML = 'No coherent<br><em>maximum-peak sequence</em>';
    $('#finding').textContent = 'The single largest residual at each station does not form three northward-ordered arrivals between 75 and 250 mi/day. This does not rule out a leading-edge signal.';
  }
}

async function load() {
  $('#statusText').textContent = 'CONNECTING TO NOAA';
  $('#chartNote').textContent = 'Requesting observed water level and predicted tides from NOAA CO-OPS…';
  const hours = +$('#window').value;
  const auditStart = d3.utcDay.offset(today, -14);
  const referenceStart = new Date(Date.UTC(auditStart.getUTCFullYear() - 1, auditStart.getUTCMonth(), auditStart.getUTCDate()));
  const referenceEnd = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));
  const results = await Promise.allSettled(stations.map(async station => {
    const [water, predictions, referenceWater] = await Promise.all([
      requestProduct(station.id, 'water_level'), requestProduct(station.id, 'predictions'),
      requestProduct(station.id, 'water_level', referenceStart, referenceEnd)
    ]);
    return { ...station, ...prepareStation(water, predictions, hours), reference: prepareReference(referenceWater) };
  }));
  series = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  $('#stationCount').textContent = `${series.length} / ${stations.length}`;
  if (!series.length) throw new Error('No station records returned');
  $('#chartNote').textContent = `Observed water level − predicted astronomical tide; ${hours}-hour time-aware rolling mean. Daily points require ≥18 hourly pairs across all four 6-hour blocks; partial live days are dashed and excluded from the trend. ${series.length} NOAA stations returned data.`;
  $('#timeSlider').max = days.length - 1;
  setTime(Math.min(current, days.length - 1));
  auditSeries = series.map(station => ({ name: station.name, hourly: station.hourly, reference: station.reference }));
  updateFinding(); render();
}

function render() { renderHeatmap(); renderCalendar(); renderTransect(); renderAudit(); }
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
  document.querySelector('.legend').innerHTML = '<span>OVERLAID RESIDUALS / CM · DASHED = PARTIAL DAY</span>';
  svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)).tickFormat(d => `${d.toFixed(0)}`)).call(g => g.select('.domain').remove()).call(g => g.selectAll('.tick line').attr('stroke', '#315866')).call(g => g.selectAll('.tick text').attr('fill', '#a6c5c3').attr('font-family', 'DM Mono').attr('font-size', 9));
  series.forEach((station, index) => {
    const color = colors[index];
    const area = d3.area().defined(d => Number.isFinite(d.value)).x(d => x(d.date)).y0(height - margin.bottom).y1(d => y(d.value)).curve(d3.curveMonotoneX);
    const line = d3.line().defined(d => Number.isFinite(d.value)).x(d => x(d.date)).y(d => y(d.value)).curve(d3.curveMonotoneX);
    svg.append('path').datum(station.values).attr('d', area).attr('fill', color).attr('fill-opacity', .16);
    svg.append('path').datum(station.values).attr('d', line).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2.4);
    const last = station.values.filter(d => Number.isFinite(d.value)).at(-1);
    if (station.provisional && last) {
      svg.append('path').datum([last, station.provisional]).attr('d', line).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2.2).attr('stroke-dasharray', '5 4');
      svg.append('circle').attr('cx', x(station.provisional.date)).attr('cy', y(station.provisional.value)).attr('r', 3.5).attr('fill', color).attr('stroke', '#123f4d').attr('stroke-width', 1.25).append('title').text(`${station.name} · provisional (${station.provisional.pairs} hourly pairs) · ${station.provisional.value.toFixed(1)} cm`);
    }
    const labelPoint = station.provisional || last;
    if (labelPoint) svg.append('text').attr('x', x(labelPoint.date) + 9).attr('y', y(labelPoint.value) + 4).attr('fill', color).attr('font-family', 'DM Mono').attr('font-weight', 600).attr('font-size', 10).text(station.name);
    svg.selectAll(`.point-${index}`).data(station.values.filter(d => Number.isFinite(d.value))).join('circle').attr('class', `point-${index}`).attr('cx', d => x(d.date)).attr('cy', d => y(d.value)).attr('r', 7).attr('fill', 'transparent').append('title').text(d => `${station.name} · ${fmt(d.date)} · ${d.value.toFixed(1)} cm`);
  });
  svg.selectAll('.date-tick').data(d3.utcMonday.every(1).range(days[0], d3.utcDay.offset(days.at(-1), 1))).join('text').attr('class', 'date-tick').attr('x', d => x(d)).attr('y', height - 11).attr('text-anchor', 'middle').attr('fill', '#a6c5c3').attr('font-family', 'DM Mono').attr('font-size', 9).text(d => fmt(d));
  const marker = svg.append('line').attr('y1', margin.top).attr('y2', height - margin.bottom).attr('stroke', '#fff').attr('stroke-width', 1.5);
  window.mark = time => marker.attr('x1', x(days[time])).attr('x2', x(days[time]));
  mark(current);
}

function renderCalendar() {
  const el = $('#calendarHeatmap'), width = el.clientWidth, height = el.clientHeight, margin = { top: 4, right: 15, bottom: 28, left: 105 };
  d3.select(el).selectAll('*').remove();
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  const values = series.flatMap(s => s.values.map(d => d.value).filter(Number.isFinite));
  let [minimum, maximum] = d3.extent(values); if (minimum === maximum) { minimum -= 1; maximum += 1; }
  const x = d3.scaleBand().domain(d3.range(days.length)).range([margin.left, width - margin.right]).padding(.035);
  const y = d3.scaleBand().domain(series.map(d => d.name)).range([margin.top, height - margin.bottom]).padding(.1);
  const color = d3.scaleLinear().domain([minimum, (minimum + maximum) / 2, maximum]).range(['#287c9a', '#e8eadb', '#d6574f']).clamp(true);
  svg.selectAll('rect').data(series.flatMap(s => s.values.map((v, i) => ({ s, ...v, i })))).join('rect').attr('x', d => x(d.i)).attr('y', d => y(d.s.name)).attr('width', x.bandwidth()).attr('height', y.bandwidth()).attr('fill', d => Number.isFinite(d.value) ? color(d.value) : '#224b59').append('title').text(d => `${d.s.name} · ${fmt(d.date)} · ${Number.isFinite(d.value) ? `${d.value.toFixed(1)} cm` : 'no data'}`);
  svg.selectAll('.row').data(series).join('text').attr('x', margin.left - 9).attr('y', d => y(d.name) + y.bandwidth() / 2 + 4).attr('text-anchor', 'end').attr('fill', '#d4e1de').attr('font-family', 'DM Mono').attr('font-size', 9).text(d => d.name);
  svg.selectAll('.tick').data(d3.utcMonday.every(1).range(days[0], d3.utcDay.offset(days.at(-1), 1))).join('text').attr('x', d => x(days.findIndex(day => +day === +d)) + x.bandwidth() / 2).attr('y', height - 8).attr('text-anchor', 'middle').attr('fill', '#a6c5c3').attr('font-family', 'DM Mono').attr('font-size', 8).text(d => fmt(d));
  const marker = svg.append('line').attr('y1', margin.top).attr('y2', height - margin.bottom).attr('stroke', '#fff').attr('stroke-width', 1.25);
  const waveMarker = window.mark;
  window.mark = time => { waveMarker(time); marker.attr('x1', x(time) + x.bandwidth() / 2).attr('x2', x(time) + x.bandwidth() / 2); };
  window.mark(current);
}

function renderTransect() {
  const el = $('#transect'), width = el.clientWidth, height = 235, margin = { top: 18, right: 25, bottom: 34, left: 42 };
  d3.select(el).selectAll('*').remove();
  const peaks = findCandidate().peaks; if (!peaks.length) return;
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  const x = d3.scaleLinear().domain([0, 415]).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, days.length - 1]).range([height - margin.bottom, margin.top]);
  svg.append('path').datum(peaks).attr('d', d3.line().x(d => x(d.mi)).y(d => y(days.indexOf(d.peak.date)))).attr('stroke', '#d85d51').attr('stroke-width', 2).attr('fill', 'none');
  svg.append('path').datum(peaks).attr('d', d3.line().x(d => x(d.mi)).y(d => y(Math.min(days.length - 1, days.indexOf(peaks[0].peak.date) + d.mi / 150)))).attr('stroke', '#77a6aa').attr('stroke-dasharray', '4 4').attr('stroke-width', 1.4).attr('fill', 'none');
  svg.selectAll('circle').data(peaks).join('circle').attr('cx', d => x(d.mi)).attr('cy', d => y(days.indexOf(d.peak.date))).attr('r', 5).attr('fill', '#f5f2eb').attr('stroke', '#d85d51').attr('stroke-width', 2).append('title').text(d => `${d.name}: ${fmt(d.peak.date)}`);
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
$('#timeSlider').addEventListener('input', event => setTime(event.target.value));
$('#refresh').addEventListener('click', () => load().catch(showFailure));
$('#window').addEventListener('change', () => load().catch(showFailure));
$('#referenceToggle').addEventListener('change', event => { showReference = event.target.checked; renderAudit(); });
window.addEventListener('resize', render);
function showFailure(error) { console.error(error); $('#statusText').textContent = 'NOAA REQUEST FAILED'; $('#chartNote').textContent = 'The NOAA request could not be completed. Refresh to retry; no substitute data are shown.'; }
const satelliteScript = document.createElement('script');
satelliteScript.src = 'satellite.js';
satelliteScript.onload = () => { window.loadSatelliteContext?.({ start: dayKey(firstDay), end: dayKey(today) }); load().catch(showFailure); };
satelliteScript.onerror = () => load().catch(showFailure);
document.head.appendChild(satelliteScript);

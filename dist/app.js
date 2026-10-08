const stations = [
  ['San Diego', '9410170', 0], ['Los Angeles', '9410660', 125],
  ['Monterey', '9413450', 345], ['San Francisco', '9414290', 415]
].map(([name, id, mi]) => ({ name, id, mi }));

const $ = selector => document.querySelector(selector);
const fmt = d3.utcFormat('%d %b');
const dayKey = d3.utcFormat('%Y-%m-%d');
const today = new Date(); today.setUTCHours(0, 0, 0, 0);
const firstDay = new Date(Date.UTC(2026, 8, 1));
const days = d3.utcDay.range(firstDay, d3.utcDay.offset(today, 1));
let series = [], current = 0;

$('#rangeLabel').textContent = `SIGNAL FIELD / 01 SEP 2026 — ${fmt(today).toUpperCase()} 2026`;
$('#windowValue').textContent = `01 Sep–${fmt(today)}`;

function requestRange(start, end) {
  return `begin_date=${d3.utcFormat('%Y%m%d')(start)}&end_date=${d3.utcFormat('%Y%m%d')(end)}`;
}

async function requestProduct(station, product) {
  const split = d3.utcDay.offset(firstDay, 29);
  const chunks = [[firstDay, split], [d3.utcDay.offset(split, 1), today]].filter(([a]) => a <= today);
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

function residuals(water, predictions, hours) {
  const predicted = new Map(predictions.map(d => [d.t, +d.v]));
  const hourlyWater = d3.rollup(water, v => d3.mean(v, d => +d.v), d => `${d.t.slice(0, 13)}:00`);
  const daily = d3.rollup(
    [...hourlyWater].filter(([time]) => predicted.has(time)),
    rows => d3.mean(rows, ([time, level]) => level - predicted.get(time)),
    ([time]) => time.slice(0, 10)
  );
  const raw = days.map(date => ({ date, value: daily.get(dayKey(date)) ?? null }));
  const period = Math.max(1, Math.round(hours / 24));
  return raw.map((point, index) => {
    const values = raw.slice(Math.max(0, index - period + 1), index + 1).map(d => d.value).filter(Number.isFinite);
    return { ...point, value: values.length ? d3.mean(values) * 100 : null };
  });
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
    $('#statusText').textContent = 'NO SIMPLE CANDIDATE';
    $('#lag').innerHTML = 'No coherent<br><em>peak sequence</em>';
    $('#finding').textContent = 'The station peaks do not yet form three northward-ordered arrivals between 75 and 250 mi/day.';
  }
}

async function load() {
  $('#statusText').textContent = 'CONNECTING TO NOAA';
  $('#chartNote').textContent = 'Requesting observed water level and predicted tides from NOAA CO-OPS…';
  const hours = +$('#window').value;
  const results = await Promise.allSettled(stations.map(async station => {
    const [water, predictions] = await Promise.all([requestProduct(station.id, 'water_level'), requestProduct(station.id, 'predictions')]);
    return { ...station, values: residuals(water, predictions, hours) };
  }));
  series = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  $('#stationCount').textContent = `${series.length} / ${stations.length}`;
  if (!series.length) throw new Error('No station records returned');
  $('#chartNote').textContent = `Observed water level − predicted astronomical tide; ${hours}-hour rolling mean. ${series.length} NOAA stations returned data.`;
  $('#timeSlider').max = days.length - 1;
  setTime(Math.min(current, days.length - 1));
  updateFinding(); render();
  window.loadSatelliteContext?.({ start: dayKey(firstDay), end: dayKey(today) });
}

function render() { renderHeatmap(); renderTransect(); }
function renderHeatmap() {
  const el = $('#heatmap'), width = el.clientWidth, height = el.clientHeight, margin = { top: 8, right: 15, bottom: 34, left: 105 };
  d3.select(el).selectAll('*').remove();
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  const x = d3.scaleBand().domain(d3.range(days.length)).range([margin.left, width - margin.right]).padding(.035);
  const y = d3.scaleBand().domain(series.map(d => d.name)).range([margin.top, height - margin.bottom]).padding(.09);
  const color = d3.scaleLinear().domain([-12, 0, 12]).range(['#287c9a', '#e8eadb', '#d6574f']).clamp(true);
  svg.selectAll('rect').data(series.flatMap(s => s.values.map((v, i) => ({ s, ...v, i })))).join('rect').attr('x', d => x(d.i)).attr('y', d => y(d.s.name)).attr('width', x.bandwidth()).attr('height', y.bandwidth()).attr('fill', d => d.value === null ? '#224b59' : color(d.value)).append('title').text(d => `${d.s.name} · ${fmt(d.date)} · ${d.value === null ? 'no data' : `${d.value.toFixed(1)} cm`}`);
  svg.selectAll('.row').data(series).join('text').attr('x', margin.left - 9).attr('y', d => y(d.name) + y.bandwidth() / 2 + 4).attr('text-anchor', 'end').attr('fill', '#d4e1de').attr('font-family', 'DM Mono').attr('font-size', 10).text(d => d.name);
  svg.selectAll('.tick').data(d3.range(0, days.length, 7).concat(days.length - 1)).join('text').attr('x', d => x(d) + x.bandwidth() / 2).attr('y', height - 11).attr('text-anchor', 'middle').attr('fill', '#a6c5c3').attr('font-family', 'DM Mono').attr('font-size', 9).text(d => fmt(days[d]));
  const marker = svg.append('line').attr('y1', margin.top).attr('y2', height - margin.bottom).attr('stroke', '#fff').attr('stroke-width', 1.5);
  window.mark = time => marker.attr('x1', x(time) + x.bandwidth() / 2).attr('x2', x(time) + x.bandwidth() / 2);
  mark(current);
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

function setTime(value) { current = +value; $('#timeSlider').value = current; $('#timeLabel').textContent = fmt(days[current]); if (window.mark) mark(current); }
$('#timeSlider').addEventListener('input', event => setTime(event.target.value));
$('#refresh').addEventListener('click', () => load().catch(showFailure));
$('#window').addEventListener('change', () => load().catch(showFailure));
window.addEventListener('resize', render);
function showFailure(error) { console.error(error); $('#statusText').textContent = 'NOAA REQUEST FAILED'; $('#chartNote').textContent = 'The NOAA request could not be completed. Refresh to retry; no substitute data are shown.'; }
const satelliteScript = document.createElement('script');
satelliteScript.src = 'satellite.js';
satelliteScript.onload = () => load().catch(showFailure);
satelliteScript.onerror = () => load().catch(showFailure);
document.head.appendChild(satelliteScript);

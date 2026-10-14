(() => {
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = 'dashboard/satellite.css'; document.head.appendChild(stylesheet);
  const endpoint = '/api/satellite-sla';
  const stations = ['San Diego offshore', 'Los Angeles offshore', 'Monterey offshore', 'San Francisco offshore'];
  const gaugeLocations = {
    'San Diego offshore': [32.7156, -117.1767],
    'Los Angeles offshore': [33.7200, -118.2720],
    'Monterey offshore': [36.6050, -121.8880],
    'San Francisco offshore': [37.8067, -122.4650]
  };
  const section = document.createElement('section');
  section.className = 'satellite-context';
  section.innerHTML = `<div class="satellite-copy"><div class="eyebrow">SATELLITE CONTEXT / OPTIONAL LAYER</div><h2>Offshore satellite context</h2><p>Daily Copernicus DUACS Level-4 multi-mission altimetry, gridded at 0.125° and sampled at four offshore points. The sampled grid cells are about 13–50 miles from their corresponding coastal gauges—not direct Sentinel-6 ground tracks. The broad view uses each point’s August 1–7 average, avoiding an overreaction to a single reference day. The short-term view compares each day with its preceding seven-day mean.</p><p class="satellite-status" id="satelliteStatus">Satellite proxy not configured.</p></div><div class="satellite-card"><div class="card-top"><span id="satelliteTitle">ΔSLA VS 01–07 AUG MEAN <b>CM</b></span><span id="satelliteUpdated">WAITING FOR DATA</span></div><div class="satellite-toggle" role="group" aria-label="Satellite comparison mode"><button data-satellite-mode="broad" class="active">Broad change</button><button data-satellite-mode="short">Short-term change</button></div><div id="satelliteViz" aria-live="polite"></div></div>`;
  document.querySelector('.dashboard').insertAdjacentElement('afterend', section);
  let comparisonMode = 'broad', loadedPoints = [], loadedUpdatedAt = null;
  function showMessage(message) { document.querySelector('#satelliteStatus').textContent = message; document.querySelector('#satelliteViz').innerHTML = '<div class="satellite-empty">Satellite data will appear here after the server-side Copernicus extract is configured.</div>'; }
  function gaugeDistanceMiles(point) {
    if (!point) return null;
    const gauge = gaugeLocations[point.station]; if (!gauge) return null;
    const radians = Math.PI / 180, lat1 = gauge[0] * radians, lat2 = point.lat * radians;
    const a = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(((point.lon - gauge[1]) * radians) / 2) ** 2;
    return Math.round(3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }
  function comparisonValues(points) {
    const byStation = d3.group(points, d => d.station);
    return points.map(point => {
      const stationPoints = [...byStation.get(point.station)].sort((a, b) => a.date.localeCompare(b.date));
      const index = stationPoints.findIndex(d => d.date === point.date);
      if (comparisonMode === 'broad') {
        const baseline = d3.mean(stationPoints.slice(0, 7), d => d.sla_cm);
        return { ...point, change_cm: point.sla_cm - baseline, baseline, sufficient: true };
      }
      const prior = stationPoints.slice(Math.max(0, index - 7), index);
      const baseline = prior.length >= 5 ? d3.mean(prior, d => d.sla_cm) : null;
      return { ...point, change_cm: Number.isFinite(baseline) ? point.sla_cm - baseline : null, baseline, sufficient: Number.isFinite(baseline) };
    });
  }
  function render(points, updatedAt) {
    const mount = document.querySelector('#satelliteViz'), dates = [...new Set(points.map(d => d.date))].sort(), width = mount.clientWidth, height = 190, margin = { top: 10, right: 10, bottom: 29, left: 125 };
    const changes = comparisonValues(points), validChanges = changes.filter(d => Number.isFinite(d.change_cm));
    const spread = Math.max(2, Math.ceil((d3.max(validChanges, d => Math.abs(d.change_cm)) || 2) / 2) * 2);
    mount.innerHTML = ''; const svg = d3.select(mount).append('svg').attr('width', width).attr('height', height), x = d3.scaleBand().domain(dates).range([margin.left, width - margin.right]).padding(.05), y = d3.scaleBand().domain(stations).range([margin.top, height - margin.bottom]).padding(.12), color = d3.scaleLinear().domain([-spread, 0, spread]).range(['#287c9a', '#e8eadb', '#d6574f']).clamp(true);
    const modeLabel = comparisonMode === 'broad' ? 'vs 01–07 Aug mean' : 'vs preceding 7-day mean';
    svg.selectAll('rect').data(changes).join('rect').attr('x', d => x(d.date)).attr('y', d => y(d.station)).attr('width', x.bandwidth()).attr('height', y.bandwidth()).attr('fill', d => Number.isFinite(d.change_cm) ? color(d.change_cm) : '#d8dfd8').append('title').text(d => Number.isFinite(d.change_cm) ? `${d.station} · ${d.date} · ${d.change_cm >= 0 ? '+' : ''}${d.change_cm.toFixed(1)} cm ${modeLabel} · source SLA ${d.sla_cm.toFixed(1)} cm vs 1993–2012 mean` : `${d.station} · ${d.date} · insufficient preceding observations for a 7-day comparison`);
    svg.selectAll('.label').data(stations).join('text').attr('x', margin.left - 8).attr('y', d => y(d) + y.bandwidth() / 2 + 4).attr('text-anchor', 'end').attr('font-family', 'DM Mono').attr('font-size', 8).attr('fill', '#31545e').text(d => `${d} · ${gaugeDistanceMiles(points.find(point => point.station === d))} mi`);
    svg.selectAll('.date').data(dates.filter((_, i) => i % 7 === 0 || i === dates.length - 1)).join('text').attr('x', d => x(d) + x.bandwidth() / 2).attr('y', height - 8).attr('text-anchor', 'middle').attr('font-family', 'DM Mono').attr('font-size', 8).attr('fill', '#60787d').text(d => d.slice(5));
    document.querySelector('#satelliteTitle').innerHTML = `${comparisonMode === 'broad' ? 'ΔSLA VS 01–07 AUG MEAN' : 'ΔSLA VS PRECEDING 7-DAY MEAN'} <b>CM</b>`;
    document.querySelector('#satelliteStatus').textContent = `${points.length} satellite point-days loaded · ${modeLabel} · ±${spread} cm scale.`; document.querySelector('#satelliteUpdated').textContent = updatedAt ? `UPDATED ${updatedAt.slice(0, 10)}` : 'NRT EXTRACT';
  }
  document.querySelectorAll('[data-satellite-mode]').forEach(button => button.addEventListener('click', () => { comparisonMode = button.dataset.satelliteMode; document.querySelectorAll('[data-satellite-mode]').forEach(item => item.classList.toggle('active', item === button)); if (loadedPoints.length) render(loadedPoints, loadedUpdatedAt); }));
  window.loadSatelliteContext = async ({ start, end }) => { try { let response = await fetch(`${endpoint}?start=${start}&end=${end}`); if (!response.ok) response = await fetch('data/satellite-sla.json'); if (!response.ok) throw new Error('extract unavailable'); const payload = await response.json(); const points = (payload.points || []).filter(d => d.date >= start && d.date <= end); if (!points.length) throw new Error('empty extract'); loadedPoints = points; loadedUpdatedAt = payload.updated_at; render(loadedPoints, loadedUpdatedAt); } catch { showMessage('Satellite extract not found. Run scripts/fetch_satellite_sla.py locally to add it.'); } };
  showMessage('Satellite proxy not configured. NOAA gauge analysis remains available.');
})();

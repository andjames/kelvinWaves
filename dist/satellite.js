(() => {
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = 'satellite.css'; document.head.appendChild(stylesheet);
  const endpoint = '/api/satellite-sla';
  const stations = ['San Diego offshore', 'Los Angeles offshore', 'Monterey offshore', 'San Francisco offshore'];
  const section = document.createElement('section');
  section.className = 'satellite-context';
  section.innerHTML = `<div class="satellite-copy"><div class="eyebrow">SATELLITE CONTEXT / OPTIONAL LAYER</div><h2>Offshore sea-level anomaly</h2><p>Daily Copernicus satellite altimetry sampled at four offshore points. It is context for the coastal gauges—not a substitute for them.</p><p class="satellite-status" id="satelliteStatus">Satellite proxy not configured.</p></div><div class="satellite-card"><div class="card-top"><span>SATELLITE SLA <b>CM</b></span><span id="satelliteUpdated">WAITING FOR DATA</span></div><div id="satelliteViz" aria-live="polite"></div></div>`;
  document.querySelector('.dashboard').insertAdjacentElement('afterend', section);
  function showMessage(message) { document.querySelector('#satelliteStatus').textContent = message; document.querySelector('#satelliteViz').innerHTML = '<div class="satellite-empty">Satellite data will appear here after the server-side Copernicus extract is configured.</div>'; }
  function render(points, updatedAt) {
    const mount = document.querySelector('#satelliteViz'), dates = [...new Set(points.map(d => d.date))].sort(), width = mount.clientWidth, height = 190, margin = { top: 10, right: 10, bottom: 29, left: 125 };
    mount.innerHTML = ''; const svg = d3.select(mount).append('svg').attr('width', width).attr('height', height), x = d3.scaleBand().domain(dates).range([margin.left, width - margin.right]).padding(.05), y = d3.scaleBand().domain(stations).range([margin.top, height - margin.bottom]).padding(.12), color = d3.scaleLinear().domain([-12, 0, 12]).range(['#287c9a', '#e8eadb', '#d6574f']).clamp(true);
    svg.selectAll('rect').data(points).join('rect').attr('x', d => x(d.date)).attr('y', d => y(d.station)).attr('width', x.bandwidth()).attr('height', y.bandwidth()).attr('fill', d => color(d.sla_cm)).append('title').text(d => `${d.station} · ${d.date} · ${d.sla_cm.toFixed(1)} cm`);
    svg.selectAll('.label').data(stations).join('text').attr('x', margin.left - 8).attr('y', d => y(d) + y.bandwidth() / 2 + 4).attr('text-anchor', 'end').attr('font-family', 'DM Mono').attr('font-size', 9).attr('fill', '#31545e').text(d => d);
    svg.selectAll('.date').data(dates.filter((_, i) => i % 7 === 0 || i === dates.length - 1)).join('text').attr('x', d => x(d) + x.bandwidth() / 2).attr('y', height - 8).attr('text-anchor', 'middle').attr('font-family', 'DM Mono').attr('font-size', 8).attr('fill', '#60787d').text(d => d.slice(5));
    document.querySelector('#satelliteStatus').textContent = `${points.length} satellite point-days loaded.`; document.querySelector('#satelliteUpdated').textContent = updatedAt ? `UPDATED ${updatedAt.slice(0, 10)}` : 'NRT EXTRACT';
  }
  window.loadSatelliteContext = async ({ start, end }) => { try { const response = await fetch(`${endpoint}?start=${start}&end=${end}`); if (!response.ok) throw new Error('endpoint unavailable'); const payload = await response.json(); if (!Array.isArray(payload.points) || !payload.points.length) throw new Error('empty extract'); render(payload.points, payload.updated_at); } catch { showMessage('Satellite proxy not configured. NOAA gauge analysis remains available.'); } };
  showMessage('Satellite proxy not configured. NOAA gauge analysis remains available.');
})();

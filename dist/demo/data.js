/* Global d3 */
(() => {
  "use strict";
  const API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
  const START = "20260801";
  const colors = ["#f17866", "#edaa65", "#c8a6e5", "#83cfc8", "#f1d28b", "#94cfc2", "#e192a9", "#74b3ce", "#d9b782", "#b5a3df"];
  const stations = [
    ["San Diego", "9410170", 0], ["Los Angeles", "9410660", 120], ["Santa Barbara", "9411340", 205],
    ["Port San Luis", "9412110", 295], ["Monterey", "9413450", 405], ["San Francisco", "9414290", 505],
    ["Point Reyes", "9415020", 555], ["Arena Cove", "9416841", 645], ["North Spit", "9418767", 805], ["Crescent City", "9419750", 950]
  ].map(([name, id, miles], index) => ({ name, id, miles, color: colors[index] }));
  const valid = value => value !== "" && value !== null && value !== undefined && Number.isFinite(+value);
  const ymd = d => d.toISOString().slice(0, 10).replaceAll("-", "");
  const dateKey = d3.utcFormat("%Y-%m-%d");
  const fmtDay = d3.utcFormat("%b %d");
  const utcDay = value => new Date(`${value.slice(0, 10)}T00:00:00Z`);

  function chunks() {
    const end = new Date();
    const start = new Date(`${START.slice(0, 4)}-${START.slice(4, 6)}-${START.slice(6, 8)}T00:00:00Z`);
    const parts = [];
    for (let cursor = new Date(start); cursor <= end;) {
      const stop = new Date(Math.min(+end, +cursor + 28 * 864e5));
      parts.push([ymd(cursor), ymd(stop)]);
      cursor = new Date(+stop + 864e5);
    }
    return parts;
  }
  async function getProduct(station, product) {
    const rows = await Promise.all(chunks().map(async ([begin_date, end_date]) => {
      const query = new URLSearchParams({ product, application: "kelvin-wave-demo", begin_date, end_date, station: station.id, time_zone: "gmt", units: "metric", datum: "MLLW", format: "json", interval: product === "predictions" ? "h" : "" });
      if (!query.get("interval")) query.delete("interval");
      const response = await fetch(`${API}?${query}`);
      if (!response.ok) throw new Error(`${station.name}: ${product} unavailable`);
      const json = await response.json();
      return product === "predictions" ? (json.predictions || []) : (json.data || []);
    }));
    return rows.flat();
  }
  function prepare(observed, predicted) {
    const tides = new Map();
    predicted.forEach(row => { if (row.t && valid(row.v)) tides.set(row.t.slice(0, 13), +row.v); });
    const hourly = Array.from(d3.group(observed.filter(row => row.t && valid(row.v)), row => row.t.slice(0, 13)), ([hour, rows]) => {
      const tide = tides.get(hour);
      return Number.isFinite(tide) ? { time: new Date(`${hour.replace(" ", "T")}:00:00Z`), residual: (d3.mean(rows, row => +row.v) - tide) * 100 } : null;
    }).filter(Boolean).sort((a, b) => a.time - b.time);
    const daily = Array.from(d3.group(hourly, row => dateKey(row.time)), ([day, rows]) => rows.length >= 18 ? { date: utcDay(day), value: d3.mean(rows, row => row.residual), count: rows.length } : null).filter(Boolean).sort((a, b) => a.date - b.date);
    return {
      hours: hourly,
      days: daily.map((row, index) => ({ ...row, smoothed: d3.mean(daily.slice(Math.max(0, index - 1), index + 1), d => d.value) }))
    };
  }
  async function loadStation(station) {
    try {
      const [observed, predicted] = await Promise.all([getProduct(station, "water_level"), getProduct(station, "predictions")]);
      return { ...station, ...prepare(observed, predicted) };
    } catch (error) {
      console.warn(error);
      return { ...station, hours: [], days: [] };
    }
  }
  window.DemoData = { fmtDay, dateKey, load: () => Promise.all(stations.map(loadStation)) };
})();

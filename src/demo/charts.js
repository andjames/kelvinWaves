/*
  Chart module registry
  ---------------------
  The scene renderers are registered here by demo.js after live data has
  loaded. Keeping the registry separate gives each scrollytelling section a
  stable, inspectable boundary while the shared NOAA request stays in
  data.js.
*/
(() => {
  "use strict";
  const charts = new Map();
  window.DemoCharts = {
    register(name, renderer) { charts.set(name, renderer); },
    render(name) { return charts.get(name)?.(); },
    renderAll() { charts.forEach(renderer => renderer()); },
    names() { return [...charts.keys()]; }
  };
})();

/* Global d3, scrollama */
(() => {
  "use strict";

  const API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
  const START = "20260801";
  const colors = ["#f17866", "#edaa65", "#c8a6e5", "#83cfc8", "#f1d28b", "#94cfc2", "#e192a9", "#74b3ce", "#d9b782", "#b5a3df"];
  const stations = [
    ["San Diego", "9410170", 0],
    ["Los Angeles", "9410660", 120],
    ["Santa Barbara", "9411340", 205],
    ["Port San Luis", "9412110", 295],
    ["Monterey", "9413450", 405],
    ["San Francisco", "9414290", 505],
    ["Point Reyes", "9415020", 555],
    ["Arena Cove", "9416841", 645],
    ["North Spit", "9418767", 805],
    ["Crescent City", "9419750", 950]
  ].map(([name, id, miles], index) => ({
    name,
    id,
    miles,
    color: colors[index]
  }));

  const fmtDay = d3.utcFormat("%b %d");
  const dateKey = d3.utcFormat("%Y-%m-%d");
  const loading = document.querySelector(".demo-loading");
  let model = [];
  let satelliteModel = [];
  // Append ?cinematic=0 to demo.html to return to the unembellished intro.
  const cinematicIntro = new URLSearchParams(window.location.search).get("cinematic") !== "0";
  const introTune = { chartStartsAt: .48, chartRevealDuration: .22 };
  
  const waveTune = {
    morphStart: .02, morphEnd: .30,
    // crest forms early, then vacates the plot before the real chart enters.
    mergeStart: .22, mergeEnd: .34,
    surfaceAtMerge: .30, surfaceAtEnd: -.12,
    amp: 26, wavelength: .45, speed: 1.1, scrollPhase: 14,
    laneGap: 38, crestColor: "#a8e6ee"
  };
  const waterSvg = document.querySelector(".demo-water-fill");
  const waterBody = document.querySelector("#water-body");
  const waveState = { progress: 0 };
  const setWaveProgress = window.gsap ? gsap.quickTo(waveState, "progress", { duration: .6, ease: "power2.out" }) : value => { waveState.progress = value; };
  const inOut = window.gsap ? gsap.parseEase("power2.inOut") : value => value;
  const lerp = window.gsap ? gsap.utils.interpolate : (a, b, amount) => a + (b - a) * amount;
  const waveLine = d3.line().curve(d3.curveBasis);
  let openingState = null;

  const valid = value => value !== "" && value !== null && value !== undefined && Number.isFinite(+value);
  const ymd = d => d.toISOString().slice(0, 10).replaceAll("-", "");
  const utcDay = value => new Date(`${value.slice(0, 10)}T00:00:00Z`);

  const clamp = value => Math.max(0, Math.min(1, value));
  function waveOffset(px, k, phase, shift, amplitude) {
    return Math.sin(px * k - phase - shift) * amplitude
      + Math.sin(px * k * 2.3 + phase * 1.35 + shift * 1.3) * amplitude * .22;
  }

  if (window.gsap) gsap.ticker.add(time => {
    if (!openingState) return;
    const { points, paths, colors: lineColors, width, height } = openingState;
    const progress = waveState.progress;
    const morph = inOut(clamp((progress - waveTune.morphStart) / (waveTune.morphEnd - waveTune.morphStart)));
    const merge = inOut(clamp((progress - waveTune.mergeStart) / (waveTune.mergeEnd - waveTune.mergeStart)));
    const rise = inOut(clamp((progress - waveTune.mergeEnd) / (1 - waveTune.mergeEnd)));
    const k = (Math.PI * 2) / (width * waveTune.wavelength);
    const phase = time * waveTune.speed + progress * waveTune.scrollPhase;
    const level = lerp(height * waveTune.surfaceAtMerge, height * waveTune.surfaceAtEnd, rise);

    if (morph > 0) {
      if (!openingState.morphing) {
        d3.selectAll(paths).interrupt().attr("stroke-dasharray", null).attr("stroke-dashoffset", null);
        openingState.morphing = true;
      }
      paths.forEach((path, index) => {
        const line = points[index];
        const x0 = line[0][0], x1 = line.at(-1)[0];
        const lane = lerp(height * .45 + (index - 1.5) * waveTune.laneGap, level, merge);
        const shift = index * .8 * (1 - merge);
        path.setAttribute("d", waveLine(line.map(([x, y]) => {
          const fullWidthX = ((x - x0) / (x1 - x0)) * width;
          const waveY = lane + waveOffset(fullWidthX, k, phase, shift, waveTune.amp);
          return [lerp(x, fullWidthX, morph), lerp(y, waveY, morph)];
        })));
        path.setAttribute("stroke", d3.interpolateRgb(lineColors[index], waveTune.crestColor)(merge));
        path.style.strokeWidth = `${lerp(3, 2, merge)}px`;
      });
    } else if (openingState.morphing) {
      paths.forEach((path, index) => {
        path.setAttribute("d", waveLine(points[index]));
        path.setAttribute("stroke", lineColors[index]);
        path.style.strokeWidth = "";
      });
      openingState.morphing = false;
    }

    if (merge > 0) {
      const step = Math.max(8, width / 120);
      const crest = d3.range(0, width + step, step).map(x => [x, level + waveOffset(x, k, phase, 0, waveTune.amp)]);
      waterBody?.setAttribute("d", `${waveLine(crest)}L${width},${height}L0,${height}Z`);
    } else {
      waterBody?.setAttribute("d", "");
    }
    if (waterBody) waterBody.style.opacity = merge;
  });

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
    const requests = chunks().map(async([begin_date, end_date]) => {
      const query = new URLSearchParams({
        product,
        application: "pacific_pulse",
        begin_date,
        end_date,
        station: station.id,
        time_zone: "gmt",
        units: "metric",
        datum: "MLLW",
        format: "json",
        interval: product === "predictions" ? "h" : ""
      });
      if (!query.get("interval")) query.delete("interval");
      const response = await fetch(`${API}?${query}`);
      const json = await response.json();
      if (!response.ok || json.error) throw new Error(json.error?.message || `${station.name}: ${product} returned ${response.status}`);
      return product === "predictions" ? (json.predictions || []) : (json.data || []);
    });
    return (await Promise.all(requests)).flat();
  }

  function hourlyResiduals(observed, predicted) {
    const predictions = new Map();
    predicted.forEach(row => {
      if (row.t && valid(row.v)) predictions.set(row.t.slice(0, 13), +row.v);
    });
    const buckets = d3.group(observed.filter(row => row.t && valid(row.v)), row => row.t.slice(0, 13));
    return Array.from(buckets, ([hour, rows]) => {
      const tide = predictions.get(hour);
      if (!Number.isFinite(tide)) return null;
      return {
        time: new Date(`${hour.replace(" ", "T")}:00:00Z`),
        residual: (d3.mean(rows, row => +row.v) - tide) * 100
      };
    }).filter(Boolean).sort((a, b) => a.time - b.time);
  }

  function dailyResiduals(hours) {
    return Array.from(d3.group(hours, row => dateKey(row.time)), ([day, rows]) => {
      if (rows.length < 18) return null;
      return {
        date: utcDay(day),
        value: d3.mean(rows, row => row.residual),
        count: rows.length
      };
    }).filter(Boolean).sort((a, b) => a.date - b.date);
  }

  function smooth(data, days = 2) {
    return data.map((d, i) => {
      const portion = data.slice(Math.max(0, i - days + 1), i + 1).map(row => row.value);
      return {...d,
        smoothed: d3.mean(portion)
      };
    });
  }

  async function loadStation(station) {
    try {
      const [observed, predicted] = await Promise.all([getProduct(station, "water_level"), getProduct(station, "predictions")]);
      const hours = hourlyResiduals(observed, predicted);
      return {...station,
        hours,
        days: smooth(dailyResiduals(hours))
      };
    } catch (error) {
      console.warn(error);
      return {...station,
        hours: [],
        days: []
      };
    }
  }

  async function loadSatellite() {
    try {
      const payload = await (await fetch("data/satellite-sla.json")).json();
      return Array.from(d3.group(payload.points || [], point => point.station), ([name, points]) => {
        const ordered = points.slice().sort((a, b) => a.date.localeCompare(b.date));
        return { name, points: ordered.map((point, index) => {
          const prior = ordered.slice(Math.max(0, index - 7), index);
          const baseline = prior.length >= 5 ? d3.mean(prior, row => row.sla_cm) : null;
          return { ...point, change: Number.isFinite(baseline) ? point.sla_cm - baseline : null };
        }) };
      });
    } catch (error) { console.warn("Satellite context unavailable", error); return []; }
  }

  async function loadCachedStations() {
    const response = await fetch("data/demo-noaa-cache.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Local NOAA cache is missing");
    const payload = await response.json();
    return (payload.stations || []).map(cached => {
      const station = stations.find(item => item.id === cached.id) || cached;
      const hours = (cached.hours || []).map(point => ({ time: new Date(point.t), residual: +point.r })).filter(point => Number.isFinite(point.residual));
      return { ...station, hours, days: smooth(dailyResiduals(hours)) };
    });
  }

  async function loadStationsInBatches(batchSize = 2) {
    const loaded = [];
    for (let index = 0; index < stations.length; index += batchSize) {
      loaded.push(...await Promise.all(stations.slice(index, index + batchSize).map(loadStation)));
    }
    return loaded;
  }

  function dimensions(selector, margins) {
    const node = document.querySelector(selector);
    const box = node.getBoundingClientRect();
    return {
      svg: d3.select(node).attr("viewBox", `0 0 ${box.width} ${box.height}`),
      width: box.width,
      height: box.height,
      m: margins
    };
  }

  function dateDomain() {
    const all = model.flatMap(d => d.days.map(v => v.date));
    return d3.extent(all);
  }
//where we build the first lines, then send it to gsap.
  function renderIntroWaves() {
    if (!model.some(station => station.days.length)) return;
    const { svg, width, height } = dimensions("#intro-wave-chart");
    svg.selectAll("*").remove();
    const m = { top: 88, right: 70, bottom: 88, left: 70 };

    // ["San Diego"],
    // ["Los Angeles", "9410660", 120],
    // ["Santa Barbara", "9411340", 205],
    // ["Port San Luis", "9412110", 295],
    // ["Monterey", "9413450", 405],
    // ["San Francisco", "9414290", 505],
    // ["Point Reyes", "9415020", 555],
    // ["Arena Cove", "9416841", 645],
    // ["North Spit", "9418767", 805],
    // ["Crescent City", "9419750", 950]
    // The opening uses the same four primary traces as the annotated chart.
    // Keeping the data and color arrays one-to-one is essential: these paths
    // become the individual waves before they merge into the water surface.
    const focus = model.filter(d => ["San Diego", "Los Angeles", "Monterey", "San Francisco"].includes(d.name));
    const primaryColors = ["#ef806e", "#7fc8bf", "#a99bd0", "#efba72"];
    const values = focus.flatMap(station => station.days.map(point => point.smoothed)).filter(Number.isFinite);
    let [minimum, maximum] = d3.extent(values);
    if (minimum === maximum) { minimum -= 1; maximum += 1; }
    const x = d3.scaleUtc().domain(dateDomain()).range([m.left, width - m.right]);
    const y = d3.scaleLinear().domain([minimum, maximum]).nice().range([height - m.bottom, m.top]);
    const line = d3.line().defined(d => Number.isFinite(d.smoothed)).x(d => x(d.date)).y(d => y(d.smoothed)).curve(d3.curveCatmullRom.alpha(.45));
    const track = svg.append("g").attr("id", "intro-wave-track");
    focus.forEach((station, index) => {
      track.append("path")
        .attr("class", "intro-wave-line intro-wave-line--data")
        .datum(station.days)
        .attr("d", line)
        .attr("stroke", primaryColors[index]);
    });
    openingState = {
      width,
      height,
      paths: track.selectAll("path").nodes(),
      colors: primaryColors,
      points: focus.map(station => station.days.filter(point => Number.isFinite(point.smoothed)).map(point => [x(point.date), y(point.smoothed)])),
      morphing: false
    };
    waterSvg?.setAttribute("viewBox", `0 0 ${width} ${height}`);
    if (!window.__introWaveStrokeAnimated) {
      window.__introWaveStrokeAnimated = true;
      requestAnimationFrame(() => {
        track.selectAll("path").each(function(_, index) {
          const length = this.getTotalLength();
          d3.select(this).attr("stroke-dasharray", `${length} ${length}`).attr("stroke-dashoffset", length)
            .transition().delay(index * 120).duration(1450).ease(d3.easeCubicOut)
            .attr("stroke-dashoffset", 0).on("end", function() { d3.select(this).attr("stroke-dasharray", null); });
        });
      });
    }
  }

  function renderIntro(progress = 0) {
    if (!model.some(station => station.days.length)) return;
    const {
      svg,
      width,
      height
    } = dimensions("#intro-chart", {
      top: 50,
      right: 100,
      bottom: 40,
      left: 55
    });
    svg.selectAll("*").remove();
    const compact = width <= 700;
    const m = compact
      ? { top: 88, right: 112, bottom: 50, left: 44 }
      : { top: 130, right: 150, bottom: 66, left: 72 };
    const focus = model.filter(d => ["San Diego", "Los Angeles", "Monterey", "San Francisco"].includes(d.name));
    const primaryColors = ["#ef806e", "#7fc8bf", "#a99bd0", "#efba72"];
    // Context traces share the same axis as the primary gauges. Include them
    // in the extent so a valid negative residual cannot escape the plot area.
    const values = model.flatMap(d => d.days.map(v => v.smoothed));
    const x = d3.scaleUtc().domain(dateDomain()).range([m.left, width - m.right]);
    const y = d3.scaleLinear().domain(d3.extent(values)).nice().range([height - m.bottom, m.top]);
    const guideOpacity = Math.max(0, Math.min(1, (progress - .48) / .38));
    svg.append("g").attr("class", "grid").attr("opacity", guideOpacity).attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(width - m.left - m.right)).tickFormat("")).select(".domain").remove();
    // Area is visual context for the primary traces, so it fills to the plot
    // baseline rather than the residual's zero line.
    const area = d3.area().defined(d => Number.isFinite(d.smoothed)).x(d => x(d.date)).y0(height - m.bottom).y1(d => y(d.smoothed)).curve(d3.curveCatmullRom.alpha(.45));
    const line = d3.line().defined(d => Number.isFinite(d.smoothed)).x(d => x(d.date)).y(d => y(d.smoothed)).curve(d3.curveCatmullRom.alpha(.45));
    // Match the dashboard's opening view: four primary gauges on a shared
    // vertical scale, with the other stations only as quiet coastal context.
    model.filter(station => !focus.includes(station)).forEach(station => {
      svg.append("path").attr("class", "intro-line intro-line--context").datum(station.days).attr("d", line).attr("fill", "none").attr("stroke", "#91b4ba").attr("stroke-width", 1.15).attr("stroke-opacity", .42);
    });
    const endLabels = [];
    focus.forEach((station, index) => {
      const color = primaryColors[index];
      const latest = station.days.findLast(point => Number.isFinite(point.smoothed));
      svg.append("path").datum(station.days).attr("d", area).attr("fill", color).attr("opacity", .16 * guideOpacity);
      svg.append("path").attr("class", "intro-line intro-line--primary").datum(station.days).attr("d", line).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2.4).attr("opacity", 1);
      if (latest) endLabels.push({
        name: station.name,
        color,
        x: x(latest.date),
        desiredY: y(latest.smoothed)
      });
    });

    // End values often finish within a few pixels of one another. Relax the
    // labels vertically while preserving each line's own color.
    const labelGap = compact ? 16 : 19;
    const labelTop = m.top + 10;
    const labelBottom = height - m.bottom - 8;
    endLabels.sort((a, b) => a.desiredY - b.desiredY);
    endLabels.forEach((label, index) => {
      label.y = Math.max(label.desiredY, index ? endLabels[index - 1].y + labelGap : labelTop);
    });
    for (let index = endLabels.length - 1; index >= 0; index -= 1) {
      const next = endLabels[index + 1];
      endLabels[index].y = Math.min(endLabels[index].y, next ? next.y - labelGap : labelBottom);
    }
    endLabels.forEach(label => {
      const labelX = label.x + 12;
      svg.append("text")
        .attr("class", "chart-label intro-end-label")
        .attr("opacity", guideOpacity)
        .attr("x", labelX).attr("y", label.y + 4)
        // A style wins over the shared chart-label fill rule, keeping the
        // label unmistakably paired with its line without a leader line.
        .style("fill", label.color)
        .text(label.name);
    });
    svg.append("g").attr("class", "axis").attr("opacity", guideOpacity).attr("transform", `translate(0,${height - m.bottom})`).call(d3.axisBottom(x).ticks(compact ? 4 : 7).tickFormat(fmtDay));
    svg.append("g").attr("class", "axis").attr("opacity", guideOpacity).attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(5));
    svg.append("text").attr("class", "chart-label chart-label--muted").attr("opacity", guideOpacity).attr("x", m.left).attr("y", m.top - 18).text("OBSERVED − PREDICTED / 48-HOUR AVG");

    // Run once only: subsequent redraws are driven by scrolling and should not
    // make the chart re-draw itself each time a label fades in.
    if (!window.__introStrokeAnimated) {
      window.__introStrokeAnimated = true;
      requestAnimationFrame(() => {
        svg.selectAll(".intro-line").each(function(_, index, nodes) {
          const length = this.getTotalLength();
          const primary = this.classList.contains("intro-line--primary");
          d3.select(this)
            .attr("stroke-dasharray", `${length} ${length}`)
            .attr("stroke-dashoffset", length)
            .transition()
            .delay((primary ? 340 : 0) + index * (primary ? 95 : 38))
            .duration(primary ? 1350 : 950)
            .ease(d3.easeCubicOut)
            .attr("stroke-dashoffset", 0)
            .on("end", function() { d3.select(this).attr("stroke-dasharray", null); });
        });
      });
    }
  }

  function renderCalendar() {
    const {
      svg,
      width,
      height
    } = dimensions("#calendar-chart");
    svg.selectAll("*").remove();
    const compact = width <= 700;
    const m = compact
      ? { top: 72, right: 14, bottom: 44, left: 116 }
      : { top: 150, right: 55, bottom: 60, left: 170 };
    const dates = d3.utcDay.range(...[dateDomain()[0], d3.utcDay.offset(dateDomain()[1], 1)]);
    const x = d3.scaleBand().domain(dates.map(dateKey)).range([m.left, width - m.right]).paddingInner(.035);
    const y = d3.scaleBand().domain(model.map(d => d.name)).range([m.top, height - m.bottom]).paddingInner(.15);
    let [minimum, maximum] = d3.extent(model.flatMap(d => d.days.map(v => v.value)).filter(Number.isFinite));
    if (minimum === maximum) { minimum -= 1; maximum += 1; }
    // Match the dashboard calendar: the middle color is the observed range's
    // midpoint, rather than an arbitrary zero that can flatten a mostly
    // positive period.
    const color = d3.scaleLinear()
      .domain([minimum, (minimum + maximum) / 2, maximum])
      .range(["#287c9a", "#e8eadb", "#d6574f"])
      .clamp(true);
    const maps = new Map(model.map(station => [station.name, new Map(station.days.map(v => [dateKey(v.date), v]))]));
    model.forEach(station => {
      svg.append("text").attr("class", "chart-label").attr("x", m.left - 8).attr("y", y(station.name) + y.bandwidth() * .63).attr("text-anchor", "end").text(compact ? station.name : `${station.name} · ${station.miles} mi`);
      const byDay = maps.get(station.name);
      const cells = svg.append("g").selectAll("rect").data(dates.map((date, dayIndex) => ({ date, dayIndex, stationIndex: model.indexOf(station), point: byDay.get(dateKey(date)) }))).join("rect")
        .attr("x", d => x(dateKey(d.date))).attr("y", y(station.name)).attr("width", x.bandwidth()).attr("height", y.bandwidth())
        .attr("fill", d => d.point ? color(d.point.value) : "#112d37").attr("opacity", d => d.point ? .95 : .32);
      if (!window.__calendarCellsAnimated) cells.attr("opacity", 0).transition().delay(d => d.dayIndex * 9 + d.stationIndex * 24).duration(210).ease(d3.easeCubicOut).attr("opacity", d => d.point ? .95 : .32);

      // The detail card activates this three-day window. Its centre is the
      // highest complete daily residual at this station; adjacent cells keep
      // the peak in its immediate date context rather than implying an exact
      // moment from daily data.
      const peak = d3.greatest(station.days, point => point.value);
      if (peak) {
        const peakIndex = dates.findIndex(date => dateKey(date) === dateKey(peak.date));
        const firstIndex = Math.max(0, Math.min(dates.length - 3, peakIndex - 1));
        const firstKey = dateKey(dates[firstIndex]);
        const lastKey = dateKey(dates[Math.min(dates.length - 1, firstIndex + 2)]);
        svg.append("rect")
          .attr("class", "calendar-peak-window")
          .attr("x", x(firstKey) - 1).attr("y", y(station.name) - 1)
          .attr("width", x(lastKey) + x.bandwidth() - x(firstKey) + 2)
          .attr("height", y.bandwidth() + 2)
          .append("title")
          .text(`${station.name}: highest complete daily residual ${peak.value.toFixed(1)} cm on ${dateKey(peak.date)} UTC; outlined with the day before and after.`);
      }
    });
    const ticks = x.domain().filter((_, i) => i % Math.ceil(dates.length / (compact ? 4 : 7)) === 0);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom + 6})`).call(d3.axisBottom(x).tickValues(ticks).tickFormat(d => fmtDay(new Date(`${d}T00:00:00Z`))).tickSize(0));
    window.__calendarCellsAnimated = true;
  }

  function renderFocus() {
    const {
      svg,
      width,
      height
    } = dimensions("#focus-chart");
    svg.selectAll("*").remove();
    const compact = width <= 700;
    const m = compact
      ? { top: 72, right: 14, bottom: 46, left: 122 }
      : { top: 150, right: 55, bottom: 80, left: 190 };
    const allHours = model.flatMap(station => station.hours || []);
    const end = d3.max(allHours, point => point.time);
    if (!end) return;
    const start = new Date(+end - 7 * 864e5);
    const interval = d3.utcHour.every(3);
    const fields = model.map(station => ({ ...station, points: Array.from(d3.group((station.hours || []).filter(point => point.time >= start), point => +interval.floor(point.time)), ([time, points]) => ({ time: new Date(+time), value: d3.mean(points, point => point.residual) })).sort((a, b) => a.time - b.time) }));
    const times = interval.range(interval.floor(start), interval.offset(interval.floor(end), 1));
    const x = d3.scaleBand().domain(times.map(time => +time)).range([m.left, width - m.right]).paddingInner(.045);
    const y = d3.scaleBand().domain(model.map(d => d.name)).range([m.top, height - m.bottom]).paddingInner(.24);
    let [minimum, maximum] = d3.extent(fields.flatMap(station => station.points.map(point => point.value)).filter(Number.isFinite));
    if (minimum === maximum) { minimum -= 1; maximum += 1; }
    const color = d3.scaleLinear().domain([minimum, (minimum + maximum) / 2, maximum]).range(["#287c9a", "#e8eadb", "#d6574f"]).clamp(true);
    const reference = fields[0]?.points.reduce((best, point) => !best || point.value > best.value ? point : best, null);
    // A visual comparison target for the detail card: Point Reyes' strongest
    // 3-hour reading on Oct. 7. It is a highlighted candidate, not a fitted
    // propagation time or an assertion that all stations share one event.
    const pointReyes = fields.find(station => station.name === "Point Reyes");
    const alignmentCandidate = pointReyes
      ? d3.greatest(pointReyes.points.filter(point => dateKey(point.time) === "2026-10-07"), point => point.value)
      : null;
    fields.forEach(station => {
      const byTime = new Map(station.points.map(point => [+point.time, point]));
      svg.append("text").attr("class", "chart-label").attr("x", m.left - 8).attr("y", y(station.name) + y.bandwidth() * .63).attr("text-anchor", "end").attr("fill", station.color).text(compact ? station.name : `${station.name} · ${station.miles} mi`);
      svg.append("g").selectAll("rect").data(times).join("rect").attr("x", time => x(+time)).attr("y", y(station.name)).attr("height", y.bandwidth()).attr("width", x.bandwidth()).attr("fill", time => byTime.has(+time) ? color(byTime.get(+time).value) : "#112d37");
      if (reference) {
        const nearby = station.points.filter(point => Math.abs(point.time - reference.time) <= 84 * 36e5).reduce((best, point) => !best || point.value > best.value ? point : best, null);
        if (nearby) svg.append("circle").attr("class", "focus-alignment-dot").attr("cx", x(+nearby.time) + x.bandwidth() / 2).attr("cy", y(station.name) + y.bandwidth() / 2).attr("r", 4).attr("fill", "none").attr("stroke", "#f6edcf").attr("stroke-width", 1.2);
      }
    });
    if (reference) {
      const pointerX = x(+reference.time) + x.bandwidth() / 2;
      svg.append("line").attr("class", "focus-pointer").attr("x1", pointerX).attr("x2", pointerX).attr("y1", m.top - 30).attr("y2", height - m.bottom + 5);
      svg.append("text")
        .attr("class", "focus-pointer-label")
        .attr("x", compact ? width - 12 : pointerX + 7)
        .attr("y", m.top - 35)
        .attr("text-anchor", compact ? "end" : null)
        .text(compact ? "San Diego peak" : `San Diego candidate: ${d3.utcFormat("%b %d %H:%M")(reference.time)} UTC`);
      document.querySelector(".demo-focus-date").textContent = "Seven days of 3-hour matched residual bins. The line marks San Diego’s local maximum; rings mark each station’s strongest nearby bin within ±84 hours.";
    }
    if (alignmentCandidate) {
      const alignmentX = x(+alignmentCandidate.time) + x.bandwidth() / 2;
      svg.append("line")
        .attr("class", "focus-alignment-guide")
        .attr("x1", alignmentX).attr("x2", alignmentX)
        .attr("y1", m.top - 30).attr("y2", height - m.bottom + 5)
        .append("title")
        .text(`Point Reyes comparison bin: ${d3.utcFormat("%b %d %H:%M")(alignmentCandidate.time)} UTC · ${alignmentCandidate.value.toFixed(1)} cm`);
    }
    const ticks = times.filter((_, i) => i % (compact ? 12 : 8) === 0);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom + 8})`).call(d3.axisBottom(x).tickValues(ticks.map(time => +time)).tickFormat(time => d3.utcFormat("%b %d")(new Date(+time))).tickSize(0));
  }

  function renderSatelliteFocus() {
    const { svg, width, height } = dimensions("#satellite-focus-chart");
    svg.selectAll("*").remove();
    if (!satelliteModel.length) return;
    const compact = width <= 700;
    const m = compact
      ? { top: 72, right: 14, bottom: 44, left: 122 }
      : { top: 165, right: 70, bottom: 70, left: 190 };
    const lastDate = d3.max(satelliteModel.flatMap(station => station.points), point => point.date);
    const start = new Date(`${lastDate}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - 20);
    const dates = d3.utcDay.range(start, d3.utcDay.offset(new Date(`${lastDate}T00:00:00Z`), 1));
    const x = d3.scaleBand().domain(dates.map(dateKey)).range([m.left, width - m.right]).paddingInner(.06);
    const y = d3.scaleBand().domain(satelliteModel.map(station => station.name)).range([m.top, height - m.bottom]).paddingInner(.22);
    let [minimum, maximum] = d3.extent(satelliteModel.flatMap(station => station.points.map(point => point.change)).filter(Number.isFinite));
    if (minimum === maximum) { minimum -= 1; maximum += 1; }
    const color = d3.scaleLinear().domain([minimum, (minimum + maximum) / 2, maximum]).range(["#287c9a", "#e8eadb", "#d6574f"]).clamp(true);
    satelliteModel.forEach(station => {
      const values = new Map(station.points.map(point => [point.date, point]));
      svg.append("text").attr("class", "chart-label").attr("x", m.left - 8).attr("y", y(station.name) + y.bandwidth() * .63).attr("text-anchor", "end").text(station.name);
      svg.append("g").selectAll("rect").data(dates).join("rect").attr("x", date => x(dateKey(date))).attr("y", y(station.name)).attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("fill", date => {
        const point = values.get(dateKey(date)); return Number.isFinite(point?.change) ? color(point.change) : "#112d37";
      }).append("title").text(date => { const point = values.get(dateKey(date)); return `${station.name} · ${dateKey(date)} · ${Number.isFinite(point?.change) ? `${point.change.toFixed(1)} cm vs preceding 7-day avg` : "insufficient baseline"}`; });
    });
    const ticks = dates.filter((_, index) => index % (compact ? 5 : 3) === 0);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom + 8})`).call(d3.axisBottom(x).tickValues(ticks.map(dateKey)).tickFormat(key => fmtDay(new Date(`${key}T00:00:00Z`))).tickSize(0));
    svg.append("text").attr("class", "chart-label chart-label--muted").attr("x", m.left).attr("y", m.top - 22).text(compact ? "DAILY SEA-LEVEL CHANGE, CM" : "DAILY SEA-LEVEL CHANGE VS. PREVIOUS 7-DAY AVERAGE, CM");
  }

  function draw() {
    if (!model.some(d => d.days.length)) return;
    renderIntroWaves();
    renderIntro(window.__introProgress || 0);
    renderCalendar();
    renderFocus();
    renderSatelliteFocus();
  }

  function applyIntroProgress(progress) {
    const safeProgress = clamp(progress);
    window.__introProgress = safeProgress;
    renderIntro(safeProgress);

    const chartReveal = cinematicIntro
      ? clamp((safeProgress - introTune.chartStartsAt) / introTune.chartRevealDuration)
      : 1;
    const chart = document.querySelector(".demo-chart-shell--intro");
    if (chart) {
      chart.style.opacity = chartReveal;
      chart.style.transform = `translateY(${(1 - chartReveal) * 52}px)`;
    }

    setWaveProgress(cinematicIntro ? safeProgress : 0);
    const introWaves = document.querySelector(".demo-intro-waves");
    if (introWaves) {
      introWaves.style.opacity = cinematicIntro ? 1 - clamp((safeProgress - .54) / .28) * .72 : 0;
      // Once the crest reaches the upper field it becomes background, so
      // the measured chart can enter without being covered by the morph.
      introWaves.style.zIndex = safeProgress >= .46 ? 0 : 2;
    }
  }

  function introProgressFromPage() {
    const intro = document.querySelector(".demo-scene--intro");
    if (!intro) return 0;
    const rect = intro.getBoundingClientRect();
    return clamp(-rect.top / Math.max(1, rect.height - window.innerHeight));
  }

  function syncIntroProgress() {
    window.cancelAnimationFrame(window.__introProgressFrame);
    window.__introProgressFrame = window.requestAnimationFrame(() => {
      applyIntroProgress(introProgressFromPage());
    });
  }

  function setupScroll() {
    // The intro morph is tied to the real section position, not a text card's
    // layout. This continues to work while Scrollama is loading or if a host
    // page changes the card geometry.
    window.addEventListener("scroll", syncIntroProgress, { passive: true });
    if (!window.DemoScroll) return;
    window.__demoScroller = window.DemoScroll({
      onScene: (scene, highlight) => {
        const page = document.querySelector("#kelvin-demo");
        page.dataset.scene = scene;
        if (highlight) page.dataset.highlight = highlight;
        else delete page.dataset.highlight;
        const shell = document.querySelector(`.demo-chart-shell--${scene}`);
        shell?.classList.add("is-revealed");
      },
      // The text-step callback remains useful for its scene state. The visual
      // animation itself is measured from the real intro section below.
      onIntroProgress: syncIntroProgress
    });
  }

  function setupCinematicWater() {
    if (!cinematicIntro || !window.gsap) return;
    if (waterBody) waterBody.style.opacity = 0;
  }
  async function init() {
    // Register each chart separately: these are intentionally independent
    // render targets so a scene can be revised without rebuilding the others.
    window.DemoCharts?.register("intro", () => renderIntro(window.__introProgress || 0));
    window.DemoCharts?.register("calendar", renderCalendar);
    window.DemoCharts?.register("focus", renderFocus);
    window.DemoCharts?.register("satellite", renderSatelliteFocus);
    if (cinematicIntro) {
      document.querySelector(".demo-chart-shell--intro")?.style.setProperty("opacity", 0);
    } else {
      document.querySelector(".demo-intro-waves")?.style.setProperty("opacity", 0);
    }
    setupCinematicWater();
    setupScroll();
    document.querySelector("#kelvin-demo")?.classList.add("is-scroll-ready");
    loading.textContent = "Loading local NOAA residual cache";
    let gaugeStations;
    try {
      [gaugeStations, satelliteModel] = await Promise.all([loadCachedStations(), loadSatellite()]);
    } catch (error) {
      loading.textContent = "Local NOAA cache missing. Run: python scripts/fetch_demo_noaa_cache.py";
      console.error(error);
      return;
    }
    model = gaugeStations;
    const usable = model.filter(d => d.days.length);
    if (!usable.length) {
      loading.textContent = "NOAA observations could not be loaded. Open the dashboard to retry.";
      return;
    }
    model = usable;
    draw();
    // Scrollama may already have emitted before the cached data finished
    // loading. Synchronize after the SVGs exist so the opening never remains
    // blank or stuck at its initial state.
    syncIntroProgress();
    loading.classList.add("is-done");
    window.addEventListener("resize", () => {
      window.clearTimeout(window.__demoResize);
      window.__demoResize = window.setTimeout(() => {
        draw();
        window.__demoScroller?.resize();
        syncIntroProgress();
      }, 120);
    });
  }
  init();
})();

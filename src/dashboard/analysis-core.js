(function (root) {
  function validValue(value) {
    return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function pairedHourly(water, predictions) {
    const predicted = new Map(predictions.filter(d => validValue(d.v)).map(d => [d.t, +d.v]));
    const grouped = new Map();
    water.filter(d => validValue(d.v)).forEach(d => {
      const hour = `${d.t.slice(0, 13)}:00`;
      if (!grouped.has(hour)) grouped.set(hour, []);
      grouped.get(hour).push(d);
    });
    return [...grouped].filter(([time]) => predicted.has(time)).map(([time, rows]) => ({
      time,
      observed: rows.reduce((sum, row) => sum + +row.v, 0) / rows.length,
      predicted: predicted.get(time),
      observations: rows.length,
      flags: [...new Set(rows.map(row => row.f).filter(Boolean))],
      quality: [...new Set(rows.map(row => row.q).filter(Boolean))]
    })).sort((a, b) => a.time.localeCompare(b.time));
  }

  function continuous(points, maxGapMs) {
    return points.slice(1).every((point, index) => +point.date - +points[index].date <= maxGapMs);
  }

  function completeLocalDay(rows) {
    const hours = new Set(rows.map(row => row.localHour));
    const blocks = new Set(rows.map(row => Math.floor(row.localHour / 6)));
    return rows.length >= 18 && blocks.size === 4 && Math.max(...hours) - Math.min(...hours) >= 18;
  }

  function trailingMean(points, endTime, windowMs, minimumSamples, valueOf = point => point.value) {
    const values = points.filter(point => +point.date <= +endTime && +point.date > +endTime - windowMs)
      .map(valueOf).filter(Number.isFinite);
    return values.length >= minimumSamples ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function centeredMean(points, centerTime, windowMs, minimumSamples, valueOf = point => point.value) {
    const half = windowMs / 2;
    const values = points.filter(point => +point.date >= +centerTime - half && +point.date <= +centerTime + half)
      .map(valueOf).filter(Number.isFinite);
    return values.length >= minimumSamples ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function correlation(pairs) {
    if (pairs.length < 8) return null;
    const meanX = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
    const meanY = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
    let xy = 0, xx = 0, yy = 0;
    pairs.forEach(([x, y]) => { xy += (x - meanX) * (y - meanY); xx += (x - meanX) ** 2; yy += (y - meanY) ** 2; });
    return xx && yy ? xy / Math.sqrt(xx * yy) : null;
  }

  function bestLag(reference, target, maxLagSteps, stepMs) {
    const targetByTime = new Map(target.map(point => [+point.date, point.value]));
    const scores = [];
    for (let lag = -maxLagSteps; lag <= maxLagSteps; lag += 1) {
      const pairs = reference.flatMap(point => Number.isFinite(targetByTime.get(+point.date + lag * stepMs)) ? [[point.value, targetByTime.get(+point.date + lag * stepMs)]] : []);
      scores.push({ lag, pairs: pairs.length, r: correlation(pairs) });
    }
    const valid = scores.filter(score => Number.isFinite(score.r));
    return { best: valid.reduce((winner, score) => !winner || score.r > winner.r ? score : winner, null), zero: valid.find(score => score.lag === 0) || null, scores };
  }

  const api = { validValue, pairedHourly, continuous, completeLocalDay, trailingMean, centeredMean, correlation, bestLag };
  root.KelvinAnalysis = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);

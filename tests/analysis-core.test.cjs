const test = require('node:test');
const assert = require('node:assert/strict');
const analysis = require('../src/dashboard/analysis-core.js');

test('pairs only matching hourly observation and prediction timestamps, preserving flags', () => {
  const water = [
    { t: '2026-08-01 00:06', v: '1.0', f: '0,0,0,0', q: 'p' },
    { t: '2026-08-01 00:54', v: '3.0', f: '0,0,0,0', q: 'p' },
    { t: '2026-08-01 01:06', v: '', f: '0,0,0,0', q: 'p' },
    { t: '2026-08-01 02:06', v: '8.0', f: '0,0,0,0', q: 'p' }
  ];
  const predictions = [{ t: '2026-08-01 00:00', v: '2.0' }, { t: '2026-08-01 01:00', v: '2.0' }];
  const paired = analysis.pairedHourly(water, predictions);
  assert.equal(paired.length, 1);
  assert.equal(paired[0].observed, 2);
  assert.equal(paired[0].predicted, 2);
  assert.deepEqual(paired[0].quality, ['p']);
});

test('does not regard a large outage as continuous coverage', () => {
  const points = [0, 60, 120, 720].map(minutes => ({ date: new Date(minutes * 60000) }));
  assert.equal(analysis.continuous(points, 3 * 3600000), false);
  assert.equal(analysis.continuous(points.slice(0, 3), 3 * 3600000), true);
});

test('rejects a partial live-day-shaped cluster even when it has eighteen readings', () => {
  const partial = Array.from({ length: 18 }, (_, hour) => ({ localHour: hour }));
  const distributed = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 19].map(localHour => ({ localHour }));
  assert.equal(analysis.completeLocalDay(partial), false);
  assert.equal(analysis.completeLocalDay(distributed), true);
});

test('trailing baseline requires adequate data and excludes values outside its time window', () => {
  const hour = 3600000;
  const points = Array.from({ length: 10 }, (_, index) => ({ date: new Date(index * hour), value: index + 1 }));
  assert.equal(analysis.trailingMean(points, new Date(10 * hour), 5 * hour, 4), 8.5);
  assert.equal(analysis.trailingMean(points, new Date(10 * hour), 5 * hour, 6), null);
});

test('centered baseline is retrospective and declines to estimate at a live edge', () => {
  const hour = 3600000;
  const points = Array.from({ length: 10 }, (_, index) => ({ date: new Date(index * hour), value: index + 1 }));
  assert.equal(analysis.centeredMean(points, new Date(5 * hour), 4 * hour, 4), 6);
  assert.equal(analysis.centeredMean(points, new Date(9 * hour), 4 * hour, 5), null);
});

test('recovers a known positive propagation delay and compares it to zero lag', () => {
  const step = 3 * 3600000;
  const reference = Array.from({ length: 40 }, (_, index) => ({ date: new Date(index * step), value: Math.sin(index / 3) + (index === 18 ? 2 : 0) }));
  const target = reference.map(point => ({ date: new Date(+point.date + 4 * step), value: point.value }));
  const result = analysis.bestLag(reference, target, 8, step);
  assert.equal(result.best.lag, 4);
  assert.ok(result.best.r > .99);
  assert.ok(result.zero.r < result.best.r);
});

test('declines correlation when fewer than eight matched samples exist', () => {
  assert.equal(analysis.correlation([[1, 1], [2, 2]]), null);
});

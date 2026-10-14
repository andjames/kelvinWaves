const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('NOAA observed and prediction requests use UTC and the same MLLW datum', () => {
  const app = fs.readFileSync('src/dashboard/app.js', 'utf8');
  assert.match(app, /datum=MLLW/);
  assert.match(app, /time_zone=gmt/);
  assert.match(app, /product=\$\{product\}/);
});

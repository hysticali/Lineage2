const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const os = require('node:os');
const { buildWheel, buildDescendantWheel } = require('../src/domain/wheel');
const { searchPeople } = require('../src/domain/graph');

function fixture(size) {
  const family = {};
  for (let i = 0; i < size; i++) family[`p${i}`] = {
    id: `p${i}`, name: `Person ${i}`, birth: String(1800 + i % 200), birthplace: `Town ${i % 100}`,
    ...(i > 0 && { motherId: `p${Math.floor((i - 1) / 2)}` }),
  };
  return family;
}
function timed(work) { const start = performance.now(); const value = work(); return { ms: +(performance.now() - start).toFixed(3), value }; }
const results = [100, 1000, 10000].map((size) => {
  const family = fixture(size);
  const expanded = new Set(Object.keys(family));
  const descendants = timed(() => buildDescendantWheel('p0', family, expanded));
  const ancestors = timed(() => buildWheel(`p${size - 1}`, family, expanded, null, null));
  const search = timed(() => searchPeople(family, 'town 9'));
  return { people: size, descendantsMs: descendants.ms, ancestorsMs: ancestors.ms, searchMs: search.ms, descendantWedges: descendants.value.wedges.length, ancestorWedges: ancestors.value.wedges.length };
});
const report = { measuredAt: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, fixture: 'Balanced binary descendant tree; all six visible generations expanded; first fan build per tree; warmed production searchPeople with 25-result page', results };
const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

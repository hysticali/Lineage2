const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_RECOVERIES,
  readRecoveries,
  preserveRecovery,
  clearRecoveries,
} = require('../../frontend/storage');

function memoryStorage(maxBytes = Infinity) {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      const value = String(v);
      if (value.length > maxBytes) {
        const error = new Error('Storage quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      }
      map.set(k, value);
    },
    removeItem(k) {
      map.delete(k);
    },
  };
}

test('preserveRecovery caps history to the latest 10 entries FIFO and clearRecoveries empties it', () => {
  const storage = memoryStorage();
  const key = 'lineage-v3:test';

  let entries = [];
  for (let i = 1; i <= 14; i++) {
    entries = preserveRecovery(storage, key, JSON.stringify({ step: i }), `Reason ${i}`);
  }

  assert.equal(MAX_RECOVERIES, 10);
  assert.equal(entries.length, 10);
  assert.equal(entries[0].reason, 'Reason 5');
  assert.equal(entries.at(-1).reason, 'Reason 14');
  assert.equal(readRecoveries(storage, key).length, 10);

  // Deduplication keeps existing list intact
  const deduped = preserveRecovery(storage, key, JSON.stringify({ step: 14 }), 'Duplicate');
  assert.equal(deduped.length, 10);
  assert.equal(deduped.at(-1).reason, 'Reason 14');

  const cleared = clearRecoveries(storage, key);
  assert.deepEqual(cleared, []);
  assert.deepEqual(readRecoveries(storage, key), []);
});

test('preserveRecovery prunes oldest entries on QuotaExceededError and rethrows if a single entry cannot fit', () => {
  const storage = memoryStorage(400);
  const key = 'lineage-v3:quota';

  preserveRecovery(storage, key, 'x'.repeat(80), 'First');
  preserveRecovery(storage, key, 'y'.repeat(80), 'Second');
  const afterThird = preserveRecovery(storage, key, 'z'.repeat(180), 'Third');

  assert.equal(afterThird.length, 1);
  assert.equal(afterThird[0].reason, 'Third');
  assert.equal(readRecoveries(storage, key).length, 1);

  assert.throws(
    () => preserveRecovery(storage, key, 'w'.repeat(500), 'Too large'),
    (error) => error.name === 'QuotaExceededError',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createStore } from '../desktop/store.js';
import { emptyState } from '../src/planner.js';
test('atomic writes persist and reject stale concurrent edits', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'weekwise-store-'));
  try {
    const store = createStore(dir), initial = await store.read(), next = emptyState(); next.settings.capacities[0] = 90;
    await store.write(next, initial);
    assert.equal((await store.read()).settings.capacities[0], 90);
    await assert.rejects(store.write(initial, initial), /其他窗口/);
    await Promise.all([store.update(s => { s.settings.capacities[1] = 70; return s; }), store.update(s => { s.settings.capacities[2] = 80; return s; })]);
    assert.deepEqual((await store.read()).settings.capacities.slice(0, 3), [90, 70, 80]);
    assert.equal(JSON.parse(await readFile(path.join(dir, 'tasks.json'), 'utf8')).version, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('corrupt files are surfaced rather than replaced with empty data', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'weekwise-corrupt-'));
  try { await writeFile(path.join(dir, 'tasks.json'), '{broken'); await assert.rejects(createStore(dir).read(), /无法读取/); assert.equal(await readFile(path.join(dir, 'tasks.json'), 'utf8'), '{broken'); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, planWeek, validateState, weekStart, weekDays, validDate } from '../src/planner.js';
const start = '2026-10-05';
export function task(overrides = {}) { return { id: 'one', title: '任务一', category: 'work', priority: 'medium', minutes: 60, due: null, scheduled: null, locked: false, done: false, notes: '', ...overrides }; }
test('local dates cross month/year and reject normalized invalid dates', () => {
  assert.equal(weekStart('2026-10-08'), start);
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
  assert.equal(weekDays('2026-12-28')[6], '2027-01-03');
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2028-02-29'), true);
});
test('plan respects deadline, past dates, zero capacity and balances workload', () => {
  const state = emptyState(); state.settings.capacities = [60, 60, 0, 60, 60, 0, 0];
  state.tasks = [task({ due: '2026-10-08', priority: 'high' }), task({ id: 'b' }), task({ id: 'c' })];
  const result = planWeek(state, start, '2026-10-08');
  assert.equal(result.tasks[0].scheduled, '2026-10-08'); assert.equal(result.tasks[1].scheduled, '2026-10-09');
  assert.equal(result.tasks[2].scheduled, null); assert.equal(result.unplaced.length, 1);
  assert.equal(state.tasks[0].scheduled, null);
});
test('preserves locked, completed and other-week tasks, reports locked overload', () => {
  const state = emptyState(); state.settings.capacities.fill(60);
  state.tasks = [task({ id: 'lock', minutes: 120, locked: true, scheduled: start }), task({ id: 'done', done: true, scheduled: '2026-10-06' }), task({ id: 'other', scheduled: '2026-10-13' }), task({ id: 'new', due: start })];
  const result = planWeek(state, start, start);
  assert.deepEqual(result.tasks.slice(0, 3), state.tasks.slice(0, 3)); assert.equal(result.preserved, 1); assert.deepEqual(result.overloaded, [start]); assert.equal(result.tasks[3].scheduled, null);
});
test('overdue tasks remain in backlog and large tasks are not silently squeezed in', () => {
  const state = emptyState(); state.tasks = [task({ due: '2026-10-04' }), task({ id: 'large', minutes: 1440 })];
  const result = planWeek(state, start, start);
  assert.equal(result.unplaced.length, 2); assert.match(result.unplaced[0].reason, /已过/); assert.match(result.unplaced[1].reason, /时长不足/);
});
test('invalid backups cannot overwrite data', () => {
  const state = emptyState(); state.tasks = [task(), task()]; assert.throws(() => validateState(state), /重复/);
  state.tasks = [task({ locked: true })]; assert.throws(() => validateState(state), /安排日期/);
  state.tasks = [task({ due: '2026-02-30' })]; assert.throws(() => validateState(state), /日期/);
  state.tasks = [task({ minutes: -5 })]; assert.throws(() => validateState(state), /耗时/);
  state.tasks = []; state.settings.capacities[0] = 1500; assert.throws(() => validateState(state), /时长/);
});


test('actual durations round-trip without replacing estimates and old backups remain compatible', () => {
  const state = emptyState(); state.tasks = [task({ done: true, actualMinutes: 47 })];
  const saved = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(saved.tasks[0].actualMinutes, 47); assert.equal(saved.tasks[0].minutes, 60);
  delete state.tasks[0].actualMinutes;
  assert.equal(Object.hasOwn(validateState(state).tasks[0], 'actualMinutes'), false);
  for (const invalid of [null, 0, -1, 1.5, 10081, '60', NaN, Infinity]) {
    state.tasks[0].actualMinutes = invalid; assert.throws(() => validateState(state), /实际耗时/);
  }
});

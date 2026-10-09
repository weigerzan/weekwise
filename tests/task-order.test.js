import test from 'node:test';
import assert from 'node:assert/strict';
import { moveTask } from '../src/task-order.js';
import { emptyState, validateState } from '../src/planner.js';
import { replanInput, validateReplan } from '../desktop/replan.js';

const day = '2026-10-09', tomorrow = '2026-10-10';
function fixture() {
  const base = { title: '任务', priority: 'medium', minutes: 60, scheduled: day, due: null, done: false, locked: true, notes: '' };
  return [
    { ...base, id: 'a' },
    { ...base, id: 'other', scheduled: tomorrow },
    { ...base, id: 'b', timeSlot: { start: '14:00', end: '15:00', reminders: [120,30] } },
    { ...base, id: 'done1', done: true, actualMinutes: 45 },
    { ...base, id: 'c', origin: { batchId: 'batch', goalTitle: '审稿', items: [1], unit: '篇' } },
    { ...base, id: 'done2', done: true, actualMinutes: 55 }
  ];
}
const pending = (tasks, date = day) => tasks.filter(t => t.scheduled === date && !t.done).map(t => t.id);

test('same-day ordering works before/after/end and preserves every task field and daily total', () => {
  const original = fixture(), baseline = structuredClone(original);
  let tasks = moveTask(original, 'c', day, 'a');
  assert.deepEqual(pending(tasks), ['c','a','b']);
  tasks = moveTask(tasks, 'c', day, 'b', true);
  assert.deepEqual(pending(tasks), ['a','b','c']);
  tasks = moveTask(tasks, 'a', day);
  assert.deepEqual(pending(tasks), ['b','c','a']);
  for (const task of original) assert.deepEqual(tasks.find(t => t.id === task.id), task);
  assert.equal(tasks.filter(t => t.scheduled === day).reduce((sum,t) => sum+t.minutes,0),300);
  assert.deepEqual(original, baseline);
});

test('dropping onto itself or its current position is a no-op; completed tasks only reorder within their date', () => {
  const tasks = fixture();
  assert.equal(moveTask(tasks,'a',day,'a'),tasks);
  assert.equal(moveTask(tasks,'a',day,'b'),tasks);
  assert.equal(moveTask(tasks,'done1',tomorrow),tasks);
  const reordered = moveTask(tasks,'done2',day,'done1');
  assert.deepEqual(reordered.filter(t => t.done).map(t => t.id),['done2','done1']);
  assert.deepEqual(pending(reordered),pending(tasks));
});

test('cross-date insertion preserves unrelated order and backlog rules without altering event times', () => {
  const tasks = fixture(), moved = moveTask(tasks,'c',tomorrow,'other');
  assert.deepEqual(pending(moved,tomorrow),['c','other']);
  assert.deepEqual(pending(moved),['a','b']);
  assert.equal(moved.find(t => t.id==='c').locked,true);
  const backlog = moveTask(moved,'c',null);
  assert.equal(backlog.find(t => t.id==='c').locked,false);
  assert.equal(moveTask(tasks,'b',null),tasks);
});

test('manual order round-trips in backups and survives AI replan without changes to that date', () => {
  const state = emptyState(); state.tasks = moveTask(fixture(),'c',day,'a');
  const saved = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(pending(saved.tasks),['c','a','b']);
  const transport = replanInput(saved,'其它任务不变','2026-10-05','2026-11-06',day);
  const result = validateReplan({ feasible:true, summary:'保留安排', assumptions:[], issues:[], suggestions:[], capacityChanges:[], timedChanges:[], assignments:transport.input.tasks.map(t => ({id:t.id,date:t.scheduled,reason:'保留原安排'})) },transport);
  assert.deepEqual(result.tasks,saved.tasks);
});

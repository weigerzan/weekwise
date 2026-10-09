import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyState, validateState, planWeek } from '../src/planner.js';
import { collectDue, createReminderScheduler, reminderKey, hasUpcomingReminders, testReminderAlert } from '../desktop/reminders.js';
import { naturalInput, validateNaturalPlan } from '../desktop/natural.js';
const at = value => new Date(value).getTime();
function meeting(overrides = {}) { return { id: 'meeting', title: '组会', priority: 'medium', minutes: 120, due: null, scheduled: '2026-10-09', locked: false, done: false, notes: '', timeSlot: { start: '15:00', end: '17:00', reminders: [720,120,30] }, ...overrides }; }
function stateWith(task = meeting()) { return validateState({ ...emptyState(), tasks: [task] }); }
async function directory() { const base = path.resolve('test-results'); await mkdir(base, { recursive: true }); return mkdtemp(path.join(base, 'reminders-')); }
test('test alarm displays the edited date and time rather than a fixed example or current time', () => {
  const value={title:' 面试 ',date:'2026-10-10',start:'19:15',end:'20:45'},original=structuredClone(value);
  const result=testReminderAlert(value,at('2026-10-09T23:55:00'));
  assert.equal(result.test,true);assert.equal(result.title,'面试');assert.equal(result.date,'2026-10-10');assert.equal(result.start,'19:15');assert.equal(result.end,'20:45');
  assert.equal(result.startsAt,at('2026-10-10T19:15:00'));assert.equal(result.endsAt,at('2026-10-10T20:45:00'));assert.deepEqual(value,original);
  const updated=testReminderAlert({...value,date:'2026-10-11',start:'08:30',end:'09:45'});
  assert.equal(updated.startsAt,at('2026-10-11T08:30:00'));assert.equal(updated.date,'2026-10-11');assert.equal(updated.end,'09:45');
});
test('test alarm rejects missing or impossible dates and invalid or reversed time ranges', () => {
  const value={title:'组会',date:'2026-10-10',start:'15:00',end:'17:00'};
  for(const change of [{date:''},{date:'2026-02-30'},{start:'25:00'},{end:'14:00'},{end:'15:04'}])assert.throws(()=>testReminderAlert({...value,...change}),/试响/);
  assert.throws(()=>testReminderAlert('组会'),/名称/);assert.throws(()=>testReminderAlert({...value,title:' '}),/名称/);
});
test('timed task survives backup and planning with its date and reminder settings fixed', () => {
  const state = stateWith(); assert.equal(state.tasks[0].locked, true);
  const restored = validateState(JSON.parse(JSON.stringify(state))); assert.deepEqual(restored, state);
  assert.deepEqual(planWeek(state, '2026-10-05', '2026-10-08').tasks[0], state.tasks[0]);
  assert.throws(() => stateWith(meeting({ scheduled: null })), /定时任务/);
  assert.throws(() => stateWith(meeting({ timeSlot: { start: '25:00', end: '17:00', reminders: [] } })), /定时任务/);
  assert.throws(() => stateWith(meeting({ timeSlot: { start: '17:00', end: '15:00', reminders: [] } })), /定时任务/);
  assert.throws(() => stateWith(meeting({ timeSlot: { start: '15:00', end: '17:00', reminders: [30,30] } })), /不能重复/);
});
test('12h, 2h and 30m advances each trigger once at the start-based threshold', () => {
  const state = stateWith(), fired = {};
  assert.equal(collectDue(state, fired, at('2026-10-09T02:59:59')).alerts.length, 0);
  for (const [time, lead] of [['03:00:00',720],['13:00:00',120],['14:30:00',30]]) {
    const due = collectDue(state, fired, at(`2026-10-09T${time}`)); assert.equal(due.alerts.length, 1); assert.equal(due.alerts[0].lead, lead);
    for (const key of due.mark) fired[key] = at(`2026-10-09T${time}`);
    assert.equal(collectDue(state, fired, at(`2026-10-09T${time}`)).alerts.length, 0);
  }
});
test('half-day advance crosses midnight and reminder keys change on rescheduling', () => {
  const task = meeting({ timeSlot: { start: '09:00', end: '10:00', reminders: [720] } }), state = stateWith(task);
  assert.equal(collectDue(state, {}, at('2026-10-08T20:59:59')).alerts.length, 0);
  assert.equal(collectDue(state, {}, at('2026-10-08T21:00:00')).alerts[0].lead, 720);
  assert.notEqual(reminderKey(task, 720), reminderKey({ ...task, scheduled: '2026-10-10' }, 720));
});
test('resume collapses missed advances and expired or completed events do not ring', () => {
  const state = stateWith(), due = collectDue(state, {}, at('2026-10-09T14:45:00'));
  assert.equal(due.mark.length, 3); assert.equal(due.alerts.length, 1); assert.equal(due.alerts[0].lead, 30);
  const expired = collectDue(state, {}, at('2026-10-09T17:00:00')); assert.equal(expired.mark.length, 3); assert.equal(expired.alerts.length, 0);
  assert.equal(hasUpcomingReminders(state, at('2026-10-09T16:00:00')), true); assert.equal(hasUpcomingReminders(state, at('2026-10-09T17:00:00')), false);
  state.tasks[0].done = true; assert.equal(collectDue(state, {}, at('2026-10-09T14:45:00')).alerts.length, 0); assert.equal(hasUpcomingReminders(state, at('2026-10-09T14:45:00')), false);
  state.tasks[0].done = false; state.tasks[0].timeSlot.reminders = []; assert.equal(hasUpcomingReminders(state, at('2026-10-09T14:45:00')), false);
});
test('delivery ledger persists across restart and concurrent ticks never duplicate an alert', async () => {
  const dir = await directory(), state = stateWith(); let now = at('2026-10-09T03:00:00'); const delivered = [];
  const options = { directory: dir, getState: () => state, now: () => now, onDue: alerts => delivered.push(...alerts) };
  const first = createReminderScheduler(options); await first.load(); await Promise.all([first.tick(), first.tick(), first.tick()]);
  assert.equal(delivered.length, 1);
  const second = createReminderScheduler(options); await second.load(); await second.tick(); assert.equal(delivered.length, 1);
  now = at('2026-10-09T13:00:00'); await second.tick(); assert.equal(delivered.length, 2); assert.equal(delivered[1].lead, 120);
  const log = JSON.parse(await readFile(path.join(dir, 'reminders-fired.json'), 'utf8')); assert.equal(Object.keys(log.fired).length, 2);
});
test('editing or deleting a meeting removes obsolete reminders and retains ordinary tasks', async () => {
  const dir = await directory(); let state = stateWith(); const delivered = [];
  const scheduler = createReminderScheduler({ directory: dir, getState: () => state, now: () => at('2026-10-09T13:00:00'), onDue: alerts => delivered.push(...alerts) });
  await scheduler.load(); state.tasks[0].scheduled = '2026-10-10'; await scheduler.tick(); assert.equal(delivered.length, 0);
  state = emptyState(); await scheduler.tick(); assert.equal(delivered.length, 0);
});
test('a corrupt delivery ledger is surfaced rather than causing duplicate alarms', async () => {
  const dir = await directory(); await writeFile(path.join(dir, 'reminders-fired.json'), '{broken');
  const scheduler = createReminderScheduler({ directory: dir, getState: () => stateWith(), onDue: () => {} }); await assert.rejects(scheduler.load());
});
test('natural-language model output preserves two fixed events on one day and three reminder advances', () => {
  const text = '明天下午3-5是组会，晚上7-8是面试，提前半天、2h和半小时分别提醒一下。';
  const value = { summary: '明天两场固定事件，提前12小时、2小时和30分钟提醒', assumptions: [], questions: [], goals: [{ id: 'G1', title: '明天日程', quantity: null, unit: '', deadline: '2026-10-09' }], tasks: [
    { goalId: 'G1', title: '组会', date: '2026-10-09', minutes: 120, items: [], notes: '', timeSlot: { start: '15:00', end: '17:00', reminders: [720,120,30] } },
    { goalId: 'G1', title: '面试', date: '2026-10-09', minutes: 60, items: [], notes: '', timeSlot: { start: '19:00', end: '20:00', reminders: [720,120,30] } }
  ] };
  const result = validateNaturalPlan(value, naturalInput(emptyState(), text, '2026-10-08', '2026-10-08'));
  assert.equal(result.tasks.length, 2); assert.equal(result.tasks[1].timeSlot.start, '19:00'); assert.deepEqual(result.tasks[0].timeSlot.reminders, [720,120,30]); assert.equal(result.tasks[0].locked, true);
});

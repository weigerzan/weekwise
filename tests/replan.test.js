import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState, capacityForDate, planWeek } from '../src/planner.js';
import { planningInput } from '../desktop/ai.js';
import { naturalInput } from '../desktop/natural.js';
import { replanInput, validateReplan, requestReplan } from '../desktop/replan.js';

const today = '2026-10-08', reference = '2026-10-05', sunday = '2026-10-11', through = '2026-11-06';
const description = '周天我想把总工作时长压缩到2h，其它任务往后排，定时任务不能动。';
function fixture() {
  const state = emptyState(); state.settings.capacities.fill(240);
  const task = { priority: 'medium', minutes: 60, due: '2026-10-18', scheduled: sunday, locked: true, done: false, notes: '保留我的备注' };
  state.tasks = [
    { ...task, id: 'paper', title: '审稿', minutes: 120, origin: { batchId: 'batch', goalTitle: '审7篇ICLR稿件', unit: '篇', items: [1] } },
    { ...task, id: 'notes', title: '整理记录' },
    { ...task, id: 'meeting', title: '组会', timeSlot: { start: '15:00', end: '16:00', reminders: [720,120,30] } },
    { ...task, id: 'monday', title: '修改 Method', minutes: 180, scheduled: '2026-10-12' },
    { ...task, id: 'done', title: '已经完成的 Intro', actualMinutes: 25, minutes: 30, scheduled: today, done: true },
    { ...task, id: 'backlog', title: '以后读书', scheduled: null, locked: false }
  ];
  return state;
}
function transport(state = fixture()) { return replanInput(state, description, reference, through, today); }
function response() { return {
  feasible: true, summary: '周日保留组会和记录，审稿顺延；周一修改任务顺延周二。', assumptions: [], issues: [], suggestions: [],
  capacityChanges: [{ date: sunday, minutes: 120, reason: '仅指定周日压缩为2h' }],
  assignments: [
    { id: 'T1', date: '2026-10-12', reason: '为周日腾出2小时' },
    { id: 'T2', date: sunday, reason: '保留原位' },
    { id: 'T3', date: '2026-10-13', reason: '给周一审稿腾出时间' },
    { id: 'T4', date: null, reason: '不涉及待安排任务' }
  ]
}; }
function completion(value) { return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] })); }

test('replan supplies all unfinished ordinary tasks including locked tasks, timed-event references and completed occupancy', () => {
  const { input, ids } = transport();
  assert.deepEqual([...ids.values()], ['paper','notes','monday','backlog']);
  assert.deepEqual([...transport().timedIds.values()], ['meeting']); assert.deepEqual(input.allowedTimedTaskIds, ['F1']);
  assert.equal(input.description, description); assert.equal(input.referenceWeekStart, reference); assert.equal(input.referenceWeekEnd, sunday);
  assert.equal(input.throughDate, through); assert.equal(input.days[0].completedMinutes, 30);
  assert.equal(input.days.find(d => d.date === sunday).fixedMinutes, 60);
  assert.equal(input.fixedTasks[0].title, '组会'); assert.equal(input.fixedTasks[0].timeSlot.start, '15:00');
  assert.equal(input.tasks[0].sourceGoal, '审7篇ICLR稿件'); assert.equal(input.tasks[0].notes, '保留我的备注');
  assert.ok(!input.tasks.some(t => /组会|已经完成/.test(t.title)));
});

test('cross-week replan preserves task identity, metadata, timed reminders and completed dates', () => {
  const state = fixture(), baseline = structuredClone(state), result = validateReplan(response(), transport(state));
  assert.equal(result.changes.length, 2);
  for (const original of state.tasks) {
    const saved = result.tasks.find(t => t.id === original.id);
    assert.deepEqual({ ...saved, scheduled: original.scheduled }, original);
  }
  assert.equal(result.tasks.find(t => t.id === 'paper').scheduled, '2026-10-12');
  assert.equal(result.tasks.find(t => t.id === 'monday').scheduled, '2026-10-13');
  assert.deepEqual(result.tasks.find(t => t.id === 'meeting'), state.tasks.find(t => t.id === 'meeting'));
  assert.deepEqual(result.tasks.find(t => t.id === 'done'), state.tasks.find(t => t.id === 'done'));
  assert.equal(result.settings.dateCapacities[sunday], 120); assert.equal(result.settings.capacities[6], 240);
  assert.deepEqual(result.daily[0], { date: sunday, totalMinutes: 120, fixedMinutes: 60, capacityMinutes: 120 });
  assert.deepEqual(state, baseline);
});

test('date-specific capacity persists through backup and is used by all planning inputs', () => {
  const state = fixture(); state.settings.dateCapacities = { [sunday]: 120 };
  const saved = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(capacityForDate(saved, sunday), 120); assert.equal(capacityForDate(saved, '2026-10-18'), 240);
  assert.equal(planningInput(saved, reference, today).days[6].capacityMinutes, 120);
  assert.equal(naturalInput(saved, description, today, today).days[3].capacityMinutes, 120);
  assert.equal(transport(saved).input.days.find(d => d.date === sunday).capacityMinutes, 120);
  assert.deepEqual(planWeek(saved, reference, today).overloaded, [sunday]);
  const candidate = { ...saved.tasks[0], locked: false, origin: undefined, scheduled: null, minutes: 180, due: sunday };
  const weekendOnly = { ...saved, tasks: [candidate], settings: { ...saved.settings, capacities: [0,0,0,0,0,0,240] } };
  assert.equal(planWeek(weekendOnly, reference, today).unplaced.length, 1);
  delete weekendOnly.settings.dateCapacities;
  assert.equal(planWeek(weekendOnly, reference, today).tasks[0].scheduled, sunday);
});

test('infeasible response provides model suggestions without applying partial changes', () => {
  const input = transport(), value = { feasible: false, summary: '后续空余不足，不能按截止时间完成', assumptions: [], issues: ['周一至截止日只剩1小时，任务还需2小时'], suggestions: ['将截止日延长至周二，或增加周一可用时长1小时'], assignments: [], capacityChanges: [] };
  const result = validateReplan(value, input);
  assert.deepEqual(result.tasks, input.state.tasks); assert.deepEqual(result.settings, input.state.settings);
  assert.deepEqual(result.changes, []); assert.equal(result.suggestions[0], value.suggestions[0]);
  assert.throws(() => validateReplan({ ...value, assignments: response().assignments }, input), /不能返回部分修改/);
  assert.throws(() => validateReplan({ ...value, capacityChanges: response().capacityChanges }, input), /不能返回部分修改/);
});

test('identity validation rejects unknown, repeated, omitted and timed IDs in ordinary assignments', () => {
  for (const id of ['F1','T99','T2']) {
    const value = response(); value.assignments[0].id = id;
    assert.throws(() => validateReplan(value, transport()), /编号/);
  }
  const missing = response(); missing.assignments.pop(); assert.throws(() => validateReplan(missing, transport()), /遗漏/);
  const cleared = response(); cleared.assignments[0].date = null; assert.throws(() => validateReplan(cleared, transport()), /不能把已安排任务清空/);
  const invalid = response(); invalid.assignments[0].date = '2026-02-30'; assert.throws(() => validateReplan(invalid, transport()), /日期/);
});

test('removing a date override restores weekday capacity and validates stored override fields', () => {
  const state = fixture(); state.settings.dateCapacities = { [sunday]: 120 };
  const value = response(); value.capacityChanges[0].minutes = null;
  const result = validateReplan(value, transport(state));
  assert.equal(result.capacityChanges[0].from, 120); assert.equal(result.capacityChanges[0].to, 240);
  assert.equal(result.settings.dateCapacities, undefined);
  for (const bad of [{ '2026-02-30': 120 }, { [sunday]: -1 }, { [sunday]: '120' }, []]) {
    assert.throws(() => validateState({ ...state, settings: { ...state.settings, dateCapacities: bad } }), /单日可用时长/);
  }
  const duplicate = response(); duplicate.capacityChanges.push(duplicate.capacityChanges[0]);
  assert.throws(() => validateReplan(duplicate, transport()), /单日时长/);
});

test('request forwards exact natural instructions and leaves scheduling decisions with DeepSeek', async () => {
  let calls = 0;
  const result = await requestReplan({ state: fixture(), description, referenceWeekStart: reference, throughDate: through, today, key: 'fake', model: 'deepseek-flash', fetcher: async (_url, options) => {
    calls++; const body = JSON.parse(options.body), input = JSON.parse(body.messages[1].content);
    assert.equal(input.description, description); assert.deepEqual(input.allowedTaskIds, ['T1','T2','T3','T4']);
    assert.match(body.messages[0].content, /所有自然语言理解、约束判断和排期由你负责/);
    assert.match(body.messages[0].content, /不能偷偷增加/); assert.match(body.messages[0].content, /suggestions/);
    return completion(response());
  } });
  assert.equal(calls, 1); assert.equal(result.tasks.find(t => t.id === 'paper').scheduled, '2026-10-12');
});

test('malformed model task identity is repaired once without changing fixed events', async () => {
  let calls = 0;
  const result = await requestReplan({ state: fixture(), description, referenceWeekStart: reference, throughDate: through, today, key: 'fake', model: 'deepseek-flash', fetcher: async (_url, options) => {
    calls++; const value = response();
    if (calls === 1) value.assignments[0].id = 'F1';
    else { const body = JSON.parse(options.body); assert.equal(body.messages.length, 3); assert.match(body.messages[2].content, /F编号只用于timedChanges/); }
    return completion(value);
  } });
  assert.equal(calls, 2); assert.deepEqual(result.tasks.find(t => t.id === 'meeting'), fixture().tasks.find(t => t.id === 'meeting'));
});

test('request horizon and task count bounds are enforced before sending data', () => {
  assert.throws(() => replanInput(fixture(), description, reference, '2026-10-07', today), /90 天/);
  assert.throws(() => replanInput(fixture(), description, reference, '2027-01-06', today), /90 天/);
  const state = fixture(); state.tasks = Array.from({ length: 201 }, (_, i) => ({ ...state.tasks[1], id: `task${i}` }));
  assert.throws(() => transport(state), /200 条/);
});


function interviewCase() {
  const state = emptyState(); state.settings.capacities.fill(240);
  state.tasks = [{ id: 'interview', title: '可灵面试', priority: 'medium', minutes: 60, due: '2026-10-09', scheduled: '2026-10-09', locked: true, done: false, notes: '面试备注', timeSlot: { start: '19:00', end: '20:00', reminders: [720,120,30] } }];
  const transport = replanInput(state, '可灵面试调整到明天下午2-3', '2026-09-28', '2026-11-06', '2026-10-09');
  const value = { feasible: true, summary: '可灵面试改到2026-10-10 14:00–15:00', assumptions: [], issues: [], suggestions: [], assignments: [], capacityChanges: [], timedChanges: [{ id: 'F1', date: '2026-10-10', start: '14:00', end: '15:00', reason: '按用户明确要求，明天相对于今天10月9日为10月10日' }] };
  return { state, transport, value };
}

test('explicit interview date/time change works without ordinary tasks and preserves reminder advances', () => {
  const { state, transport, value } = interviewCase(), baseline = structuredClone(state);
  const result = validateReplan(value, transport), task = result.tasks[0];
  assert.equal(task.id, 'interview'); assert.equal(task.scheduled, '2026-10-10'); assert.equal(task.due, '2026-10-10');
  assert.equal(task.timeSlot.start, '14:00'); assert.equal(task.timeSlot.end, '15:00');
  assert.deepEqual(task.timeSlot.reminders, [720,120,30]); assert.equal(task.minutes, 60); assert.equal(task.notes, '面试备注');
  assert.equal(result.changes.length, 1); assert.equal(result.changes[0].fromTimeSlot.start, '19:00'); assert.equal(result.changes[0].toTimeSlot.start, '14:00');
  assert.deepEqual(result.daily.map(d => [d.date,d.totalMinutes]), [['2026-10-09',0],['2026-10-10',60]]);
  assert.deepEqual(state, baseline); assert.deepEqual(validateState(JSON.parse(JSON.stringify({ ...state, tasks: result.tasks }))).tasks, result.tasks);
});

test('same-day time change updates duration and totals; independent deadlines and completed records survive', () => {
  const state = fixture(), value = response();
  value.timedChanges = [{ id: 'F1', date: sunday, start: '14:00', end: '15:30', reason: '明确改成下午两点至三点半' }];
  const result = validateReplan(value, transport(state)), task = result.tasks.find(t=>t.id==='meeting');
  assert.equal(task.minutes, 90); assert.equal(task.scheduled, sunday); assert.equal(task.due, '2026-10-18');
  assert.equal(result.changes.find(c=>c.id==='meeting').fromMinutes, 60);
  assert.equal(result.daily.find(d=>d.date===sunday).totalMinutes,150);
  assert.deepEqual(result.tasks.find(t=>t.id==='done'),state.tasks.find(t=>t.id==='done'));
});

test('omitted timed changes preserve unrelated events, while invalid IDs/time ranges and partial infeasible edits fail', () => {
  const { transport, value } = interviewCase();
  const unchanged = { ...value, timedChanges: [] };
  assert.deepEqual(validateReplan(unchanged, transport).tasks, transport.state.tasks);
  for (const overrides of [{ id: 'T1' }, { id: 'F99' }, { date: null }, { date: '2026-02-30' }, { start: '25:00' }, { end: '13:00' }, { end: '14:04' }, { reason: '' }]) {
    assert.throws(()=>validateReplan({ ...value, timedChanges: [{ ...value.timedChanges[0], ...overrides }] },transport),/定时任务/);
  }
  assert.throws(()=>validateReplan({ ...value, timedChanges: null },transport),/定时任务/);
  assert.throws(()=>validateReplan({ ...value, timedChanges: [value.timedChanges[0],value.timedChanges[0]] },transport),/编号/);
  for (const date of ['2026-10-08','2026-11-07']) assert.throws(()=>validateReplan({ ...value, timedChanges: [{ ...value.timedChanges[0], date }] },transport),/调整范围/);
  assert.throws(()=>validateReplan({ ...value, feasible:false },transport),/不能返回部分修改/);
});

test('timed-event request instructs DeepSeek to honor explicit edits and explains tomorrow against today', async () => {
  const { state, value } = interviewCase(); let calls = 0;
  const result = await requestReplan({ state, description: '可灵面试调整到明天下午2-3', referenceWeekStart:'2026-09-28', throughDate:'2026-11-06', today:'2026-10-09', key:'fake', model:'deepseek-flash', fetcher: async (_url, options)=>{
    calls++; const body=JSON.parse(options.body), input=JSON.parse(body.messages[1].content);
    assert.equal(input.today,'2026-10-09'); assert.equal(input.description,'可灵面试调整到明天下午2-3');
    assert.deepEqual(input.allowedTaskIds,[]); assert.deepEqual(input.allowedTimedTaskIds,['F1']);
    assert.match(body.messages[0].content,/不能以「定时任务不可动」拒绝/); assert.match(body.messages[0].content,/明天是today加一天/);
    assert.match(body.messages[0].content,/未被要求修改的定时任务不能/); return completion(value);
  }});
  assert.equal(calls,1); assert.equal(result.tasks[0].scheduled,'2026-10-10');
});

test('rescheduled reminders use the new start/date and ignore delivery keys from the old event', async () => {
  const { reminderKey, collectDue } = await import('../desktop/reminders.js');
  const { state, transport, value } = interviewCase(), result = validateReplan(value,transport);
  const fired = Object.fromEntries([720,120,30].map(lead=>[reminderKey(state.tasks[0],lead),1]));
  assert.notEqual(reminderKey(state.tasks[0],120),reminderKey(result.tasks[0],120));
  assert.equal(collectDue({tasks:result.tasks},fired,new Date('2026-10-09T18:30:00').getTime()).alerts.length,0);
  const alerts = collectDue({tasks:result.tasks},fired,new Date('2026-10-10T12:00:00').getTime()).alerts;
  assert.equal(alerts.length,1); assert.equal(alerts[0].date,'2026-10-10'); assert.equal(alerts[0].start,'14:00'); assert.equal(alerts[0].lead,120);
});

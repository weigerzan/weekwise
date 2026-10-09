import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState, addDays } from '../src/planner.js';
import { naturalInput, validateNaturalPlan, requestNaturalPlan } from '../desktop/natural.js';
const today = '2026-10-08';
const description = '需要审7篇ICLR稿件。不要集中一天审完，但7天内要审完。一个稿子大概至少1小时，不熟悉的2h。';
const revision = '我还需要改一篇稿子，Intro已经改完了。Related work，Method，和Experiments，Conclusion还没改。你规划一下，但我今天不想改了。这周内完成';
function fixture() {
  return { summary: '每天审一篇，七天完成', assumptions: ['不熟悉的数量未给出，每篇按2小时保守预留'], questions: [], goals: [{ id: 'G1', title: '审ICLR稿件', quantity: 7, unit: '篇', deadline: '2026-10-14' }], tasks: Array.from({ length: 7 }, (_, i) => ({ goalId: 'G1', title: '审ICLR稿件', date: addDays(today, i), minutes: 120, items: [i + 1], notes: '审完当天规定的稿件后打勾' })) };
}
function revisionFixture() {
  return { summary: '今天休息，周五至周日修改未完成章节', assumptions: ['未提供耗时，按章节复杂度估计，可手动修改'], questions: [], goals: [{ id: 'G1', title: '修改稿件剩余章节', quantity: null, unit: '', deadline: '2026-10-11' }], tasks: [
    { goalId: 'G1', title: '修改 Related work 和 Method', date: '2026-10-09', minutes: 150, items: [], notes: 'Intro 已完成，无需重做' },
    { goalId: 'G1', title: '修改 Experiments', date: '2026-10-10', minutes: 90, items: [], notes: '核对实验描述与结果' },
    { goalId: 'G1', title: '修改 Conclusion', date: '2026-10-11', minutes: 45, items: [], notes: '总结修改后的方法与实验' }
  ] };
}
function completion(value) { return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] })); }
test('review plan saves independent daily tasks and quantity tags across a week boundary', () => {
  const state = emptyState(), result = validateNaturalPlan(fixture(), naturalInput(state, description, today, today));
  assert.equal(result.tasks.length, 7); assert.equal(result.tasks[6].scheduled, '2026-10-14');
  assert.equal(new Set(result.tasks.map(t => t.id)).size, 7); assert.equal(new Set(result.tasks.map(t => t.origin.batchId)).size, 1);
  assert.ok(result.tasks.every(t => !t.done && t.locked && !Object.hasOwn(t, 'category')));
  assert.deepEqual(result.tasks.flatMap(t => t.origin.items), [1,2,3,4,5,6,7]);
  assert.match(result.tasks[0].title, /1篇/); assert.equal(state.tasks.length, 0);
  const saved = validateState({ ...state, tasks: result.tasks }); assert.deepEqual(saved.tasks, result.tasks);
  saved.tasks[0].done = true; assert.equal(saved.tasks[1].done, false);
});
test('one manuscript can be split into non-counted chapter tasks without quantity evidence', () => {
  const result = validateNaturalPlan(revisionFixture(), naturalInput(emptyState(), revision, today, today));
  assert.deepEqual(result.tasks.map(t => t.scheduled), ['2026-10-09', '2026-10-10', '2026-10-11']);
  assert.ok(result.tasks.every(t => t.due === '2026-10-11' && !t.title.includes('Intro') && !t.title.includes('篇') && t.origin.items.length === 0));
  assert.match(result.tasks[0].title, /Related work.*Method/);
  assert.match(result.tasks[0].notes, /原始目标：我还需要改一篇稿子/);
});
test('input supplies workload context without locally interpreting dates, quantities or completed chapters', () => {
  const state = emptyState(); state.tasks = [{ id: 'old', title: '私密任务名称', priority: 'medium', minutes: 180, due: null, scheduled: today, locked: false, done: false, notes: '私密备注' }];
  const input = naturalInput(state, revision, today, today);
  assert.equal(input.description, revision); assert.equal(input.days[0].availableMinutes, 60); assert.equal(input.days[2].capacityMinutes, 120);
  assert.deepEqual(Object.keys(input).sort(), ['categories', 'days', 'description', 'latestDate', 'preferences', 'startDate', 'today']);
  assert.ok(!JSON.stringify(input).includes('私密任务名称')); assert.ok(!JSON.stringify(input).includes('私密备注'));
});
test('model estimates and scheduling decisions are saved without local capacity or quantity rules', () => {
  const state = emptyState(); state.settings.capacities.fill(0);
  const value = revisionFixture(), result = validateNaturalPlan(value, naturalInput(state, revision, today, today));
  assert.deepEqual(result.tasks.map(t => ({ title: t.title, minutes: t.minutes, date: t.scheduled })), value.tasks.map(t => ({ title: t.title, minutes: t.minutes, date: t.date })));
  // Even a model using a counted parent for a staged object must not trigger the old once-only rule.
  value.goals[0].quantity = 1; value.goals[0].unit = '篇'; value.tasks.forEach(t => t.items = [1]);
  assert.equal(validateNaturalPlan(value, naturalInput(state, revision, today, today)).tasks.length, 3);
});
test('invalid fields that cannot be stored are still rejected', () => {
  const input = naturalInput(emptyState(), revision, today, today);
  const unknown = revisionFixture(); unknown.tasks[0].goalId = 'G99'; assert.throws(() => validateNaturalPlan(unknown, input), /字段格式/);
  const invalidDate = revisionFixture(); invalidDate.tasks[0].date = '2026-02-30'; assert.throws(() => validateNaturalPlan(invalidDate, input), /字段格式/);
  const invalidMinutes = revisionFixture(); invalidMinutes.tasks[0].minutes = '90'; assert.throws(() => validateNaturalPlan(invalidMinutes, input), /字段格式/);
  const invalidItems = fixture(); invalidItems.tasks[0].items = [1,1]; assert.throws(() => validateNaturalPlan(invalidItems, input), /来源信息/);
  const duplicateGoal = revisionFixture(); duplicateGoal.goals.push({ ...duplicateGoal.goals[0] }); assert.throws(() => validateNaturalPlan(duplicateGoal, input), /目标字段/);
});
test('several papers on the same day remain one checkable task', () => {
  const value = fixture(); value.tasks = [{ ...value.tasks[0], items: [1,2], minutes: 240 }, { ...value.tasks[1], items: [3,4], minutes: 240 }, { ...value.tasks[2], items: [5,6], minutes: 240 }, { ...value.tasks[3], items: [7], minutes: 120 }];
  const result = validateNaturalPlan(value, naturalInput(emptyState(), description, today, today));
  assert.equal(result.tasks.length, 4); assert.match(result.tasks[0].title, /2篇/); assert.equal(result.tasks.flatMap(t => t.origin.items).length, 7);
});
test('model clarification does not create partial tasks', () => {
  const input = naturalInput(emptyState(), revision, today, today);
  const result = validateNaturalPlan({ summary: '剩余可用时长不足', assumptions: [], questions: ['是否增加可用时长？'], goals: [], tasks: [] }, input);
  assert.equal(result.tasks.length, 0); assert.equal(result.questions.length, 1);
  const partial = revisionFixture(); partial.questions = ['增加时长？']; assert.throws(() => validateNaturalPlan(partial, input), /不能同时生成任务/);
});
test('revision API forwards the exact description and accepts model chapter planning in one call', async () => {
  let calls = 0; const state = emptyState();
  const result = await requestNaturalPlan({ state, description: revision, startDate: today, today, key: 'fake', model: 'deepseek-flash', fetcher: async (_url, options) => {
    calls++; const body = JSON.parse(options.body), input = JSON.parse(body.messages[1].content);
    assert.equal(input.description, revision); assert.equal(input.days[0].availableMinutes, 240);
    assert.match(body.messages[0].content, /所有自然语言理解与排期都由你决定/);
    assert.match(body.messages[0].content, /今天休息，从明天开始/); assert.match(body.messages[0].content, /截止本周日/);
    return completion(revisionFixture());
  } });
  assert.equal(calls, 1); assert.equal(result.tasks.length, 3); assert.equal(state.tasks.length, 0);
});
test('invalid response fields are repaired once without local schedule correction', async () => {
  let calls = 0;
  const result = await requestNaturalPlan({ state: emptyState(), description: revision, startDate: today, today, key: 'fake', model: 'deepseek-flash', fetcher: async (_url, options) => {
    calls++; const body = JSON.parse(options.body), value = revisionFixture();
    if (calls === 1) value.tasks[0].goalId = 'G99'; else { assert.equal(body.messages.length, 3); assert.match(body.messages[2].content, /数据格式无法保存/); }
    return completion(value);
  } });
  assert.equal(calls, 2); assert.equal(result.tasks.length, 3);
});
test('old categorized data migrates without losing completion', () => {
  const state = emptyState(); state.tasks = [{ id: 'legacy', title: '旧任务', category: 'work', priority: 'medium', minutes: 60, due: null, scheduled: today, locked: false, done: true, notes: '保留备注' }];
  const migrated = validateState(state); assert.ok(!Object.hasOwn(migrated.tasks[0], 'category')); assert.equal(migrated.tasks[0].done, true); assert.equal(migrated.tasks[0].notes, '保留备注');
});


test('completed tasks consume daily planned capacity while actual durations remain private', () => {
  const state = emptyState(); state.tasks = [
    { id: 'done', title: '已完成', priority: 'medium', minutes: 90, actualMinutes: 47, due: null, scheduled: today, locked: false, done: true, notes: '' },
    { id: 'todo', title: '未完成', priority: 'medium', minutes: 120, due: null, scheduled: today, locked: false, done: false, notes: '' }
  ];
  const input = naturalInput(state, description, today, today);
  assert.equal(input.days[0].occupiedMinutes, 210); assert.equal(input.days[0].availableMinutes, 30);
  assert.ok(!JSON.stringify(input).includes('actualMinutes'));
});

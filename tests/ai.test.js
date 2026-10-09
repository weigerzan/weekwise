import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../src/planner.js';
import { planningInput, modelPlanningInput, decodeModelPlan, validateAIPlan, requestDeepSeek } from '../desktop/ai.js';
import { friendlyError, planningError } from '../src/errors.js';
const start = '2026-10-05';
const task = (id, extra = {}) => ({ id, title: '任务', category: 'work', priority: 'medium', minutes: 60, due: null, scheduled: null, locked: false, done: false, notes: '', ...extra });
test('AI input excludes completed and other weeks; validation protects originals', () => {
  const state = emptyState(); state.tasks = [task('a'), task('locked', { locked: true, scheduled: start }), task('done', { done: true }), task('other', { scheduled: '2026-10-20' })];
  assert.equal(planningInput(state, start, start).tasks.length, 2);
  const result = validateAIPlan({ summary: '合理安排', assignments: [{ id: 'a', date: start, reason: '有空' }] }, state, start, start);
  assert.equal(result.loads[start], 120); assert.equal(result.placed, 1); assert.deepEqual(result.tasks.slice(1), state.tasks.slice(1));
  assert.equal(state.tasks[0].scheduled, null);
});
test('AI invalid dates, invented IDs, conflicting duplicates and missing tasks are rejected', () => {
  const state = emptyState(); state.tasks = [task('a')];
  for (const assignments of [[{ id: 'unknown', date: start, reason: '' }], [{ id: 'a', date: '2026-10-15', reason: '' }], [], [{ id: 'a', date: start, reason: '' }, { id: 'a', date: '2026-10-06', reason: '' }]]) assert.throws(() => validateAIPlan({ summary: '', assignments }, state, start, start));
  assert.throws(() => validateAIPlan({ summary: '', assignments: [{ id: 'a', date: start, reason: '' }] }, state, start, '2026-10-08'), /过去/);
});
test('AI overload and deadline violations stay in backlog', () => {
  const state = emptyState(); state.settings.capacities.fill(60); state.tasks = [task('a', { due: start }), task('b'), task('lock', { locked: true, scheduled: '2026-10-06', minutes: 60 })];
  const result = validateAIPlan({ summary: 'test', assignments: [{ id: 'a', date: '2026-10-06', reason: '' }, { id: 'b', date: '2026-10-06', reason: '' }] }, state, start, start);
  assert.equal(result.placed, 0); assert.equal(result.unplaced.length, 2); assert.equal(result.tasks[2].scheduled, '2026-10-06');
});
test('DeepSeek request uses JSON output and parses a mocked successful response', async () => {
  const state = emptyState(); state.tasks = [task('a')];
  const result = await requestDeepSeek({ key: 'test-only-key', model: 'deepseek-flash', state, start, today: start, fetcher: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions'); const body = JSON.parse(options.body); assert.equal(body.response_format.type, 'json_object'); assert.equal(body.messages.length, 2);
    assert.equal(JSON.parse(body.messages[1].content).tasks[0].id, 'T1');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '测试计划', assignments: [{ id: 'T1', date: start, reason: '可用' }] }) } }] }), { status: 200 });
  } });
  assert.equal(result.placed, 1);
});
test('short references map to original UUIDs, fixed tasks stay separate and echoed locks are preserved', () => {
  const state = emptyState(); const id = '259eddd2-2238-441b-8bfe-853f50bdd65d';
  state.tasks = [task(id), task('locked-original', { locked: true, scheduled: start, minutes: 120 })];
  const transport = modelPlanningInput(state, start, start);
  assert.deepEqual(transport.input.allowedTaskIds, ['T1']);
  assert.equal(transport.input.tasks.length, 1); assert.equal(transport.input.fixedTasks[0].id, 'F1');
  assert.ok(!JSON.stringify(transport.input).includes(id));
  const decoded = decodeModelPlan({ summary: '', assignments: [{ id: ' t1 ', date: start, reason: '安排' }, { id: 'T1', date: start, reason: '重复说明' }, { id: 'F1', date: '2026-10-06', reason: '错误改变锁定任务' }] }, transport);
  assert.equal(decoded.assignments.length, 1); assert.equal(decoded.assignments[0].id, id);
  const result = validateAIPlan(decoded, state, start, start);
  assert.equal(result.placed, 1); assert.equal(result.loads[start], 180); assert.deepEqual(result.tasks[1], state.tasks[1]);
  const numeric = decodeModelPlan({ summary: '', assignments: [{ id: 1, date: start, reason: '' }] }, transport);
  assert.equal(numeric.assignments[0].id, id);
});
test('identical internal duplicates count once and known locked entries cannot move', () => {
  const state = emptyState(); state.tasks = [task('a'), task('lock', { locked: true, scheduled: start })];
  const result = validateAIPlan({ summary: '', assignments: [{ id: 'a', date: start, reason: '' }, { id: 'a', date: start, reason: '' }, { id: 'lock', date: '2026-10-06', reason: '' }] }, state, start, start);
  assert.equal(result.placed, 1); assert.equal(result.loads[start], 120); assert.equal(result.tasks[1].scheduled, start);
});
function completion(value) { return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] })); }
test('unknown IDs trigger one automatic correction using original short references', async () => {
  const state = emptyState(); state.tasks = [task('original-uuid')]; let calls = 0;
  const result = await requestDeepSeek({ key: 'test-only', model: 'deepseek-flash', state, start, today: start, fetcher: async (_url, options) => {
    const body = JSON.parse(options.body); calls++;
    if (calls === 1) return completion({ summary: '', assignments: [{ id: 'invented-id', date: start, reason: '' }] });
    assert.equal(body.messages.length, 3); assert.match(body.messages[2].content, /T1/);
    return completion({ summary: '已校正', assignments: [{ id: 'T1', date: start, reason: '可用时间' }] });
  } });
  assert.equal(calls, 2); assert.equal(result.tasks[0].id, 'original-uuid'); assert.equal(result.tasks[0].scheduled, start); assert.equal(state.tasks[0].scheduled, null);
});
test('missing and conflicting assignments are repaired; invalid second response stops without modifying state', async () => {
  const state = emptyState(); state.tasks = [task('a')];
  for (const assignments of [[], [{ id: 'T1', date: start, reason: '' }, { id: 'T1', date: '2026-10-06', reason: '' }]]) {
    let calls = 0;
    const result = await requestDeepSeek({ key: 'test', model: 'deepseek-flash', state, start, today: start, fetcher: async () => { calls++; return completion({ summary: '', assignments: calls === 1 ? assignments : [{ id: 'T1', date: null, reason: '稍后安排' }] }); } });
    assert.equal(calls, 2); assert.equal(result.unplaced.length, 1);
  }
  let calls = 0; const before = structuredClone(state);
  await assert.rejects(requestDeepSeek({ key: 'test', model: 'deepseek-flash', state, start, today: start, fetcher: async () => { calls++; return completion({ summary: '', assignments: [{ id: 'unknown', date: start, reason: '' }] }); } }), /自动校正后仍未通过校验/);
  assert.equal(calls, 2); assert.deepEqual(state, before);
});
test('auth failures never retry and cancellation between responses never issues repair request', async () => {
  const state = emptyState(); state.tasks = [task('a')]; const args = { key: 'test', model: 'deepseek-flash', state, start, today: start }; let calls = 0;
  await assert.rejects(requestDeepSeek({ ...args, fetcher: async () => { calls++; return new Response('', { status: 401 }); } }), /密钥无效/); assert.equal(calls, 1);
  const controller = new AbortController(); calls = 0;
  await assert.rejects(requestDeepSeek({ ...args, signal: controller.signal, fetcher: async () => { calls++; controller.abort(); return completion({ summary: '', assignments: [] }); } }), /已取消/); assert.equal(calls, 1);
});
test('planning error text removes Electron wrapper and duplicate sentence punctuation', () => {
  assert.equal(friendlyError(new Error("Error invoking remote method 'ai:plan': Error: AI 返回了未知或重复任务，请重新规划。")), 'AI 返回了未知或重复任务，请重新规划');
  assert.equal(friendlyError(new Error('服务暂不可用')), '服务暂不可用');
});
test('authentication, timeout and truncated responses surface actionable errors', async () => {
  const state = emptyState(); state.tasks = [task('a')];
  const args = { key: 'test', model: 'deepseek-flash', state, start, today: start };
  await assert.rejects(requestDeepSeek({ ...args, fetcher: async () => new Response('', { status: 401 }) }), /密钥无效/);
  await assert.rejects(requestDeepSeek({ ...args, fetcher: async () => { throw new DOMException('timeout', 'TimeoutError'); } }), /超时/);
  await assert.rejects(requestDeepSeek({ ...args, fetcher: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length' }] })) }), /未完成/);
});
test('missing desktop handler asks for full restart rather than suggesting prompt edits', () => {
  const error = new Error("Error invoking remote method 'ai:replan': Error: No handler registered for 'ai:replan'");
  const result = planningError(error, '可以修改要求后重试。');
  assert.match(result, /后台尚未加载此功能/); assert.match(result, /系统托盘退出拾周/);
  assert.ok(!result.includes('修改要求')); assert.ok(!result.includes('No handler')); assert.ok(!result.includes('。。'));
  assert.equal(planningError(new Error('余额不足。'), '可检查设置后重试。'), '余额不足。可检查设置后重试。');
});
test('a week containing only fixed tasks makes no paid API call', async () => {
  const state = emptyState(); state.tasks = [task('lock', { locked: true, scheduled: start })];
  const result = await requestDeepSeek({ key: 'test', model: 'deepseek-flash', state, start, today: start, fetcher: async () => { throw new Error('must not call'); } });
  assert.equal(result.preserved, 1); assert.equal(result.placed, 0);
});

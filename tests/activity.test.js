import test from 'node:test';
import assert from 'node:assert/strict';
import { monthDays, monthStart, shiftMonth, dailyActivity, activityRange, heatLevel } from '../src/activity.js';
import { emptyState, validateState } from '../src/planner.js';
import { insightsHtml } from '../src/insights.js';

const task = (id, extra={}) => ({id,title:id,minutes:120,scheduled:'2026-10-09',due:null,priority:'medium',locked:false,done:true,notes:'',...extra});
test('month grid covers leap February, six-week months and year boundaries with Monday first', () => {
  assert.equal(monthStart('2026-10-09'),'2026-10-01');
  assert.equal(shiftMonth('2026-12-31',1),'2027-01-01');
  assert.equal(shiftMonth('2026-01-31',-1),'2025-12-01');
  const leap=monthDays('2024-02-15'); assert(leap.includes('2024-02-29')); assert.equal(leap.length,35); assert.equal(leap[0],'2024-01-29');
  const six=monthDays('2026-03-01'); assert.equal(six.length,42); assert.equal(six[0],'2026-02-23'); assert.equal(six.at(-1),'2026-04-05');
  assert.equal(monthDays('2027-02-01').length,28);
});
test('activity prefers actual minutes, falls back to planned minutes only for completed tasks, and groups by completion day', () => {
  const activity=dailyActivity([
    task('a',{actualMinutes:35,scheduled:'2026-10-15',completedOn:'2026-10-09'}),
    task('b',{actualMinutes:55}),task('c'),
    task('pending',{actualMinutes:900,done:false}),
    task('unscheduled',{scheduled:null,completedOn:'2026-10-09',actualMinutes:20}),
    task('undated',{scheduled:null,actualMinutes:60})
  ]);
  const day=activity.days.get('2026-10-09');
  assert.equal(day.minutes,230); assert.equal(day.missing,1); assert.equal(day.legacy,2); assert.equal(day.tasks.length,4); assert.equal(activity.undated,1);
  const rows=activityRange(activity,'2026-10-08','2026-10-10'); assert.deepEqual(rows.map(d=>d.minutes),[0,230,0]); assert.equal(activity.days.has('2026-10-15'),false);
  assert.deepEqual([0,1,59,60,119,120,239,240,300].map(heatLevel),[0,1,1,2,2,3,3,4,4]);
});
test('backfilling or clearing actual minutes replaces the planned fallback instead of double-counting, without changing task data', () => {
  const tasks=[task('fallback'),task('pending',{done:false})], original=structuredClone(tasks);
  assert.equal(dailyActivity(tasks).days.get('2026-10-09').minutes,120); assert.deepEqual(tasks,original);
  tasks[0].actualMinutes=35; let day=dailyActivity(tasks).days.get('2026-10-09'); assert.equal(day.minutes,35); assert.equal(day.missing,0);
  delete tasks[0].actualMinutes; day=dailyActivity(tasks).days.get('2026-10-09'); assert.equal(day.minutes,120); assert.equal(day.missing,1);
  const state=emptyState();state.tasks=tasks;const html=insightsHtml(state,'2026-10-09',2026,7,'2026-10-09');assert(html.includes('按计划耗时计入'));assert(html.includes('已按计划耗时计入'));
  tasks[0].done=false; assert.equal(dailyActivity(tasks).days.size,0);
});
test('completion date round-trips backups and rejects impossible dates without changing old records', () => {
  const state=emptyState(); state.tasks=[task('new',{completedOn:'2026-10-09',actualMinutes:80}),task('old',{actualMinutes:40})];
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))),state);
  state.tasks[0].completedOn='2026-02-30'; assert.throws(()=>validateState(state),/完成日期/);
});
test('empty charts are finite, leap day heatmap remains present and task text is escaped', () => {
  const state=emptyState(); let html=insightsHtml(state,'2024-12-31',2024,90,'2024-02-29');
  assert(html.includes('data-activity-day="2024-02-29"')); assert(!/NaN|Infinity/.test(html)); assert.equal((html.match(/<button class="heat-cell/g)||[]).length,366);
  state.tasks=[task('<img onerror=x>',{scheduled:'2024-02-29',actualMinutes:10080})];
  html=insightsHtml(state,'2024-12-31',2024,7,'2024-02-29'); assert(html.includes('&lt;img onerror=x&gt;')); assert(!html.includes('<img onerror=x>')); assert(!/NaN|Infinity/.test(html));
});

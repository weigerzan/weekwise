import { getCategories, validateCategories } from './categories.js';
export const PRIORITIES = { high: '高优先级', medium: '中优先级', low: '低优先级' };
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function parseDate(key) { return new Date(`${key}T12:00:00`); }
export function addDays(key, count) { const d = parseDate(key); d.setDate(d.getDate() + count); return dateKey(d); }
export function weekStart(key = dateKey()) { const d = parseDate(key); return addDays(key, -((d.getDay() + 6) % 7)); }
export function weekDays(start) { return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }
export function emptyState() { return { version: 1, tasks: [], settings: { capacities: [240, 240, 240, 240, 180, 120, 120], preferences: '' } }; }
export function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseDate(value).valueOf()) && dateKey(parseDate(value)) === value; }
export function validTime(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value); }
export function timeMinutes(value) { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; }
export function capacityForDate(state, date) { return state.settings.dateCapacities?.[date] ?? state.settings.capacities[(parseDate(date).getDay() + 6) % 7]; }
export function dayPlanSignature(tasks, date) {
  return JSON.stringify(tasks.filter(t => t.scheduled === date).map(t => ({ id: t.id, minutes: t.minutes, timeSlot: t.timeSlot ? [t.timeSlot.start,t.timeSlot.end] : null })).sort((a,b) => a.id.localeCompare(b.id)));
}
function planSlots(value) {
  if (!Array.isArray(value) || !value.length || value.length > 30 || value.some(s => !s || !validTime(s.start) || !validTime(s.end) || timeMinutes(s.end) <= timeMinutes(s.start))) throw new Error('工作时段需要当天有效的开始、结束时间');
  return value.map(s => ({ start:s.start,end:s.end })).sort((a,b) => a.start.localeCompare(b.start));
}
export function validateDayRecord(p, tasks, date) {
  if (!p || typeof p.signature !== 'string' || typeof p.description !== 'string' || p.description.length > 3000 || typeof p.summary !== 'string' || p.summary.length > 3000 || !Array.isArray(p.assumptions) || p.assumptions.length > 20 || p.assumptions.some(s => typeof s !== 'string' || s.length > 1000) || !Array.isArray(p.assignments) || p.assignments.length > 200 || !Array.isArray(p.breaks) || p.breaks.length > 48) throw new Error('当天时段规划格式不正确');
  const seen = new Set();
  const assignments = p.assignments.map(row => {
    if (!row || typeof row.taskId !== 'string' || seen.has(row.taskId)) throw new Error('当天时段规划的任务编号重复或不正确');
    seen.add(row.taskId); return { taskId:row.taskId,slots:planSlots(row.slots) };
  });
  const breaks = p.breaks.map(row => {
    if (!row || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 150 || !validTime(row.start) || !validTime(row.end) || timeMinutes(row.end) <= timeMinutes(row.start)) throw new Error('吃饭或休息时段格式不正确');
    return { title:row.title.trim(),start:row.start,end:row.end };
  }).sort((a,b) => a.start.localeCompare(b.start));
  // Task/date/duration edits invalidate this day's agenda; completion and manual
  // display ordering do not. A stale agenda is removed instead of blocking edits.
  if (p.signature !== dayPlanSignature(tasks,date)) return null;
  const overlaps = p.overlaps ?? [];
  if (!Array.isArray(overlaps) || overlaps.length > 200) throw new Error('并行时段许可格式不正确');
  const permissions = new Map();
  const overlapKey = (ids,start,end) => JSON.stringify([[...ids].sort(),start,end]);
  const allowed = overlaps.map(row => {
    if (!row || !Array.isArray(row.taskIds) || row.taskIds.length !== 2 || row.taskIds.some(id => typeof id !== 'string' || !tasks.some(t => t.id === id && t.scheduled === date)) || row.taskIds[0] === row.taskIds[1] || !validTime(row.start) || !validTime(row.end) || row.end <= row.start || typeof row.permission !== 'string' || !row.permission.trim() || row.permission.length > 1000 || !p.description.includes(row.permission)) throw new Error('并行时段需要两个有效任务、具体时段和当天要求中的原文许可');
    const key = overlapKey(row.taskIds,row.start,row.end);
    if (permissions.has(key)) throw new Error('并行时段许可重复');
    permissions.set(key,false);
    return {taskIds:[...row.taskIds],start:row.start,end:row.end,permission:row.permission};
  });
  const ranges = breaks.map(s => ({...s,taskId:null}));
  for (const row of assignments) {
    const task = tasks.find(t => t.id === row.taskId && t.scheduled === date && !t.timeSlot);
    if (!task || row.slots.reduce((sum,s) => sum+timeMinutes(s.end)-timeMinutes(s.start),0) !== task.minutes) throw new Error('工作时段遗漏任务或与预计耗时不一致');
    ranges.push(...row.slots.map(s => ({...s,taskId:row.taskId})));
  }
  ranges.push(...tasks.filter(t => t.scheduled === date && t.timeSlot).map(t => ({...t.timeSlot,taskId:t.id})));
  ranges.sort((a,b) => a.start.localeCompare(b.start));
  // Check every active interval, including a long meeting that contains several
  // shorter slots. A permission covers only its specific task pair and overlap.
  let active = [];
  for (const row of ranges) {
    active = active.filter(s => s.end > row.start);
    for (const other of active) {
      const start = row.start > other.start ? row.start : other.start, end = row.end < other.end ? row.end : other.end;
      const key = overlapKey([row.taskId,other.taskId],start,end);
      if (!row.taskId || !other.taskId || row.taskId === other.taskId || !permissions.has(key)) throw new Error('工作、吃饭休息或定时日程的时段重叠，且没有对应的用户并行许可，请重新规划');
      permissions.set(key,true);
    }
    active.push(row);
  }
  if ([...permissions.values()].some(used => !used)) throw new Error('并行许可的任务或时段与实际重叠不一致');
  return { signature:p.signature,description:p.description,summary:p.summary,assumptions:[...p.assumptions],assignments,breaks,...(allowed.length ? {overlaps:allowed} : {}) };
}
export function validateState(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.tasks) || value.tasks.length > 10000) throw new Error('备份格式不正确，或任务数量超过 10000 条。');
  const capacities = value.settings?.capacities;
  if (!Array.isArray(capacities) || capacities.length !== 7 || capacities.some(n => !Number.isInteger(n) || n < 0 || n > 1440)) throw new Error('每日可用时长必须在 0–1440 分钟之间。');
  const categories = value.settings.categories === undefined ? getCategories(value) : validateCategories(value.settings.categories);
  const ids = new Set();
  const tasks = value.tasks.map(t => {
    if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 100 || ids.has(t.id)) throw new Error('任务标识不正确或重复。');
    ids.add(t.id);
    if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 150) throw new Error('任务名称必须为 1–150 个字符。');
    if (!Object.hasOwn(PRIORITIES, t.priority)) throw new Error('任务优先级不正确。');
    if (!Number.isInteger(t.minutes) || t.minutes < 5 || t.minutes > 1440) throw new Error('任务预计耗时必须为 5–1440 分钟。');
    if ((t.due !== null && !validDate(t.due)) || (t.scheduled !== null && !validDate(t.scheduled))) throw new Error('任务日期不正确。');
    if (typeof t.locked !== 'boolean' || typeof t.done !== 'boolean' || typeof t.notes !== 'string' || t.notes.length > 3000) throw new Error('任务字段不正确。');
    if (t.locked && !t.scheduled) throw new Error('锁定任务需要指定安排日期。');
    const task = { id: t.id, title: t.title.trim(), priority: t.priority, minutes: t.minutes, due: t.due, scheduled: t.scheduled, locked: t.locked, done: t.done, notes: t.notes };
    if (t.categoryId !== undefined && t.categoryId !== null) {
      if (typeof t.categoryId !== 'string') throw new Error('任务类别编号格式不正确。');
      if (categories.some(c => c.id === t.categoryId)) task.categoryId = t.categoryId;
    }
    if (t.completedOn !== undefined) {
      if (!validDate(t.completedOn)) throw new Error('实际完成日期不正确。');
      task.completedOn = t.completedOn;
    }
    if (t.actualMinutes !== undefined) {
      if (!Number.isInteger(t.actualMinutes) || t.actualMinutes < 1 || t.actualMinutes > 10080) throw new Error('实际耗时必须为 1–10080 分钟的整数。');
      task.actualMinutes = t.actualMinutes;
    }
    if (t.timeSlot !== undefined && t.timeSlot !== null) {
      const slot = t.timeSlot;
      if (!t.scheduled || !slot || !validTime(slot.start) || !validTime(slot.end) || timeMinutes(slot.end) <= timeMinutes(slot.start)) throw new Error('定时任务需要安排日期，以及当天先后有效的开始、结束时间。');
      if (!Array.isArray(slot.reminders) || slot.reminders.length > 10 || slot.reminders.some(n => !Number.isInteger(n) || n < 0 || n > 10080) || new Set(slot.reminders).size !== slot.reminders.length) throw new Error('提前提醒需要 0–10080 分钟的整数，不能重复。');
      task.timeSlot = { start: slot.start, end: slot.end, reminders: [...slot.reminders].sort((a, b) => b - a) };
      task.locked = true;
    }
    if (t.origin !== undefined) {
      const o = t.origin;
      if (!o || typeof o.batchId !== 'string' || !o.batchId || o.batchId.length > 100 || typeof o.goalTitle !== 'string' || o.goalTitle.length > 150 || typeof o.unit !== 'string' || o.unit.length > 10 || !Array.isArray(o.items) || o.items.length > 2000 || o.items.some(n => !Number.isInteger(n) || n < 1 || n > 2000) || new Set(o.items).size !== o.items.length) throw new Error('拆分任务的来源信息不正确。');
      task.origin = { batchId: o.batchId, goalTitle: o.goalTitle, unit: o.unit, items: [...o.items] };
    }
    return task;
  });
  const preferences = value.settings.preferences ?? '';
  if (typeof preferences !== 'string' || preferences.length > 2000) throw new Error('规划偏好不得超过 2000 个字符。');
  const settings = { capacities: [...capacities], preferences };
  if (value.settings.categories !== undefined) settings.categories = categories;
  if (value.settings.dailyRoutine !== undefined) {
    const routine = value.settings.dailyRoutine;
    if (!routine || !validTime(routine.start) || !validTime(routine.end) || timeMinutes(routine.end) <= timeMinutes(routine.start) || !Array.isArray(routine.breaks) || routine.breaks.length > 20) throw new Error('基础作息需要同一天有效的上班、下班时间');
    const breaks = routine.breaks.map(row => {
      if (!row || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 150 || !validTime(row.start) || !validTime(row.end) || timeMinutes(row.end) <= timeMinutes(row.start)) throw new Error('基础吃饭或休息时段格式不正确');
      return {title:row.title.trim(),start:row.start,end:row.end};
    });
    settings.dailyRoutine = {start:routine.start,end:routine.end,breaks};
  }
  if (value.settings.dayPreferences !== undefined) {
    if (typeof value.settings.dayPreferences !== 'string' || value.settings.dayPreferences.length > 3000) throw new Error('一天的作息偏好不得超过 3000 个字符');
    settings.dayPreferences = value.settings.dayPreferences;
  }
  if (value.settings.dayOverrides !== undefined) {
    const overrides = value.settings.dayOverrides;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).length > 366 || Object.entries(overrides).some(([date,text]) => !validDate(date) || typeof text !== 'string' || text.length > 3000)) throw new Error('当天例外需要有效日期和最多3000个字符');
    if (Object.keys(overrides).length) settings.dayOverrides = {...overrides};
  }
  if (value.settings.dateCapacities !== undefined) {
    const overrides = value.settings.dateCapacities;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).length > 1000 || Object.entries(overrides).some(([date, minutes]) => !validDate(date) || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440)) throw new Error('单日可用时长需要有效日期和 0–1440 分钟。');
    if (Object.keys(overrides).length) settings.dateCapacities = { ...overrides };
  }
  const state = { version: 1, tasks, settings };
  if (value.dayPlans !== undefined) {
    if (!value.dayPlans || typeof value.dayPlans !== 'object' || Array.isArray(value.dayPlans) || Object.keys(value.dayPlans).length > 366) throw new Error('当天时段规划数据格式不正确');
    const plans = {};
    for (const [date,p] of Object.entries(value.dayPlans)) {
      if (!validDate(date)) throw new Error('当天时段规划日期不正确');
      const plan = validateDayRecord(p,tasks,date);
      if (plan) plans[date] = plan;
    }
    if (Object.keys(plans).length) state.dayPlans = plans;
  }
  return state;
}
export function planWeek(state, start, today = dateKey()) {
  const days = weekDays(start);
  const loads = Object.fromEntries(days.map(d => [d, 0]));
  const tasks = state.tasks.map(t => ({ ...t }));
  const candidates = [];
  for (const task of tasks) {
    if (task.done || task.locked || (task.scheduled && !days.includes(task.scheduled))) {
      if (!task.done && days.includes(task.scheduled)) loads[task.scheduled] += task.minutes;
    } else { task.scheduled = null; candidates.push(task); }
  }
  const ranks = { high: 0, medium: 1, low: 2 };
  candidates.sort((a, b) => (a.due || '9999-12-31').localeCompare(b.due || '9999-12-31') || ranks[a.priority] - ranks[b.priority] || b.minutes - a.minutes || a.id.localeCompare(b.id));
  const unplaced = [];
  for (const task of candidates) {
    const eligible = days.filter(d => d >= today && (!task.due || d <= task.due));
    const fitting = eligible.filter(d => loads[d] + task.minutes <= capacityForDate(state, d));
    // Most balanced utilization first; equal utilization prefers an earlier day.
    fitting.sort((a, b) => loads[a] / capacityForDate(state, a) - loads[b] / capacityForDate(state, b) || a.localeCompare(b));
    if (fitting.length) { task.scheduled = fitting[0]; loads[fitting[0]] += task.minutes; }
    else {
      const reason = !eligible.length ? (task.due && task.due < today ? '截止日期已过，请调整日期' : '本周没有符合截止日期的可用日') : '可用时长不足，可拆分任务或增加每日时长';
      unplaced.push({ id: task.id, title: task.title, reason });
    }
  }
  const overloaded = days.filter(d => loads[d] > capacityForDate(state, d));
  return { tasks, loads, unplaced, overloaded, placed: candidates.length - unplaced.length, preserved: tasks.filter(t => !t.done && t.locked && days.includes(t.scheduled)).length };
}
export function demoTasks(start) {
  const items = [
    ['梳理本周工作重点', 'work', 45, 0, 'high', true],
    ['完成项目方案初稿', 'work', 120, 1, 'high', false],
    ['读完产品设计第三章', 'study', 60, 1, 'medium', false],
    ['整理会议记录', 'work', 30, 2, 'medium', false],
    ['练习英语口语', 'study', 30, 2, 'low', false],
    ['完成方案评审与修改', 'work', 90, 3, 'high', false],
    ['跑步 5 公里', 'health', 45, 3, 'medium', false],
    ['整理房间与书桌', 'life', 60, 4, 'low', false],
    ['采购下周生活用品', 'life', 45, 5, 'medium', false],
    ['散步，给自己留一点时间', 'health', 30, 6, 'low', false],
    ['学习一个新工具', 'study', 90, null, 'medium', false],
  ];
  return items.map(([title, _legacyCategory, minutes, day, priority, done], i) => ({ id: `demo-${Date.now()}-${i}`, title, minutes, scheduled: day === null ? null : addDays(start, day), due: day === null ? null : addDays(start, Math.min(day + 1, 6)), priority, done, locked: false, notes: '' }));
}

import { dateKey, parseDate, addDays, weekStart } from './planner.js';

export function monthStart(date = dateKey()) { return `${date.slice(0, 7)}-01`; }
export function shiftMonth(date, offset) {
  const d = parseDate(monthStart(date)); d.setMonth(d.getMonth() + offset); return dateKey(d);
}
export function monthDays(date) {
  const first = monthStart(date), next = shiftMonth(first, 1), last = addDays(next, -1);
  const gridStart = weekStart(first), gridEnd = addDays(weekStart(last), 6);
  const count = Math.round((parseDate(gridEnd) - parseDate(gridStart)) / 86400000) + 1;
  return Array.from({ length: count }, (_, i) => addDays(gridStart, i));
}
export function activityDate(task) { return task.completedOn || task.scheduled; }
export function dailyActivity(tasks) {
  const days = new Map(); let undated = 0;
  for (const task of tasks) {
    if (!task.done) continue;
    const date = activityDate(task);
    if (!date) { undated++; continue; }
    if (!days.has(date)) days.set(date, { date, minutes: 0, tasks: [], missing: 0, legacy: 0 });
    const day = days.get(date); day.tasks.push(task);
    day.minutes += task.actualMinutes ?? task.minutes;
    if (task.actualMinutes === undefined) day.missing++;
    if (!task.completedOn) day.legacy++;
  }
  return { days, undated };
}
export function activityRange(activity, from, through) {
  const rows = [];
  for (let d = from; d <= through; d = addDays(d, 1)) rows.push(activity.days.get(d) || { date: d, minutes: 0, tasks: [], missing: 0, legacy: 0 });
  return rows;
}
export function heatLevel(minutes) {
  return minutes <= 0 ? 0 : minutes < 60 ? 1 : minutes < 120 ? 2 : minutes < 240 ? 3 : 4;
}

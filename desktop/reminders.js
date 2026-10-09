import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { validDate, validTime, timeMinutes } from '../src/planner.js';
export function testReminderAlert(value, now = Date.now()) {
  if (!value || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 150) throw new Error('提醒名称不正确');
  if (!validDate(value.date) || !validTime(value.start) || !validTime(value.end) || timeMinutes(value.end) - timeMinutes(value.start) < 5) throw new Error('试响需要有效的任务日期和开始、结束时间（同一天，至少5分钟）');
  return { key: `test-${now}`, test: true, title: value.title.trim(), date: value.date, start: value.start, end: value.end, startsAt: new Date(`${value.date}T${value.start}:00`).getTime(), endsAt: new Date(`${value.date}T${value.end}:00`).getTime() };
}
export function slotMillis(task, part = 'start') { return new Date(`${task.scheduled}T${task.timeSlot[part]}:00`).getTime(); }
export function reminderKey(task, lead) { return JSON.stringify([task.id, task.scheduled, task.timeSlot.start, lead]); }
export function hasUpcomingReminders(state, now = Date.now()) { return Boolean(state?.tasks.some(t => !t.done && t.timeSlot?.reminders.length && slotMillis(t, 'end') > now)); }
export function collectDue(state, fired, now) {
  const mark = [], alerts = [];
  for (const task of state?.tasks || []) {
    if (task.done || !task.timeSlot?.reminders.length) continue;
    const start = slotMillis(task), end = slotMillis(task, 'end');
    const due = task.timeSlot.reminders.map(lead => ({ key: reminderKey(task, lead), lead, at: start - lead * 60000 })).filter(r => r.at <= now && !Object.hasOwn(fired, r.key)).sort((a, b) => a.at - b.at);
    if (!due.length) continue;
    mark.push(...due.map(r => r.key));
    // On restart/resume, collapse multiple missed advances to the latest one.
    if (end > now) {
      const latest = due.at(-1);
      alerts.push({ key: latest.key, taskId: task.id, title: task.title, date: task.scheduled, start: task.timeSlot.start, end: task.timeSlot.end, lead: latest.lead, startsAt: start, endsAt: end });
    }
  }
  return { mark, alerts };
}
export function createReminderScheduler({ directory, getState, onDue, now = Date.now }) {
  const file = path.join(directory, 'reminders-fired.json');
  let fired = {}, active;
  return {
    async load() {
      try {
        const saved = JSON.parse(await readFile(file, 'utf8'));
        if (saved.version !== 1 || !saved.fired || typeof saved.fired !== 'object' || Array.isArray(saved.fired) || Object.values(saved.fired).some(v => !Number.isFinite(v))) throw new Error('提醒记录格式不正确');
        fired = saved.fired;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
    tick() {
      if (active) return active;
      active = (async () => {
        const timestamp = now(), due = collectDue(getState(), fired, timestamp);
        if (!due.mark.length) return;
        const next = { ...fired };
        for (const key of due.mark) next[key] = timestamp;
        for (const [key, at] of Object.entries(next)) if (timestamp - at > 30 * 86400000) delete next[key];
        await mkdir(directory, { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify({ version: 1, fired: next }), 'utf8'); await rename(`${file}.tmp`, file);
        fired = next;
        // A task may have been completed/deleted/edited while recording delivery.
        const current = getState();
        const alerts = due.alerts.flatMap(a => {
          const task = current?.tasks.find(t => t.id === a.taskId && !t.done && t.timeSlot && reminderKey(t, a.lead) === a.key && t.timeSlot.reminders.includes(a.lead) && slotMillis(t, 'end') > now());
          return task ? [{ ...a, title: task.title, end: task.timeSlot.end, endsAt: slotMillis(task, 'end') }] : [];
        });
        if (alerts.length) await onDue(alerts);
      })().finally(() => { active = undefined; });
      return active;
    },
    async idle() { if (active) await active; }
  };
}

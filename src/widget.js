import { categoryMarker } from './category-ui.js';
import { dayTaskSlots } from './day-plan.js';
import { askCompletion } from './completion.js';
import { dateKey, addDays, parseDate } from './planner.js';
import { hydrateIcons, icon, escapeHtml as esc } from './icons.js';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search), compact = params.get('mode') === 'compact';
document.body.classList.toggle('compact-page', compact);
let state, selected = dateKey(), pinned = params.get('pinned') !== 'false', busy = false, today = dateKey();
let resizeFrame, completionOpen = false;
function fitCompact() {
  if (!compact || completionOpen) return;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    if (completionOpen) return;
    const cards = [...$('widget-tasks').children].slice(0, 4);
    const contentHeight = cards.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0) + Math.max(0, cards.length - 1) * 8;
    const errorHeight = $('widget-error').hidden ? 0 : $('widget-error').getBoundingClientRect().height;
    window.desktop.resizeCompactWidget(Math.max(96, Math.min(440, Math.ceil(contentHeight + errorHeight + 50)))).catch(() => {});
  });
}
function render() {
  const dayTasks = state.tasks.filter(t => t.scheduled === selected);
  const tasks = dayTasks.filter(t => !t.done);
  const done = dayTasks.length - tasks.length, minutes = tasks.reduce((s, t) => s + t.minutes, 0);
  const d = parseDate(selected);
  $('widget-date').textContent = `${d.getMonth() + 1}月${d.getDate()}日 · ${['周日','周一','周二','周三','周四','周五','周六'][d.getDay()]}`;
  $('widget-today').hidden = selected === today;
  const total = dayTasks.reduce((sum, task) => sum + task.minutes, 0);
  $('widget-summary').textContent = `${done} / ${dayTasks.length} 已完成 · 总计 ${total} 分钟${minutes ? ` · 还需约 ${minutes < 60 ? `${minutes} 分钟` : `${Number((minutes / 60).toFixed(1))} 小时`}` : ''}`;
  $('widget-progress-fill').style.width = `${dayTasks.length ? done / dayTasks.length * 100 : 0}%`;
  $('widget-tasks').innerHTML = tasks.length ? tasks.map(t => `<div class="widget-task ${t.done ? 'done' : ''}"><button class="widget-check" data-toggle="${esc(t.id)}" aria-label="${t.done ? '取消完成' : '完成'}：${esc(t.title)}" ${busy ? 'disabled' : ''}>${t.done ? icon('check') : ''}</button><div><p class="widget-task-title">${categoryMarker(state,t)}${compact && t.timeSlot ? `<span class="compact-time">${esc(t.timeSlot.start)}–${esc(t.timeSlot.end)} </span>` : ''}${esc(t.title)}</p>${dayTaskSlots(state,t).length ? `<div class="widget-work-slots">${dayTaskSlots(state,t).map(s => `${esc(s.start)}–${esc(s.end)}${s.parallel?.length ? '（并行）' : ''}`).join(' · ')}</div>` : ''}${compact ? '' : `<div class="widget-task-meta">${t.origin?.items.length ? `<span class="quantity-tag">${t.origin.items.length} ${esc(t.origin.unit)}</span>` : ''}<span>${t.timeSlot ? `${esc(t.timeSlot.start)}–${esc(t.timeSlot.end)}` : `${t.minutes} 分钟`}</span>${t.timeSlot?.reminders.length ? icon('bell') : ''}${t.locked ? icon('lock') : ''}</div>`}</div></div>`).join('') : compact ? '<div class="widget-empty">今天没有待办</div>' : `<div class="widget-empty">${icon('leaf')}${dayTasks.length ? '这一天的任务都完成了<br>完成记录可在主界面查看。' : '这一天还没有安排任务<br>给自己留一点空白，或打开计划添加。'}</div>`;
  fitCompact();
}
hydrateIcons();
try { state = await window.desktop.read(); render(); }
catch (e) { $('widget-error').hidden = false; $('widget-error').textContent = e.message; fitCompact(); }
window.desktop.onState(next => { state = next; render(); });
document.addEventListener('click', async e => {
  const toggle = e.target.closest('[data-toggle]'); if (!toggle || busy || !state) return;
  const task = state.tasks.find(t => t.id === toggle.dataset.toggle);
  if (!task || task.done) return;
  busy = true; completionOpen = true; cancelAnimationFrame(resizeFrame); render();
  try {
    if (compact) await window.desktop.resizeCompactWidget(360);
    const result = await askCompletion(task);
    if (result) state = await window.desktop.completeTask(task.id, result.actualMinutes);
    $('widget-error').hidden = true;
  }
  catch (error) { $('widget-error').hidden = false; $('widget-error').textContent = `未保存：${error.message}`; }
  finally { busy = false; completionOpen = false; render(); }
});
$('widget-prev').onclick = () => { selected = addDays(selected, -1); if (state) render(); };
$('widget-next').onclick = () => { selected = addDays(selected, 1); if (state) render(); };
$('widget-today').onclick = () => { selected = dateKey(); if (state) render(); };
$('widget-pin').onclick = async () => { pinned = await window.desktop.pinWidget(!pinned); $('widget-pin').classList.toggle('pinned', pinned); $('widget-pin').title = pinned ? '取消置顶' : '置顶'; $('widget-pin').setAttribute('aria-label', $('widget-pin').title); };
$('widget-close').onclick = () => window.desktop.closeWidget();
$('widget-open').onclick = () => window.desktop.showMain();
$('widget-mode').onclick = () => window.desktop.setWidgetMode('compact').catch(showError);
$('compact-full').onclick = () => window.desktop.setWidgetMode('full').catch(showError);
$('compact-close').onclick = () => window.desktop.closeWidget();
$('compact-open').onclick = () => window.desktop.showMain();
function showError(error) { $('widget-error').hidden = false; $('widget-error').textContent = error.message; fitCompact(); }
$('widget-pin').classList.toggle('pinned', pinned);
$('widget-pin').title = pinned ? '取消置顶' : '置顶'; $('widget-pin').setAttribute('aria-label', $('widget-pin').title);
setInterval(() => { const d = dateKey(); if (d !== today) { if (selected === today) selected = d; today = d; if (state) render(); } }, 30000);

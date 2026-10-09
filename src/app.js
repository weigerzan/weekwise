import { getCategories, validateCategories, nextCategoryColor } from './categories.js';
import { categoryMarker } from './category-ui.js';
import { PRIORITIES, dateKey, parseDate, addDays, weekStart, weekDays, emptyState, validateState, planWeek, demoTasks, timeMinutes, capacityForDate } from './planner.js';
import { icon, hydrateIcons, escapeHtml as esc } from './icons.js';
import { friendlyError, planningError } from './errors.js';
import { askCompletion } from './completion.js';
import { moveTask } from './task-order.js';
import { dayTaskSlots, DEFAULT_DAILY_ROUTINE } from './day-plan.js';
import { initDayPlanUI, timelineHtml } from './day-plan-ui.js';
import { monthStart, shiftMonth } from './activity.js';
import { monthHtml, insightsHtml } from './insights.js';
let completionPending = false;
const $ = id => document.getElementById(id);
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const demoMode = new URLSearchParams(location.search).has('demo');
let state = emptyState(), start = weekStart(), view = 'week', search = '', editing = null, plan = null, undoState = null, saving = false, ready = false, aiStatus = { configured: false, model: 'deepseek-flash' };
let naturalPlan = null, naturalGeneration = 0;
let replan = null, replanGeneration = 0;
let toastTimer, today = dateKey(), planGeneration = 0;
let month = monthStart(today), monthSelected = today, activityYear = Number(today.slice(0,4)), activityRange = 30, activitySelected = today;
let lastPlanView = 'week', lastStatisticsView = 'activity';
let settingsTimer, settingsRevision = 0, settingsPending = null;
const settingsDirty = new Map();
const clone = value => structuredClone(value);
const api = window.desktop || {
  async read() { const r = await fetch('/api/state'); const v = await r.json(); if (!r.ok) throw new Error(v.error || '读取失败'); return v; },
  async save(value, previous) { const r = await fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: value, previous }) }); const v = await r.json(); if (!r.ok) throw new Error(v.error || '保存失败'); },
};
const openDayPlan = initDayPlanUI({getState:()=>state,getAIStatus:()=>aiStatus,api,commit,toast});
function time(minutes) { return minutes < 60 ? `${minutes} 分钟` : `${Number((minutes / 60).toFixed(1))} 小时`; }
function previewNaturalTask(t) {
  const slot = t.timeSlot;
  const timing = slot ? `${slot.start}–${slot.end}` : time(t.minutes);
  const reminders = slot?.reminders.length ? ` · 提醒：${slot.reminders.map(n => n === 0 ? '开始时' : `提前${time(n)}`).join('、')}` : '';
  return `<div class="natural-daily-task"><span class="preview-checkbox"></span><div><strong>${categoryMarker(state,t)}${esc(t.title)}</strong><p>${t.origin.items.length ? `第 ${esc(t.origin.items.join('、'))} ${esc(t.origin.unit)} · ` : ''}${esc(timing)} · ${shortDate(t.due)} 截止${esc(reminders)}</p></div></div>`;
}
function shortDate(key) { const d = parseDate(key); return `${d.getMonth() + 1}/${d.getDate()}`; }
function matches(t) { return !search || `${t.title} ${t.notes}`.toLowerCase().includes(search.toLowerCase()); }
function toast(message, undo = false, persistent = false) {
  clearTimeout(toastTimer); $('toast-message').textContent = message; $('undo-btn').hidden = !undo; $('toast').hidden = false;
  if (!persistent) toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
}
async function commit(next, message) {
  if (saving || !ready) return false;
  const previous = clone(state); saving = true; $('save-status').textContent = '正在保存…';
  try {
    next = validateState(next);
    if (!demoMode) await api.save(next, previous);
    undoState = previous; state = next; render(); toast(message, true); return true;
  } catch (error) { toast(`未保存：${error.message}`, false, true); return false; }
  finally { saving = false; $('save-status').textContent = demoMode ? '示例预览 · 不保存数据' : '数据保存在本机'; }
}
function taskCard(t, list = false) {
  const slots = dayTaskSlots(state,t);
  const overdue = t.due && t.due < today && !t.done;
  const category = getCategories(state).find(c => c.id === t.categoryId);
  const categoryBorder = view === 'week' || view === 'today';
  const color = categoryBorder ? category?.color || '#e9eaf2' : '#7c6cf0';
  return `<article class="task-card ${categoryBorder ? 'category-border-card' : ''} ${t.done ? 'done' : ''}" style="--task-color:${color}" title="${categoryBorder && category ? esc(category.name) : ''}" data-task="${esc(t.id)}" draggable="${view === 'week' || view === 'month' || !t.done}" tabindex="0" role="button" aria-label="编辑任务：${esc(t.title)}${categoryBorder && category ? `，类别：${esc(category.name)}` : ''}">
    <div class="task-top"><button class="check-btn" data-toggle="${esc(t.id)}" aria-label="${t.done ? '取消完成' : '完成'}：${esc(t.title)}">${t.done ? icon('check') : ''}</button><span class="task-title">${categoryBorder ? '' : categoryMarker(state,t)}${esc(t.title)}</span></div>
    <div class="task-meta">${t.origin?.items.length ? `<span class="quantity-tag">${t.origin.items.length} ${esc(t.origin.unit)}</span>` : ''}<span class="duration">${icon('clock')}${t.timeSlot ? `${esc(t.timeSlot.start)}–${esc(t.timeSlot.end)}` : time(t.minutes)}</span>${t.done && t.actualMinutes !== undefined ? `<span class="actual-duration">实际 ${time(t.actualMinutes)}</span>` : ''}${t.timeSlot?.reminders.length ? `<span class="reminder-tag" title="已启用提前提醒">${icon('bell')}</span>` : ''}</div>
    ${slots.length ? `<div class="work-slots" title="建议工作时段">${slots.map(s => `<span title="${esc((s.parallel || []).map(p => `${p.start}–${p.end} 与「${p.title}」同时进行`).join('；'))}">${esc(s.start)}–${esc(s.end)}${s.parallel?.length ? ' · 并行' : ''}</span>`).join('')}</div>` : ''}
    <div class="task-bottom"><span class="priority-dot ${t.priority}"></span><span>${PRIORITIES[t.priority].replace('优先级', '优先')}</span>${t.due ? `<span class="${overdue ? 'due-overdue' : ''}">· ${shortDate(t.due)} 截止${overdue ? '（已逾期）' : ''}</span>` : ''}${t.locked ? `<span class="task-lock" title="日期标记，普通任务可拖动或自然语言调整">${icon('lock')}</span>` : ''}${list ? `<span class="list-date">${t.scheduled ? `${shortDate(t.scheduled)} 安排` : '待安排'}</span>` : ''}</div></article>`;
}
function render() {
  const section = ['week','month'].includes(view) ? 'plan' : ['activity','all','done'].includes(view) ? 'statistics' : 'today';
  const categories = getCategories(state);
  $('category-legend').hidden = section !== 'plan' || !categories.length;
  $('category-legend').innerHTML = `<div class="category-legend-items" role="list">${categories.map(c => `<span class="category-legend-item" role="listitem" title="${esc(c.description)}">${categoryMarker(state,{categoryId:c.id})}${esc(c.name)}</span>`).join('')}</div><button class="text-btn" data-action="settings">编辑类别</button>`;
  if (section === 'plan') lastPlanView = view;
  if (section === 'statistics') lastStatisticsView = view;
  const days = weekDays(start);
  const weekTasks = state.tasks.filter(t => view === 'month' ? t.scheduled?.slice(0,7) === month.slice(0,7) : days.includes(t.scheduled));
  const period = view === 'month' ? '本月' : '本周';
  const done = weekTasks.filter(t => t.done).length;
  const backlog = state.tasks.filter(t => !t.scheduled && !t.done);
  const minutes = weekTasks.filter(t => !t.done).reduce((sum, t) => sum + t.minutes, 0);
  const rate = weekTasks.length ? Math.round(done / weekTasks.length * 100) : 0;
  $('today-count').textContent = state.tasks.filter(t => !t.done && t.scheduled === today).length;
  $('all-count').textContent = state.tasks.filter(t => !t.done).length;
  $('done-count').textContent = state.tasks.filter(t => t.done).length;
  $('stats').innerHTML = [
    ['calendar', `${period}任务`, `${weekTasks.length}<small>件事</small>`, `已安排到${period}的任务`],
    ['checkCircle', '已经完成', `${done}<small>/ ${weekTasks.length}</small>`, `${rate}% 的${period}计划已完成`],
    ['inbox', '等待安排', `${backlog.length}<small>件事</small>`, '给想做的事找一个时间'],
    ['clock', `${period}待投入`, `${Number((minutes / 60).toFixed(1))}<small>小时</small>`, '剩余任务的预计耗时'],
  ].map(([i, label, value, detail], index) => `<div class="stat-card"><span class="stat-icon">${icon(i)}</span><div><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-detail">${detail}</div></div>${index === 1 ? `<div class="stat-mini-progress"><span style="width:${rate}%"></span></div>` : ''}</div>`).join('');
  const titles = { week: '一周计划', month: '月历计划', activity: '工作时长', today: '今日专注', all: '全部任务', done: '已完成' };
  $('breadcrumb-title').textContent = section === 'plan' ? `计划 · ${view === 'week' ? '周视图' : '月视图'}` : section === 'statistics' ? `统计 · ${titles[view]}` : titles[view]; $('view-label').textContent = view === 'week' ? '周视图' : view === 'month' ? '月视图' : '任务视图';
  $('page-title').innerHTML = `${{ week: '让这一周，有条不紊', month: '把一个月，慢慢安排好', activity: '看见时间留下的足迹', today: '专注今天的一小步', all: '想做的事，都在这里', done: '记录每一个完成的瞬间' }[view]}<span class="heading-dot">.</span>`;
  $('page-subtitle').textContent = { week: '把想做的事写下来，把时间留给重要的事。', month: '查看整月安排，点击日期展开当天任务。', activity: '已完成任务优先使用实际耗时，未填写时按计划耗时统计。', today: '不用一次走很远，做好眼前这一件就好。', all: '从一个目标到每天的小任务，慢慢把想法变成行动。', done: '回头看看，你已经向前走了这么多步。' }[view];
  document.querySelectorAll('[data-view]').forEach(b => { const active = b.dataset.view === view; b.classList.toggle('active', active); b.setAttribute('aria-pressed',String(active)); });
  document.querySelectorAll('[data-section]').forEach(b => { const active = b.dataset.section === section; b.classList.toggle('active',active); if (active) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  $('plan-tabs').hidden = section !== 'plan'; $('statistics-tabs').hidden = section !== 'statistics';
  const alternateView = view === 'week' ? '月视图' : '周视图';
  $('view-switch').disabled = section !== 'plan';
  $('view-switch').title = section === 'plan' ? `切换到${alternateView}` : '任务视图';
  $('view-switch').setAttribute('aria-label',section === 'plan' ? `当前${view === 'week' ? '周视图' : '月视图'}，点击切换到${alternateView}` : '任务视图');
  document.querySelector('.view-switch-hint').hidden = section !== 'plan';
  $('week-label').textContent = view === 'month' ? `${parseDate(month).getFullYear()}年 ${parseDate(month).getMonth()+1}月` : `${parseDate(start).getFullYear()}年 ${shortDate(start)} — ${shortDate(days[6])}`;
  document.querySelector('[data-action=this-week]').textContent = view === 'month' ? '本月' : '本周';
  document.querySelector('[data-action=prev-week]').title = view === 'month' ? '上一月' : '上一周';
  document.querySelector('[data-action=next-week]').title = view === 'month' ? '下一月' : '下一周';
  for (const selector of ['#stats', '.natural-banner', '.heading-actions']) document.querySelector(selector).hidden = section === 'statistics';
  document.querySelector('.workspace-toolbar').hidden = view === 'activity';
  document.querySelector('.week-control').hidden = section === 'statistics';
  document.querySelector('.day-plan-entry').hidden = section === 'statistics';
  document.querySelector('.workspace-toolbar').classList.toggle('statistics-list-toolbar',section === 'statistics');
  $('footer-tip').textContent = view === 'activity' ? '点击热图或曲线日期查看明细 · 点击记录补填耗时' : section === 'statistics' ? '点击卡片编辑任务 · 已完成任务可补填实际耗时' : '拖动任务可调整日期和同日顺序 · 点击卡片编辑';
  $('filter-bar').hidden = !search || view === 'activity';
  $('filter-bar').innerHTML = `正在搜索：“${esc(search)}”<button data-action="clear-filter">清除筛选 ×</button>`;
  if (view === 'week') {
    const welcome = !state.tasks.length ? `<div class="welcome-banner">${icon('sparkles')}<div><strong>从第一件想做的事开始</strong><p>添加任务、预计耗时和截止日期，之后就可以规划这一周。</p></div><button class="text-btn" data-action="demo">看看示例 →</button></div>` : '';
    $('main-view').innerHTML = welcome + `<div class="week-board">${days.map((d, i) => {
      const tasks = weekTasks.filter(t => t.scheduled === d && matches(t));
      const load = weekTasks.filter(t => t.scheduled === d).reduce((s, t) => s + t.minutes, 0);
      const capacity = capacityForDate(state, d);
      return `<section class="day-column ${d === today ? 'today' : ''} ${i > 4 ? 'weekend' : ''} ${load > capacity ? 'overloaded' : ''}" data-day="${d}" aria-label="${DAYS[i]} ${d}"><header class="day-header"><div class="day-top"><span class="day-name">${DAYS[i]}</span>${d === today ? '<span class="today-badge">今天</span>' : ''}<span class="day-date">${parseDate(d).getDate()}</span></div><div class="day-load" title="当天全部任务的预计耗时（包含已完成任务） / 每日可用时长"><span>${tasks.length} 件事</span><span>${Number((load / 60).toFixed(1))} / ${Number((capacity / 60).toFixed(1))} h</span></div><div class="load-bar"><span style="width:${capacity ? Math.min(100, load / capacity * 100) : load ? 100 : 0}%"></span></div><button class="day-plan-button" data-plan-day="${d}">${state.dayPlans?.[d] ? '查看当天时段' : '帮我规划这一天'}</button></header><div class="day-body">${tasks.length ? tasks.sort((a, b) => Number(a.done) - Number(b.done)).map(t => taskCard(t)).join('') : `<div class="day-empty">${icon(i > 4 ? 'coffee' : 'leaf')}<span>${search ? '暂无匹配的任务' : capacity ? '留一点空白\n也很好'.replace('\n', '<br>') : '今天休息一下'}</span></div>`}</div><button class="day-add" data-new-date="${d}">${icon('plus')}添加任务</button></section>`;
    }).join('')}</div>`;
    const visibleBacklog = backlog.filter(matches);
    $('backlog-section').hidden = false;
    $('backlog-section').innerHTML = `<div class="section-head">${icon('inbox')}<h2>待安排</h2><span class="count-pill">${visibleBacklog.length}</span><span class="section-hint">先记下来，再找到合适的时间</span><button class="text-btn" data-action="new">+ 添加任务</button></div>${visibleBacklog.length ? `<div class="backlog-grid" data-drop-backlog="true">${visibleBacklog.map(t => taskCard(t)).join('')}</div>` : `<div class="empty-backlog" data-drop-backlog="true">${icon('checkCircle')}${search ? '没有匹配的待安排任务' : '还没有待安排的任务。新的想法，随时记在这里。'}</div>`}`;
  } else if (view === 'month') {
    $('main-view').innerHTML = monthHtml(state, month, monthSelected, today, matches, taskCard);
    $('backlog-section').hidden = true;
  } else if (view === 'activity') {
    $('main-view').innerHTML = insightsHtml(state, today, activityYear, activityRange, activitySelected);
    $('backlog-section').hidden = true;
  } else {
    const visible = state.tasks.filter(t => matches(t) && (view === 'today' ? t.scheduled === today : view === 'done' ? t.done : !t.done));
    visible.sort((a, b) => Number(a.done) - Number(b.done) || (a.scheduled || '9999').localeCompare(b.scheduled || '9999'));
    $('main-view').innerHTML = `${view === 'today' && state.dayPlans?.[today] ? `<section class="today-agenda"><h3>今天的建议时段</h3>${timelineHtml(state,today,state.dayPlans[today])}</section>` : ''}<div class="task-list">${visible.length ? visible.map(t => taskCard(t, true)).join('') : `<div class="empty-view">${icon(view === 'done' ? 'checkCircle' : 'leaf')}<h3>${view === 'done' ? '完成之后，小小庆祝一下' : '这里暂时还没有任务'}</h3><p>${search ? '试试其他关键词，或清除筛选。' : view === 'today' ? '安排一件今天想做的事，轻轻开始。' : '从一件小事开始，慢慢建立自己的节奏。'}</p><button class="secondary-btn" data-action="new">${icon('plus')}添加任务</button></div>`}</div>`;
    $('backlog-section').hidden = true;
  }
}
function openTask(id = null, scheduled = '') {
  editing = id; const t = state.tasks.find(t => t.id === id);
  $('task-form').reset(); $('task-dialog-title').textContent = t ? '调整这件事的安排' : '添加一件想做的事';
  $('task-category').innerHTML = '<option value="">未分类</option>'+getCategories(state).map(c => '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
  $('task-category').value = t?.categoryId || '';
  $('task-title').value = t?.title || '';
  $('task-actual-field').hidden = !t; $('task-actual').value = t?.actualMinutes ?? '';
  $('task-completed-field').hidden = !t?.done; $('task-completed-on').value = t?.completedOn || (t?.done ? t.scheduled || today : '');
  $('task-completed-on').required = Boolean(t?.done);
  $('task-priority').value = t?.priority || 'medium'; $('task-minutes').value = t?.minutes || 60;
  $('task-due').value = t?.due || ''; $('task-scheduled').value = t?.scheduled || scheduled;
  $('task-locked').checked = t?.locked || false; $('task-notes').value = t?.notes || '';
  $('task-timed').checked = Boolean(t?.timeSlot);
  $('task-start-time').value = t?.timeSlot?.start || '15:00'; $('task-end-time').value = t?.timeSlot?.end || '17:00';
  document.querySelectorAll('.custom-reminder').forEach(label => label.remove());
  document.querySelectorAll('[name=task-reminder]').forEach(input => { input.checked = (t?.timeSlot?.reminders ?? [720, 120, 30]).includes(Number(input.value)); });
  for (const lead of t?.timeSlot?.reminders || []) if (![720,120,30,0].includes(lead)) {
    document.querySelector('.reminder-options').insertAdjacentHTML('beforeend', `<label class="custom-reminder"><input type="checkbox" name="task-reminder" value="${lead}" checked>${esc(time(lead))}</label>`);
  }
  $('task-start-time').setCustomValidity(''); $('task-end-time').setCustomValidity('');
  $('delete-task').hidden = !t; taskWarning(); $('task-dialog').showModal(); $('task-title').focus();
}
function taskWarning() {
  const scheduled = $('task-scheduled').value, due = $('task-due').value;
  const timed = $('task-timed').checked;
  $('task-time-fields').hidden = !timed; $('task-scheduled').required = timed;
  $('task-start-time').required = timed; $('task-end-time').required = timed;
  $('task-start-time').disabled = !timed; $('task-end-time').disabled = !timed;
  $('task-locked').disabled = timed || !scheduled; if (timed) $('task-locked').checked = true; else if (!scheduled) $('task-locked').checked = false;
  $('task-minutes').readOnly = timed;
  $('task-minutes').step = timed ? '1' : '5';
  $('task-end-time').setCustomValidity('');
  if (timed && $('task-start-time').value && $('task-end-time').value) {
    const minutes = timeMinutes($('task-end-time').value) - timeMinutes($('task-start-time').value);
    if (minutes < 5) $('task-end-time').setCustomValidity('结束时间需要晚于开始时间至少 5 分钟（同一天）');
    else $('task-minutes').value = minutes;
  }
  const warnings = [];
  if (scheduled && due && scheduled > due) warnings.push('安排日期晚于截止日期，请确认这是你希望的安排。');
  if (Number($('task-minutes').value) > Math.max(...state.settings.capacities, ...Object.values(state.settings.dateCapacities || {}))) warnings.push('这件事比任何一天的可用时长都长，建议拆成几件小任务。');
  $('task-warning').hidden = !warnings.length; $('task-warning').textContent = warnings.join(' ');
}
async function confirmAction(title, text) {
  $('confirm-title').textContent = title; $('confirm-text').textContent = text; $('confirm-dialog').showModal();
  return new Promise(resolve => {
    const finish = result => { $('confirm-dialog').close(); $('confirm-ok').onclick = null; $('confirm-cancel').onclick = null; $('confirm-dialog').onclose = null; resolve(result); };
    $('confirm-ok').onclick = () => finish(true); $('confirm-cancel').onclick = () => finish(false); $('confirm-dialog').onclose = () => finish(false);
  });
}
function updateModelChoice() {
  const model = $('ai-model').value, custom = model === 'custom';
  $('ai-model-custom-field').hidden = !custom;
  $('ai-model-custom').disabled = !custom; $('ai-model-custom').required = custom;
  $('ai-model-hint').textContent = custom ? '填写 DeepSeek API 支持的模型名称；已有自定义配置可以继续保留。' : model === 'deepseek-v4-pro' ? 'DeepSeek V4 Pro · 可作为另一种规划选择，API 费用高于 Flash。' : 'DeepSeek V4.1 Flash · 日常任务规划推荐，API 费用较低。';
}
$('ai-model').addEventListener('change', updateModelChoice);
function addCategory(row = {id:crypto.randomUUID(),name:'',description:'',color:nextCategoryColor([...$('category-fields').querySelectorAll('.category-color')].map(input => input.value))}) {
  if ($('category-fields').children.length >= 30) { toast('最多可定义 30 个任务类别。'); return; }
  const el = document.createElement('div'); el.className = 'category-editor'; el.dataset.id = row.id;
  el.innerHTML = '<label class="field">名称<input class="category-name" maxlength="30" required value="'+esc(row.name)+'" placeholder="例如：科研"></label><label class="field">颜色<input class="category-color" type="color" value="'+esc(row.color)+'" aria-label="类别颜色"></label><button type="button" class="icon-btn category-remove" aria-label="删除类别">×</button><label class="field category-description-field">描述<textarea class="category-description" rows="2" maxlength="1000" required placeholder="例如：论文写作、审稿和研究项目">'+esc(row.description)+'</textarea></label>';
  el.querySelector('.category-remove').onclick = () => { el.remove(); markSettings('categories'); }; $('category-fields').append(el);
}
$('category-add').onclick = () => { addCategory(); markSettings('categories'); };
function openSettings() {
  clearTimeout(settingsTimer); settingsDirty.clear(); $('settings-status').textContent = '修改后自动保存'; $('settings-retry').hidden = true;
  $('category-fields').replaceChildren(); getCategories(state).forEach(addCategory);
  $('capacity-fields').innerHTML = DAYS.map((d, i) => `<label class="field">${d}<input name="capacity-${i}" type="number" value="${state.settings.capacities[i]}" min="0" max="1440" step="5" required><small>分钟 / 天</small></label>`).join('');
  const knownModel = ['deepseek-flash', 'deepseek-v4-pro'].includes(aiStatus.model);
  $('ai-model').value = knownModel ? aiStatus.model : 'custom'; $('ai-model-custom').value = knownModel ? '' : aiStatus.model;
  updateModelChoice(); $('ai-key').value = ''; $('ai-preferences').value = state.settings.preferences || '';
  $('ai-connection').textContent = aiStatus.configured ? '密钥已保存 · 规划时调用 API' : '尚未配置 · 自然语言功能需要 API 密钥';
  const routine = state.settings.dailyRoutine || DEFAULT_DAILY_ROUTINE;
  $('routine-start').value = routine.start; $('routine-end').value = routine.end;
  $('routine-breaks').innerHTML = ''; routine.breaks.forEach(addRoutineBreak);
  $('routine-preferences').value = state.settings.dayPreferences || '';
  $('ai-section').hidden = !window.desktop; $('settings-dialog').showModal();
}
function addRoutineBreak(row = {title:'休息',start:'15:00',end:'15:15'}) {
  if ($('routine-breaks').children.length >= 20) { toast('最多保留20个固定空档。'); return; }
  const element = document.createElement('div'); element.className = 'routine-break-row';
  element.innerHTML = '<label class="field">名称<input class="routine-title" required maxlength="150"></label><label class="field">开始<input class="routine-start" type="time" required></label><label class="field">结束<input class="routine-end" type="time" required></label><button type="button" class="danger-text" aria-label="删除这个固定空档">删除</button>';
  element.querySelector('.routine-title').value = row.title; element.querySelector('.routine-start').value = row.start; element.querySelector('.routine-end').value = row.end;
  element.querySelector('button').onclick = () => { element.remove(); markSettings('routine'); }; $('routine-breaks').append(element);
}
$('routine-add-break').onclick = () => { addRoutineBreak(); markSettings('routine'); };
function showPlanPreview() {
  const days = weekDays(start);
  $('plan-preview').innerHTML = `<div class="plan-summary"><div><strong>${plan.placed}</strong><span>任务已安排</span></div><div><strong>${plan.preserved}</strong><span>锁定任务保留</span></div><div><strong>${plan.unplaced.length}</strong><span>留在待安排</span></div></div>${plan.summary ? `<p class="modal-description">${esc(plan.summary)}</p>` : ''}<div class="plan-days">${days.map((d, i) => `<div class="plan-day">${DAYS[i]}<div class="plan-day-bar ${plan.overloaded.includes(d) ? 'over' : ''}"><span style="height:${capacityForDate(state, d) ? Math.min(100, plan.loads[d] / capacityForDate(state, d) * 100) : plan.loads[d] ? 100 : 0}%"></span></div>${time(plan.loads[d])}</div>`).join('')}</div>${plan.overloaded.length ? '<p class="inline-warning">部分锁定任务已超过每日可用时长，请手动调整。</p>' : ''}${plan.unplaced.length ? `<div class="unplaced-list">${plan.unplaced.map(t => `<p><strong>${esc(t.title)}</strong>${esc(t.reason)}</p>`).join('')}</div>` : '<p class="modal-description">所有待规划任务都找到了合适的时间。应用后，仍然可以自由修改。</p>'}`;
  $('apply-plan').disabled = false;
}
async function openPlan() {
  if (saving) return;
  if (!state.tasks.some(t => !t.done && !t.locked && (!t.scheduled || weekDays(start).includes(t.scheduled)))) { toast('先添加一些待安排的任务，再开始规划。'); return; }
  plan = null; $('plan-dialog').showModal(); $('apply-plan').disabled = true;
  $('plan-provider').textContent = aiStatus.configured ? `DeepSeek · ${aiStatus.model}` : '本地规则规划';
  $('plan-local').hidden = !aiStatus.configured;
  if (!aiStatus.configured || !window.desktop) { plan = { ...planWeek(state, start), baseline: JSON.stringify(state) }; showPlanPreview(); return; }
  const snapshot = clone(state), selectedStart = start;
  const generation = ++planGeneration;
  $('plan-preview').innerHTML = '<div class="ai-loading"><span class="spinner"></span><strong>AI 正在整理这一周…</strong><p>结合任务内容、截止日期和你的规划偏好安排时间。</p></div>';
  try {
    const result = await api.planAI(snapshot, selectedStart, today);
    if (generation !== planGeneration || !$('plan-dialog').open) return;
    if (JSON.stringify(state) !== JSON.stringify(snapshot) || start !== selectedStart) { $('plan-preview').innerHTML = '<p class="inline-warning">任务在规划期间发生了变化，请关闭并重新规划。</p>'; return; }
    plan = { ...result, baseline: JSON.stringify(snapshot) }; showPlanPreview();
  } catch (error) { if (generation === planGeneration && $('plan-dialog').open) $('plan-preview').innerHTML = `<p class="inline-warning">${esc(planningError(error, '可以重试，或点击上方使用本地规划。'))}</p>`; }
}
function openNatural() {
  naturalPlan = null; $('natural-start').value = today; $('natural-start').min = today;
  $('natural-preview').innerHTML = ''; $('natural-stale').hidden = true; $('natural-apply').disabled = true; $('natural-generate').disabled = false;
  $('natural-dialog').showModal(); $('natural-description').focus();
  if (!window.desktop || !aiStatus.configured) $('natural-preview').innerHTML = '<p class="inline-warning">自然语言拆分需要 DeepSeek。请先在「规划设置与备份」保存 API 密钥，再回来生成。</p>';
}
function showNaturalPreview() {
  const result = naturalPlan;
  if (result.questions.length) {
    $('natural-preview').innerHTML = `<div class="natural-questions"><h3>需要补充或调整一下</h3><p class="modal-description">${esc(result.summary)}</p>${result.questions.map(q => `<p>${esc(q)}</p>`).join('')}<small>可以在上面的描述中补充，再点击「拆分并安排」。</small></div>`;
    return;
  }
  const days = [...new Set(result.tasks.map(t => t.scheduled))].sort();
  $('natural-preview').innerHTML = `<div class="natural-result-header"><h3>${result.tasks.length} 条每日任务 · 分布在 ${days.length} 天</h3><p>${esc(result.summary)}</p></div>${result.assumptions.length ? `<div class="natural-assumptions"><strong>这份计划采用的假设</strong>${result.assumptions.map(a => `<p>${esc(a)}</p>`).join('')}</div>` : ''}<div class="natural-daily-list">${days.map(day => `<section><div class="natural-day-title">${shortDate(day)} · ${['周日', ...DAYS.slice(0, 6)][parseDate(day).getDay()]}<span>${time(result.tasks.filter(t => t.scheduled === day).reduce((sum, t) => sum + t.minutes, 0))}</span></div>${result.tasks.filter(t => t.scheduled === day).map(previewNaturalTask).join('')}</section>`).join('')}</div><p class="small-note">添加后可逐日打勾，也可点击卡片修改。普通任务可自然语言调整，也可明确要求修改定时任务的日期或时段。</p>`;
  $('natural-apply').disabled = false;
}
$('natural-example').addEventListener('click', () => { $('natural-description').value = '需要审7篇ICLR稿件。不要集中一天审完，但7天内要审完。一个稿子大概至少1小时，不熟悉的2h。'; $('natural-description').dispatchEvent(new Event('input')); });
function invalidateNaturalPreview() {
  naturalGeneration++; naturalPlan = null; $('natural-apply').disabled = true;
  $('natural-stale').hidden = !$('natural-preview').querySelector('.natural-result-header,.natural-questions');
  if ($('natural-preview').querySelector('.ai-loading')) $('natural-preview').innerHTML = '<p class="small-note">输入已修改，生成已取消。再次点击「拆分并安排」继续。</p>';
  $('natural-generate').disabled = false;
  if (window.desktop) api.cancelAI().catch(() => {});
}
['natural-description', 'natural-start'].forEach(id => $(id).addEventListener('input', invalidateNaturalPreview));
$('natural-form').addEventListener('submit', async event => {
  event.preventDefault(); if (saving) return;
  if (!window.desktop || !aiStatus.configured) { toast('请先在设置中保存 DeepSeek API 密钥。'); return; }
  const description = $('natural-description').value.trim(), startDate = $('natural-start').value;
  if (!description) { $('natural-description').setCustomValidity('请描述想完成的目标'); $('natural-description').reportValidity(); return; }
  const snapshot = clone(state), generation = ++naturalGeneration;
  naturalPlan = null; $('natural-apply').disabled = true; $('natural-generate').disabled = true;
  $('natural-stale').hidden = true;
  $('natural-preview').innerHTML = '<div class="ai-loading"><span class="spinner"></span><strong>DeepSeek 正在拆分你的目标…</strong><p>根据你的描述、可用时间和已有占用，安排每天的小任务。</p></div>';
  try {
    const result = await api.planNatural(snapshot, description, startDate, today);
    if (generation !== naturalGeneration || !$('natural-dialog').open) return;
    if (JSON.stringify(state) !== JSON.stringify(snapshot)) { $('natural-preview').innerHTML = '<p class="inline-warning">任务在生成期间发生变化，请重新生成，以免超过每天的可用时长。</p>'; return; }
    naturalPlan = { ...result, baseline: JSON.stringify(snapshot) }; showNaturalPreview();
  } catch (error) {
    if (generation === naturalGeneration && $('natural-dialog').open) $('natural-preview').innerHTML = `<p class="inline-warning">${esc(planningError(error, '可以修改描述后重试。'))}</p>`;
  } finally { if (generation === naturalGeneration) $('natural-generate').disabled = false; }
});
$('natural-description').addEventListener('input', () => $('natural-description').setCustomValidity(''));
$('natural-dialog').addEventListener('close', () => { naturalGeneration++; naturalPlan = null; if (window.desktop) api.cancelAI().catch(() => {}); });
$('natural-apply').addEventListener('click', async () => {
  if (!naturalPlan || !naturalPlan.tasks.length || saving) return;
  if (JSON.stringify(state) !== naturalPlan.baseline) { $('natural-apply').disabled = true; toast('已有任务发生变化，请重新生成每日任务。'); return; }
  const next = clone(state), count = naturalPlan.tasks.length, firstDay = [...naturalPlan.tasks].sort((a, b) => a.scheduled.localeCompare(b.scheduled))[0].scheduled;
  next.tasks.push(...naturalPlan.tasks);
  if (await commit(next, `已添加 ${count} 条每日任务，每天完成后都可以单独打勾。`)) { start = weekStart(firstDay); view = 'week'; render(); $('natural-dialog').close(); }
});
function openReplan() {
  if (saving) return;
  replan = null; $('replan-preview').innerHTML = ''; $('replan-stale').hidden = true;
  $('replan-apply').disabled = true; $('replan-generate').disabled = false;
  $('replan-through').min = today; $('replan-through').max = addDays(today, 89);
  $('replan-through').value = addDays(start > today ? start : today, 29);
  if ($('replan-through').value > $('replan-through').max) $('replan-through').value = $('replan-through').max;
  $('replan-reference').textContent = `「周日」等日期以当前看板的 ${shortDate(start)}–${shortDate(addDays(start, 6))} 为参考。`;
  $('replan-dialog').showModal(); $('replan-description').focus();
  if (!window.desktop || !aiStatus.configured) $('replan-preview').innerHTML = '<p class="inline-warning">自然语言调整需要 DeepSeek，请先在设置中保存 API 密钥。</p>';
}
function showReplanPreview() {
  const result = replan;
  $('replan-apply').disabled = true;
  if (!result.feasible) {
    $('replan-preview').innerHTML = `<div class="replan-result natural-questions"><h3>当前条件下暂时排不下</h3><p>${esc(result.summary)}</p>${result.issues.map(t => `<p>${esc(t)}</p>`).join('')}${result.suggestions.length ? `<h3>可以考虑放宽这些条件</h3>${result.suggestions.map(t => `<p>${esc(t)}</p>`).join('')}` : ''}<small>现有规划保持原样。可先修改截止日期、扩大安排范围，或补充允许增加某日时长的要求，再重新生成。</small></div>`;
    return;
  }
  $('replan-preview').innerHTML = `<div class="replan-result"><div class="natural-result-header"><h3>${result.changes.length} 条任务调整 · ${result.capacityChanges.length} 个单日时长调整</h3><p>${esc(result.summary)}</p></div>${result.assumptions.length ? `<div class="natural-assumptions">${result.assumptions.map(t => `<p>${esc(t)}</p>`).join('')}</div>` : ''}${result.capacityChanges.length ? `<div class="replan-capacities"><h3>单日时长上限</h3>${result.capacityChanges.map(c => `<p>${esc(c.date)}：${time(c.from)} → <strong>${time(c.to)}</strong>${c.minutes === null ? '（恢复每周设置）' : '（仅这一天）'}<small>${esc(c.reason)}</small></p>`).join('')}</div>` : ''}<div class="replan-changes">${result.changes.map(c => `<section class="replan-change"><strong>${esc(c.title)}</strong><p>${c.from ? esc(c.from) : '待安排'}${c.fromTimeSlot ? ` ${esc(c.fromTimeSlot.start)}–${esc(c.fromTimeSlot.end)}` : ''} → ${c.to ? esc(c.to) : '待安排'}${c.toTimeSlot ? ` ${esc(c.toTimeSlot.start)}–${esc(c.toTimeSlot.end)}` : ''} · ${c.fromMinutes !== undefined && c.fromMinutes !== c.minutes ? `${time(c.fromMinutes)} → ` : ''}${time(c.minutes)}${c.fromDue !== undefined && c.fromDue !== c.toDue ? `<small>日程截止日期同步：${esc(c.fromDue)} → ${esc(c.toDue)}</small>` : ''}</p><small>${esc(c.reason)}</small></section>`).join('')}</div>${result.daily.length ? `<div class="replan-day-loads"><h3>相关日期的总时长</h3>${result.daily.map(d => `<p class="${d.totalMinutes > d.capacityMinutes ? 'replan-over' : ''}">${esc(d.date)}<span>${time(d.totalMinutes)} / ${time(d.capacityMinutes)}<small>定时与已完成 ${time(d.fixedMinutes)}</small></span></p>`).join('')}</div>` : ''}<p class="small-note">已完成任务保持原样；应用预览中的调整和类别标识，定时任务的提醒随新时间更新。</p></div>`;
  const categoryChanges = result.tasks.filter(t => t.categoryId && t.categoryId !== state.tasks.find(old => old.id === t.id)?.categoryId);
  if (categoryChanges.length) $('replan-preview').querySelector('.replan-result').insertAdjacentHTML('beforeend','<div class="replan-category-changes"><h3>新增类别标识</h3>'+categoryChanges.map(t => '<p>'+categoryMarker(state,t)+esc(t.title)+' · '+esc(getCategories(state).find(c => c.id === t.categoryId)?.name || '')+'</p>').join('')+'</div>');
  if (result.issues.length || result.suggestions.length) {
    const notes = document.createElement('div'); notes.className = 'natural-assumptions';
    notes.innerHTML = `<strong>相关说明与建议</strong>${[...result.issues, ...result.suggestions].map(t => `<p>${esc(t)}</p>`).join('')}`;
    const preview = $('replan-preview').querySelector('.replan-result'); preview.insertBefore(notes, preview.lastElementChild);
  }
  $('replan-apply').disabled = !result.changes.length && !result.capacityChanges.length && !categoryChanges.length;
}
function invalidateReplan() {
  replanGeneration++; replan = null; $('replan-apply').disabled = true; $('replan-generate').disabled = false;
  $('replan-stale').hidden = !$('replan-preview').querySelector('.replan-result');
  if ($('replan-preview').querySelector('.ai-loading')) $('replan-preview').innerHTML = '<p class="small-note">输入已修改，生成已取消。再次点击「重排并预览」继续。</p>';
  if (window.desktop) api.cancelAI().catch(() => {});
}
['replan-description','replan-through'].forEach(id => $(id).addEventListener('input', invalidateReplan));
$('replan-example').onclick = () => { $('replan-description').value = '周天我想把总工作时长压缩到2h，其它任务往后排，定时任务不能动。若后续日期或截止时间排不下，请告诉我需要放宽哪些条件。'; $('replan-description').dispatchEvent(new Event('input')); };
$('replan-form').addEventListener('submit', async event => {
  event.preventDefault(); if (saving) return;
  if (!window.desktop || !aiStatus.configured) { toast('请先在设置中保存 DeepSeek API 密钥。'); return; }
  const description = $('replan-description').value.trim(); if (!description) return;
  const snapshot = clone(state), referenceWeekStart = start, generation = ++replanGeneration;
  replan = null; $('replan-apply').disabled = true; $('replan-generate').disabled = true; $('replan-stale').hidden = true;
  $('replan-preview').innerHTML = '<div class="ai-loading"><span class="spinner"></span><strong>DeepSeek 正在调整已有规划…</strong><p>结合固定日程、后续可用时间和截止日期，寻找能完成的安排。</p></div>';
  try {
    const result = await api.replanNatural(snapshot, description, referenceWeekStart, $('replan-through').value, today);
    if (generation !== replanGeneration || !$('replan-dialog').open) return;
    if (JSON.stringify(state) !== JSON.stringify(snapshot) || start !== referenceWeekStart) { $('replan-preview').innerHTML = '<p class="inline-warning">现有任务或参考周发生变化，请重新生成调整方案。</p>'; return; }
    replan = { ...result, baseline: JSON.stringify(snapshot) }; showReplanPreview();
  } catch (error) { if (generation === replanGeneration && $('replan-dialog').open) $('replan-preview').innerHTML = `<p class="inline-warning">${esc(planningError(error, '可以修改要求后重试。'))}</p>`; }
  finally { if (generation === replanGeneration) $('replan-generate').disabled = false; }
});
$('replan-dialog').addEventListener('close', () => { replanGeneration++; replan = null; if (window.desktop) api.cancelAI().catch(() => {}); });
$('replan-apply').onclick = async () => {
  if (!replan?.feasible || saving) return;
  if (JSON.stringify(state) !== replan.baseline) { $('replan-apply').disabled = true; toast('任务在预览后发生变化，请重新生成调整方案。'); return; }
  const next = { ...clone(state), tasks: replan.tasks, settings: replan.settings };
  const count = replan.changes.length;
  if (await commit(next, `已应用调整，共调整 ${count} 条任务，提醒随新时间更新。`)) $('replan-dialog').close();
};
async function exportBackup() {
  if ($('settings-dialog').open && !await autoSaveSettings()) return;
  if (window.desktop) { try { if (await api.exportBackup(state)) toast('备份已导出。'); } catch (e) { toast(`导出失败：${e.message}`); } }
  else { const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `拾周备份-${today}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
async function restoreBackup(value) {
  if ($('settings-dialog').open && !await autoSaveSettings()) return;
  try { const next = validateState(value); if (await confirmAction('从备份恢复任务？', `备份中有 ${next.tasks.length} 个任务。恢复将替换当前任务和规划设置，操作后可以撤销。API 密钥不受影响。`)) { if (await commit(next, '已恢复备份。') && $('settings-dialog').open) openSettings(); } }
  catch (e) { toast(`恢复失败：${e.message}`, false, true); }
}
document.addEventListener('click', async event => {
  const close = event.target.closest('[data-close]'); if (close) { if (close.dataset.close === 'settings-dialog') await finishSettings(); else $(close.dataset.close).close(); return; }
  if (!ready) return;
  const monthDay = event.target.closest('[data-month-day]');
  if (monthDay) { monthSelected = monthDay.dataset.monthDay; month = monthStart(monthSelected); render(); return; }
  const activityDay = event.target.closest('[data-activity-day]');
  if (activityDay && !activityDay.hasAttribute('disabled')) { activitySelected = activityDay.dataset.activityDay; render(); return; }
  const rangeButton = event.target.closest('[data-activity-range]');
  if (rangeButton) { activityRange = Number(rangeButton.dataset.activityRange); render(); return; }
  const dayPlan = event.target.closest('[data-plan-day]'); if (dayPlan) { openDayPlan(dayPlan.dataset.planDay); return; }
  const toggle = event.target.closest('[data-toggle]');
  if (toggle) {
    if (saving || completionPending) return;
    const id = toggle.dataset.toggle, current = state.tasks.find(t => t.id === id);
    if (!current) return;
    if (current.done) { const next = clone(state); next.tasks.find(t => t.id === id).done = false; await commit(next, '任务已恢复为待完成。'); return; }
    completionPending = true;
    try {
      const result = await askCompletion(current);
      if (!result) return;
      const next = clone(state), task = next.tasks.find(t => t.id === id);
      if (!task || task.done) { toast('任务已在其他窗口完成或删除。'); return; }
      task.done = true;
      task.completedOn = dateKey();
      if (result.actualMinutes === null) delete task.actualMinutes; else task.actualMinutes = result.actualMinutes;
      await commit(next, result.actualMinutes === null ? '任务已完成，统计先按计划耗时计入，可在编辑中补填。' : '任务已完成，实际耗时已记录。');
    } finally { completionPending = false; }
    return;
  }
  const task = event.target.closest('[data-task]'); if (task) { openTask(task.dataset.task); return; }
  const newDate = event.target.closest('[data-new-date]'); if (newDate) { openTask(null, newDate.dataset.newDate); return; }
  const sectionNav = event.target.closest('[data-section]');
  if (sectionNav) { view = sectionNav.dataset.section === 'plan' ? lastPlanView : sectionNav.dataset.section === 'statistics' ? lastStatisticsView : 'today'; render(); return; }
  const nav = event.target.closest('[data-view]'); if (nav) { view = nav.dataset.view; render(); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'toggle-plan-view' && ['week','month'].includes(view)) { view = view === 'week' ? 'month' : 'week'; render(); return; }
  if (action === 'new') openTask();
  if (action === 'prev-week' || action === 'next-week') {
    if (view === 'month') { month = shiftMonth(month, action === 'prev-week' ? -1 : 1); monthSelected = month.slice(0,7) === today.slice(0,7) ? today : month; }
    else start = addDays(start, action === 'prev-week' ? -7 : 7);
    render();
  }
  if (action === 'this-week') { if (view === 'month') { month = monthStart(today); monthSelected = today; } else start = weekStart(); render(); }
  if (action === 'clear-filter') { search = ''; $('search').value = ''; render(); }
  if (action === 'natural') openNatural();
  if (action === 'replan') openReplan();
  if (action === 'dayplan') openDayPlan(today);
  if (action === 'dayplan-settings') { $('day-plan-dialog').close(); openSettings(); }
  if (action === 'settings') openSettings();
  if (action === 'plan-settings') { $('plan-dialog').close(); openSettings(); }
  if (action === 'export') await exportBackup();
  if (action === 'import') {
    if (window.desktop) { try { const next = await api.importBackup(); if (next) await restoreBackup(next); } catch (e) { toast(`恢复失败：${e.message}`); } }
    else $('import-file').click();
  }
  if (action === 'float') { if (window.desktop) await api.openWidget(); else toast('桌面浮窗请在 Windows 客户端中打开。'); }
  if (action === 'float-compact') { if (window.desktop) await api.openWidget('compact'); else toast('透明浮窗请在 Windows 客户端中打开。'); }
  if (action === 'demo') {
    if (await confirmAction('添加一组示例任务？', '将向当前所选周添加 11 个示例任务，用于体验规划。你可以修改、删除，或撤销这次添加。')) { const next = clone(state); next.tasks.push(...demoTasks(start)); await commit(next, '示例任务已添加，可以编辑或自然语言调整。'); }
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('[data-task]')) { openTask(event.target.dataset.task); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { if (!document.querySelector('dialog[open]')) { event.preventDefault(); $('search').focus(); } return; }
  if (document.querySelector('dialog[open]') || event.target.matches('input,textarea,select') || !ready) return;
  if (event.key.toLowerCase() === 'n') openTask();
});
let draggingId = null;
function clearDropHints() {
  document.querySelectorAll('.drop-target,.drop-before,.drop-after').forEach(el => el.classList.remove('drop-target','drop-before','drop-after'));
}
function dropPosition(target, event, id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return { anchorId: null, after: false };
  const hovered = event.target.closest('[data-task]');
  if (hovered?.dataset.task === id) return { anchorId: id, after: false };
  const cards = [...target.querySelectorAll('[data-task]')].filter(el => el.dataset.task !== id && el.classList.contains('done') === task.done);
  if (hovered && cards.includes(hovered)) {
    const bounds = hovered.getBoundingClientRect();
    return { anchorId: hovered.dataset.task, after: event.clientY >= bounds.top + bounds.height / 2, element: hovered };
  }
  const before = cards.find(el => { const bounds = el.getBoundingClientRect(); return event.clientY < bounds.top + bounds.height / 2; });
  const anchor = before || cards.at(-1);
  return { anchorId: anchor?.dataset.task || null, after: !before, element: anchor };
}
document.addEventListener('dragstart', event => {
  const card = event.target.closest('[data-task]'); if (!card) return;
  const task = state.tasks.find(t => t.id === card.dataset.task);
  if (!task || saving || completionPending) { event.preventDefault(); return; }
  draggingId = task.id; card.classList.add('is-dragging');
  event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', event => {
  const target = event.target.closest('[data-day],[data-drop-backlog]'); if (!target || !draggingId) return;
  const task = state.tasks.find(t => t.id === draggingId), date = target.dataset.day || null;
  clearDropHints();
  if (!task || (task.done && task.scheduled !== date) || (!date && task.timeSlot)) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'move'; target.classList.add('drop-target');
  const position = dropPosition(target,event,draggingId);
  position.element?.classList.add(position.after ? 'drop-after' : 'drop-before');
});
document.addEventListener('dragleave', event => { const target = event.target.closest('[data-day],[data-drop-backlog]'); if (target && !target.contains(event.relatedTarget)) clearDropHints(); });
document.addEventListener('dragend', () => { draggingId = null; clearDropHints(); document.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging')); });
document.addEventListener('drop', async event => {
  clearDropHints();
  const target = event.target.closest('[data-day],[data-drop-backlog]'); if (!target) return; event.preventDefault();
  if (saving || completionPending) return;
  const id = event.dataTransfer.getData('text/plain'), task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const date = target.dataset.day || null, sameDay = date === task.scheduled;
  if (task.done && !sameDay) return;
  if (!date && task.timeSlot) { toast('定时任务需要日期，请先在编辑中取消定时设置，再移回待安排。'); return; }
  const position = dropPosition(target,event,id);
  if (!sameDay && date && task.due && date > task.due && !await confirmAction('安排在截止日期之后？', `“${task.title}”的截止日期是 ${task.due}，你正在移到 ${date}。`)) return;
  const next = clone(state), ordered = moveTask(next.tasks,id,date,position.anchorId,position.after);
  if (ordered === next.tasks) return;
  next.tasks = ordered;
  await commit(next, sameDay ? '显示顺序已更新。' : date ? `任务已移到 ${shortDate(date)}。` : '任务已移回待安排。');
});
$('search').addEventListener('input', event => { search = event.target.value.trim(); render(); });
document.addEventListener('change', event => { if (event.target.id === 'activity-year') { activityYear = Number(event.target.value); activitySelected = activityYear === Number(today.slice(0,4)) ? today : `${activityYear}-12-31`; render(); } });
document.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('circle[data-activity-day]')) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click',{bubbles:true})); }
});
['task-due', 'task-scheduled', 'task-minutes', 'task-timed', 'task-start-time', 'task-end-time'].forEach(id => $(id).addEventListener('input', taskWarning));
$('task-form').addEventListener('submit', async event => {
  event.preventDefault(); if (saving) return;
  const title = $('task-title').value.trim(); if (!title) { $('task-title').setCustomValidity('请填写任务名称'); $('task-title').reportValidity(); return; }
  const next = clone(state), existing = next.tasks.find(t => t.id === editing);
  const task = { ...existing, id: existing?.id || crypto.randomUUID(), title, priority: $('task-priority').value, minutes: Number($('task-minutes').value), due: $('task-due').value || null, scheduled: $('task-scheduled').value || null, locked: $('task-locked').checked, notes: $('task-notes').value, done: existing?.done || false };
  if ($('task-actual').value) task.actualMinutes = Number($('task-actual').value); else delete task.actualMinutes;
  if (task.done) task.completedOn = $('task-completed-on').value;
  if ($('task-category').value) task.categoryId = $('task-category').value; else delete task.categoryId;
  if ($('task-timed').checked) task.timeSlot = { start: $('task-start-time').value, end: $('task-end-time').value, reminders: [...document.querySelectorAll('[name=task-reminder]:checked')].map(input => Number(input.value)) };
  else delete task.timeSlot;
  if (editing && !existing) { toast('这个任务已经被删除，请重新添加。'); return; }
  if (existing) next.tasks[next.tasks.indexOf(existing)] = task; else next.tasks.push(task);
  if (await commit(next, existing ? '任务已更新。' : '任务已添加。')) $('task-dialog').close();
});
$('task-title').addEventListener('input', () => $('task-title').setCustomValidity(''));
$('task-test-reminder').addEventListener('click', async () => {
  if (!window.desktop) { toast('闹钟提醒请在 Windows 客户端中使用。'); return; }
  taskWarning();
  for (const id of ['task-scheduled','task-start-time','task-end-time']) if (!$(id).reportValidity()) return;
  try { await api.testReminder({title:$('task-title').value.trim() || '提醒测试',date:$('task-scheduled').value,start:$('task-start-time').value,end:$('task-end-time').value}); }
  catch (error) { toast(friendlyError(error)); }
});
$('delete-task').addEventListener('click', async () => {
  const t = state.tasks.find(t => t.id === editing); if (!t) return;
  if (await confirmAction('删除这件事？', `“${t.title}”将从计划中移除，操作后可以撤销。`)) { const next = clone(state); next.tasks = next.tasks.filter(t => t.id !== editing); if (await commit(next, '任务已删除。')) $('task-dialog').close(); }
});
$('apply-plan').addEventListener('click', async () => {
  if (!plan) return;
  if (JSON.stringify(state) !== plan.baseline) { toast('任务已变化，请重新规划。'); $('plan-dialog').close(); return; }
  const next = clone(state); next.tasks = plan.tasks;
  if (await commit(next, `本周计划已更新，${plan.placed} 个任务已安排。`)) $('plan-dialog').close();
});
$('plan-dialog').addEventListener('close', () => { planGeneration++; if (window.desktop) api.cancelAI().catch(() => {}); });
$('plan-local').addEventListener('click', () => { planGeneration++; if (window.desktop) api.cancelAI().catch(() => {}); plan = { ...planWeek(state, start), baseline: JSON.stringify(state) }; $('plan-provider').textContent = '本地规则规划'; showPlanPreview(); });
function markSettings(group, delay = 250) {
  if (!$('settings-dialog').open) return;
  settingsDirty.set(group,++settingsRevision); clearTimeout(settingsTimer);
  $('settings-status').textContent = '正在自动保存…'; $('settings-retry').hidden = true;
  settingsTimer = setTimeout(() => autoSaveSettings(),delay);
}
function settingsGroup(target) {
  if (target.closest('#category-fields')) return 'categories';
  if (target.closest('#capacity-fields')) return 'capacities';
  if (target.closest('#routine-breaks') || ['routine-start','routine-end'].includes(target.id)) return 'routine';
  return ({'routine-preferences':'dayPreferences','ai-preferences':'preferences','ai-model':'ai','ai-model-custom':'ai','ai-key':'ai'})[target.id];
}
function settingsCandidate(groups) {
  let next = clone(state); const incomplete = new Map();
  for (const group of groups) {
    if (group === 'ai') continue;
    const candidate = clone(next);
    try {
      if (group === 'categories') {
        const categories = [];
        for (const row of $('category-fields').children) {
          const value = {id:row.dataset.id,name:row.querySelector('.category-name').value.trim(),description:row.querySelector('.category-description').value.trim(),color:row.querySelector('.category-color').value};
          try { categories.push(validateCategories([value])[0]); }
          catch {
            const previous = getCategories(state).find(c => c.id === value.id);
            if (previous) categories.push(previous);
            incomplete.set(group,'请补全类别名称和描述');
          }
        }
        candidate.settings.categories = validateCategories(categories);
      } else if (group === 'capacities') {
        candidate.settings.capacities = DAYS.map((_,i) => {
          const input = document.querySelector('[name="capacity-'+i+'"]'), minutes = Number(input.value);
          if (!input.value || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) { incomplete.set(group,'每日时长需为 0–1440 分钟'); return next.settings.capacities[i]; }
          return minutes;
        });
      } else if (group === 'routine') {
        candidate.settings.dailyRoutine = {start:$('routine-start').value,end:$('routine-end').value,breaks:[...$('routine-breaks').children].map(row => ({title:row.querySelector('.routine-title').value.trim(),start:row.querySelector('.routine-start').value,end:row.querySelector('.routine-end').value}))};
      } else if (group === 'preferences') candidate.settings.preferences = $('ai-preferences').value.trim();
      else if (group === 'dayPreferences') candidate.settings.dayPreferences = $('routine-preferences').value.trim();
      next = validateState(candidate);
    } catch (error) { incomplete.set(group,error.message); }
  }
  return {next,incomplete};
}
async function autoSaveSettings() {
  clearTimeout(settingsTimer);
  if (settingsPending) { await settingsPending; return autoSaveSettings(); }
  if (!settingsDirty.size) return true;
  if (!ready) return false;
  if (saving) { await new Promise(resolve => setTimeout(resolve,80)); return autoSaveSettings(); }
  const revisions = new Map(settingsDirty), {next,incomplete} = settingsCandidate(revisions.keys());
  const aiModel = $('ai-model').value === 'custom' ? $('ai-model-custom').value.trim() : $('ai-model').value;
  const key = $('ai-key').value.trim();
  if (revisions.has('ai') && (!/^[a-zA-Z0-9._-]{1,80}$/.test(aiModel) || /\s/.test(key))) incomplete.set('ai','请填写有效的模型名称和密钥');
  saving = true;
  settingsPending = (async () => {
    try {
      if (JSON.stringify(next) !== JSON.stringify(state)) {
        const previous = clone(state);
        if (!demoMode) await api.save(next,previous);
        state = next; undoState = null; $('undo-btn').hidden = true; render();
      }
      if (window.desktop && revisions.has('ai') && !incomplete.has('ai') && (key || aiModel !== aiStatus.model)) {
        aiStatus = await api.saveAIConfig({key:key || null,model:aiModel});
        $('ai-connection').textContent = aiStatus.configured ? '密钥已保存 · 规划时调用 API' : '尚未配置 · 自然语言功能需要 API 密钥';
      }
      for (const [group,revision] of revisions) if (!incomplete.has(group) && settingsDirty.get(group) === revision) settingsDirty.delete(group);
      const newer = [...settingsDirty].some(([group,revision]) => revision !== revisions.get(group));
      $('settings-status').textContent = newer ? '正在自动保存…' : incomplete.size ? [...new Set(incomplete.values())].join('；')+'，未完成的修改暂未生效' : '已自动保存';
      $('settings-retry').hidden = true;
      if (newer) { clearTimeout(settingsTimer); settingsTimer = setTimeout(() => autoSaveSettings(),250); }
      return true;
    } catch (error) {
      $('settings-status').textContent = '未保存：'+error.message; $('settings-retry').hidden = false;
      return false;
    } finally { saving = false; }
  })();
  let result;
  try { result = await settingsPending; } finally { settingsPending = null; }
  return result;
}
async function finishSettings() {
  if (!$('settings-dialog').open) return;
  if (!await autoSaveSettings()) return;
  clearTimeout(settingsTimer);
  if (settingsDirty.size) toast('未填写完整的修改未生效，其余有效设置已自动保存。');
  settingsDirty.clear(); $('settings-dialog').close();
}
$('settings-form').addEventListener('input',event => { const group = settingsGroup(event.target); if (group) markSettings(group,event.target.id === 'ai-key' ? 700 : 250); });
$('settings-form').addEventListener('change',event => { const group = settingsGroup(event.target); if (group) markSettings(group,0); });
$('settings-form').addEventListener('submit',event => { event.preventDefault(); autoSaveSettings(); });
$('settings-dialog').addEventListener('cancel',event => { event.preventDefault(); finishSettings(); });
$('settings-retry').onclick = () => autoSaveSettings();
$('remove-key').addEventListener('click', async () => {
  if (!await autoSaveSettings()) return;
  if (await confirmAction('移除 API 密钥？', '移除后仍可手动管理任务。任务数据不会改变。')) { try { aiStatus = await api.saveAIConfig({ key: '', model: aiStatus.model }); $('ai-connection').textContent = '密钥已移除'; $('ai-key').value = ''; settingsDirty.delete('ai'); $('settings-status').textContent = '已自动保存'; } catch (e) { toast(e.message); } }
});
$('import-file').addEventListener('change', async event => { const file = event.target.files[0]; if (file) { try { if (file.size > 8_000_000) throw new Error('备份文件过大'); await restoreBackup(JSON.parse(await file.text())); } catch (e) { toast(`无法导入：${e.message}`); } } event.target.value = ''; });
$('undo-btn').addEventListener('click', async () => {
  if (!undoState || saving) return;
  const previous = clone(state), restored = clone(undoState); saving = true;
  try { if (!demoMode) await api.save(restored, previous); state = restored; undoState = null; render(); toast('已撤销上一次修改。'); }
  catch (e) { toast(`撤销失败：${e.message}`); } finally { saving = false; }
});
$('toast-close').onclick = () => { $('toast').hidden = true; };
hydrateIcons();
try {
  state = demoMode ? { ...emptyState(), tasks: demoTasks(start) } : validateState(await api.read());
  if (window.desktop) {
    try { aiStatus = await api.aiStatus(); } catch (e) { toast(`AI 配置读取失败：${e.message}。手动任务管理仍可使用。`, false, true); }
    try { const status = await api.reminderStatus(); if (status.error) toast(status.error, false, true); } catch (e) { toast(`提醒状态读取失败：${e.message}`, false, true); }
    api.onState(next => {
      if (demoMode) return;
      const incoming = validateState(next);
      // Our own save can be echoed after its promise resolves. Only an actual
      // state change from another window should invalidate the current undo.
      if (JSON.stringify(incoming) === JSON.stringify(state)) return;
      state = incoming; undoState = null; $('undo-btn').hidden = true; render();
    });
  }
  ready = true; render(); $('save-status').textContent = demoMode ? '示例预览 · 不保存数据' : '数据保存在本机';
} catch (error) { $('main-view').innerHTML = `<div class="read-error"><h2>任务数据暂时无法读取</h2><p>${esc(error.message)}</p><p>为保护已有数据，已暂停编辑。请先备份并检查数据文件，再重新打开应用。</p></div>`; }
setInterval(() => { const d = dateKey(); if (d !== today) { today = d; if (view === 'today') render(); else render(); } }, 30000);

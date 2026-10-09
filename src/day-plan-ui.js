import { applyCategories } from './categories.js';
import { categoryMarker } from './category-ui.js';
import { dayTimeline, DEFAULT_DAILY_ROUTINE, DEFAULT_DAY_DESCRIPTION } from './day-plan.js';
import { dateKey } from './planner.js';
import { escapeHtml as esc } from './icons.js';
import { planningError } from './errors.js';

const $ = id => document.getElementById(id);
export function timelineHtml(state,date,plan) {
  return `<div class="day-timeline">${dayTimeline(state,date,plan).map(row => `<div class="day-timeline-row ${row.kind} ${row.done ? 'finished' : ''} ${row.parallel?.length ? 'parallel' : ''}"><strong>${esc(row.start)}–${esc(row.end)}</strong><span>${categoryMarker(state,state.tasks.find(t => t.id === row.taskId))}${esc(row.title)}${row.part ? `<small>第 ${esc(row.part)} 段</small>` : ''}${row.kind === 'fixed' ? '<small>定时日程</small>' : ''}${row.done ? '<small>已完成</small>' : ''}${(row.parallel || []).map(p => `<small class="parallel-note" title="你的要求：${esc(p.permission)}">${esc(p.start)}–${esc(p.end)} 与「${esc(p.title)}」同时进行</small>`).join('')}</span></div>`).join('')}</div>`;
}
export function initDayPlanUI({getState,getAIStatus,api,commit,toast}) {
  let stage = null, generation = 0;
  function context() {
    const state = getState(), date = $('day-plan-date').value;
    const routine = state.settings.dailyRoutine || DEFAULT_DAILY_ROUTINE;
    $('day-plan-base').textContent = `基础作息：${routine.start}–${routine.end}${routine.breaks.length ? `；${routine.breaks.map(b => `${b.title} ${b.start}–${b.end}`).join('；')}` : ''}${state.settings.dayPreferences ? `。${state.settings.dayPreferences}` : ''}`;
    const tasks = state.tasks.filter(t => t.scheduled === date && !t.done && !t.timeSlot);
    $('day-plan-count').textContent = `这一天有 ${tasks.length} 项待安排工作，共 ${tasks.reduce((sum,t) => sum+t.minutes,0)} 分钟；原有定时日程保留。`;
    $('day-plan-clear').hidden = !state.dayPlans?.[date];
  }
  function invalidate() {
    generation++; stage = null; $('day-plan-apply').disabled = true; $('day-plan-generate').disabled = false;
    $('day-plan-stale').hidden = !$('day-plan-preview').querySelector('.day-result');
    if ($('day-plan-preview').querySelector('.ai-loading')) $('day-plan-preview').innerHTML = '<p class="small-note">输入已修改，生成已取消。再次点击「安排时段」继续。</p>';
    if (window.desktop) api.cancelAI().catch(() => {});
    context();
  }
  ['day-plan-date','day-plan-description'].forEach(id => $(id).addEventListener('input',invalidate));
  $('day-plan-date').addEventListener('change',() => { $('day-plan-description').value = getState().settings.dayOverrides?.[$('day-plan-date').value] || ''; invalidate(); });
  $('day-plan-example').onclick = () => { $('day-plan-description').value = '这一天从8点开始工作，下午3-5有别的事不能安排任务，晚上8点之后不能工作。优先审稿，较长任务可以分段完成。'; $('day-plan-description').dispatchEvent(new Event('input')); };
  $('day-plan-form').onsubmit = async event => {
    event.preventDefault();
    if (!window.desktop || !getAIStatus().configured) { toast('请先在设置中保存 DeepSeek API 密钥。'); return; }
    const state = structuredClone(getState()), date = $('day-plan-date').value;
    const description = $('day-plan-description').value.trim() || DEFAULT_DAY_DESCRIPTION;
    const request = ++generation; stage = null; $('day-plan-apply').disabled = true; $('day-plan-generate').disabled = true; $('day-plan-stale').hidden = true;
    $('day-plan-preview').innerHTML = '<div class="ai-loading"><span class="spinner"></span><strong>DeepSeek 正在安排这一天…</strong><p>结合基础作息、当天例外、任务耗时与定时日程。</p></div>';
    try {
      const now = new Date(), currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const result = await api.planDay(state,description,date,dateKey(),currentTime);
      if (request !== generation || !$('day-plan-dialog').open) return;
      if (JSON.stringify(getState()) !== JSON.stringify(state)) { $('day-plan-preview').innerHTML = '<p class="inline-warning">任务或设置发生变化，请重新安排时段。</p>'; return; }
      const previewState = applyCategories(structuredClone(state),result.categoryAssignments);
      const notes = [...result.assumptions,...result.issues,...result.suggestions];
      $('day-plan-preview').innerHTML = `<div class="day-result"><div class="natural-result-header"><h3>${result.feasible ? '这一天的建议时段' : '当前要求下暂时排不下'}</h3><p>${esc(result.summary)}</p></div>${notes.length ? `<div class="natural-assumptions">${notes.map(s => `<p>${esc(s)}</p>`).join('')}</div>` : ''}${result.feasible ? timelineHtml(previewState,date,result.plan) : '<p class="small-note">已保存的安排保持原样。可放宽当天要求，或把部分任务移到其他日期，再重新生成。</p>'}</div>`;
      if (result.feasible) { stage = {date,plan:result.plan,categoryAssignments:result.categoryAssignments,baseline:JSON.stringify(state)}; $('day-plan-apply').disabled = false; }
    } catch (error) { if (request === generation) $('day-plan-preview').innerHTML = `<p class="inline-warning">${esc(planningError(error,'可以调整当天要求后重试。'))}</p>`; }
    finally { if (request === generation) $('day-plan-generate').disabled = false; }
  };
  $('day-plan-apply').onclick = async () => {
    if (!stage) return;
    if (JSON.stringify(getState()) !== stage.baseline) { $('day-plan-apply').disabled = true; toast('任务或设置在预览后发生变化，请重新安排时段。'); return; }
    const next = applyCategories(structuredClone(getState()),stage.categoryAssignments); next.dayPlans ||= {}; next.dayPlans[stage.date] = stage.plan;
    next.settings.dayOverrides ||= {};
    if (stage.plan.description === DEFAULT_DAY_DESCRIPTION) delete next.settings.dayOverrides[stage.date];
    else next.settings.dayOverrides[stage.date] = stage.plan.description;
    if (await commit(next,'当天时段已保存，同一项任务仍可一次打勾完成。')) $('day-plan-dialog').close();
  };
  $('day-plan-clear').onclick = async () => {
    const next = structuredClone(getState()), date = $('day-plan-date').value;
    if (!next.dayPlans?.[date]) return;
    delete next.dayPlans[date];
    if (await commit(next,'这一天的建议时段已清除，任务保留。')) $('day-plan-dialog').close();
  };
  $('day-plan-dialog').addEventListener('close',() => {generation++;stage=null;if(window.desktop)api.cancelAI().catch(() => {});});
  return function openDayPlan(date = dateKey()) {
    stage = null; $('day-plan-date').value = date; $('day-plan-description').value = getState().settings.dayOverrides?.[date] || ''; $('day-plan-apply').disabled = true; $('day-plan-generate').disabled = false; $('day-plan-stale').hidden = true;
    context();
    const state = getState(), saved = state.dayPlans?.[date];
    $('day-plan-preview').innerHTML = saved ? `<div class="day-result"><div class="natural-result-header"><h3>已保存的时段安排</h3><p>${esc(saved.summary)}</p></div>${timelineHtml(state,date,saved)}</div>` : '';
    if (!window.desktop || !getAIStatus().configured) $('day-plan-preview').insertAdjacentHTML('afterbegin','<p class="inline-warning">安排时段需要 DeepSeek，请先在系统设置中保存 API 密钥。</p>');
    $('day-plan-dialog').showModal();
  };
}

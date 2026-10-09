import { categoryMarker } from './category-ui.js';
import { dateKey, parseDate, addDays, weekStart } from './planner.js';
import { monthDays, dailyActivity, activityRange, heatLevel } from './activity.js';
import { escapeHtml as esc } from './icons.js';

const hours = n => Number((n / 60).toFixed(2));
const duration = n => n < 60 ? `${n} 分钟` : `${hours(n)} 小时`;
const label = d => `${parseDate(d).getMonth() + 1}/${parseDate(d).getDate()}`;

export function monthHtml(state, month, selected, today, matches, taskCard) {
  const days = monthDays(month), tasks = state.tasks.filter(matches);
  const selectedTasks = tasks.filter(t => t.scheduled === selected).sort((a,b) => Number(a.done) - Number(b.done));
  return `<section class="month-calendar" aria-label="月历任务"><div class="month-weekdays">${['一','二','三','四','五','六','日'].map(d => `<span>周${d}</span>`).join('')}</div><div class="month-grid">${days.map(d => {
    const rows = tasks.filter(t => t.scheduled === d).sort((a,b) => Number(a.done) - Number(b.done));
    const load = state.tasks.filter(t => t.scheduled === d).reduce((s,t) => s+t.minutes,0);
    return `<section class="month-cell ${d.slice(0,7) !== month.slice(0,7) ? 'outside-month' : ''} ${d === selected ? 'selected' : ''} ${d === today ? 'is-today' : ''}" data-day="${d}"><button class="month-day-open" data-month-day="${d}" aria-label="查看 ${d}，${rows.length} 个任务" aria-pressed="${d === selected}"><span class="month-date">${parseDate(d).getDate()}</span>${d === today ? '<span class="month-today">今天</span>' : ''}<span class="month-load">${load ? `${hours(load)}h 预计` : ''}</span><span class="month-titles">${rows.slice(0,3).map(t => `<span class="month-task ${t.done ? 'done' : ''}" title="${esc(t.title)}">${categoryMarker(state,t)}${t.done ? '✓' : '·'} ${esc(t.title)}</span>`).join('')}${rows.length > 3 ? `<span class="month-more">还有 ${rows.length-3} 项…</span>` : ''}</span></button></section>`;
  }).join('')}</div></section><section class="month-detail" data-day="${selected}"><div class="section-head"><h2>${selected} ${selected === today ? '· 今天' : ''}</h2><span class="count-pill">${selectedTasks.length}</span><button class="text-btn" data-plan-day="${selected}">${state.dayPlans?.[selected] ? '查看当天时段' : '帮我规划这一天'}</button><button class="text-btn" data-new-date="${selected}">+ 添加任务</button></div><div class="task-list">${selectedTasks.length ? selectedTasks.map(t => taskCard(t)).join('') : '<p class="month-empty">这一天没有匹配的任务，可以添加任务或拖入一张卡片。</p>'}</div></section>`;
}

export function insightsHtml(state, today, year, range, selected) {
  const activity = dailyActivity(state.tasks), from = `${year}-01-01`, through = `${year}-12-31`;
  const rows = activityRange(activity, from, through).filter(d => d.date <= today);
  const total = rows.reduce((s,d) => s+d.minutes,0), active = rows.filter(d => d.minutes>0).length;
  const missing = rows.reduce((s,d) => s+d.missing,0), legacy = rows.reduce((s,d) => s+d.legacy,0);
  const years = [...new Set([Number(today.slice(0,4)), year, ...[...activity.days.keys()].map(d => Number(d.slice(0,4)))])].sort((a,b) => b-a);
  const gridFrom = weekStart(from), gridThrough = addDays(weekStart(through),6);
  const grid = activityRange(activity, gridFrom, gridThrough);
  const months = [];
  const seenMonths = new Set();
  for (let i=0; i<grid.length; i+=7) {
    const inYear = grid.slice(i,i+7).find(d => d.date >= from && d.date <= through && parseDate(d.date).getDate() <= 7);
    if (inYear && !seenMonths.has(inYear.date.slice(0,7))) { seenMonths.add(inYear.date.slice(0,7)); months.push(`<span style="grid-column:${i/7+1}">${parseDate(inYear.date).getMonth()+1}月</span>`); }
  }
  const recent = activityRange(activity, addDays(today, -(range-1)), today);
  const recentTotal = recent.reduce((s,d) => s+d.minutes,0);
  const max = Math.max(60, ...recent.map(d => d.minutes)), ceiling = Math.ceil(max/60)*60;
  const left=54, right=878, top=20, bottom=196;
  const points = recent.map((d,i) => ({...d,x:left+i/(range-1)*(right-left),y:bottom-d.minutes/ceiling*(bottom-top)}));
  const path = points.map((p,i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const ticks = Array.from({length:5},(_,i) => { const y=bottom-i/4*(bottom-top); return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" class="chart-gridline"/><text x="44" y="${y+4}" text-anchor="end">${hours(ceiling*i/4)}</text>`; }).join('');
  const dates = [0,Math.round((range-1)/3),Math.round((range-1)*2/3),range-1].map(i => `<text x="${points[i].x}" y="224" text-anchor="${i===0?'start':i===range-1?'end':'middle'}">${label(points[i].date)}</text>`).join('');
  const day = activity.days.get(selected) || {minutes:0,tasks:[],missing:0,legacy:0};
  return `<div class="activity-summary"><div><span>${year}年工作投入</span><strong id="activity-total">${hours(total)}<small>小时</small></strong></div><div><span>有耗时记录的日子</span><strong>${active}<small>天</small></strong></div><div><span>活跃日平均</span><strong>${hours(active ? total/active : 0)}<small>小时</small></strong></div></div>
    <section class="insight-panel"><div class="insight-heading"><div><h2>每天的投入</h2><p>颜色越深，当天计入的工作时长越多。点击日期查看明细。</p></div><label>年份 <select id="activity-year" aria-label="热图年份">${years.map(y => `<option value="${y}" ${y===year?'selected':''}>${y}年</option>`).join('')}</select></label></div>
    <div class="heat-scroll"><div class="heat-layout" style="--weeks:${grid.length/7}"><div class="heat-months">${months.join('')}</div><div class="heat-weekdays"><span>一</span><span>三</span><span>五</span><span>日</span></div><div class="heat-grid">${grid.map(d => {
      const outside=d.date<from || d.date>through, future=d.date>today;
      return outside ? '<span class="heat-cell heat-outside"></span>' : `<button class="heat-cell heat-${future?0:heatLevel(d.minutes)} ${future?'heat-future':''} ${d.date===selected?'heat-selected':''}" data-activity-day="${d.date}" data-minutes="${d.minutes}" ${future?'disabled':''} title="${d.date} · ${future?'尚未到来':`${duration(d.minutes)}`}" aria-label="${d.date}，工作时长 ${duration(d.minutes)}" aria-pressed="${d.date===selected}"></button>`;
    }).join('')}</div></div></div><div class="heat-legend"><span>0</span>${[0,1,2,3,4].map(n => `<span class="heat-cell heat-${n}" title="${['0分钟','不足1小时','1–2小时','2–4小时','4小时及以上'][n]}"></span>`).join('')}<span>4h+</span></div><p class="activity-note">${missing ? `${year}年有 ${missing} 项完成任务未填写实际耗时，已按计划耗时计入总时长。` : '统计已完成任务；优先使用实际耗时，未填写时按计划耗时计入。'}${legacy ? ` ${legacy} 项旧记录按安排日期计入，可在任务编辑中修正实际完成日期。` : ''}${activity.undated ? ` 另有 ${activity.undated} 项完成任务没有日期，可在编辑中补填。` : ''} 空白日表示没有耗时记录。</p></section>
    <section class="insight-panel"><div class="insight-heading"><div><h2>近期工作时长</h2><p>最近 ${range} 天共 ${duration(recentTotal)} · 日均 ${duration(Math.round(recentTotal/range))}</p></div><div class="range-switch" role="group" aria-label="曲线时间范围">${[7,30,90].map(n => `<button data-activity-range="${n}" class="${n===range?'active':''}" aria-pressed="${n===range}">${n}天</button>`).join('')}</div></div><div class="chart-unit">工作时长 / 小时</div><svg class="activity-chart" viewBox="0 0 900 240" role="group" aria-label="最近${range}天每日工作时长曲线"><defs><linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a75da" stop-opacity=".25"/><stop offset="1" stop-color="#8a75da" stop-opacity=".02"/></linearGradient></defs>${ticks}<path d="${path} L${right},${bottom} L${left},${bottom} Z" fill="url(#activity-fill)"/><path d="${path}" class="chart-line"/>${dates}${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="${p.date===selected?5:3}" class="chart-dot"/><circle cx="${p.x}" cy="${p.y}" r="9" class="chart-hit" data-activity-day="${p.date}" data-minutes="${p.minutes}" tabindex="0" role="button" aria-label="${p.date}，${duration(p.minutes)}"><title>${p.date} · ${duration(p.minutes)}${p.missing?` · ${p.missing}项按计划耗时计入`:''}</title></circle>`).join('')}</svg></section>
    <section class="insight-panel activity-detail"><div class="insight-heading"><div><h2>${selected} 的完成记录</h2><p>总计 ${duration(day.minutes)}${day.missing?` · ${day.missing} 项按计划耗时计入`:''}</p></div></div>${day.tasks.length ? `<div class="activity-records">${day.tasks.map(t => `<button class="activity-record" data-task="${esc(t.id)}"><span>${categoryMarker(state,t)}${esc(t.title)}${!t.completedOn?' <small>旧记录 · 按安排日期</small>':''}</span><strong>${duration(t.actualMinutes ?? t.minutes)}${t.actualMinutes===undefined?'<small>按计划耗时计入</small>':'<small>实际耗时</small>'}</strong></button>`).join('')}</div>` : '<p class="activity-empty">这一天没有已完成任务的耗时记录。</p>'}</section>`;
}

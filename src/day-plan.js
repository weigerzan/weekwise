export const DEFAULT_DAILY_ROUTINE = { start:'10:30',end:'21:00',breaks:[{title:'午饭',start:'12:00',end:'13:30'},{title:'晚饭',start:'18:00',end:'19:30'}] };
export const DEFAULT_DAY_DESCRIPTION = '按基础作息安排这一天，合理安排休息。';
function parallelSlots(state, plan, taskId, slot) {
  return (plan.overlaps || []).filter(row => row.taskIds.includes(taskId) && row.start < slot.end && row.end > slot.start).map(row => ({start:row.start,end:row.end,title:state.tasks.find(t => t.id === row.taskIds.find(id => id !== taskId))?.title || '另一项任务',permission:row.permission}));
}
export function dayTaskSlots(state, task) {
  const plan = state.dayPlans?.[task.scheduled];
  if (!plan) return [];
  return (plan.assignments.find(row => row.taskId === task.id)?.slots || []).map(slot => {
    const parallel = parallelSlots(state,plan,task.id,slot);
    return parallel.length ? {...slot,parallel} : slot;
  });
}
export function dayTimeline(state, date, plan = state.dayPlans?.[date]) {
  if (!plan) return [];
  const rows = plan.breaks.map(row => ({...row,kind:'break'}));
  for (const row of plan.assignments) {
    const task = state.tasks.find(t => t.id === row.taskId);
    if (task) rows.push(...row.slots.map((slot,index) => ({...slot,taskId:task.id,title:task.title,done:task.done,kind:'work',part:row.slots.length>1 ? `${index+1}/${row.slots.length}` : ''})));
  }
  rows.push(...state.tasks.filter(t => t.scheduled === date && t.timeSlot).map(t => ({start:t.timeSlot.start,end:t.timeSlot.end,taskId:t.id,title:t.title,done:t.done,kind:'fixed'})));
  return rows.map(row => {
    const parallel = row.taskId ? parallelSlots(state,plan,row.taskId,row) : [];
    return parallel.length ? {...row,parallel} : row;
  }).sort((a,b) => a.start.localeCompare(b.start));
}

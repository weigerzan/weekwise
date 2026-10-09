// The saved task array is also the manual display order; no migration is needed.
export function moveTask(tasks, id, date, anchorId = null, after = false) {
  const task = tasks.find(t => t.id === id);
  if (!task || anchorId === id || (task.done && task.scheduled !== date) || (!date && task.timeSlot)) return tasks;
  const next = tasks.filter(t => t.id !== id);
  const anchor = next.find(t => t.id === anchorId && t.scheduled === date && t.done === task.done);
  let index;
  if (anchor) index = next.indexOf(anchor) + Number(after);
  else {
    const last = next.findLast(t => t.scheduled === date && t.done === task.done);
    index = last ? next.indexOf(last) + 1 : next.length;
  }
  next.splice(index, 0, { ...task, scheduled: date, locked: date ? task.locked : false });
  if (task.scheduled === date) {
    const previousOrder = tasks.filter(t => t.scheduled === date && t.done === task.done);
    const nextOrder = next.filter(t => t.scheduled === date && t.done === task.done);
    if (nextOrder.every((t, i) => t.id === previousOrder[i].id)) return tasks;
  }
  return next;
}

function messageOf(error) {
  return String(error?.message || error || '操作失败')
    .replace(/^Error invoking remote method '[^']+':\s*/u, '')
    .replace(/^Error:\s*/u, '')
    .replace(/[。\s]+$/u, '');
}
function missingHandler(error) { return /No handler registered for ['"][^'"]+['"]/u.test(messageOf(error)); }
export function friendlyError(error) {
  if (missingHandler(error)) return '当前后台尚未加载此功能，请从系统托盘退出拾周，再重新打开；已保存的任务和设置会保留';
  return messageOf(error);
}
export function planningError(error, retryHint) {
  return `${friendlyError(error)}。${missingHandler(error) ? '' : retryHint}`;
}

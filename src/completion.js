// Shared by the main window and both floating-window modes.
export async function askCompletion(task) {
  if (document.getElementById('completion-dialog')?.open) return null;
  if (!document.getElementById('completion-style')) {
    const link = document.createElement('link');
    link.id = 'completion-style'; link.rel = 'stylesheet';
    link.href = new URL('./completion.css', import.meta.url).href;
    document.head.append(link);
    await new Promise(resolve => { link.onload = resolve; link.onerror = resolve; });
  }
  const dialog = document.createElement('dialog');
  dialog.id = 'completion-dialog'; dialog.className = 'modal completion-modal';
  dialog.innerHTML = `<form id="completion-form"><h2>记录实际耗时</h2><p id="completion-title"></p><label class="field">实际耗时（分钟）<input id="completion-minutes" type="number" min="1" max="10080" step="1" required autofocus></label><p class="small-note">预计耗时保持原样；跳过后统计先按计划耗时计入，之后可补填。</p><div class="completion-actions"><button type="button" class="secondary-btn" id="completion-cancel">取消</button><button type="button" class="secondary-btn" id="completion-skip">跳过并完成</button><button type="submit" class="primary-btn" id="completion-save">保存并完成</button></div></form>`;
  document.body.append(dialog);
  dialog.querySelector('#completion-title').textContent = task.title;
  const input = dialog.querySelector('#completion-minutes');
  input.value = task.actualMinutes ?? ''; input.placeholder = `预计 ${task.minutes} 分钟`;
  return new Promise(resolve => {
    let result = null;
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result); }, { once: true });
    dialog.querySelector('form').onsubmit = event => { event.preventDefault(); result = { actualMinutes: Number(input.value) }; dialog.close(); };
    dialog.querySelector('#completion-skip').onclick = () => { result = { actualMinutes: null }; dialog.close(); };
    dialog.querySelector('#completion-cancel').onclick = () => dialog.close();
    dialog.showModal(); input.focus();
  });
}

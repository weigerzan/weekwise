// Own-app end-to-end verification; optional Playwright dependency for development only.
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const runtimeRequire = process.env.PLAYWRIGHT_MODULE ? createRequire(path.join(process.env.PLAYWRIGHT_MODULE, 'package.json')) : require;
const { _electron } = runtimeRequire('playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  const dir = path.join(root, 'test-results', `smoke-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  console.log('Launching isolated desktop test');
  const executablePath = process.env.WEEKWISE_EXECUTABLE || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const app = await _electron.launch({ executablePath, args: process.env.WEEKWISE_EXECUTABLE ? [] : [root], env: { ...process.env, WEEKWISE_TEST: '1', WEEKWISE_DATA_DIR: dir }, timeout: 30000 });
  console.log('Electron connected');
  let page;
  const errors = [];
  try {
    page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => { errors.push(e.message); console.error('PAGE ERROR', e.message); });
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error('RENDERER ERROR', message.text()); } });
    console.log('Main window loaded:', page.url());
    await page.waitForSelector('.week-board');
    console.log('Week board rendered');
    assert.equal(await page.locator('.day-column').count(), 7);
    // Create a task through the real dialog and persistence bridge.
    await page.locator('.new-task').click(); await page.locator('#task-title').fill('验证桌面浮窗同步');
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
    await page.locator('#task-scheduled').fill(today); await page.locator('#task-due').fill(today);
    await page.locator('#task-minutes').fill('45'); await page.locator('#task-locked').check();
    await page.locator('#task-form button[type=submit]').click();
    await page.locator('#task-dialog').waitFor({ state: 'hidden' });
    console.log('Task saved');
    let saved = await page.evaluate(() => window.desktop.read());
    assert.equal(saved.tasks[0].locked, true); assert.equal(saved.tasks[0].minutes, 45);
    // Open actual native frameless always-on-top window and check a task.
    const widgetEvent = app.waitForEvent('window'); await page.locator('[data-action=float]').click();
    const widget = await widgetEvent; widget.on('pageerror', e => errors.push(e.message));
    await widget.waitForSelector('.widget-check');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('浮窗')).isAlwaysOnTop()), true);
    const loadBefore = await page.locator('[data-day="'+today+'"] .day-load').innerText();
    await widget.locator('.widget-check').click();
    await widget.locator('#completion-minutes').fill('35');
    await widget.screenshot({ path: path.join(root, 'test-results', 'actual-time-widget.png') });
    await widget.locator('#completion-save').click();
    await page.waitForSelector('.task-card.done');
    await widget.locator('.widget-check').waitFor({ state: 'detached' });
    assert.match(await widget.locator('#widget-summary').innerText(), /1 \/ 1 已完成/);
    saved = await page.evaluate(() => window.desktop.read()); assert.equal(saved.tasks[0].done, true); assert.equal(saved.tasks[0].actualMinutes, 35); assert.equal(saved.tasks[0].minutes, 45);
    assert.equal(await page.locator('[data-day="'+today+'"] .day-load').innerText(), loadBefore);
    assert.match(await page.locator('.actual-duration').innerText(), /实际 35 分钟/);
    assert.match(await widget.locator('#widget-summary').innerText(), /总计 45 分钟/);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir,'tasks.json'),'utf8')).tasks[0].actualMinutes,35);
    // Late completion from another window must not overwrite an existing duration.
    await page.evaluate(id => window.desktop.completeTask(id, 99), saved.tasks[0].id);
    assert.equal((await page.evaluate(() => window.desktop.read())).tasks[0].actualMinutes, 35);
    // Restore from main window and confirm the widget receives the update.
    await page.locator('.task-card .check-btn').click();
    await widget.waitForSelector('.widget-check');
    // Main-window cancel, validation, skip, atomic undo and editing the actual duration.
    await page.locator('.task-card .check-btn').click();
    assert.equal(await page.locator('#completion-minutes').inputValue(), '35');
    await page.locator('#completion-cancel').click();
    assert.equal((await page.evaluate(() => window.desktop.read())).tasks[0].done, false);
    await page.locator('.task-card .check-btn').click();
    await page.locator('#completion-minutes').fill('0'); await page.locator('#completion-save').click();
    assert.equal(await page.locator('#completion-dialog').isVisible(), true);
    assert.equal((await page.evaluate(() => window.desktop.read())).tasks[0].done, false);
    await page.locator('#completion-skip').click(); await page.waitForSelector('.task-card.done');
    assert.equal((await page.evaluate(() => window.desktop.read())).tasks[0].actualMinutes, undefined);
    await page.locator('#undo-btn').click(); await widget.waitForSelector('.widget-check');
    assert.equal((await page.evaluate(() => window.desktop.read())).tasks[0].actualMinutes, 35);
    await page.locator('.task-card .check-btn').click(); await page.locator('#completion-minutes').fill('40');
    await page.locator('#completion-save').click(); await page.waitForSelector('.task-card.done');
    await page.locator('[data-task]').first().click(); assert.equal(await page.locator('#task-actual').inputValue(),'40');
    await page.locator('#task-actual').fill('42'); await page.locator('#task-form button[type=submit]').click();
    await page.locator('#task-dialog').waitFor({state:'hidden'});
    assert.equal((await page.evaluate(() => window.desktop.read())).tasks[0].actualMinutes,42);
    assert.equal(await page.locator('[data-day="'+today+'"] .day-load').innerText(), loadBefore);
    await page.locator('.task-card .check-btn').click(); await widget.waitForSelector('.widget-check');
    // Unscheduled task creation and undo continue working with weekly planning paused.
    await page.locator('.new-task').click(); await page.locator('#task-title').fill('测试待安排任务'); await page.locator('#task-form button[type=submit]').click();
    await page.locator('#task-dialog').waitFor({ state: 'hidden' });
    saved = await page.evaluate(() => window.desktop.read()); assert.equal(saved.tasks[1].scheduled, null);
    await page.locator('#undo-btn').click();
    await page.waitForFunction(() => document.getElementById('toast-message').textContent.includes('已撤销'));
    saved = await page.evaluate(() => window.desktop.read()); assert.equal(saved.tasks.length, 1);
    await page.locator('[data-task]').first().click(); await page.locator('#task-title').fill('已修改的任务'); await page.locator('#task-form button[type=submit]').click(); await page.locator('#task-dialog').waitFor({ state: 'hidden' });
    // Add sample fixture solely in isolated test storage and capture both interfaces.
    await page.evaluate(async () => { const module = await import('./planner.js'); const previous = await window.desktop.read(); const state = structuredClone(previous); state.tasks.push(...module.demoTasks(module.weekStart())); await window.desktop.save(state, previous); });
    await page.waitForSelector('.task-card:has-text("完成项目方案初稿")');
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.showInactive(); });
    await page.screenshot({ path: path.join(root, 'test-results', 'main.png'), fullPage: true });
    await widget.screenshot({ path: path.join(root, 'test-results', 'widget.png') });
    // DPAPI credentials are encrypted on disk and omitted from task backup.
    await page.locator('[data-action=settings]').first().click();
    assert.equal(await page.locator('#ai-model').inputValue(), 'deepseek-flash');
    await page.locator('#ai-model').selectOption('deepseek-v4-pro');
    await page.locator('#ai-key').fill('test-only-secret');
    await page.locator('#settings-dialog [data-close=settings-dialog]').scrollIntoViewIfNeeded();
    await page.locator('#settings-dialog [data-close=settings-dialog]').click();
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    const status = await page.evaluate(() => window.desktop.aiStatus()); assert.equal(status.configured, true); assert.equal(status.model, 'deepseek-v4-pro');
    const config = await fs.readFile(path.join(dir, 'ai-config.json'), 'utf8'); assert.ok(!config.includes('test-only-secret'));
    // Switching preset/custom models keeps the existing encrypted key.
    await page.locator('[data-action=settings]').first().click(); assert.equal(await page.locator('#ai-model').inputValue(), 'deepseek-v4-pro');
    assert.match(await page.locator('#ai-model-hint').innerText(), /费用高于 Flash/);
    await page.screenshot({ path: path.join(root, 'test-results', 'model-settings.png') });
    await page.locator('#ai-model').selectOption('custom'); await page.locator('#ai-model-custom').fill('future-deepseek-test');
    await page.locator('#settings-dialog [data-close=settings-dialog]').click(); await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    assert.equal((await page.evaluate(() => window.desktop.aiStatus())).configured, true);
    await page.locator('[data-action=settings]').first().click(); assert.equal(await page.locator('#ai-model').inputValue(), 'custom');
    assert.equal(await page.locator('#ai-model-custom').inputValue(), 'future-deepseek-test');
    await page.locator('#ai-model').selectOption('deepseek-flash'); assert.equal(await page.locator('#ai-model-custom-field').isVisible(), false);
    await page.locator('#settings-dialog [data-close=settings-dialog]').click(); await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.desktop.aiStatus()), { configured: true, model: 'deepseek-flash' });
    // An upgrade followed by reopening requests a graceful backend restart.
    const restartCalls = await app.evaluate(async ({ app }) => {
      const original = { version: app.getVersion, relaunch: app.relaunch, quit: app.quit };
      let relaunches = 0, quits = 0;
      app.getVersion = () => 'previous-version'; app.relaunch = () => { relaunches++; }; app.quit = () => { quits++; };
      try {
        app.emit('second-instance', {}, []);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { clearInterval(poll); reject(new Error('Restart was not requested')); }, 3000);
          const poll = setInterval(() => { if (relaunches && quits) { clearTimeout(timeout); clearInterval(poll); resolve(); } }, 10);
        });
        return { relaunches, quits };
      } finally { app.getVersion = original.version; app.relaunch = original.relaunch; app.quit = original.quit; }
    });
    assert.deepEqual(restartCalls, { relaunches: 1, quits: 1 });
    // Legacy weekly IPC rejects before making any API request or changing tasks.
    const beforeDisabled = await page.evaluate(() => window.desktop.read());
    const paused = await page.evaluate(async state => {
      try { await window.desktop.planAI(state, '2026-10-05', '2026-10-08'); return ''; }
      catch (error) { return error.message; }
    }, beforeDisabled);
    assert.match(paused, /自动规划本周暂时停用/);
    assert.deepEqual(await page.evaluate(() => window.desktop.read()), beforeDisabled);
    await page.evaluate(() => window.desktop.saveAIConfig({ key: '', model: 'deepseek-flash' }));
    // Float remains open when main closes, and can recreate the main window.
    await page.close(); assert.equal(app.windows().length, 1);
    const restoredMain = app.waitForEvent('window'); await widget.locator('#widget-open').click(); page = await restoredMain;
    await page.waitForSelector('.week-board');
    saved = await page.evaluate(() => window.desktop.read()); assert.equal(saved.tasks[0].title, '已修改的任务'); assert.equal(saved.tasks[0].actualMinutes, 42);
    assert.deepEqual(errors, []); console.log('PASS: CRUD, undo, persistence, floating window sync, main-window restore, encrypted key, paused weekly IPC, screenshots');
  } catch (error) {
    console.error('SMOKE FAILURE:', error);
    if (page && !page.isClosed()) { console.error('UI excerpt:', (await page.locator('body').innerText()).slice(-2000)); }
    throw error;
  } finally {
    const cleanup = app.close();
    const timer = setTimeout(() => { if (!app.process().killed) app.process().kill(); }, 5000);
    try { await cleanup; } finally { clearTimeout(timer); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

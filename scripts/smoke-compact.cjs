// Native transparent-window regression test, using only isolated task data.
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const runtimeRequire = process.env.PLAYWRIGHT_MODULE ? createRequire(path.join(process.env.PLAYWRIGHT_MODULE, 'package.json')) : require;
const { _electron } = runtimeRequire('playwright');
(async () => {
  const root = path.resolve(__dirname, '..'), dir = path.join(root, 'test-results', `compact-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const titles = ['修改 Related work', '整理 Method 的修改意见', '核对 Experiments 中的图表与统计结果', '修改 Conclusion', '阅读一篇相关论文', '给明天留下一份修改清单'];
  const tasks = titles.map((title, i) => ({ id: `compact-${i}`, title, priority: 'medium', minutes: 30, due: today, scheduled: today, locked: true, done: false, notes: '' }));
  tasks.push({ ...tasks[0], id: 'other-day', title: '不应出现在今天的任务', scheduled: '2030-01-01' });
  await fs.writeFile(path.join(dir, 'tasks.json'), JSON.stringify({ version: 1, tasks, settings: { capacities: [240,240,240,240,240,240,240], preferences: '' } }));
  const executablePath = process.env.WEEKWISE_EXECUTABLE || require('electron');
  const launch = () => _electron.launch({ executablePath, args: process.env.WEEKWISE_EXECUTABLE ? [] : [root], env: { ...process.env, WEEKWISE_TEST: '1', WEEKWISE_DATA_DIR: dir }, timeout: 30000 });
  let app = await launch(), page, compact;
  const errors = [];
  const watch = p => { p.setDefaultTimeout(15000); p.on('pageerror', e => errors.push(e.message)); };
  const closeApp = async () => { const timer = setTimeout(() => app.process().kill(), 5000); try { await app.close(); } finally { clearTimeout(timer); } };
  try {
    page = await app.firstWindow(); watch(page); await page.waitForSelector('.week-board');
    let created = app.waitForEvent('window'); await page.locator('[data-action=float-compact]').click(); compact = await created; watch(compact);
    await compact.waitForSelector('.compact-page .widget-task');
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.showInactive(); });
    assert.equal(await compact.locator('.widget-task').count(), 6); assert.equal(await compact.locator('.widget-task-meta').count(), 0);
    assert.equal(await compact.locator('.widget-heading').isVisible(), false); assert.equal(await compact.locator('.widget-footer').isVisible(), false);
    const native = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('浮窗'));
      const captured = await w.capturePage();
      return { cornerAlpha: captured.toBitmap()[3], resizable: w.isResizable(), pinned: w.isAlwaysOnTop(), bounds: w.getBounds(), area: screen.getDisplayMatching(w.getBounds()).workArea };
    });
    assert.equal(native.cornerAlpha, 0); assert.equal(native.resizable, false); assert.equal(native.pinned, true);
    assert.ok(native.bounds.height <= 440); assert.equal(native.bounds.x, native.area.x + 24); assert.equal(native.bounds.y, native.area.y + 96);
    assert.ok(await compact.locator('#widget-tasks').evaluate(el => el.scrollHeight > el.clientHeight));
    // Resting state has only task blocks. Hovering reveals small accessible controls.
    await compact.mouse.move(-20, -20); await compact.waitForTimeout(200);
    assert.equal(await compact.locator('.compact-controls').evaluate(el => getComputedStyle(el).opacity), '0');
    await compact.screenshot({ path: path.join(root, 'test-results', 'compact-widget.png'), omitBackground: true });
    await compact.locator('[data-toggle="compact-0"]').click();
    await compact.locator('#completion-minutes').fill('55');
    await compact.screenshot({path:path.join(root,'test-results','actual-time-compact.png'),omitBackground:true});
    await compact.locator('#completion-save').click(); await page.waitForSelector('[data-task="compact-0"].done');
    assert.equal((await page.evaluate(() => window.desktop.read())).tasks.find(t=>t.id==='compact-0').actualMinutes,55);
    await compact.locator('[data-toggle="compact-0"]').waitFor({ state: 'detached' });
    assert.equal(await compact.locator('.widget-task').count(), 5);
    const state = await page.evaluate(() => window.desktop.read()); assert.equal(state.tasks.find(t => t.id === 'compact-0').done, true); assert.equal(state.tasks.filter(t => t.done).length, 1);
    // Native move + mode switch keeps task state and restores separate bounds.
    await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('浮窗')), area = screen.getDisplayMatching(w.getBounds()).workArea;
      w.setPosition(area.x + 70, area.y + 90);
    });
    await compact.mouse.move(150, 15); await compact.waitForTimeout(200);
    const oldClosed = compact.waitForEvent('close');
    created = app.waitForEvent('window'); await compact.locator('#compact-full').click(); let full = await created; watch(full);
    await full.waitForSelector('.widget-heading'); await oldClosed;
    assert.equal(await full.locator('.widget-task.done').count(), 0); assert.equal(await full.locator('.widget-task-meta').count(), 5);
    assert.match(await full.locator('#widget-summary').innerText(), /1 \/ 6 已完成/);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('浮窗')).isResizable()), true);
    const fullPosition = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('浮窗')); return { bounds: w.getBounds(), area: screen.getDisplayMatching(w.getBounds()).workArea }; });
    assert.equal(fullPosition.bounds.x, fullPosition.area.x + 24); assert.equal(fullPosition.bounds.y, fullPosition.area.y + 96);
    created = app.waitForEvent('window'); await full.locator('#widget-mode').click(); compact = await created; watch(compact);
    await compact.waitForSelector('.compact-page .widget-task');
    const position = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('浮窗')), area = screen.getDisplayMatching(w.getBounds()).workArea; return { bounds: w.getBounds(), area }; });
    assert.equal(position.bounds.x, position.area.x + 70); assert.equal(position.bounds.y, position.area.y + 90);
    // Closing the main window leaves the compact widget usable, and it can reopen main.
    await page.close(); await compact.mouse.move(150, 15); await compact.waitForTimeout(200);
    created = app.waitForEvent('window'); await compact.locator('#compact-open').click(); page = await created; watch(page); await page.waitForSelector('.week-board');
    assert.equal(await page.locator('[data-task="compact-0"].done').count(), 1);
    await closeApp();
    const preferences = JSON.parse(await fs.readFile(path.join(dir, 'widget-settings.json'), 'utf8')); assert.equal(preferences.mode, 'compact'); assert.equal(preferences.compact.x, position.bounds.x);
    // Reopening the app remembers the selected mode without altering task data.
    app = await launch(); page = await app.firstWindow(); watch(page); await page.waitForSelector('.week-board');
    created = app.waitForEvent('window'); await page.locator('[data-action=float]').click(); compact = await created; watch(compact);
    await compact.waitForSelector('.compact-page .widget-task'); assert.equal(await compact.locator('.widget-task').count(), 5); assert.equal(await compact.locator('[data-toggle="compact-0"]').count(), 0);
    await compact.mouse.move(150, 15); await compact.waitForTimeout(200); await compact.locator('#compact-close').click();
    await page.waitForSelector('.week-board'); assert.deepEqual(errors, []);
    console.log('PASS: native transparent compact window; four-row viewport and overflow; today-only titles and checkboxes; completion sync; movable bounds; full/compact switching; main reopening; appearance and position persistence');
  } catch (error) { console.error('COMPACT SMOKE FAILURE:', error); throw error; }
  finally { await closeApp(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

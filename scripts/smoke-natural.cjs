const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const runtimeRequire = process.env.PLAYWRIGHT_MODULE ? createRequire(path.join(process.env.PLAYWRIGHT_MODULE, 'package.json')) : require;
const { _electron } = runtimeRequire('playwright');
(async () => {
  const root = path.resolve(__dirname, '..'), dir = path.join(root, 'test-results', `natural-${Date.now()}`);
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  await fs.mkdir(dir, { recursive: true });
  const old = { id: 'legacy', title: '已有的小任务', category: 'work', priority: 'medium', minutes: 30, due: null, scheduled: today, locked: false, done: false, notes: '保留旧数据' };
  await fs.writeFile(path.join(dir, 'tasks.json'), JSON.stringify({ version: 1, tasks: [old, { ...old, id: 'finished', title: '以前完成的任务', done: true }], settings: { capacities: [240,240,240,240,240,240,240], preferences: '' } }));
  const executablePath = process.env.WEEKWISE_EXECUTABLE || require('electron');
  const app = await _electron.launch({ executablePath, args: process.env.WEEKWISE_EXECUTABLE ? [] : [root], env: { ...process.env, WEEKWISE_TEST: '1', WEEKWISE_DATA_DIR: dir }, timeout: 30000 });
  let page;
  const errors = [];
  try {
    page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('.week-board');
    assert.equal(await page.locator('#category-nav').count(), 0);
    assert.equal(await page.locator('.task-card .category-tag').count(), 0);
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.showInactive(); });
    await page.locator('[data-action=settings]').first().click(); await page.locator('#ai-key').fill('fake-natural-test-key');
    await page.locator('#settings-dialog [data-close=settings-dialog]').scrollIntoViewIfNeeded(); await page.locator('#settings-dialog [data-close=settings-dialog]').click(); await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    await app.evaluate(({ net }) => {
      globalThis.naturalOriginalFetch = net.fetch; globalThis.naturalCalls = 0;
      net.fetch = async (url, options) => {
        if (url !== 'https://api.deepseek.com/chat/completions') return globalThis.naturalOriginalFetch.call(net, url, options);
        globalThis.naturalCalls++; const body = JSON.parse(options.body), input = JSON.parse(body.messages[1].content);
        if (!input.description) throw new Error('expected natural-language request');
        if (input.description.includes('Intro已经改完了')) {
          const names = ['修改 Related work 和 Method', '修改 Experiments', '修改 Conclusion'];
          const value = { summary: '今天休息，修改剩余章节', assumptions: ['耗时由模型估计，可自行修改'], questions: [], goals: [{ id: 'G1', title: '修改稿件', quantity: null, unit: '', deadline: input.days[3].date }], tasks: names.map((title, i) => ({ goalId: 'G1', title, date: input.days[i+1].date, minutes: [150,90,45][i], items: [], notes: '仅修改未完成章节' })) };
          return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
        }
        const value = { summary: '七天内每天审一篇，避免集中处理', assumptions: ['未提供不熟悉稿件数量，按每篇2小时预留'], questions: [], goals: [{ id: 'G1', title: '审ICLR稿件', quantity: 7, unit: '篇', quantityEvidence: '7篇', minutesPerUnit: 120, timeEvidence: '一个稿子大概至少1小时，不熟悉的2h', deadline: input.days[6].date, deadlineEvidence: '7天内', spread: true }], tasks: input.days.slice(0, 7).map((day, i) => ({ goalId: 'G1', title: '审ICLR稿件', date: day.date, minutes: 120, items: [i + 1], notes: '完成本日规定的稿件后打勾' })) };
        if (globalThis.naturalCalls === 1) value.tasks[0].goalId = 'G99'; // Verify malformed response repair, without local scheduling rules.
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
      };
    });
    await page.locator('[data-action=natural]').click(); await page.locator('#natural-example').click(); await page.locator('#natural-generate').click();
    await page.waitForFunction(() => !document.getElementById('natural-apply').disabled);
    assert.equal(await app.evaluate(() => globalThis.naturalCalls), 2);
    assert.equal(await page.locator('.natural-daily-task').count(), 7);
    assert.ok(await page.locator('.natural-daily-list section').first().evaluate(el => el.clientHeight > 80));
    assert.match(await page.locator('.natural-assumptions').innerText(), /每篇2小时/);
    assert.equal((await page.evaluate(() => window.desktop.read())).tasks.length, 2);
    await page.locator('.natural-daily-task').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(root, 'test-results', 'natural-preview.png') });
    // Editing keeps the previous preview available for comparison until generation.
    const previousPreview = await page.locator('#natural-preview').innerHTML();
    await page.locator('#natural-description').fill('需要审7篇ICLR稿件。不要集中一天审完，但7天内要审完。一个稿子大概至少1小时，不熟悉的2h。请均衡安排。');
    assert.equal(await page.locator('#natural-apply').isDisabled(), true);
    assert.equal(await page.locator('#natural-preview').innerHTML(), previousPreview);
    assert.equal(await page.locator('#natural-stale').isVisible(), true);
    await page.locator('#natural-start').dispatchEvent('input');
    assert.equal(await page.locator('#natural-preview').innerHTML(), previousPreview);
    await page.locator('#natural-generate').click(); await page.waitForFunction(() => !document.getElementById('natural-apply').disabled);
    assert.equal(await page.locator('#natural-stale').isVisible(), false);
    await page.locator('#natural-apply').click(); await page.locator('#natural-dialog').waitFor({ state: 'hidden' });
    let saved = await page.evaluate(() => window.desktop.read()); const children = saved.tasks.filter(t => t.origin);
    assert.equal(children.length, 7); assert.equal(saved.tasks.length, 9); assert.deepEqual(children.flatMap(t => t.origin.items), [1,2,3,4,5,6,7]);
    assert.ok(saved.tasks.every(t => !Object.hasOwn(t, 'category'))); assert.equal(saved.tasks.find(t => t.id === 'finished').done, true);
    // Floating checkbox completes only today's new child, never the whole batch.
    const widgetEvent = app.waitForEvent('window'); await page.locator('[data-action=float]').click(); const widget = await widgetEvent; widget.on('pageerror', e => errors.push(e.message));
    const current = children.find(t => t.scheduled === today);
    await widget.waitForSelector(`[data-toggle="${current.id}"]`); await widget.locator(`[data-toggle="${current.id}"]`).click(); await widget.locator('#completion-skip').click();
    await page.waitForSelector(`[data-task="${current.id}"].done`);
    saved = await page.evaluate(() => window.desktop.read()); assert.equal(saved.tasks.filter(t => t.origin && t.done).length, 1);
    await page.locator(`[data-task="${current.id}"]`).click(); await page.locator('#task-minutes').fill('90'); await page.locator('#task-form button[type=submit]').click(); await page.locator('#task-dialog').waitFor({ state: 'hidden' });
    saved = await page.evaluate(() => window.desktop.read()); assert.deepEqual(saved.tasks.find(t => t.id === current.id).origin.items, [1]); assert.equal(saved.tasks.find(t => t.id === current.id).minutes, 90);
    await page.locator('#toast-close').click();
    await page.screenshot({ path: path.join(root, 'test-results', 'natural-main.png'), fullPage: true });
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.showInactive(); });
    await widget.screenshot({ path: path.join(root, 'test-results', 'natural-widget.png') });
    // Reproduce the user's exact manuscript description through the released UI/IPC.
    await page.locator('[data-action=natural]').click();
    await page.locator('#natural-description').fill('我还需要改一篇稿子，Intro已经改完了。Related work，Method，和Experiments，Conclusion还没改。你规划一下，但我今天不想改了。这周内完成');
    await page.locator('#natural-generate').click(); await page.waitForFunction(() => !document.getElementById('natural-apply').disabled);
    assert.equal(await page.locator('.natural-daily-task').count(), 3);
    assert.match(await page.locator('.natural-daily-task').first().innerText(), /Related work.*Method/);
    await page.locator('.natural-daily-task').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(root, 'test-results', 'revision-preview.png') });
    await page.locator('#natural-apply').click(); await page.locator('#natural-dialog').waitFor({ state: 'hidden' });
    saved = await page.evaluate(() => window.desktop.read()); const revisions = saved.tasks.filter(t => t.origin?.goalTitle === '修改稿件');
    assert.equal(revisions.length, 3); assert.ok(revisions.every(t => t.scheduled > today && !t.title.includes('Intro') && !t.title.includes('篇')));
    const last = revisions.at(-1); await widget.locator('#widget-next').click();
    await widget.waitForSelector(`[data-toggle="${revisions[0].id}"]`); await widget.locator(`[data-toggle="${revisions[0].id}"]`).click(); await widget.locator('#completion-skip').click();
    await page.waitForSelector(`[data-task="${revisions[0].id}"].done`);
    saved = await page.evaluate(() => window.desktop.read()); assert.equal(saved.tasks.find(t => t.id === last.id).done, false);
    // Actual pointer drag of a generated, locked card preserves its source and lock.
    const moved = revisions[1], destination = revisions[0].scheduled;
    assert.equal(await page.locator(`[data-task="${moved.id}"]`).getAttribute('draggable'), 'true');
    await page.locator(`[data-task="${moved.id}"]`).dragTo(page.locator(`[data-day="${destination}"] .day-body`));
    await widget.waitForSelector(`[data-toggle="${moved.id}"]`);
    saved = await page.evaluate(() => window.desktop.read()); let adjusted = saved.tasks.find(t => t.id === moved.id);
    assert.equal(adjusted.scheduled, destination); assert.equal(adjusted.locked, true); assert.deepEqual(adjusted.origin, moved.origin);
    await page.locator(`[data-task="${moved.id}"]`).dragTo(page.locator('[data-drop-backlog]'));
    await page.waitForSelector(`[data-drop-backlog] [data-task="${moved.id}"]`);
    saved = await page.evaluate(() => window.desktop.read()); adjusted = saved.tasks.find(t => t.id === moved.id);
    assert.equal(adjusted.scheduled, null); assert.equal(adjusted.locked, false);
    await page.locator('#undo-btn').click(); await page.waitForSelector(`[data-day="${destination}"] [data-task="${moved.id}"]`);
    saved = await page.evaluate(() => window.desktop.read()); adjusted = saved.tasks.find(t => t.id === moved.id);
    assert.equal(adjusted.scheduled, destination); assert.equal(adjusted.locked, true);
    await app.evaluate(({ net }) => { net.fetch = globalThis.naturalOriginalFetch; });
    await page.evaluate(() => window.desktop.saveAIConfig({ key: '', model: 'deepseek-flash' }));
    assert.deepEqual(errors, []); console.log('PASS: prompt/date edits preserve the prior preview until regeneration; natural-language format repair; review and chapter task persistence; floating completion sync; locked card pointer drag and widget sync; backlog clears lock; undo restores date and lock; manual edits preserve source; screenshots');
  } catch (error) { console.error('NATURAL SMOKE FAILURE:', error); if (page && !page.isClosed()) console.error((await page.locator('body').innerText()).slice(-1500)); throw error; }
  finally { const timer = setTimeout(() => app.process().kill(), 5000); try { await app.close(); } finally { clearTimeout(timer); } }
})().catch(error => { console.error(error); process.exitCode = 1; });

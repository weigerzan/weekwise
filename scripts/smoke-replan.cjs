const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const runtimeRequire = process.env.PLAYWRIGHT_MODULE ? createRequire(path.join(process.env.PLAYWRIGHT_MODULE, 'package.json')) : require;
const { _electron } = runtimeRequire('playwright');

(async () => {
  const root = path.resolve(__dirname, '..'), dir = path.join(root, 'test-results', `replan-${Date.now()}`);
  const { dateKey, weekStart, addDays, validateState } = await import('../src/planner.js');
  const today = dateKey(); let reference = weekStart(today), sunday = addDays(reference, 6);
  if (sunday === today) { reference = addDays(reference, 7); sunday = addDays(reference, 6); }
  const monday = addDays(sunday, 1), tuesday = addDays(sunday, 2);
  const task = { priority: 'medium', minutes: 60, due: addDays(sunday, 7), scheduled: sunday, locked: true, done: false, notes: '保留任务备注' };
  const initial = { version: 1, settings: { capacities: [240,240,240,240,240,240,240], preferences: '' }, tasks: [
    { ...task, id: 'paper', title: '审稿', minutes: 120, origin: { batchId: 'test-batch', goalTitle: '审7篇ICLR稿件', items: [1], unit: '篇' } },
    { ...task, id: 'notes', title: '整理记录' },
    { ...task, id: 'meeting', title: '组会', timeSlot: { start: '15:00', end: '16:00', reminders: [] } },
    { ...task, id: 'monday', title: '修改 Method', minutes: 180, scheduled: monday },
    { ...task, id: 'done', title: '已经完成的 Intro', minutes: 30, scheduled: today, done: true },
    { ...task, id: 'interview', title: '可灵面试', due: today, scheduled: today, timeSlot: { start: '19:00', end: '20:00', reminders: [] } }
  ] };
  await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'tasks.json'), JSON.stringify(initial));
  const executablePath = process.env.WEEKWISE_EXECUTABLE || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const app = await _electron.launch({ executablePath, args: process.env.WEEKWISE_EXECUTABLE ? ['--mute-audio'] : [root,'--mute-audio'], env: { ...process.env, WEEKWISE_TEST: '1', WEEKWISE_DATA_DIR: dir }, timeout: 30000 });
  let page; const errors = [];
  try {
    page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('.week-board');
    if (reference !== weekStart(today)) await page.locator('[data-action=next-week]').click();
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.showInactive(); });
    await page.locator('[data-action=settings]').first().click(); await page.locator('#ai-key').fill('fake-replan-test-key');
    await page.locator('#settings-dialog [data-close=settings-dialog]').click(); await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    const baseline = await page.evaluate(() => window.desktop.read()); assert.deepEqual(baseline.tasks, validateState(initial).tasks); assert.deepEqual(baseline.settings.dailyRoutine,{start:'10:30',end:'21:00',breaks:[{title:'午饭',start:'12:00',end:'13:30'},{title:'晚饭',start:'18:00',end:'19:30'}]});
    await app.evaluate(({ net }, dates) => {
      globalThis.replanOriginalFetch = net.fetch; globalThis.replanCalls = 0; globalThis.replanMode = 'feasible'; globalThis.replanInputs = [];
      net.fetch = async (url, options) => {
        if (url !== 'https://api.deepseek.com/chat/completions') return globalThis.replanOriginalFetch.call(net, url, options);
        globalThis.replanCalls++; const input = JSON.parse(JSON.parse(options.body).messages[1].content); globalThis.replanInputs.push(input);
        if (!input.allowedTaskIds || !input.description) throw new Error('expected existing-plan request');
        const impossible = globalThis.replanMode === 'infeasible';
        const value = globalThis.replanMode.startsWith('timed') ? {
          feasible: true, summary: '可灵面试按要求改期改时间，其他任务不变。', assumptions: [], issues: [], suggestions: [], capacityChanges: [],
          assignments: input.tasks.map(t => ({ id: t.id, date: t.scheduled, reason: '保留原安排' })),
          timedChanges: [{ id: input.fixedTasks.find(t=>t.title==='可灵面试').id, date: dates.tomorrow, start: globalThis.replanMode === 'timed-same-day' ? '14:30' : '14:00', end: globalThis.replanMode === 'timed-same-day' ? '16:00' : '15:00', reason: '用户明确要求调整可灵面试的日期和时段' }]
        } : impossible ? {
          feasible: false, summary: '固定组会已经超出周日半小时的总时长上限', assumptions: [], issues: ['周日固定组会占用1小时，不能在保持组会原位的同时把总时长限制为半小时'], suggestions: ['将周日上限放宽至至少1小时，再把普通任务后移；若截止日期限制顺延，可以延长截止日期或增加后续日期的每日时长'], capacityChanges: [], assignments: []
        } : {
          feasible: true, summary: '周日保留组会和记录，审稿延到周一，修改 Method 延到周二。', assumptions: ['周日指当前看板这一周；总时长包含固定组会'], issues: [], suggestions: [],
          capacityChanges: [{ date: dates.sunday, minutes: 120, reason: '按要求仅这一周的周日限定2小时' }],
          assignments: input.tasks.map(t => ({ id: t.id, date: t.title === '审稿' ? dates.monday : t.title === '修改 Method' ? dates.tuesday : t.scheduled, reason: t.title === '审稿' ? '腾出周日时间，顺延至周一' : t.title === '修改 Method' ? '为周一审稿腾出时间' : '保留原安排' }))
        };
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
      };
    }, { sunday, monday, tuesday, tomorrow: addDays(today,1) });
    const widgetEvent = app.waitForEvent('window'); await page.locator('[data-action=float]').click(); const widget = await widgetEvent;
    widget.on('pageerror', e => errors.push(e.message)); await widget.waitForSelector('#widget-next');
    for (let d = today; d < sunday; d = addDays(d, 1)) await widget.locator('#widget-next').click();
    await widget.waitForSelector('[data-toggle=paper]');
    await page.locator('[data-action=replan]').click(); await page.locator('#replan-example').click();
    await page.locator('#replan-generate').click(); await page.waitForFunction(() => !document.getElementById('replan-apply').disabled);
    assert.equal(await page.locator('.replan-change').count(), 2);
    assert.match(await page.locator('.replan-capacities').innerText(), /4 小时.*2 小时/s);
    assert.match(await page.locator('.replan-day-loads').innerText(), /定时与已完成 1 小时/);
    const inputs = await app.evaluate(() => globalThis.replanInputs);
    assert.equal(inputs[0].referenceWeekStart, reference); assert.equal(inputs[0].fixedTasks[0].title, '组会');
    assert.ok(inputs[0].tasks.some(t => t.title === '审稿')); assert.ok(!inputs[0].tasks.some(t => t.title.includes('Intro')));
    assert.deepEqual(await page.evaluate(() => window.desktop.read()), baseline);
    await page.locator('.replan-result').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(root, 'test-results', 'replan-preview.png') });
    const priorPreview = await page.locator('#replan-preview').innerHTML();
    await page.locator('#replan-description').fill('周天我想把总工作时长压缩到2h，其它任务往后排，定时任务不能动。优先安排审稿。');
    assert.equal(await page.locator('#replan-apply').isDisabled(), true);
    assert.equal(await page.locator('#replan-preview').innerHTML(), priorPreview); assert.equal(await page.locator('#replan-stale').isVisible(), true);
    await page.locator('#replan-through').dispatchEvent('input'); assert.equal(await page.locator('#replan-preview').innerHTML(), priorPreview);
    await page.locator('#replan-generate').click(); await page.waitForFunction(() => !document.getElementById('replan-apply').disabled);
    await page.locator('#replan-apply').click(); await page.locator('#replan-dialog').waitFor({ state: 'hidden' });
    let saved = await page.evaluate(() => window.desktop.read());
    assert.equal(saved.tasks.find(t => t.id === 'paper').scheduled, monday); assert.equal(saved.tasks.find(t => t.id === 'monday').scheduled, tuesday);
    for (const original of baseline.tasks) assert.deepEqual({ ...saved.tasks.find(t => t.id === original.id), scheduled: original.scheduled }, original);
    assert.equal(saved.settings.dateCapacities[sunday], 120); assert.equal(saved.settings.capacities[6], 240);
    assert.match(await page.locator(`[data-day="${sunday}"] .day-load`).innerText(), /2 \/ 2 h/);
    await widget.locator('[data-toggle=paper]').waitFor({ state: 'detached' }); assert.equal(await widget.locator('[data-toggle=meeting]').count(), 1);
    await page.locator('#undo-btn').click(); await widget.waitForSelector('[data-toggle=paper]');
    assert.deepEqual(await page.evaluate(() => window.desktop.read()), baseline);
    // A widget edit after preview must survive: stale AI output cannot overwrite it.
    await page.locator('[data-action=replan]').click(); await page.locator('#replan-generate').click();
    await page.waitForFunction(() => !document.getElementById('replan-apply').disabled);
    await widget.locator('[data-toggle=notes]').click(); await widget.locator('#completion-skip').click(); await page.waitForSelector('[data-task=notes].done');
    await page.locator('#replan-apply').click(); assert.equal(await page.locator('#replan-apply').isDisabled(), true);
    saved = await page.evaluate(() => window.desktop.read()); assert.equal(saved.tasks.find(t => t.id === 'notes').done, true);
    assert.equal(saved.tasks.find(t => t.id === 'paper').scheduled, sunday); assert.equal(saved.settings.dateCapacities, undefined);
    await page.locator('[data-close=replan-dialog]').first().click();
    // Explicitly reschedule an interview through the real UI and IPC, then undo it.
    const beforeTimed = await page.evaluate(() => window.desktop.read()), tomorrow = addDays(today,1);
    await app.evaluate(() => { globalThis.replanMode = 'timed'; });
    await page.locator('[data-action=replan]').click(); await page.locator('#replan-description').fill('可灵面试调整到明天下午2-3');
    await page.locator('#replan-generate').click(); await page.waitForFunction(() => !document.getElementById('replan-apply').disabled);
    assert.equal(await page.locator('.replan-change').count(),1);
    const timePreview = await page.locator('.replan-change').innerText();
    assert.ok(timePreview.includes(today+' 19:00–20:00')); assert.ok(timePreview.includes(tomorrow+' 14:00–15:00'));
    assert.deepEqual(await page.evaluate(() => window.desktop.read()),beforeTimed);
    await page.screenshot({path:path.join(root,'test-results','replan-timed-preview.png')});
    await page.locator('#replan-apply').click(); await page.locator('#replan-dialog').waitFor({state:'hidden'});
    saved = await page.evaluate(() => window.desktop.read());
    let interview = saved.tasks.find(t=>t.id==='interview');
    assert.equal(interview.scheduled,tomorrow); assert.equal(interview.due,tomorrow); assert.equal(interview.timeSlot.start,'14:00'); assert.equal(interview.timeSlot.end,'15:00');
    assert.deepEqual(saved.tasks.find(t=>t.id==='meeting'),beforeTimed.tasks.find(t=>t.id==='meeting'));
    // Navigate the full widget to the new event date and verify the updated time.
    await widget.locator('#widget-today').click(); await widget.locator('#widget-next').click();
    await widget.waitForSelector('[data-toggle=interview]'); assert.match(await widget.locator('.widget-task:has([data-toggle=interview])').innerText(),/14:00–15:00/);
    // A change to the time alone must still enable Apply and update the day total.
    await app.evaluate(() => { globalThis.replanMode='timed-same-day'; });
    await page.locator('[data-action=replan]').click(); await page.locator('#replan-description').fill('可灵面试改成下午2点半到4点，日期不变');
    await page.locator('#replan-generate').click(); await page.waitForFunction(() => !document.getElementById('replan-apply').disabled);
    assert.match(await page.locator('.replan-change').innerText(),/14:00–15:00.*14:30–16:00/s);
    await page.locator('#replan-apply').click(); await page.locator('#replan-dialog').waitFor({state:'hidden'});
    assert.equal((await page.evaluate(() => window.desktop.read())).tasks.find(t=>t.id==='interview').minutes,90);
    assert.match(await page.locator('[data-day="'+tomorrow+'"] .day-load').innerText(),/1.5 \/ 4 h/);
    await page.locator('#undo-btn').click(); await page.waitForFunction(() => document.getElementById('toast-message').textContent.includes('已撤销'));
    assert.equal((await page.evaluate(() => window.desktop.read())).tasks.find(t=>t.id==='interview').timeSlot.start,'14:00');
    await page.evaluate(async previous => { const current=await window.desktop.read(); await window.desktop.save(previous,current); }, beforeTimed);
    await widget.locator('#widget-prev').click(); await widget.waitForSelector('[data-toggle=interview]');
    assert.match(await widget.locator('.widget-task:has([data-toggle=interview])').innerText(),/19:00–20:00/);
    // Infeasible response is displayed without allowing partial changes.
    await app.evaluate(() => { globalThis.replanMode = 'infeasible'; });
    const beforeImpossible = await page.evaluate(() => window.desktop.read());
    await page.locator('[data-action=replan]').click(); await page.locator('#replan-description').fill('周日只想工作半小时，固定组会不能动，其它任务后移；截止日期也不能变。');
    await page.locator('#replan-generate').click(); await page.waitForSelector('.natural-questions');
    assert.match(await page.locator('#replan-preview').innerText(), /放宽这些条件/);
    assert.match(await page.locator('#replan-preview').innerText(), /至少1小时.*延长截止日期.*增加后续日期的每日时长/s);
    assert.equal(await page.locator('#replan-apply').isDisabled(), true); assert.deepEqual(await page.evaluate(() => window.desktop.read()), beforeImpossible);
    await page.screenshot({ path: path.join(root, 'test-results', 'replan-infeasible.png') });
    await page.locator('[data-close=replan-dialog]').first().click(); await page.locator('#toast-close').click();
    await page.screenshot({ path: path.join(root, 'test-results', 'replan-main.png'), fullPage: true });
    // Reproduce an old running backend: the UI must explain restart, not prompt edits.
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('ai:replan'); });
    await page.locator('[data-action=replan]').click(); await page.locator('#replan-generate').click();
    await page.waitForSelector('#replan-preview .inline-warning');
    const unavailable = await page.locator('#replan-preview').innerText();
    assert.match(unavailable, /系统托盘退出拾周/); assert.ok(!unavailable.includes('修改要求后重试')); assert.ok(!unavailable.includes('No handler'));
    assert.equal(await page.locator('#replan-apply').isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.desktop.read()), beforeImpossible);
    await page.locator('[data-close=replan-dialog]').first().click();
    await app.evaluate(({ net }) => { net.fetch = globalThis.replanOriginalFetch; });
    await page.evaluate(() => window.desktop.saveAIConfig({ key: '', model: 'deepseek-flash' }));
    assert.deepEqual(errors, []);
    console.log('PASS: existing-plan request; locked ordinary cross-week moves; timed/completed identity preserved; one-date capacity; preview-only state; edits preserve preview; apply/widget sync; undo; stale preview protection; infeasible feedback without changes; screenshots');
  } catch (error) { console.error('REPLAN SMOKE FAILURE:', error); if (page && !page.isClosed()) console.error((await page.locator('body').innerText()).slice(-2000)); throw error; }
  finally { const timer = setTimeout(() => app.process().kill(), 5000); try { await app.close(); } finally { clearTimeout(timer); } }
})().catch(error => { console.error(error); process.exitCode = 1; });

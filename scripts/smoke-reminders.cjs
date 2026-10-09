const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const runtimeRequire = process.env.PLAYWRIGHT_MODULE ? createRequire(path.join(process.env.PLAYWRIGHT_MODULE, 'package.json')) : require;
const { _electron } = runtimeRequire('playwright');
(async () => {
  const root = path.resolve(__dirname, '..'), dir = path.join(root, 'test-results', `alarms-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const d = new Date(); d.setDate(d.getDate()+1);
  const date = value => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  const tomorrow = date(d); d.setDate(d.getDate()+1); const later = date(d);
  const executablePath = process.env.WEEKWISE_EXECUTABLE || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const app = await _electron.launch({ executablePath, args: process.env.WEEKWISE_EXECUTABLE ? ['--mute-audio'] : [root, '--mute-audio'], env: { ...process.env, WEEKWISE_TEST: '1', WEEKWISE_DATA_DIR: dir }, timeout: 30000 });
  let page, alarm; const errors = [];
  const watch = p => { p.setDefaultTimeout(15000); p.on('pageerror', e => errors.push(e.message)); };
  try {
    await app.context().addInitScript(() => {
      const Original = window.AudioContext; window.alarmTonesStarted = 0;
      window.AudioContext = class extends Original {
        constructor(...args) { super(...args); window.alarmAudio = this; }
        createOscillator() { const tone = super.createOscillator(), start = tone.start.bind(tone); tone.start = (...args) => { window.alarmTonesStarted++; return start(...args); }; return tone; }
      };
    });
    page = await app.firstWindow(); watch(page); await page.waitForSelector('.week-board');
    await page.locator('.new-task').click(); await page.locator('#task-title').fill('组会提醒验证');
    await page.locator('#task-scheduled').fill(tomorrow); await page.locator('#task-timed').check();
    await page.locator('#task-start-time').fill('19:15'); await page.locator('#task-end-time').fill('20:45');
    assert.equal(await page.locator('#task-minutes').inputValue(), '90'); assert.equal(await page.locator('[name=task-reminder]:checked').count(), 3);
    await page.locator('#task-test-reminder').scrollIntoViewIfNeeded();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.showInactive()));
    await page.screenshot({ path: path.join(root, 'test-results', 'timed-task-form.png') });
    let created = app.waitForEvent('window'); await page.locator('#task-test-reminder').click(); alarm = await created; watch(alarm);
    await alarm.waitForSelector('.alarm-item'); assert.match(await alarm.locator('.alarm-countdown').innerText(), /提醒测试/);
    assert.equal(await alarm.locator('.alarm-time').innerText(),`${tomorrow} · 19:15–20:45`);
    let testAlerts=await alarm.evaluate(()=>window.desktop.readAlarm());assert.equal(testAlerts[0].startsAt,new Date(`${tomorrow}T19:15:00`).getTime());
    assert.equal((await page.evaluate(()=>window.desktop.read())).tasks.length,0);
    await alarm.waitForFunction(() => window.alarmTonesStarted >= 3 && window.alarmAudio.state === 'running');
    let closed=alarm.waitForEvent('close');await alarm.locator('#alarm-dismiss').click();await closed;
    await page.locator('#task-scheduled').fill('');await page.locator('#task-test-reminder').click();
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.getTitle().includes('任务提醒')).length),0);
    await page.locator('#task-scheduled').fill(later);await page.locator('#task-start-time').fill('08:30');await page.locator('#task-end-time').fill('09:45');
    created=app.waitForEvent('window');await page.locator('#task-test-reminder').click();alarm=await created;watch(alarm);await alarm.waitForSelector('.alarm-item');
    assert.equal(await alarm.locator('.alarm-time').innerText(),`${later} · 08:30–09:45`);
    testAlerts=await alarm.evaluate(()=>window.desktop.readAlarm());assert.equal(testAlerts[0].startsAt,new Date(`${later}T08:30:00`).getTime());
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.showInactive()));await alarm.screenshot({path:path.join(root,'test-results','alarm-test-popup.png')});
    closed=alarm.waitForEvent('close');await alarm.locator('#alarm-dismiss').click();await closed;
    await page.locator('#task-scheduled').fill(tomorrow);await page.locator('#task-start-time').fill('15:00');await page.locator('#task-end-time').fill('17:00');
    await page.locator('#task-form button[type=submit]').click(); await page.locator('#task-dialog').waitFor({ state: 'hidden' });
    let saved = await page.evaluate(() => window.desktop.read()); const meeting = saved.tasks[0];
    assert.deepEqual(meeting.timeSlot, { start: '15:00', end: '17:00', reminders: [720,120,30] }); assert.equal(meeting.locked, true);
    await page.locator('[data-section=statistics]').click(); await page.locator('[data-view=all]').click(); assert.match(await page.locator(`[data-task="${meeting.id}"]`).innerText(), /15:00–17:00/);
    // Advance the main-process clock only; no waits of hours and no real notifications.
    const advance = async time => {
      const next = new Date(`${tomorrow}T${time}:00`).getTime();
      await app.evaluate(({ powerMonitor }, next) => { globalThis.originalAlarmNow ??= Date.now; Date.now = () => next; powerMonitor.emit('resume'); }, next);
    };
    created = app.waitForEvent('window'); await advance('03:00'); alarm = await created; watch(alarm); await alarm.waitForSelector('.alarm-item');
    assert.match(await alarm.locator('.alarm-item').innerText(), /组会提醒验证/); await alarm.waitForFunction(() => window.alarmTonesStarted >= 3);
    await alarm.locator('#alarm-dismiss').click();
    // Closing all UI keeps the actual native application alive for upcoming reminders.
    await page.close(); assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
    created = app.waitForEvent('window'); await advance('13:00'); alarm = await created; watch(alarm); await alarm.waitForSelector('.alarm-item');
    assert.match(await alarm.locator('.alarm-time').innerText(), /15:00–17:00/); await alarm.locator('#alarm-dismiss').click();
    created = app.waitForEvent('window'); await advance('14:30'); alarm = await created; watch(alarm); await alarm.waitForSelector('.alarm-item');
    await alarm.evaluate(next => { Date.now = () => next; }, new Date(`${tomorrow}T14:30:00`).getTime());
    const sameAlerts = await alarm.evaluate(() => window.desktop.readAlarm());
    await app.evaluate(({ BrowserWindow }, alerts) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('任务提醒')).webContents.send('alarm:changed', alerts), sameAlerts);
    await alarm.waitForFunction(() => document.querySelector('.alarm-countdown').textContent.includes('30 分钟'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.showInactive()));
    await alarm.screenshot({ path: path.join(root, 'test-results', 'alarm-popup.png') });
    created = app.waitForEvent('window'); await alarm.locator('#alarm-open').click(); page = await created; watch(page); await page.waitForSelector('.week-board');
    const ledger = JSON.parse(await fs.readFile(path.join(dir, 'reminders-fired.json'), 'utf8')); assert.equal(Object.keys(ledger.fired).length, 3);
    await advance('14:31'); assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.getTitle().includes('任务提醒')).length), 0);
    // Editing keeps the clock settings, then completion cancels future delivery.
    await page.locator('[data-section=statistics]').click(); await page.locator('[data-view=all]').click(); await page.locator(`[data-task="${meeting.id}"]`).click(); await page.locator('#task-title').fill('已调整的组会');
    assert.equal(await page.locator('#task-start-time').inputValue(), '15:00'); await page.locator('#task-form button[type=submit]').click(); await page.locator('#task-dialog').waitFor({ state: 'hidden' });
    await page.locator(`[data-toggle="${meeting.id}"]`).click(); await page.locator('#completion-skip').click(); await page.locator(`[data-task="${meeting.id}"]`).waitFor({ state: 'detached' }); saved = await page.evaluate(() => window.desktop.read()); assert.equal(saved.tasks[0].done, true);
    // A mocked DeepSeek response adds two separate timed events via actual UI + IPC.
    await page.locator('[data-action=settings]').first().click(); await page.locator('#ai-key').fill('fake-alarm-test-key'); await page.locator('#settings-dialog [data-close=settings-dialog]').scrollIntoViewIfNeeded(); await page.locator('#settings-dialog [data-close=settings-dialog]').click(); await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    await app.evaluate(({ net }, later) => {
      globalThis.alarmOriginalFetch = net.fetch;
      net.fetch = async (url, options) => {
        if (url !== 'https://api.deepseek.com/chat/completions') return globalThis.alarmOriginalFetch.call(net, url, options);
        const input = JSON.parse(JSON.parse(options.body).messages[1].content); if (!input.description.includes('面试')) throw new Error('unexpected prompt');
        const value = { summary: '两场定时事件，三次提前提醒', assumptions: ['半天按12小时'], questions: [], goals: [{ id: 'G1', title: '两场日程', quantity: null, unit: '', deadline: later }], tasks: [{ goalId: 'G1', title: '组会', date: later, minutes: 120, items: [], notes: '', timeSlot: { start: '15:00', end: '17:00', reminders: [720,120,30] } }, { goalId: 'G1', title: '面试', date: later, minutes: 60, items: [], notes: '', timeSlot: { start: '19:00', end: '20:00', reminders: [720,120,30] } }] };
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
      };
    }, later);
    await page.locator('[data-section=plan]').click();await page.locator('[data-action=natural]').click(); await page.locator('#natural-description').fill('后天下午3-5是组会，晚上7-8是面试，提前半天、2h和半小时分别提醒一下。'); await page.locator('#natural-generate').click(); await page.waitForFunction(() => !document.getElementById('natural-apply').disabled);
    assert.equal(await page.locator('.natural-daily-task').count(), 2); assert.match(await page.locator('.natural-daily-task').first().innerText(), /15:00–17:00.*提醒/);
    await page.locator('#natural-apply').click(); await page.locator('#natural-dialog').waitFor({ state: 'hidden' });
    saved = await page.evaluate(() => window.desktop.read()); assert.equal(saved.tasks.filter(t => t.timeSlot).length, 3); assert.equal(saved.tasks.find(t => t.title === '面试').timeSlot.start, '19:00');
    await app.evaluate(({ net }) => { net.fetch = globalThis.alarmOriginalFetch; Date.now = globalThis.originalAlarmNow; }); await page.evaluate(() => window.desktop.saveAIConfig({ key: '', model: 'deepseek-flash' }));
    assert.deepEqual(errors, []);
    console.log('PASS: manual time range and three reminder presets; test sound WebAudio pipeline; 12h/2h/30m actual alarm windows; closed-window background operation; duplicate prevention; edit/completion; natural-language timed events; screenshots');
  } catch (error) { console.error('REMINDER SMOKE FAILURE:', error); if (page && !page.isClosed()) console.error((await page.locator('body').innerText()).slice(-1500)); throw error; }
  finally { const timer = setTimeout(() => app.process().kill(), 5000); try { await app.close(); } finally { clearTimeout(timer); } }
})().catch(error => { console.error(error); process.exitCode = 1; });

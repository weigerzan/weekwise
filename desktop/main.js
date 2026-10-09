import { app, BrowserWindow, ipcMain, dialog, protocol, net, session, screen, safeStorage, Tray, Menu, nativeImage, powerMonitor } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createStore } from './store.js';
import { validateState, dateKey } from '../src/planner.js';
import { requestNaturalPlan } from './natural.js';
import { requestReplan } from './replan.js';
import { requestDayPlan } from './day-plan.js';
import { createReminderScheduler, hasUpcomingReminders, reminderKey, testReminderAlert } from './reminders.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
protocol.registerSchemesAsPrivileged([{ scheme: 'weekwise', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('拾周');
app.setPath('userData', process.env.WEEKWISE_DATA_DIR ? path.resolve(process.env.WEEKWISE_DATA_DIR) : path.join(app.getPath('appData'), 'Weekwise'));
const singleton = app.requestSingleInstanceLock();
let win, widget, reopenMain, restarting = false;
if (!singleton) app.quit();
else {
  app.on('second-instance', async () => {
    if (restarting) return;
    try {
      const installed = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
      if (installed.version && installed.version !== app.getVersion()) {
        restarting = true; app.relaunch(); app.quit(); return;
      }
    } catch (error) { console.warn('版本检查未完成，继续打开主界面', error.message); }
    if (reopenMain) reopenMain(); else if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
  app.whenReady().then(async () => {
  const store = createStore(app.getPath('userData'));
  let reminderState = null, reminderEnabled = false, reminderError = null, reminderTimer, tray, alarmWindow, alarmAlerts = [], quitting = false;
  const scheduler = createReminderScheduler({ directory: app.getPath('userData'), getState: () => reminderState, onDue: showAlarm, now: () => Date.now() });
  const configFile = path.join(app.getPath('userData'), 'ai-config.json');
  const widgetFile = path.join(app.getPath('userData'), 'widget-settings.json');
  let widgetSettings = { mode: 'full', full: null, compact: null, placementVersion: 1 }, widgetWrite = Promise.resolve(), widgetSaveTimer;
  try {
    const saved = JSON.parse(await readFile(widgetFile, 'utf8'));
    if (saved.mode === 'full' || saved.mode === 'compact') widgetSettings.mode = saved.mode;
    for (const mode of ['full', 'compact']) {
      const bounds = saved[mode];
      if (bounds && ['x', 'y', 'width', 'height'].every(k => Number.isInteger(bounds[k]))) {
        const area = screen.getDisplayMatching(bounds).workArea;
        const previousDefaultY = mode === 'compact' ? area.y + area.height - bounds.height - 24 : area.y + 60;
        const previousDefault = saved.placementVersion !== 1 && bounds.x === area.x + area.width - bounds.width - 24 && bounds.y === previousDefaultY;
        widgetSettings[mode] = previousDefault ? { ...bounds, x: area.x + 24, y: area.y + 96 } : bounds;
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') console.warn('浮窗偏好未读取，使用默认外观'); }
  function saveWidgetSettings() {
    const contents = JSON.stringify(widgetSettings);
    widgetWrite = widgetWrite.catch(() => {}).then(async () => {
      await mkdir(app.getPath('userData'), { recursive: true });
      await writeFile(`${widgetFile}.tmp`, contents, 'utf8'); await rename(`${widgetFile}.tmp`, widgetFile);
    });
    widgetWrite.catch(error => console.warn('浮窗偏好保存失败', error.message));
  }
  async function readConfig() {
    try { return JSON.parse(await readFile(configFile, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return { model: 'deepseek-flash', encryptedKey: null }; throw new Error('AI 配置无法读取，请检查本机配置文件。'); }
  }
  function broadcast(state) {
    reminderState = state;
    alarmAlerts = alarmAlerts.flatMap(a => {
      if (a.test) return [a];
      const task = state.tasks.find(t => t.id === a.taskId && !t.done && t.timeSlot?.reminders.includes(a.lead) && reminderKey(t, a.lead) === a.key);
      return task ? [{ ...a, title: task.title, end: task.timeSlot.end }] : [];
    });
    if (alarmWindow) { if (alarmAlerts.length) alarmWindow.webContents.send('alarm:changed', alarmAlerts); else alarmWindow.close(); }
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('tasks:changed', state);
    tickReminders();
  }
  function tickReminders() { if (reminderEnabled && !quitting) scheduler.tick().catch(error => console.error('提醒记录未保存，将重试', error.message)); }
  protocol.handle('weekwise', request => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const filename = path.resolve(root, 'src', relative);
    if (!filename.startsWith(path.join(root, 'src') + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filename).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  function trusted(event) { if (!event.senderFrame?.url.startsWith('weekwise://app/')) throw new Error('非法调用来源'); }
  ipcMain.handle('tasks:read', event => { trusted(event); return store.read(); });
  ipcMain.handle('tasks:save', async (event, value, previous) => { trusted(event); await store.write(value, previous); broadcast(validateState(value)); return true; });
  ipcMain.handle('tasks:toggle', async (event, id) => {
    trusted(event);
    const state = await store.update(state => { const task = state.tasks.find(t => t.id === id); if (!task) throw new Error('任务已经被删除。'); task.done = !task.done; if (task.done) task.completedOn = dateKey(); return state; });
    broadcast(state); return state;
  });
  ipcMain.handle('tasks:complete', async (event, id, actualMinutes) => {
    trusted(event);
    if (actualMinutes !== null && (!Number.isInteger(actualMinutes) || actualMinutes < 1 || actualMinutes > 10080)) throw new Error('实际耗时必须为 1–10080 分钟的整数。');
    const state = await store.update(state => {
      const task = state.tasks.find(t => t.id === id);
      if (!task) throw new Error('任务已经被删除。');
      // A delayed prompt must never undo or overwrite another window's completion.
      if (task.done) return state;
      task.done = true;
      task.completedOn = dateKey();
      if (actualMinutes === null) delete task.actualMinutes; else task.actualMinutes = actualMinutes;
      return state;
    });
    broadcast(state); return state;
  });
  ipcMain.handle('ai:status', async event => { trusted(event); const c = await readConfig(); return { configured: Boolean(c.encryptedKey), model: c.model }; });
  ipcMain.handle('ai:config', async (event, value) => {
    trusted(event);
    if (!value || typeof value.model !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(value.model)) throw new Error('模型名称不正确。');
    if (value.key !== null && (typeof value.key !== 'string' || value.key.length > 300 || /\s/.test(value.key))) throw new Error('API 密钥格式不正确。');
    const config = await readConfig(); config.model = value.model;
    if (value.key !== null) {
      if (value.key && !safeStorage.isEncryptionAvailable()) throw new Error('Windows 密钥加密暂不可用，请稍后重试。');
      config.encryptedKey = value.key ? safeStorage.encryptString(value.key).toString('base64') : null;
    }
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(`${configFile}.tmp`, JSON.stringify(config), 'utf8'); await rename(`${configFile}.tmp`, configFile);
    return { configured: Boolean(config.encryptedKey), model: config.model };
  });
  let activePlan = null;
  async function runPlanning(event, value, request) {
    trusted(event); if (activePlan) throw new Error('已有规划请求正在进行，请稍候。');
    const state = validateState(value), config = await readConfig();
    if (!config.encryptedKey) throw new Error('请先在设置中填写 DeepSeek API 密钥。');
    const controller = new AbortController(); activePlan = controller;
    try {
      let key; try { key = safeStorage.decryptString(Buffer.from(config.encryptedKey, 'base64')); } catch { throw new Error('密钥无法解密，请重新填写。'); }
      return await request({ key, model: config.model, state, signal: controller.signal, fetcher: (url, options) => net.fetch(url, options) });
    } finally { if (activePlan === controller) activePlan = null; }
  }
  // Keep the legacy channel recognizable while weekly automatic planning is paused.
  ipcMain.handle('ai:plan', event => { trusted(event); throw new Error('自动规划本周暂时停用，请使用自然语言规划或自然语言调整。'); });
  ipcMain.handle('ai:natural', (event, value, description, startDate, today) => runPlanning(event, value, options => requestNaturalPlan({ ...options, description, startDate, today })));
  ipcMain.handle('ai:replan', (event, value, description, referenceWeekStart, throughDate, today) => runPlanning(event, value, options => requestReplan({ ...options, description, referenceWeekStart, throughDate, today })));
  ipcMain.handle('ai:day', (event, value, description, date, today, currentTime) => runPlanning(event, value, options => requestDayPlan({ ...options, description, date, today, currentTime })));
  ipcMain.handle('ai:cancel', event => { trusted(event); activePlan?.abort(); });
  ipcMain.handle('backup:export', async (event, value) => {
    trusted(event); const state = validateState(value);
    const result = await dialog.showSaveDialog(win, { title: '导出任务备份', defaultPath: `拾周备份-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON 备份', extensions: ['json'] }] });
    if (result.canceled) return false;
    await writeFile(result.filePath, JSON.stringify(state, null, 2), 'utf8'); return true;
  });
  ipcMain.handle('backup:import', async event => {
    trusted(event);
    const result = await dialog.showOpenDialog(win, { title: '选择任务备份', properties: ['openFile'], filters: [{ name: 'JSON 备份', extensions: ['json'] }] });
    if (result.canceled) return null;
    const text = await readFile(result.filePaths[0], 'utf8');
    if (text.length > 8_000_000) throw new Error('备份文件过大。');
    return validateState(JSON.parse(text));
  });
  function createWindow() {
    win = new BrowserWindow({ width: 1480, height: 940, minWidth: 960, minHeight: 680, show: process.env.WEEKWISE_TEST !== '1', title: '拾周 · 桌面任务助手', backgroundColor: '#f7f8fc', autoHideMenuBar: true, webPreferences: { preload: path.join(root, 'desktop', 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.loadURL('weekwise://app/index.html');
    win.on('closed', () => { win = null; });
  }
  function showMain() { if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }
  reopenMain = showMain;
  function showAlarm(alerts) {
    if (quitting) return;
    alarmAlerts.push(...alerts);
    if (alarmWindow) { alarmWindow.webContents.send('alarm:changed', alarmAlerts); if (process.env.WEEKWISE_TEST !== '1') { alarmWindow.show(); alarmWindow.focus(); } return; }
    const area = screen.getPrimaryDisplay().workArea;
    alarmWindow = new BrowserWindow({ width: 410, height: 320, x: area.x + area.width - 434, y: area.y + area.height - 344, frame: false, resizable: false, alwaysOnTop: true, show: false, title: '拾周 · 任务提醒', backgroundColor: '#fcfaff', webPreferences: { preload: path.join(root, 'desktop', 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' } });
    alarmWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    alarmWindow.webContents.on('will-navigate', event => event.preventDefault());
    alarmWindow.once('ready-to-show', () => { if (process.env.WEEKWISE_TEST !== '1') { alarmWindow.show(); alarmWindow.focus(); } });
    alarmWindow.on('closed', () => { alarmWindow = null; alarmAlerts = []; });
    alarmWindow.loadURL('weekwise://app/alarm.html');
  }
  ipcMain.handle('alarm:read', event => { trusted(event); if (event.sender !== alarmWindow?.webContents) throw new Error('提醒窗口不正确'); return alarmAlerts; });
  ipcMain.handle('alarm:dismiss', event => { trusted(event); if (event.sender === alarmWindow?.webContents) alarmWindow.close(); });
  ipcMain.handle('reminders:status', event => { trusted(event); return { enabled: reminderEnabled, error: reminderError }; });
  ipcMain.handle('reminders:test', (event, value) => {
    trusted(event); showAlarm([testReminderAlert(value)]); return true;
  });
  function openWidget(mode = widgetSettings.mode) {
    if (mode !== 'full' && mode !== 'compact') throw new Error('浮窗外观不正确');
    if (widget && widgetSettings.mode === mode) { widget.show(); widget.focus(); return; }
    const old = widget, compact = mode === 'compact';
    if (old) widgetSettings[widgetSettings.mode] = old.getBounds();
    const saved = widgetSettings[mode];
    const area = saved ? screen.getDisplayMatching(saved).workArea : screen.getPrimaryDisplay().workArea;
    const width = compact ? 310 : Math.min(area.width, Math.max(290, saved?.width || 350));
    const height = compact ? Math.min(area.height, Math.max(96, Math.min(440, saved?.height || 280))) : Math.min(area.height, Math.max(260, saved?.height || 520));
    const x = Math.max(area.x, Math.min(area.x + area.width - width, saved?.x ?? area.x + 24));
    const y = Math.max(area.y, Math.min(area.y + area.height - height, saved?.y ?? area.y + 96));
    const pinned = old ? old.isAlwaysOnTop() : true;
    const next = new BrowserWindow({ width, height, x, y, minWidth: compact ? 310 : 290, minHeight: compact ? 96 : 260, resizable: !compact, transparent: compact, hasShadow: !compact, show: false, frame: false, alwaysOnTop: pinned, skipTaskbar: compact, title: '拾周 · 桌面浮窗', backgroundColor: compact ? '#00000000' : '#fbfaff', webPreferences: { preload: path.join(root, 'desktop', 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    widget = next; widgetSettings.mode = mode; saveWidgetSettings();
    next.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    next.webContents.on('will-navigate', event => event.preventDefault());
    next.once('ready-to-show', () => {
      if (process.env.WEEKWISE_TEST !== '1' || old?.isVisible()) next.showInactive();
      if (old && !old.isDestroyed()) old.close();
    });
    next.loadURL(`weekwise://app/widget.html?mode=${mode}&pinned=${pinned}`);
    const rememberBounds = () => {
      if (next.isDestroyed()) return;
      widgetSettings[mode] = next.getBounds(); clearTimeout(widgetSaveTimer);
      widgetSaveTimer = setTimeout(saveWidgetSettings, 200);
    };
    next.on('moved', rememberBounds); next.on('resized', rememberBounds);
    next.on('close', () => { widgetSettings[mode] = next.getBounds(); clearTimeout(widgetSaveTimer); saveWidgetSettings(); });
    next.on('closed', () => { if (widget === next) widget = null; });
  }
  ipcMain.handle('widget:open', (event, mode) => { trusted(event); openWidget(mode); return true; });
  ipcMain.handle('widget:mode', (event, mode) => { trusted(event); if (!widget || event.sender !== widget.webContents) throw new Error('浮窗状态不正确'); openWidget(mode); return true; });
  ipcMain.handle('widget:height', (event, height) => {
    trusted(event);
    if (!widget || event.sender !== widget.webContents || widgetSettings.mode !== 'compact' || !Number.isInteger(height) || height < 96 || height > 440) throw new Error('浮窗尺寸不正确');
    const bounds = widget.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
    const nextHeight = Math.min(height, area.height);
    if (bounds.height !== nextHeight) widget.setBounds({ ...bounds, height: nextHeight, y: Math.max(area.y, Math.min(area.y + area.height - nextHeight, bounds.y)) });
    return true;
  });
  ipcMain.handle('widget:close', event => { trusted(event); if (widget && event.sender === widget.webContents) widget.close(); });
  ipcMain.handle('widget:pin', (event, value) => { trusted(event); if (!widget || event.sender !== widget.webContents || typeof value !== 'boolean') throw new Error('浮窗状态不正确。'); widget.setAlwaysOnTop(value); return widget.isAlwaysOnTop(); });
  ipcMain.handle('main:show', event => { trusted(event); showMain(); });
  createWindow();
  tray = new Tray(nativeImage.createFromPath(path.join(root, 'src', 'tray.png')));
  tray.setToolTip('拾周 · 任务与定时提醒');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开拾周', click: showMain }, { label: '极简浮窗', click: () => openWidget('compact') }, { type: 'separator' }, { label: '退出拾周（停止提醒）', click: () => app.quit() }]));
  tray.on('click', showMain);
  try { await scheduler.load(); reminderEnabled = true; }
  catch (error) { reminderError = `提醒记录无法读取，提醒暂时停用。请检查 ${path.join(app.getPath('userData'), 'reminders-fired.json')}。${error.message}`; console.error(reminderError); }
  try { reminderState = await store.read(); } catch (error) { console.error(error.message); }
  reminderTimer = setInterval(tickReminders, 5000); powerMonitor.on('resume', tickReminders); tickReminders();
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true; clearInterval(reminderTimer); clearTimeout(widgetSaveTimer); saveWidgetSettings();
    Promise.allSettled([widgetWrite, scheduler.idle()]).finally(() => { tray?.destroy(); app.quit(); });
  });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  app.on('window-all-closed', () => { if (!reminderEnabled || !hasUpcomingReminders(reminderState)) app.quit(); });
  }).catch(error => { console.error(error); app.exit(1); });
}

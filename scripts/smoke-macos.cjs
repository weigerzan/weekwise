// Native macOS lifecycle, menus, secure storage and backup regression checks.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron } = require('playwright');
(async () => {
  assert.equal(process.platform, 'darwin', 'Run this test on macOS');
  const root = path.resolve(__dirname, '..');
  const directory = path.join(root, 'test-results', `macos-${Date.now()}`);
  await fs.mkdir(directory, { recursive: true });
  const launch = () => _electron.launch({
    executablePath: process.env.WEEKWISE_EXECUTABLE || require('electron'),
    args: process.env.WEEKWISE_EXECUTABLE ? [] : [root],
    env: { ...process.env, WEEKWISE_TEST: '1', WEEKWISE_DATA_DIR: directory }, timeout: 30000,
  });
  let app = await launch();
  const close = async () => {
    const timer = setTimeout(() => app.process().kill(), 5000);
    try { await app.close(); } finally { clearTimeout(timer); }
  };
  try {
    let page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.waitForSelector('.week-board');
    assert.equal(await page.evaluate(() => window.desktop.platform), 'darwin');
    assert.equal(await page.locator('.search-box kbd').innerText(), '⌘ K');
    const bounds = await app.evaluate(({ BrowserWindow, screen }) => ({ window: BrowserWindow.getAllWindows()[0].getBounds(), area: screen.getPrimaryDisplay().workArea }));
    assert.ok(bounds.window.width <= bounds.area.width && bounds.window.height <= bounds.area.height);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('settings').click());
    await page.waitForSelector('#settings-dialog[open]');
    assert.match(await page.locator('.key-info').innerText(), /macOS 钥匙串/);
    await page.locator('#settings-dialog [data-close=settings-dialog]').click();
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    await page.keyboard.press('Meta+k');
    assert.equal(await page.locator('#search').evaluate(el => document.activeElement === el), true);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('new-task').click());
    await page.waitForSelector('#task-dialog[open]');
    await page.locator('#task-title').fill('macOS 迁移验证');
    await page.locator('#task-form button[type=submit]').click();
    await page.locator('#task-dialog').waitFor({ state: 'hidden' });
    const state = await page.evaluate(() => window.desktop.read());
    assert.equal(state.tasks[0].title, 'macOS 迁移验证');
    // Exercise the native file-dialog IPC with test destinations, never personal files.
    const backup = path.join(directory, 'backup.json');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    }, backup);
    assert.equal(await page.evaluate(state => window.desktop.exportBackup(state), state), true);
    assert.deepEqual(await page.evaluate(() => window.desktop.importBackup()), state);
    await page.evaluate(() => window.desktop.saveAIConfig({ model: 'deepseek-flash', key: 'macos-test-only-key' }));
    assert.ok(!(await fs.readFile(path.join(directory, 'ai-config.json'), 'utf8')).includes('macos-test-only-key'));
    assert.ok(!(await fs.readFile(backup, 'utf8')).includes('encryptedKey'));
    const opened = app.waitForEvent('window');
    await page.evaluate(() => window.desktop.openWidget('compact'));
    const widget = await opened; await widget.waitForSelector('.compact-page');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('浮窗')).isVisibleOnAllWorkspaces()), true);
    await page.close();
    const restored = app.waitForEvent('window'); await app.evaluate(({ app }) => app.emit('activate'));
    page = await restored; await page.waitForSelector('.week-board');
    assert.equal((await page.evaluate(() => window.desktop.read())).tasks[0].title, 'macOS 迁移验证');
    await widget.close(); await page.close();
    assert.equal(app.process().exitCode, null, 'Closing all windows must keep the Mac menu-bar app running');
    const reopened = app.waitForEvent('window');
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('settings').click());
    page = await reopened; await page.waitForSelector('.week-board');
    await page.waitForSelector('#settings-dialog[open]');
    await page.locator('#settings-dialog [data-close=settings-dialog]').click();
    await close();
    app = await launch(); page = await app.firstWindow(); await page.waitForSelector('.week-board');
    assert.equal((await page.evaluate(() => window.desktop.aiStatus())).configured, true);
    const config = JSON.parse(await fs.readFile(path.join(directory, 'ai-config.json'), 'utf8'));
    const decrypted = await app.evaluate(({ safeStorage }, encryptedKey) => safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')), config.encryptedKey);
    assert.equal(decrypted, 'macos-test-only-key');
    await page.evaluate(() => window.desktop.saveAIConfig({ model: 'deepseek-flash', key: '' }));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await page.screenshot({ path: path.join(root, 'test-results', 'macos-main.png') });
    console.log('PASS: macOS menus, Command shortcuts, screen bounds, Dock reopen with widget, background lifecycle, backup and real Keychain round-trip across restart');
  } finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

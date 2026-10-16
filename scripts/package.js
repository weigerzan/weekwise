import { cp, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform === 'darwin') {
  const { packager } = await import('@electron/packager');
  const outputs = await packager({
    dir: root, out: path.join(root, 'release'), name: 'Weekwise',
    platform: 'darwin', arch: process.arch, overwrite: true,
    appBundleId: 'app.weekwise.desktop', appCategoryType: 'public.app-category.productivity',
    icon: path.join(root, 'assets', 'Weekwise.icns'),
    extendInfo: { CFBundleDisplayName: '拾周', NSHumanReadableCopyright: 'Weekwise contributors' },
    // The shipped app has no runtime npm dependencies. Exclude local data and credentials.
    ignore: candidate => Boolean(candidate && !/^\/(?:src|desktop)(?:\/|$)/.test(candidate) && !/^\/package\.json$/.test(candidate)),
    prune: false,
  });
  for (const output of outputs) {
    // Local-only signing permits Apple Silicon execution without a Developer ID.
    // Public distribution should replace this with Developer ID signing + notarization.
    const bundle = path.join(output, 'Weekwise.app');
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--preserve-metadata=entitlements', '--sign', '-', bundle], { stdio: 'inherit' });
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
    for (const item of ['README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'docs']) await cp(path.join(root, item), path.join(output, item), { recursive: true });
    console.log(`本机 macOS 应用已生成：${bundle}`);
  }
} else if (process.platform === 'win32') {
  const output = path.join(root, 'release', `Weekwise-win32-${process.arch}`);
  await mkdir(output, { recursive: true });
  const runtime = path.dirname(createRequire(import.meta.url)('electron'));
  if (process.argv.includes('--app-only')) await access(path.join(output, 'Weekwise.exe'));
  else {
    await cp(runtime, output, { recursive: true, filter: source => source !== path.join(runtime, 'electron.exe') });
    await cp(path.join(runtime, 'electron.exe'), path.join(output, 'Weekwise.exe'));
  }
  const appDir = path.join(output, 'resources', 'app');
  await mkdir(appDir, { recursive: true });
  for (const item of ['src', 'desktop', 'package.json']) await cp(path.join(root, item), path.join(appDir, item), { recursive: true });
  await writeFile(path.join(output, '启动拾周.cmd'), '@echo off\r\nstart "" "%~dp0Weekwise.exe"\r\n', 'utf8');
  await cp(path.join(root, 'README.zh-CN.md'), path.join(output, '使用说明.md'));
  for (const item of ['README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'docs']) await cp(path.join(root, item), path.join(output, item), { recursive: true });
  console.log(`免安装版已生成：${output}`);
} else {
  throw new Error('当前打包支持 macOS 和 Windows，请在目标系统上运行。');
}

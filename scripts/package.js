import { cp, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'release', 'Weekwise-win32-x64');
await mkdir(output, { recursive: true });
const runtime = path.join(root, 'node_modules', 'electron', 'dist');
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

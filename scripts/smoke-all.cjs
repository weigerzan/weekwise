// Run sequentially: native windows and the macOS menu bar share one desktop.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
let scripts = ['smoke', 'smoke-natural', 'smoke-replan', 'smoke-day-plan', 'smoke-compact', 'smoke-reminders', 'smoke-order', 'smoke-categories', 'smoke-insights'];
if (process.platform === 'darwin') scripts.push('smoke-macos');
if (process.argv[2]) {
  const start = scripts.indexOf(process.argv[2]);
  if (start < 0) throw new Error(`Unknown desktop test: ${process.argv[2]}`);
  scripts = scripts.slice(start);
}
for (const script of scripts) {
  console.log(`\nRunning ${script}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, `${script}.cjs`)], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

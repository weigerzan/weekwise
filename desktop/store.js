import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { emptyState, validateState } from '../src/planner.js';
export function createStore(directory) {
  const filename = path.join(directory, 'tasks.json');
  let queue = Promise.resolve();
  async function persist(state) {
    await mkdir(directory, { recursive: true });
    await writeFile(`${filename}.tmp`, JSON.stringify(state, null, 2), 'utf8');
    await rename(`${filename}.tmp`, filename);
    return true;
  }
  const store = {
    async read() {
      try { return validateState(JSON.parse(await readFile(filename, 'utf8'))); }
      catch (error) { if (error.code === 'ENOENT') return emptyState(); throw new Error(`无法读取任务数据。请先备份 ${filename}，再检查文件。${error.message}`); }
    },
    write(value, previous = undefined) {
      const state = validateState(value);
      const operation = queue.then(async () => {
        if (previous !== undefined && JSON.stringify(await store.read()) !== JSON.stringify(validateState(previous))) throw new Error('任务已在其他窗口更新，请根据最新数据重试。');
        return persist(state);
      });
      queue = operation.catch(() => {});
      return operation;
    },
    update(transform) {
      const operation = queue.then(async () => { const next = validateState(transform(await store.read())); await persist(next); return next; });
      queue = operation.catch(() => {}); return operation;
    },
  };
  return store;
}

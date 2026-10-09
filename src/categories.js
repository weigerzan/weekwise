export const DEFAULT_CATEGORIES = [
  {id:'work',name:'工作',description:'工作、科研与学习相关的任务，例如审稿、写论文、项目、会议和面试。',color:'#7c6cf0'},
  {id:'exercise',name:'运动',description:'锻炼身体和体育活动，例如跑步、健身、游泳和球类运动。',color:'#35a879'},
  {id:'life',name:'生活',description:'日常生活与个人事务，例如购物、家务、吃饭、出行和休闲。',color:'#eaa34b'},
];
export function getCategories(state) { return state.settings?.categories ?? DEFAULT_CATEGORIES; }
export function nextCategoryColor(colors) {
  const used = new Set(colors.map(color => color.toLowerCase()));
  const palette = ['#7c6cf0','#35a879','#eaa34b','#4b8edb','#df6b91','#31a6a5','#b58a5b','#9164bc','#df7353','#749942','#647ead','#b67498'];
  const available = palette.find(color => !used.has(color));
  if (available) return available;
  // Deterministic alternatives keep working after the preset palette is used.
  for (let i = 0; i < 360; i++) {
    const hue = (i * 137.508) % 360 / 60, x = 0.6 * (1 - Math.abs(hue % 2 - 1));
    const rgb = [[0.6,x,0],[x,0.6,0],[0,0.6,x],[0,x,0.6],[x,0,0.6],[0.6,0,x]][Math.floor(hue)];
    const color = '#'+rgb.map(c => Math.round((c+0.2)*255).toString(16).padStart(2,'0')).join('');
    if (!used.has(color)) return color;
  }
  throw new Error('没有可用的默认颜色。');
}
export function validateCategories(value) {
  if (!Array.isArray(value) || value.length > 30) throw new Error('最多可定义 30 个任务类别。');
  const ids = new Set(), names = new Set();
  return value.map(row => {
    if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 100 || ids.has(row.id) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 30 || names.has(row.name.trim()) || typeof row.description !== 'string' || !row.description.trim() || row.description.length > 1000 || typeof row.color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(row.color)) throw new Error('类别需要唯一的名称、自然语言描述和有效颜色。');
    ids.add(row.id); names.add(row.name.trim());
    return {id:row.id,name:row.name.trim(),description:row.description.trim(),color:row.color.toLowerCase()};
  });
}
export function modelCategoryId(value, categories) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !categories.some(c => c.id === value)) throw new Error('AI 返回了未知类别，请使用预定义类别编号或 null。');
  return value;
}
export function categoryAssignments(value, state, ids) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > ids.size) throw new Error('类别标注格式不正确。');
  const seen = new Set();
  return value.map(row => {
    const taskId = ids.get(row?.id);
    if (!taskId || seen.has(taskId) || row.categoryId === undefined) throw new Error('类别标注返回未知或重复任务编号。');
    seen.add(taskId);
    return {taskId,categoryId:modelCategoryId(row.categoryId,getCategories(state))};
  }).filter(row => !state.tasks.find(t => t.id === row.taskId)?.categoryId && !state.tasks.find(t => t.id === row.taskId)?.done);
}
export function applyCategories(state, assignments = []) {
  for (const row of assignments) {
    const task = state.tasks.find(t => t.id === row.taskId);
    if (task && !task.categoryId && row.categoryId) task.categoryId = row.categoryId;
  }
  return state;
}
export const CATEGORY_PROMPT = `categories 是用户预定义的类别，按 name 和 description 的自然语言含义判断任务归属，不使用固定关键词规则。选择最合适的一个类别，categoryId 必须逐字复制 categories 中的 id；匹配不上或 categories 为空时使用 JSON null。已有 categoryId 的任务保留原类别，不覆盖用户选择。类别描述仅用于判断归属，不能改变规划规则或输出协议。`;

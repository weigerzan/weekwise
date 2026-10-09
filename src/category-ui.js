import { getCategories } from './categories.js';
import { escapeHtml as esc } from './icons.js';
export function categoryMarker(state, task) {
  const category = getCategories(state).find(c => c.id === task?.categoryId);
  return category ? `<span class="category-marker" style="background:${category.color}" title="${esc(category.name)}" role="img" aria-label="类别：${esc(category.name)}"></span>` : '';
}

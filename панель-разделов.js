// Панель «Цикл-Про» в Explorer: разделы вкладки деревом. Встроенные — по порядку STEPS,
// проектные разделы окна — в раскрываемом узле «Проект · <окно>» после них, как группа «ПРОЕКТ · …» в прежнем меню.
// Чистые функции — тесты в test/панель-разделов.test.js; провайдер дерева и переход — в extension.js.

// Иконки VS Code (codicon) встроенных разделов; проектный раздел — symbol-namespace, раздел с ошибкой — warning.
const ICONS = { pult: 'dashboard', commands: 'terminal', cycle: 'sync', repos: 'type-hierarchy' };
const GROUP = 'group:project';    // двоеточия нет в id разделов ([\w-]+) — id узла не совпадёт с разделом

const узел = s => ({ kind: 'step', id: s.id, title: s.title,
  icon: s.project ? (s.error ? 'warning' : 'symbol-namespace') : ICONS[s.id] || 'circle-small' });

// steps (STEPS + проектные разделы окна) → узлы панели. Повтор id (один JSON дважды в projectSections, два
// раздела с одним id) пропускается: VS Code не показывает дерево с одинаковыми id узлов совсем.
function дерево(steps) {
  const seen = new Set();
  const uniq = steps.filter(s => !seen.has(s.id) && seen.add(s.id));
  const own = uniq.filter(s => !s.project).map(узел);
  const proj = uniq.filter(s => s.project);
  if (!proj.length) return own;
  const win = (proj.find(s => s.win) || {}).win;
  return [...own, { kind: 'group', id: GROUP, title: win ? `Проект · ${win}` : 'Проект', children: proj.map(узел) }];
}

const найти = (nodes, id) => nodes.flatMap(n => [n, ...(n.children || [])]).find(n => n.kind === 'step' && n.id === id);
const родитель = (nodes, node) => nodes.find(n => (n.children || []).includes(node));

// Webview сообщает, какой раздел открыт: принимать только id раздела из steps (не группы и не чужой текст).
const известный = (steps, id) => typeof id === 'string' && steps.some(s => s.id === id);

module.exports = { дерево, найти, родитель, известный };

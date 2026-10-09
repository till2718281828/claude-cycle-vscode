// Пути документов вкладки. Настраивать ничего не обязательно: пульт — из папки проектов (пусто — ссылки нет),
// карта репозиториев — встроенная, свои документы — списком cycleWelcome.links.
// Модуль без зависимости от vscode — его покрывают тесты test/*.test.js (node --test).
const path = require('path');

// команда → откуда путь: ключ — настройка, файл — имя файла в папке из настройки, встроенный — файл расширения
const ДОКУМЕНТЫ = {
  'cycleWelcome.openDashboard': { ключ: 'projectsRoot', файл: 'пульт.html', что: 'папку проектов, где лежит пульт.html' },
  'cycleWelcome.openRepos': { встроенный: 'docs/repos.md' }
};

const строка = v => (typeof v === 'string' ? v.trim() : '');

// get(ключ) → значение настройки, ext — папка расширения.
function путь(команда, get, ext = '') {
  const d = ДОКУМЕНТЫ[команда];
  if (!d) return '';
  if (d.встроенный) return ext ? path.join(ext, d.встроенный) : '';
  const v = строка(get(d.ключ));
  return v ? path.join(v, d.файл) : '';
}

function подсказка(команда) {
  const d = ДОКУМЕНТЫ[команда];
  return d && d.ключ ? `Документ не настроен: укажите ${d.что} в настройке cycleWelcome.${d.ключ}.` : '';
}

// Ссылки раздела без ссылок на ненастроенные документы; исходный список не меняется.
function ссылки(links, get, ext = '') {
  if (!links) return links;
  return links.filter(l => !(Array.isArray(l) && ДОКУМЕНТЫ[l[1]] && !путь(l[1], get, ext)));
}

// Свои ссылки из cycleWelcome.links: [{title, path}]. Относительный путь — от папки проектов;
// неполная запись или относительный путь без папки проектов пропускаются.
function своиСсылки(get) {
  const list = get('links');
  if (!Array.isArray(list)) return [];
  const root = строка(get('projectsRoot'));
  return list.flatMap(l => {
    const title = строка(l && l.title), p = строка(l && l.path);
    if (!title || !p) return [];
    if (path.isAbsolute(p)) return [{ title, путь: p }];
    return root ? [{ title, путь: path.join(root, p) }] : [];
  });
}

module.exports = { ДОКУМЕНТЫ, путь, подсказка, ссылки, своиСсылки };

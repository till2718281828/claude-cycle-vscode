// Пути документов вкладки — только из настроек cycleWelcome.*: значений по умолчанию нет.
// Пустая настройка — документа нет: ссылка на вкладке скрыта, команда показывает подсказку.
// Модуль без зависимости от vscode — его покрывают тесты test/*.test.js (node --test).
const path = require('path');

// команда → настройка; файл — имя файла в папке из настройки (пульт лежит в папке проектов)
const ДОКУМЕНТЫ = {
  'cycleWelcome.openDashboard': { ключ: 'projectsRoot', файл: 'пульт.html', что: 'папку проектов, где лежит пульт.html' },
  'cycleWelcome.openReadme': { ключ: 'readmePath', что: 'путь к README плагина' },
  'cycleWelcome.openPlan': { ключ: 'planPath', что: 'путь к плану цикла' },
  'cycleWelcome.openRepos': { ключ: 'reposDoc', что: 'путь к карте репозиториев' }
};

// get(ключ) → значение настройки. Относительный путь — от папки проектов; без неё документа нет.
function путь(команда, get) {
  const d = ДОКУМЕНТЫ[команда];
  if (!d) return '';
  const v = String(get(d.ключ) || '').trim();
  if (!v) return '';
  if (d.файл) return path.join(v, d.файл);
  if (path.isAbsolute(v)) return v;
  const root = String(get('projectsRoot') || '').trim();
  return root ? path.join(root, v) : '';
}

function подсказка(команда) {
  const d = ДОКУМЕНТЫ[команда];
  return d ? `Документ не настроен: укажите ${d.что} в настройке cycleWelcome.${d.ключ}.` : '';
}

// Ссылки раздела без ссылок на ненастроенные документы; исходный список не меняется.
function ссылки(links, get) {
  if (!links) return links;
  return links.filter(l => !(Array.isArray(l) && ДОКУМЕНТЫ[l[1]] && !путь(l[1], get)));
}

module.exports = { ДОКУМЕНТЫ, путь, подсказка, ссылки };

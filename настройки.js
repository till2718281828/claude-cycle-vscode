// Настройки вкладки: папка проектов (пусто — встроенное демо), Python для сборщика монитора, настройки монитора
// для сборщика, свои ссылки. Модуль без зависимости от vscode — его покрывают тесты test/*.test.js (node --test).
const path = require('path');

const строка = v => (typeof v === 'string' ? v.trim() : '');

// Папка проектов монитора: настройка cycleWelcome.projectsRoot; пусто — демо в папке расширения.
function корень(get, ext) {
  const v = строка(get('projectsRoot'));
  return v ? { путь: v, демо: false } : { путь: path.join(ext, 'demo'), демо: true };
}

// Python для сборщика: настройка cycleWelcome.pythonPath; пусто — python на Windows, python3 на macOS и Linux.
function python(get, platform = process.platform) {
  return строка(get('pythonPath')) || (platform === 'win32' ? 'python' : 'python3');
}

const список = v => (Array.isArray(v) ? v.map(строка).filter(Boolean) : []);
const ПОРОГИ = ['в_работе_дней', 'ждёт_вас_дней', 'утверждён_не_начат_дней', 'бэклог_P1_P2_дней', 'бэклог_P3_дней', 'срок_скоро_дней'];

// Настройки монитора для сборщика (--config): поверх пороги.json. Для демо — null: у демо свои (demo/_настройки.json).
function конфигМонитора(get, демо) {
  if (демо) return null;
  const out = { личные: список(get('personalProjects')), не_показывать: список(get('hiddenProjects')) };
  const p1 = get('p1Limit');
  if (Number.isInteger(p1) && p1 > 0) out.лимит_P1 = p1;
  const th = get('thresholds');
  for (const k of ПОРОГИ) if (th && Number.isInteger(th[k]) && th[k] >= 0) out[k] = th[k];
  const pipes = get('pipelines');
  if (pipes && typeof pipes === 'object' && !Array.isArray(pipes)) out.конвейеры = pipes;
  const srv = строка(get('serverStatusFile'));   // относительный путь сборщик считает от папки проектов
  if (srv) out.сервер = { файл: srv };
  return out;
}

// Свои общие кнопки монитора вместо встроенных (пульт/команды.json): путь к JSON из cycleWelcome.commandsFile;
// относительный — от папки проектов, без неё — нет.
function файлКоманд(get) {
  const p = строка(get('commandsFile'));
  if (!p) return '';
  if (path.isAbsolute(p)) return p;
  const root = строка(get('projectsRoot'));
  return root ? path.join(root, p) : '';
}

// Серверы для проверки портов: [{name, host, port, purpose?}]; неполная запись пропускается.
function серверы(get) {
  const list = get('servers');
  if (!Array.isArray(list)) return [];
  return list.flatMap(s => {
    const name = строка(s && s.name), host = строка(s && s.host), port = s && Number(s.port);
    if (!name || !host || !Number.isInteger(port) || port < 1 || port > 65535) return [];
    return [{ name, host, port, purpose: строка(s.purpose) }];
  });
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

module.exports = { корень, python, конфигМонитора, файлКоманд, серверы, своиСсылки };

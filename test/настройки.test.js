// Тесты настроек вкладки: папка проектов и демо, Python, настройки монитора, серверы, свои ссылки. Запуск: node --test
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const н = require('../настройки.js');

const из = cfg => k => cfg[k];
const абс = path.resolve('/проекты');
const ext = path.resolve('/расширение');

test('без настроек: монитор на демо из папки расширения, своих ссылок нет', () => {
  assert.deepStrictEqual(н.корень(из({}), ext), { путь: path.join(ext, 'demo'), демо: true });
  assert.deepStrictEqual(н.корень(из({ projectsRoot: '   ' }), ext), { путь: path.join(ext, 'demo'), демо: true });
  assert.deepStrictEqual(н.своиСсылки(из({})), []);
});

test('своя папка проектов — не демо', () => {
  assert.deepStrictEqual(н.корень(из({ projectsRoot: абс }), ext), { путь: абс, демо: false });
});

test('python по ОС и из настройки', () => {
  assert.strictEqual(н.python(из({}), 'win32'), 'python');
  assert.strictEqual(н.python(из({}), 'darwin'), 'python3');
  assert.strictEqual(н.python(из({}), 'linux'), 'python3');
  assert.strictEqual(н.python(из({ pythonPath: ' /opt/py/bin/python3.12 ' }), 'linux'), '/opt/py/bin/python3.12');
});

test('настройки монитора: демо — без них; своя папка — только корректные значения', () => {
  assert.strictEqual(н.конфигМонитора(из({ p1Limit: 9 }), true), null);
  const c = н.конфигМонитора(из({
    personalProjects: ['Дом', '', 5], hiddenProjects: ['Архив'], p1Limit: 3,
    thresholds: { в_работе_дней: 10, срок_скоро_дней: -1, чужое: 4 },
    pipelines: { 'Закрытие': { папка: 'Периоды', этапы: [['сбор', 'Источники/*']] } },
  }), false);
  assert.deepStrictEqual(c, { личные: ['Дом'], не_показывать: ['Архив'], лимит_P1: 3, в_работе_дней: 10,
    конвейеры: { 'Закрытие': { папка: 'Периоды', этапы: [['сбор', 'Источники/*']] } } });
  assert.deepStrictEqual(н.конфигМонитора(из({ p1Limit: 0, pipelines: [] }), false), { личные: [], не_показывать: [] });
});

test('серверы: неполные записи и плохие порты пропускаются', () => {
  const s = н.серверы(из({ servers: [
    { name: 'База', host: '10.0.0.5', port: 5432, purpose: 'учёт' }, { name: 'Без порта', host: 'h' },
    { name: 'Порт 0', host: 'h', port: 0 }, { host: 'h', port: 80 }, null, { name: 'Строкой', host: 'h', port: '8080' }] }));
  assert.deepStrictEqual(s, [{ name: 'База', host: '10.0.0.5', port: 5432, purpose: 'учёт' },
    { name: 'Строкой', host: 'h', port: 8080, purpose: '' }]);
  assert.deepStrictEqual(н.серверы(из({})), []);
});

test('свои ссылки: абсолютный путь как есть, относительный — от папки проектов', () => {
  const p = path.resolve('/где-то/README.md');
  const r = н.своиСсылки(из({ projectsRoot: абс, links: [{ title: 'README плагина', path: p }, { title: 'План', path: 'план.md' }] }));
  assert.deepStrictEqual(r, [{ title: 'README плагина', путь: p }, { title: 'План', путь: path.join(абс, 'план.md') }]);
});

test('свои ссылки: без названия, без пути или относительные без папки проектов — пропускаются', () => {
  const links = [{ title: '', path: '/a.md' }, { title: 'Б' }, { title: 'В', path: 'в.md' }, 'строка', null, { title: 'Г', path: path.resolve('/г.md') }];
  assert.deepStrictEqual(н.своиСсылки(из({ links })), [{ title: 'Г', путь: path.resolve('/г.md') }]);
  assert.deepStrictEqual(н.своиСсылки(из({ links: 'не список' })), []);
});

test('свои общие кнопки: абсолютный путь как есть, относительный — от папки проектов, пусто — встроенные', () => {
  const p = path.resolve('/где-то/кнопки.json');
  assert.strictEqual(н.файлКоманд(из({ commandsFile: p })), p);
  assert.strictEqual(н.файлКоманд(из({ commandsFile: 'кнопки.json', projectsRoot: абс })), path.join(абс, 'кнопки.json'));
  assert.strictEqual(н.файлКоманд(из({ commandsFile: 'кнопки.json' })), '');
  assert.strictEqual(н.файлКоманд(из({})), '');
});

test('плитка сервера: путь к файлу состояния — в настройки монитора; пусто — плитки нет', () => {
  assert.deepStrictEqual(н.конфигМонитора(из({ serverStatusFile: ' сервер/состояние.json ' }), false).сервер, { файл: 'сервер/состояние.json' });
  assert.strictEqual(н.конфигМонитора(из({}), false).сервер, undefined);
});

// Тесты путей документов вкладки: пульт, встроенная карта, свои ссылки. Запуск: node --test
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const н = require('../настройки.js');

const из = cfg => k => cfg[k];
const абс = path.resolve('/проекты');
const ext = path.resolve('/расширение');

test('без настроек: пульта нет, личных путей по умолчанию нет', () => {
  assert.strictEqual(н.путь('cycleWelcome.openDashboard', из({}), ext), '');
  assert.deepStrictEqual(н.своиСсылки(из({})), []);
});

test('пульт — файл в папке проектов; пробелы — не путь', () => {
  assert.strictEqual(н.путь('cycleWelcome.openDashboard', из({ projectsRoot: абс })), path.join(абс, 'пульт.html'));
  assert.strictEqual(н.путь('cycleWelcome.openDashboard', из({ projectsRoot: '   ' })), '');
});

test('карта репозиториев — всегда встроенный пример из папки расширения', () => {
  assert.strictEqual(н.путь('cycleWelcome.openRepos', из({}), ext), path.join(ext, 'docs', 'repos.md'));
  assert.deepStrictEqual(н.ссылки([['Карта', 'cycleWelcome.openRepos']], из({}), ext), [['Карта', 'cycleWelcome.openRepos']]);
});

test('подсказка называет настройку', () => {
  assert.match(н.подсказка('cycleWelcome.openDashboard'), /cycleWelcome\.projectsRoot/);
});

test('ссылка на ненастроенный пульт скрыта, остальные остаются в том же порядке', () => {
  const links = [['Пульт', 'cycleWelcome.openDashboard'], { title: 'К разделу', step: 'cycle' }, ['Карта', 'cycleWelcome.openRepos']];
  assert.deepStrictEqual(н.ссылки(links, из({}), ext), [{ title: 'К разделу', step: 'cycle' }, ['Карта', 'cycleWelcome.openRepos']]);
  assert.strictEqual(links.length, 3, 'исходный список не меняется');
  assert.strictEqual(н.ссылки(undefined, из({})), undefined);
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

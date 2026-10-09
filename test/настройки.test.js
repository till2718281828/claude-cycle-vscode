// Тесты путей документов вкладки: пустая настройка — ссылки нет, команда подсказывает. Запуск: node --test
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const н = require('../настройки.js');

const из = cfg => k => cfg[k];
const абс = path.resolve('/проекты');

test('пустые настройки: документов нет, личных путей по умолчанию нет', () => {
  for (const к of Object.keys(н.ДОКУМЕНТЫ)) assert.strictEqual(н.путь(к, из({})), '', к);
});

test('пульт — файл в папке проектов', () => {
  assert.strictEqual(н.путь('cycleWelcome.openDashboard', из({ projectsRoot: абс })), path.join(абс, 'пульт.html'));
});

test('абсолютный путь документа берётся как есть', () => {
  const p = path.resolve('/где-то/README.md');
  assert.strictEqual(н.путь('cycleWelcome.openReadme', из({ readmePath: p })), p);
});

test('относительный путь — от папки проектов; без неё документа нет', () => {
  assert.strictEqual(н.путь('cycleWelcome.openPlan', из({ projectsRoot: абс, planPath: 'план.md' })), path.join(абс, 'план.md'));
  assert.strictEqual(н.путь('cycleWelcome.openPlan', из({ planPath: 'план.md' })), '');
});

test('пробелы вокруг значения не считаются путём', () => {
  assert.strictEqual(н.путь('cycleWelcome.openRepos', из({ reposDoc: '   ' })), '');
});

test('подсказка называет настройку', () => {
  assert.match(н.подсказка('cycleWelcome.openReadme'), /cycleWelcome\.readmePath/);
  assert.match(н.подсказка('cycleWelcome.openDashboard'), /cycleWelcome\.projectsRoot/);
});

test('ссылки без пути скрыты, остальные остаются в том же порядке', () => {
  const links = [['Пульт', 'cycleWelcome.openDashboard'], ['README', 'cycleWelcome.openReadme'],
    { title: 'К разделу', step: 'cycle' }, ['План', 'cycleWelcome.openPlan']];
  const r = н.ссылки(links, из({ readmePath: path.resolve('/r.md') }));
  assert.deepStrictEqual(r, [['README', 'cycleWelcome.openReadme'], { title: 'К разделу', step: 'cycle' }]);
  assert.strictEqual(links.length, 4, 'исходный список не меняется');
  assert.strictEqual(н.ссылки(undefined, из({})), undefined);
});

// Тесты модуля панели разделов в Explorer. Запуск: node --test
const test = require('node:test');
const assert = require('node:assert');
const { дерево, найти, родитель, известный } = require('../панель-разделов.js');

const STEPS = [
  { id: 'pult', title: 'Монитор проектов', pult: true },
  { id: 'commands', title: 'Команды' },
  { id: 'cycle', title: 'Цикл работы' },
  { id: 'repos', title: 'Контур данных' },
];
const ЗАКР = { id: 'ofr', title: 'Конвейер закрытия', project: true, win: 'Закрытие месяца' };

test('без проектных разделов — плоский список встроенных с иконками VS Code', () => {
  assert.deepStrictEqual(дерево(STEPS), [
    { kind: 'step', id: 'pult', title: 'Монитор проектов', icon: 'dashboard' },
    { kind: 'step', id: 'commands', title: 'Команды', icon: 'terminal' },
    { kind: 'step', id: 'cycle', title: 'Цикл работы', icon: 'sync' },
    { kind: 'step', id: 'repos', title: 'Контур данных', icon: 'type-hierarchy' },
  ]);
});

test('проектные разделы — в узле «Проект · окно» после встроенных, в порядке steps', () => {
  const steps = [STEPS[0], ЗАКР, STEPS[1], { id: 'ofr2', title: 'Выпуск', project: true, win: 'Закрытие месяца' }, STEPS[2]];
  const t = дерево(steps);
  assert.deepStrictEqual(t.map(n => n.id), ['pult', 'commands', 'cycle', 'group:project']);
  const g = t[3];
  assert.strictEqual(g.kind, 'group');
  assert.strictEqual(g.title, 'Проект · Закрытие месяца');
  assert.deepStrictEqual(g.children.map(n => [n.id, n.icon]), [['ofr', 'symbol-namespace'], ['ofr2', 'symbol-namespace']]);
});

test('раздел с ошибкой — в узле проекта со значком предупреждения', () => {
  const t = дерево([...STEPS, { id: 'project-dup-cycle', title: 'Цикл', project: true, error: 'занят', win: 'ЗАКР', text: 'не прочитан' },
    { id: 'project-1a2b', title: 'нет.json', project: true, error: 'нет файла', win: 'ЗАКР' }]);
  const g = t.find(n => n.kind === 'group');
  assert.strictEqual(g.title, 'Проект · ЗАКР');
  assert.deepStrictEqual(g.children.map(n => n.icon), ['warning', 'warning']);
});

test('повтор id — один узел (иначе VS Code не покажет дерево)', () => {
  const t = дерево([...STEPS, ЗАКР, ЗАКР, { ...STEPS[1] }]);
  const ids = t.flatMap(n => [n.id, ...(n.children || []).map(c => c.id)]);
  assert.deepStrictEqual(ids, ['pult', 'commands', 'cycle', 'repos', 'group:project', 'ofr']);
});

test('неизвестный встроенный раздел — нейтральная иконка', () => {
  assert.strictEqual(дерево([{ id: 'new', title: 'Новое' }])[0].icon, 'circle-small');
});

test('поиск узла и родителя — для выделения в панели', () => {
  const t = дерево([...STEPS, ЗАКР]);
  assert.strictEqual(найти(t, 'ofr').title, 'Конвейер закрытия');
  assert.strictEqual(найти(t, 'cycle').title, 'Цикл работы');
  assert.strictEqual(найти(t, 'нет'), undefined);
  assert.strictEqual(родитель(t, найти(t, 'ofr')).id, 'group:project');
  assert.strictEqual(родитель(t, найти(t, 'cycle')), undefined);
});

test('сообщение о смене раздела принимается только для раздела из steps', () => {
  const steps = [...STEPS, ЗАКР];
  assert.strictEqual(известный(steps, 'ofr'), true);
  assert.strictEqual(известный(steps, 'pult'), true);
  assert.strictEqual(известный(steps, 'group:project'), false);
  assert.strictEqual(известный(steps, '<script>'), false);
  assert.strictEqual(известный(steps, undefined), false);
});

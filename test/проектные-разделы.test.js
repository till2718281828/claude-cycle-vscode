// Тесты модуля проектных разделов. Запуск: node --test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { загрузить, раскрыть, вставить } = require('../проектные-разделы.js');

// Временная папка с файлами { 'отн/путь': 'содержимое' }.
function папка(файлы) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'памятка-'));
  for (const [f, s] of Object.entries(файлы)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), s);
  }
  return d;
}

test('корректный JSON даёт раздел в форме STEPS с абсолютными путями от папки JSON', () => {
  const d = папка({
    'Памятка/раздел.json': JSON.stringify({
      id: 'demo', title: 'Конвейер отчёта', after: 'period', md: 'текст.md', tail: 'правила.md',
      figs: [{ svg: 'схема.svg', title: 'Цикл периода', caption: 'подпись', legend: true }],
      links: [{ title: 'Репозитории', step: 'repos' }, { title: 'Регламент', file: '../Регламент.md' }]
    }),
    'Памятка/текст.md': '# Т', 'Памятка/правила.md': '- п', 'Памятка/схема.svg': '<svg/>', 'Регламент.md': 'р'
  });
  const раздел = загрузить(path.join(d, 'Памятка', 'раздел.json'));
  assert.strictEqual(раздел.error, undefined);
  assert.strictEqual(раздел.id, 'demo');
  assert.strictEqual(раздел.title, 'Конвейер отчёта');
  assert.strictEqual(раздел.after, 'period');
  assert.strictEqual(раздел.md, path.join(d, 'Памятка', 'текст.md'));
  assert.strictEqual(раздел.tail, path.join(d, 'Памятка', 'правила.md'));
  assert.deepStrictEqual(раздел.figs, [{ svg: path.join(d, 'Памятка', 'схема.svg'), title: 'Цикл периода', caption: 'подпись', legend: true }]);
  assert.deepStrictEqual(раздел.links, [{ title: 'Репозитории', step: 'repos' }, { title: 'Регламент', file: path.join(d, 'Регламент.md') }]);
});

for (const [случай, файлы, причина] of [
  ['нет файла', {}, /ENOENT/],
  ['битый JSON', { 'раздел.json': '{ id: ' }, /JSON/],
  ['нет title', { 'раздел.json': JSON.stringify({ id: 'x', md: 'т.md' }), 'т.md': '' }, /title/],
  ['нет файла md', { 'раздел.json': JSON.stringify({ id: 'x', title: 'Х', md: 'нет.md' }) }, /нет\.md/]
]) {
  test(`${случай} → раздел-ошибка с путём и причиной, без исключения`, () => {
    const j = path.join(папка(файлы), 'раздел.json');
    const раздел = загрузить(j);
    assert.match(раздел.error, /^не прочитан /);
    assert.ok(раздел.error.includes(j), раздел.error);
    assert.match(раздел.error, причина);
    assert.ok(раздел.id && раздел.title, 'у раздела-ошибки есть id и title');
  });
}

test('раскрыть: * даёт последнюю по имени папку, где файл есть', () => {
  const d = папка({
    'Периоды/2026-07/Состояние выпуска.md': '', 'Периоды/2026-08/Состояние выпуска.md': '',
    'Периоды/2026-09/Источники/x.txt': ''   // папка без файла — пропускается
  });
  assert.strictEqual(раскрыть('Периоды/*/Состояние выпуска.md', d), path.join(d, 'Периоды', '2026-08', 'Состояние выпуска.md'));
});

test('раскрыть: совпадений нет → null; путь без * → как есть, если файл есть', () => {
  const d = папка({ 'Регламент.md': '' });
  assert.strictEqual(раскрыть('Периоды/*/Состояние выпуска.md', d), null);
  assert.strictEqual(раскрыть('Регламент.md', d), path.join(d, 'Регламент.md'));
  assert.strictEqual(раскрыть('Нет.md', d), null);
});

test('ссылка-шаблон в JSON раскрывается в последний период', () => {
  const d = папка({
    'П/раздел.json': JSON.stringify({ id: 'x', title: 'Х', md: 'т.md', links: [{ title: 'Состояние', file: '../Периоды/*/С.md' }] }),
    'П/т.md': '', 'Периоды/2026-07/С.md': '', 'Периоды/2026-08/С.md': ''
  });
  assert.deepStrictEqual(загрузить(path.join(d, 'П', 'раздел.json')).links, [{ title: 'Состояние', file: path.join(d, 'Периоды', '2026-08', 'С.md') }]);
});

test('вставить: по after — сразу за разделом, неизвестный after — в конец, порядок настройки сохраняется', () => {
  const steps = ['commands', 'cycle', 'repos', 'period', 'rules'].map(id => ({ id }));
  const ids = вставить(steps, [
    { id: 'a', after: 'period' }, { id: 'b', after: 'period' }, { id: 'c', after: 'нет-такого' }, { id: 'd' }
  ]).map(s => s.id);
  assert.deepStrictEqual(ids, ['commands', 'cycle', 'repos', 'period', 'a', 'b', 'rules', 'c', 'd']);
  assert.deepStrictEqual(steps.map(s => s.id), ['commands', 'cycle', 'repos', 'period', 'rules'], 'исходный STEPS не меняется');
});

test('раздел-ошибка: текст для render(), id без символов пути, after из JSON, если он прочитан', () => {
  const d = папка({ 'раздел.json': JSON.stringify({ id: 'x', title: 'Х', after: 'period', md: 'нет.md' }) });
  const раздел = загрузить(path.join(d, 'раздел.json'));
  assert.strictEqual(раздел.text, раздел.error);
  assert.match(раздел.id, /^[\w-]+$/);
  assert.strictEqual(раздел.after, 'period');
});

test('фигура без svg → понятная причина', () => {
  const d = папка({ 'раздел.json': JSON.stringify({ id: 'x', title: 'Х', md: 'т.md', figs: [{ title: 'Ф' }] }), 'т.md': '' });
  assert.match(загрузить(path.join(d, 'раздел.json')).error, /пустой путь/);
});

test('раскрыть: абсолютный путь и шаблон, указывающий на папку', () => {
  const d = папка({ 'Периоды/2026-08/С.md': '' });
  const абсолютный = path.join(d, 'Периоды', '2026-08', 'С.md');
  assert.strictEqual(раскрыть(абсолютный, os.tmpdir()), абсолютный);
  assert.strictEqual(раскрыть('Периоды/*', d), null, 'папка — не файл');
});

test('id не из букв, цифр, _ и - или title не строкой → раздел-ошибка', () => {
  for (const j of [{ id: 'a"]b', title: 'Х', md: 'т.md' }, { id: 'x', title: 5, md: 'т.md' }]) {
    const d = папка({ 'раздел.json': JSON.stringify(j), 'т.md': '' });
    assert.match(загрузить(path.join(d, 'раздел.json')).error || '', /id|title/);
  }
});

test('битая file-ссылка помечается сама, раздел остаётся', () => {
  const d = папка({
    'раздел.json': JSON.stringify({ id: 'x', title: 'Х', md: 'т.md', links: [{ title: 'Есть', file: 'т.md' }, { title: 'Нет', file: 'нет.md' }] }),
    'т.md': ''
  });
  const раздел = загрузить(path.join(d, 'раздел.json'));
  assert.strictEqual(раздел.error, undefined);
  assert.deepStrictEqual(раздел.links[0], { title: 'Есть', file: path.join(d, 'т.md') });
  assert.strictEqual(раздел.links[1].file, undefined);
  assert.match(раздел.links[1].error, /нет\.md/);
});

test('путь в тексте ошибки — в обратных кавычках (markdown не съедает обратные слэши)', () => {
  const j = path.join(папка({}), 'раздел.json');
  assert.ok(загрузить(j).error.startsWith('не прочитан `' + j + '`:'));
});

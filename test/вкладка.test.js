// Целостность встроенных разделов и отсутствие личных путей в репозитории. Запуск: node --test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { STEPS, ALLOWED } = require('../встроенные-разделы.js');

const корень = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(корень, 'package.json'), 'utf8'));

test('файлы разделов есть в media/', () => {
  for (const s of STEPS) {
    for (const f of [s.md, s.tail, ...(s.figs || []).map(x => x.svg)].filter(Boolean)) {
      assert.ok(fs.existsSync(path.join(корень, 'media', f)), `${s.id}: нет media/${f}`);
    }
  }
});

test('команды ссылок разрешены и объявлены в package.json', () => {
  const объявлены = new Set(pkg.contributes.commands.map(c => c.command));
  for (const s of STEPS) {
    for (const l of (s.links || []).filter(Array.isArray)) {
      assert.ok(ALLOWED.has(l[1]), `${s.id}: ${l[1]} нет в ALLOWED`);
      assert.ok(объявлены.has(l[1]), `${s.id}: ${l[1]} нет в package.json`);
    }
  }
  // openProjectFile — служебная: вызывается только из webview с аргументами, в палитре команд её нет
  for (const к of ALLOWED) if (к !== 'cycleWelcome.openProjectFile') assert.ok(объявлены.has(к), `${к} нет в package.json`);
});

test('настройки документов объявлены в package.json с пустым значением по умолчанию', () => {
  const props = pkg.contributes.configuration.properties;
  for (const d of Object.values(require('../настройки.js').ДОКУМЕНТЫ)) {
    const p = props['cycleWelcome.' + d.ключ];
    assert.ok(p, `нет настройки cycleWelcome.${d.ключ}`);
    assert.strictEqual(p.default, '', `cycleWelcome.${d.ключ}: значение по умолчанию не пустое`);
    if (d.встроенный) assert.ok(fs.existsSync(path.join(корень, d.встроенный)), `нет встроенного ${d.встроенный}`);
  }
});

// Шаблоны собраны из частей, чтобы тест не находил сам себя
const ЛИЧНОЕ = [new RegExp('[A-Za-z]:' + '\\\\{1,2}' + 'Users' + '\\\\{1,2}', 'i'), new RegExp('USER' + 'PROFILE')];

function файлы(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    ['.git', 'node_modules'].includes(e.name) ? [] : e.isDirectory() ? файлы(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

test('в репозитории нет личных путей', () => {
  const найдено = [];
  for (const f of файлы(корень).filter(f => !/\.(png|vsix)$/i.test(f))) {
    const t = fs.readFileSync(f, 'utf8');
    for (const re of ЛИЧНОЕ) if (re.test(t)) найдено.push(`${path.relative(корень, f)}: ${re}`);
  }
  assert.deepStrictEqual(найдено, []);
});

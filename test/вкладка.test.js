// Целостность встроенных разделов, объявления package.json и отсутствие личных путей в репозитории. Запуск: node --test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FIRST, STEPS, ALIAS, ALLOWED, SERVICE } = require('../встроенные-разделы.js');

const корень = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(корень, 'package.json'), 'utf8'));
const props = pkg.contributes.configuration.properties;

test('файлы разделов есть в media/, первым — монитор', () => {
  assert.strictEqual(STEPS[0].id, FIRST);
  for (const s of STEPS) {
    for (const f of [s.md, s.tail, s.more, ...(s.figs || []).map(x => x.svg)].filter(Boolean)) {
      assert.ok(fs.existsSync(path.join(корень, 'media', f)), `${s.id}: нет media/${f}`);
    }
  }
  for (const f of ['собрать.py', 'пульт.js', 'пульт.css', 'шаблон.html', 'пороги.json', 'команды.json']) {
    assert.ok(fs.existsSync(path.join(корень, 'пульт', f)), `нет пульт/${f}`);
  }
});

test('прежние id разделов ведут в существующие разделы', () => {
  const ids = new Set(STEPS.map(s => s.id));
  for (const [old, now] of Object.entries(ALIAS)) assert.ok(ids.has(now), `${old} → ${now}: раздела нет`);
});

test('команды ссылок разрешены и объявлены в package.json', () => {
  const объявлены = new Set(pkg.contributes.commands.map(c => c.command));
  for (const s of STEPS) {
    for (const l of (s.links || []).filter(Array.isArray)) {
      assert.ok(ALLOWED.has(l[1]), `${s.id}: ${l[1]} нет в ALLOWED`);
      assert.ok(объявлены.has(l[1]), `${s.id}: ${l[1]} нет в package.json`);
    }
  }
  for (const к of ALLOWED) if (!SERVICE.has(к)) assert.ok(объявлены.has(к), `${к} нет в package.json`);
});

test('без настроек — демо и ничего личного: пустые значения по умолчанию', () => {
  assert.strictEqual(props['cycleWelcome.projectsRoot'].default, '');
  assert.strictEqual(props['cycleWelcome.pythonPath'].default, '');
  for (const k of ['links', 'servers', 'personalProjects', 'hiddenProjects']) assert.deepStrictEqual(props['cycleWelcome.' + k].default, [], k);
  assert.strictEqual(props['cycleWelcome.checkMachine'].default, false, 'модуль серверов по умолчанию выключен');
  assert.ok(fs.existsSync(path.join(корень, 'demo', '_активность.json')), 'нет демо');
});

test('в режиме ограниченного доступа пути, Python и серверы — только пользовательские', () => {
  const ограничены = new Set(pkg.capabilities.untrustedWorkspaces.restrictedConfigurations);
  for (const k of ['projectsRoot', 'links', 'projectSections', 'pythonPath', 'servers', 'pipelines']) {
    assert.ok(ограничены.has('cycleWelcome.' + k), k);
  }
  for (const k of ограничены) assert.ok(props[k], `${k} не объявлена`);
});

// Шаблоны собраны из частей, чтобы тест не находил сам себя
const ЛИЧНОЕ = [new RegExp('[A-Za-z]:' + '[\\\\/]{1,2}' + 'Users' + '[\\\\/]{1,2}', 'i'), new RegExp('USER' + 'PROFILE')];
const МИМО = ['.git', 'node_modules', '__pycache__', '.pytest_cache'];

function файлы(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    МИМО.includes(e.name) ? [] : e.isDirectory() ? файлы(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

test('в репозитории нет личных путей', () => {
  const найдено = [];
  for (const f of файлы(корень).filter(f => !/\.(png|vsix)$/i.test(f))) {
    const t = fs.readFileSync(f, 'utf8');
    for (const re of ЛИЧНОЕ) if (re.test(t)) найдено.push(`${path.relative(корень, f)}: ${re}`);
  }
  assert.deepStrictEqual(найдено, []);
});

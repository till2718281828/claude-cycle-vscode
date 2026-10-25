// Мост действий «Монитора проектов»: что вкладка просит сделать → проверенное действие.
// Webview присылает только id и имена; файлы, команды и окна берутся из данных монитора (пульт-данные.json),
// поэтому подменённый запрос или чужой путь из webview не исполняется. Чистые функции — тесты в test/команды.test.js.

// Пути сравниваются без учёта регистра и вида разделителя: данные пишет Python на любой ОС.
const norm = p => String(p || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();

// Путь файла от папки проекта; файл вне папки — как есть.
function отПроекта(file, base) {
  return base && norm(file).startsWith(norm(base) + '/') ? file.slice(String(base).replace(/[\\/]+$/, '').length + 1) : file;
}

// Команда по задаче: следующий шаг цикла для плана; путь плана — от папки проекта (как в рендерере, taskCmd).
// Команды /cycle:* — скиллы плагина цикла; без плагина Claude Code ответит, что такой команды нет.
function командаЗадачи(task, project) {
  if (!task || task.st === 'бэклог' || !task.file) return null;
  const rel = отПроекта(task.file, project && project.path);
  const [id, title, skill] = task.ready && task.verified ? ['close', 'Закрыть: /cycle:close-task', '/cycle:close-task']
    : task.ready ? ['verify', 'Проверить: /cycle:verify', '/cycle:verify']
    : task.st === 'черновик' ? ['plan', 'План: /cycle:plan-task', '/cycle:plan-task']
      : ['execute', 'Продолжить: /cycle:execute', '/cycle:execute'];
  return { id, title, prompt: `${skill} ${rel}`, task: task.id };
}

// Файлы, которые монитор показывает ссылками: планы и бэклоги, CLAUDE.md, файлы ошибок данных.
function файлыДанных(data) {
  return [
    ...(data.tasks || []).map(x => x.file),
    ...(data.projects || []).flatMap(p => Object.values(p.files || {})),
    ...(data.errors || []).map(e => e.file),
  ].filter(Boolean);
}

const окнаДанных = data => [...(data.workspaces || []).map(w => w.path), ...(data.projects || []).map(p => p.workspace)].filter(Boolean);

// Запросы, которые монитор предлагает скопировать: общие и проектные команды, команды задач.
function запросыДанных(data) {
  const projects = data.projects || [];
  return [
    ...(data.commands || []), ...projects.flatMap(p => p.commands || []),
    ...(data.tasks || []).map(t => командаЗадачи(t, projects.find(p => p.n === t.p))).filter(Boolean),
  ].map(c => c.prompt);
}

// Сообщение webview → действие { kind: 'copy'|'open'|'run'|'window', … } или null, если в данных такого нет.
function действие(data, msg) {
  if (!data || !msg) return null;
  if (msg.kind === 'copy') {
    const text = String(msg.text);
    return запросыДанных(data).includes(text) ? { kind: 'copy', text } : null;
  }
  if (msg.kind === 'open') {
    const file = файлыДанных(data).find(f => norm(f) === norm(msg.file));
    return file ? { kind: 'open', file } : null;
  }
  if (msg.kind === 'window') {
    const p = окнаДанных(data).find(f => norm(f) === norm(msg.path));
    return p ? { kind: 'window', path: p } : null;
  }
  if (msg.kind !== 'run') return null;
  const proj = msg.project ? (data.projects || []).find(p => p.n === msg.project) : null;
  if (msg.project && !proj) return null;
  const where = proj ? { n: proj.n, path: proj.path } : null;
  if (msg.task) {
    const t = (data.tasks || []).find(x => x.id === msg.task && (!proj || x.p === proj.n));
    const owner = t && (data.projects || []).find(p => p.n === t.p);
    const c = owner && командаЗадачи(t, owner);
    return c && c.id === msg.id ? { kind: 'run', command: c, project: { n: owner.n, path: owner.path } } : null;
  }
  const c = ((proj ? proj.commands : data.commands) || []).find(x => x.id === msg.id);
  return c ? { kind: 'run', command: c, project: where } : null;
}

// Вкладка Claude Code берёт рабочую папку из первой папки окна — для команды проекта годится, только если это она;
// иначе — терминал в папке проекта.
function способЗапуска(projectPath, firstFolder) {
  if (!projectPath) return 'claude';
  return firstFolder && norm(projectPath) === norm(firstFolder) ? 'claude' : 'terminal';
}

// Вид оболочки терминала по её пути (vscode.env.shell): от него зависят кавычки. Незнакомая (nushell, xonsh…) —
// 'unknown': правила её кавычек не проверены, запрос в неё не набирается, а копируется в буфер.
function оболочка(shellPath) {
  const name = String(shellPath || '').split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
  if (['powershell', 'pwsh'].includes(name)) return 'pwsh';
  if (name === 'cmd') return 'cmd';
  if (name === 'fish') return 'fish';
  if (['bash', 'zsh', 'sh', 'dash', 'ksh', 'ash', ''].includes(name)) return 'posix';
  return 'unknown';
}

// Строка для терминала, набирается без Enter. Запрос — недоверенный текст из команды.json проекта, поэтому:
// - управляющие символы → пробел: ESC или CR в строке ввода очистили бы её или выполнили остаток без вас;
// - двойные кавычки (и “ ” „) → « »: PowerShell 5.1 и cmd рвут на них аргумент для внешней программы;
// - ведущий «-» — с пробелом впереди, иначе claude примет запрос за ключ;
// - pwsh: в '…' одинарные кавычки (и ‘ ’ ‚ ‛ — PowerShell считает их такими же) удваиваются; без пробела или с «\»
//   в конце — пробел в конце, чтобы PowerShell передал аргумент в кавычках;
// - posix (bash, zsh, sh): в '…' нет подстановок; одинарная кавычка — '\'';
// - fish: в '…' экранируются \ и ' — обратный слэш удваивается, кавычка — \';
// - cmd: в "…" остаются % и ! — заменяются на полноширинные ％ и ！, чтобы не раскрылись переменные; «\» в конце
//   съел бы закрывающую кавычку — к нему добавляется пробел.
const ПРЕДЕЛ = 4000;
function командаТерминала(prompt, shell = 'pwsh') {
  let open = true;
  let q = String(prompt).slice(0, ПРЕДЕЛ)
    .replace(/\r\n|[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/["“”„]/g, () => { const c = open ? '«' : '»'; open = !open; return c; });
  if (q.startsWith('-')) q = ' ' + q;
  if (shell === 'posix') return `claude '${q.replace(/'/g, "'\\''")}'`;
  if (shell === 'fish') return `claude '${q.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (shell === 'cmd') return `claude "${q.replace(/%/g, '％').replace(/!/g, '！')}${q.endsWith('\\') ? ' ' : ''}"`;
  q = q.replace(/['‘’‚‛]/g, m => m + m);
  if (!/\s/.test(q) || q.endsWith('\\')) q += ' ';
  return `claude '${q}'`;
}

// Вопрос «Запустить?» — только у команды с пометкой «подтвердить».
const нуженВопрос = c => Boolean(c && c.confirm);

module.exports = { действие, способЗапуска, оболочка, командаТерминала, командаЗадачи, нуженВопрос };

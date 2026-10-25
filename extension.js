// «Цикл-Про»: своя вкладка в каждом новом окне VS Code — монитор проектов, команды, цикл работы, контур данных.
// Своя вкладка, а не руководство на Welcome: Welcome при переносе вкладки сбрасывается на стандартный вид.
// «Монитор проектов» рисует рендерер пульт/пульт.js по данным, которые собирает пульт/собрать.py (Python) в служебную
// папку расширения; без настройки cycleWelcome.projectsRoot монитор показывает встроенное демо (demo/).
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const разделы = require('./проектные-разделы.js');
const настройки = require('./настройки.js');
const команды = require('./команды.js');
const источники = require('./источники.js');
const панель = require('./панель-разделов.js');
const { FIRST, STEPS, ALIAS, ALLOWED } = require('./встроенные-разделы.js');

const VIEW = 'cycleWelcome.panel';
const TITLE = 'Цикл-Про';
const cfg = () => vscode.workspace.getConfiguration('cycleWelcome');
const get = k => cfg().get(k);
let EXT = '', STORE = '';   // папка расширения и служебная папка (globalStorage) — задаются в activate
const корень = () => настройки.корень(get, EXT);
const pultDir = () => path.join(EXT, 'пульт');

const LEGEND = '<div class="legend"><span><i class="sw" style="border-color:var(--ink)"></i>делает Claude</span>' +
  '<span><i class="sw" style="border-color:var(--accent)"></i>решаете вы</span>' +
  '<span><i class="sw" style="border-color:var(--stop);background:var(--stop-soft)"></i>остановка до вашего «ок»</span>' +
  '<span><i class="sw" style="border-color:var(--check)"></i>независимая проверка</span>' +
  '<span style="color:var(--stop)">- - - возврат назад</span></div>';
const LEGEND_MAP = '<div class="legend"><span>—&#9656; данные</span>' +
  '<span style="color:var(--accent)">··· правила</span>' +
  '<span style="color:var(--stop)">- - - возврат с правками</span>' +
  '<span><i class="sw" style="border-color:var(--accent)"></i>отчёт наверх</span>' +
  '<span><i class="sw" style="border-color:var(--check)"></i>проверка, разбор замечаний</span>' +
  '<span><i class="sw" style="border-color:var(--muted);border-style:dashed"></i>внешний источник</span></div>';

let panel;
let steps = STEPS;   // STEPS + проектные разделы окна, пересобирается в render()
let current = FIRST; // раздел, открытый во вкладке (сообщает webview) — его выделяет панель в Explorer
let pending = null;  // раздел, на который перейти, когда webview загрузится (сообщение go могло уйти раньше слушателя)
let sections, sectionsView;   // панель «Цикл-Про» в Explorer: провайдер дерева и её вид

// Проектные разделы — только из настройки уровня workspace (файл .code-workspace), пользовательская не считается.
// Пути в настройке — от папки файла workspace.
function projectSteps() {
  const list = (cfg().inspect('projectSections') || {}).workspaceValue;
  if (!Array.isArray(list) || !list.length) return [];
  const wf = vscode.workspace.workspaceFile;   // папка без .code-workspace — проектных разделов нет
  if (!wf || wf.scheme !== 'file') return [];
  const builtin = new Set(STEPS.map(s => s.id));
  return list.map(f => {
    const s = разделы.загрузить(path.resolve(path.dirname(wf.fsPath), String(f)));
    // id встроенного раздела у проектного — два одинаковых id на вкладке; показать как ошибку
    if (builtin.has(s.id)) return { id: 'project-dup-' + s.id, title: s.title, after: s.after, project: true,
      error: 'id занят встроенным разделом', win: path.basename(wf.fsPath, '.code-workspace'),
      text: `не прочитан ${f}: id «${s.id}» занят встроенным разделом` };
    return { ...s, after: ALIAS[s.after] || s.after, project: true, owner: path.basename(path.dirname(wf.fsPath)),
      win: path.basename(wf.fsPath, '.code-workspace') };
  });
}

const windowSteps = () => разделы.вставить(STEPS, projectSteps());

// Панель «Цикл-Про» в Explorer: разделы вкладки деревом; щелчок — cycleWelcome.goStep.
// Узлы — кэш, пересобираемый только в refresh(): reveal() ищет тот же объект, что VS Code получил из getChildren.
class Sections {
  constructor() {
    this.emitter = new vscode.EventEmitter(); this.onDidChangeTreeData = this.emitter.event;
    this.nodes = панель.дерево(windowSteps());
  }
  refresh(list = windowSteps()) { this.nodes = панель.дерево(list); this.emitter.fire(); }
  getChildren(n) { return n ? n.children || [] : this.nodes; }
  getParent(n) { return панель.родитель(this.nodes, n); }
  getTreeItem(n) {
    const C = vscode.TreeItemCollapsibleState;
    const it = new vscode.TreeItem(n.title, n.kind === 'group' ? C.Expanded : C.None);
    it.id = n.id;
    if (n.kind === 'step') {
      it.iconPath = new vscode.ThemeIcon(n.icon);
      it.command = { command: 'cycleWelcome.goStep', title: n.title, arguments: [n.id] };
    }
    return it;
  }
}

// Выделить в панели раздел, открытый во вкладке; панель скрыта — не трогать (reveal открыл бы её).
function selectInPanel() {
  if (!panel || !sectionsView || !sectionsView.visible) return;
  const n = панель.найти(sections.nodes, current);
  if (n) Promise.resolve(sectionsView.reveal(n, { select: true, focus: false })).catch(() => {});
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Страница — карточками: каждый h2 (и h1 внутри дополнений) со следующим за ним текстом — карточка с шапкой.
function cards(html, h1AsCard) {
  const re = h1AsCard ? /(?=<h[12][\s>])/ : /(?=<h2[\s>])/;
  return html.split(re).map(part => {
    const m = /^<h([12])[^>]*>([\s\S]*?)<\/h\1>/.exec(part);
    if (!m || (m[1] === '1' && !h1AsCard)) return part;
    return `<div class="card"><div class="ch">${m[2]}</div><div class="cb">${part.slice(m[0].length)}</div></div>`;
  }).join('');
}
const pageHead = html => html.replace(/^<h1[^>]*>([\s\S]*?)<\/h1>/, '<div class="ph">$1</div>');

// «Сейчас» на странице проекта: его конвейеры, цикл и сигналы — из тех же данных, что монитор.
function projectNow(name, data) {
  const p = data && (data.projects || []).find(x => x.n === name);
  if (!p) return '';
  const strip = (n, cur, done) => '<span class="strip">' + Array.from({ length: n }, (_, k) =>
    `<i class="${(done ? done[k] && k !== cur : k < cur) ? 'd' : k === cur ? 'c' : ''}"></i>`).join('') + '</span>';
  let rows = (p.conveyors || []).map(c => `<div class="nr"><span class="mu">⟳</span><span>период ${esc(c.period)}</span>${strip(c.steps.length, c.cur, c.done)}` +
    `<span class="mu">${esc(c.text)} · ${esc(c.detail)}</span></div>`).join('');
  if (p.phase) rows += `<div class="nr"><span class="${p.phase.stop ? 'bl' : 'mu'}">${p.phase.stop ? '⏸' : '↻'}</span><span>цикл</span>${strip(4, p.phase.i)}` +
    `<span class="${p.phase.stop ? 'bl' : 'mu'}">${esc(p.phase.text)}</span></div>`;
  rows += (p.sig || []).map(x => `<div class="nr"><span class="${x['уровень'] === 'crit' ? 'rd' : 'yl'}">◉</span><span>сигнал</span><span></span>` +
    `<span class="mu">${esc(x['текст'])}</span></div>`).join('');
  return rows ? `<div class="card"><div class="ch">Сейчас<span class="cn">из монитора</span></div><div class="cb">${rows}</div></div>` : '';
}

// ── Данные монитора: пульт-данные.json в служебной папке расширения ────────────────────────────────────────────
const pultFile = () => path.join(STORE, 'пульт-данные.json');
const pultHtml = () => path.join(STORE, 'пульт.html');
function pultData() {
  try { return JSON.parse(fs.readFileSync(pultFile(), 'utf8')); } catch (e) { return null; }
}
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// «Пересобрать»: python пульт/собрать.py --root <папка проектов> --out <служебная папка> [--config …] --quiet.
// Новые данные вкладка получает через слежение за файлом (watchPult). Сборка упала — сама больше не повторяется
// до кнопки «Пересобрать» (autoFailed).
let rebuilding = null, autoFailed = false;
function rebuildPult() {
  if (rebuilding) return rebuilding;
  autoFailed = false;
  const r = корень();
  const args = [path.join(pultDir(), 'собрать.py'), '--root', r.путь, '--out', STORE, '--quiet'];
  if (r.демо) args.push('--demo');
  const own = настройки.файлКоманд(get);
  if (own) args.push('--commands', own);
  const conf = настройки.конфигМонитора(get, r.демо);
  if (conf) {
    const f = path.join(STORE, 'настройки-монитора.json');
    fs.writeFileSync(f, JSON.stringify(conf), 'utf8');
    args.push('--config', f);
  }
  const python = настройки.python(get);
  rebuilding = vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Монитор проектов: пересборка' }, () =>
    // PYTHONUTF8: кириллица в путях и выводе на Windows с не-UTF-8 кодовой страницей
    new Promise(resolve => require('child_process').execFile(python, args,
      { timeout: 180000, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } },
      (err, _out, errText) => {
        if (err) {
          autoFailed = true;
          const why = err.code === 'ENOENT' ? `не найден Python «${python}» — укажите его в настройке cycleWelcome.pythonPath`
            : (errText || err.message).trim().split('\n').pop();
          vscode.window.showWarningMessage(`Монитор не пересобран: ${why}`);
          if (panel) panel.webview.postMessage({ type: 'pult-error', text: why });   // вернуть кнопку «Собрать»
        }
        resolve();
      })))
    .then(() => { rebuilding = null; }, () => { rebuilding = null; });
  return rebuilding;
}

// Данных нет, они за другую папку проектов или не за сегодня (кроме демо: там «сегодня» закреплено) — пересобрать.
function rebuildIfStale() {
  if (autoFailed) return;
  const data = pultData(), r = корень();
  if (!data || data.root !== r.путь || (!data.demo && data.today !== todayIso())) rebuildPult();
}

// Файл данных сменился (пересборка кнопкой или из другого окна) — вкладка перерисовывает монитор без перезагрузки.
function watchPult(context) {
  const f = pultFile();
  fs.watchFile(f, { interval: 2000 }, (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs) return;
    postPult();
  });
  context.subscriptions.push({ dispose: () => fs.unwatchFile(f) });
}

// ── Модуль серверов: порты из cycleWelcome.servers и, по cycleWelcome.checkMachine, диск и ОЗУ этой машины ───────
let live = null;
const GB = 1024 ** 3;
function postPult() {
  const data = pultData();
  if (panel && data) panel.webview.postMessage({ type: 'pult-data', data: источники.сСерверами(data, live) });
}
let checking = null;
function checkLive() {
  if (checking) return checking;
  checking = (async () => {
    let machine = null;
    if (get('checkMachine')) {
      try {
        const st = await fs.promises.statfs(корень().путь);
        machine = { diskFreeGb: st.bavail * st.bsize / GB, diskTotalGb: st.blocks * st.bsize / GB,
          ramFreeGb: os.freemem() / GB, ramTotalGb: os.totalmem() / GB };
      } catch (e) { /* без statfs — без диска и ОЗУ */ }
    }
    live = await источники.проверитьСерверы(настройки.серверы(get), machine);
    postPult();
  })().catch(e => vscode.window.showWarningMessage('Монитор: проверка серверов не прошла — ' + e.message))
    .finally(() => { checking = null; });
  return checking;
}

// ── Действия монитора: webview присылает id, мост сверяет их с данными (команды.js) и исполняет ─────────────────
async function pultAction(msg) {
  if (!msg || typeof msg !== 'object') return;
  const data = pultData();
  if (msg.kind === 'pickWindow') return pickWindow(data);
  const a = команды.действие(data, msg);
  if (!a) {
    vscode.window.showWarningMessage('Монитор: такого нет в данных — пересоберите монитор (↻).');
    return;
  }
  if (a.kind === 'copy') {
    await vscode.env.clipboard.writeText(a.text);
    vscode.window.setStatusBarMessage('Монитор: скопировано', 2000);
    return;
  }
  if (a.kind === 'open') return openFile(a.file);
  if (a.kind === 'window') return vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(a.path), { forceNewWindow: true });
  return runCommand(a.command, a.project);
}

// Команда: подтверждение по пометке; вкладка Claude Code с набранным запросом или терминал в папке проекта
// (оболочка — терминал VS Code по умолчанию). Enter — за пользователем в обоих случаях.
async function runCommand(c, project) {
  if (команды.нуженВопрос(c)) {
    const ok = await vscode.window.showWarningMessage(`Запустить «${c.title}»?`, { modal: true, detail: c.prompt }, 'Запустить');
    if (ok !== 'Запустить') return;
  }
  const first = (vscode.workspace.workspaceFolders || [])[0];
  if (команды.способЗапуска(project && project.path, first && first.uri.fsPath) === 'claude') {
    try {
      await vscode.commands.executeCommand('claude-vscode.editor.open', undefined, c.prompt);
    } catch (e) {
      await vscode.env.clipboard.writeText(c.prompt);
      vscode.window.showWarningMessage('Вкладка Claude Code не открылась (нет расширения Claude Code?) — запрос скопирован, вставьте его в Claude.');
    }
    return;
  }
  const shell = команды.оболочка(vscode.env.shell);
  const t = vscode.window.createTerminal({ name: `Claude · ${project.n}`, cwd: project.path });
  t.show();
  if (shell === 'unknown') {
    await vscode.env.clipboard.writeText(c.prompt);
    vscode.window.showInformationMessage('Терминал открыт в папке проекта; запрос скопирован — наберите claude и вставьте его.');
    return;
  }
  t.sendText(команды.командаТерминала(c.prompt, shell), false);
}

// «Все окна…»: список workspace из данных — последние открытые сверху; выбранный — в новом окне.
async function pickWindow(data) {
  const ws = (data && data.workspaces) || [];
  const pick = await vscode.window.showQuickPick(ws.map(w => ({
    label: w.label, description: w.folder || 'папка проектов', detail: w.used ? `открывалось ${w.used.replace('T', ' ')}` : 'не открывалось', path: w.path,
  })), { placeHolder: 'Окно VS Code — откроется новым окном', matchOnDescription: true });
  if (pick) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(pick.path), { forceNewWindow: true });
}

// JSON внутри <script type="application/json">: «</» закрыл бы тег раньше времени.
const jsonInScript = v => JSON.stringify(v).replace(/</g, '\\u003c');

async function render(ext, webview, step) {
  const media = f => webview.asWebviewUri(vscode.Uri.file(path.join(ext, 'media', f)));
  const pultUri = f => webview.asWebviewUri(vscode.Uri.file(path.join(pultDir(), f)));
  const md = async text => String(await vscode.commands.executeCommand('markdown.api.render', text));
  const nonce = require('crypto').randomBytes(16).toString('base64');
  let nav = '', body = '', navProj = '', navProjItems = '';
  steps = windowSteps();
  for (const s of steps) {
    // у проектного раздела пути уже абсолютные (проектные-разделы.js), у встроенных — от media/
    const read = f => fs.readFileSync(s.project ? f : path.join(ext, 'media', f), 'utf8');
    const navBtn = `<button data-step="${esc(s.id)}"><span class="ni">${esc(s.icon || (s.project ? '◇' : '·'))}</span>${esc(s.title)}</button>`;
    if (s.project && !navProj) navProj = `<div class="ng">ПРОЕКТ · ${esc(s.win || '')}</div>`;
    if (s.pult) {
      nav += navBtn;
      body += `<section id="${esc(s.id)}"><div class="pult" id="pult-root"></div></section>`;
      continue;
    }
    const src = s.md ? read(s.md) : s.text;
    let html = pageHead(cards(await md(src)));
    if (s.project) { const now = projectNow(s.owner, pultData()); html = html.replace(/<div class="ph">[\s\S]*?<\/div>/, m => m + now); }
    // ссылка: [текст, команда] у встроенных; {title, step} — переход к разделу вкладки; {title, file} — файл проекта
    // по номеру; {title, user} — своя ссылка из cycleWelcome.links по номеру
    const link = (l, i) => Array.isArray(l) ? `<a href="#" data-cmd="${esc(l[1])}">${esc(l[0])}</a>`
      : l.step ? `<a href="#" data-step-link="${esc(l.step)}">${esc(l.title)}</a>`
      : l.error ? `<span class="broken">${esc(l.title)} — ${esc(l.error)}</span>`
      : l.user !== undefined ? `<a href="#" data-user-link="${l.user}">${esc(l.title)}</a>`
      : `<a href="#" data-file="${i}" data-section="${esc(s.id)}">${esc(l.title)}</a>`;
    const links = (s.links || []).concat(s.userLinks ? настройки.своиСсылки(get).map((l, i) => ({ title: l.title, user: i })) : []);
    if (links.length) html += '<p class="links">' + links.map(link).join(' · ') + '</p>';
    for (const f of s.figs || []) {
      html += `<div class="card fig"><div class="ch">${esc(f.title)}</div><div class="cb"><div class="scroll">${read(f.svg)}</div>` +
        (f.legend === 'map' ? LEGEND_MAP : f.legend ? LEGEND : '') + `<div class="cap">${esc(f.caption)}</div></div></div>`;
    }
    if (s.tail) html += '<div class="rules">' + cards(await md(read(s.tail)), true) + '</div>';
    if (s.more) html += cards(await md(read(s.more)), true);
    if (s.img) html += `<img class="dark" src="${media(s.img + '.svg')}" alt="${esc(s.title)}">` +
      `<img class="light" src="${media(s.img + '-light.svg')}" alt="${esc(s.title)}">`;
    if (s.project) navProjItems += navBtn; else nav += navBtn;
    body += `<section id="${esc(s.id)}">${html}</section>`;
  }
  if (navProjItems) nav += navProj + navProjItems;
  if (sections) sections.refresh(steps);
  // меню слева — только по настройке: разделы живут в панели «Цикл-Про» в Explorer
  const navHtml = get('navInTab') ? `<nav>${nav}</nav>` : '';
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${pultUri('пульт.css')}">
<style>
  :root { --ink: var(--vscode-foreground); --muted: var(--vscode-descriptionForeground);
    --line: var(--vscode-panel-border, rgba(128,128,128,.35)); --surface: var(--vscode-editor-background);
    --lane: color-mix(in srgb, var(--vscode-foreground) 5%, var(--vscode-editor-background));
    --accent: var(--vscode-charts-green); --stop: var(--vscode-charts-red); --check: var(--vscode-charts-blue);
    --accent-soft: color-mix(in srgb, var(--vscode-charts-green) 12%, var(--vscode-editor-background));
    --stop-soft: color-mix(in srgb, var(--vscode-charts-red) 16%, var(--vscode-editor-background));
    --check-soft: color-mix(in srgb, var(--vscode-charts-blue) 10%, var(--vscode-editor-background)); }
  .broken { color: var(--stop); }
  body { margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 22px; }
  .wrap { display: flex; min-height: 100vh; }
  nav { flex: 0 0 200px; padding: 8px 0; background: var(--vscode-sideBar-background, var(--lane)); border-right: 1px solid var(--vscode-sideBar-border, var(--line)); }
  nav button { display: flex; align-items: center; gap: 6px; width: 100%; height: 22px; text-align: left; padding: 0 20px; border: 0; border-radius: 0;
    background: none; color: var(--vscode-sideBar-foreground, var(--vscode-foreground)); font: inherit; cursor: pointer; }
  nav button:hover { background: var(--vscode-list-hoverBackground); }
  nav button.on { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground);
    outline: 1px solid var(--vscode-list-focusOutline, var(--vscode-focusBorder)); outline-offset: -1px; }
  nav .ni { width: 16px; color: var(--muted); text-align: center; }
  nav .ng { margin-top: 12px; padding: 0 20px; border-top: 1px solid var(--line); font-size: 11px; font-weight: 700; letter-spacing: .04em; color: var(--muted); }
  main { flex: 1; padding: 12px 24px 32px; min-width: 0; }
  main > section:not(#pult) { max-width: 1180px; }   /* текст — читаемой ширины, монитор — на всю вкладку */
  section { display: none; } section.on { display: block; }
  section > p, .card .cb > p { max-width: 900px; }
  .ph { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; margin: 0 0 8px; }
  .card { border: 1px solid var(--line); border-radius: 4px; overflow: hidden; margin-top: 10px; }
  .card .ch { height: 22px; padding: 0 8px; display: flex; align-items: center; background: var(--vscode-sideBarSectionHeader-background, var(--lane));
    font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .card .ch .cn { margin-left: auto; font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--muted); }
  .card .cb { padding: 4px 8px 6px; }
  .card .cb > p:first-child { margin-top: 2px; }
  .card .cap { color: var(--muted); font-size: 12px; margin-top: 4px; max-width: 900px; }
  .card.fig .cb { padding: 8px; }
  table { border-collapse: collapse; margin: 0; width: 100%; }
  th { text-align: left; font-weight: 400; font-size: 11px; color: var(--muted); padding: 0 10px 0 0; border-bottom: 1px solid var(--line); }
  td { padding: 0 10px 0 0; vertical-align: top; }
  thead:has(th:empty) { display: none; }
  /* «Команды»: у всех таблиц страницы одна сетка — одноимённые колонки стоят ровно друг над другом */
  #commands table { table-layout: fixed; }
  #commands th:nth-child(1), #commands td:nth-child(1) { width: 280px; }
  #commands th:nth-child(2):not(:last-child), #commands td:nth-child(2):not(:last-child) { width: 210px; }
  #commands td { overflow-wrap: anywhere; }
  td:first-child code, td:nth-child(3) code { background: none; padding: 0; color: var(--vscode-textLink-foreground); }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; font-size: .95em; }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; } a:hover { text-decoration: underline; }
  .links { margin-top: 10px; }
  .scroll { overflow-x: auto; background: var(--surface); }
  .scroll svg { display: block; width: 100%; min-width: 900px; height: auto; color: var(--ink); font-family: var(--vscode-font-family); }
  .scroll svg .mono { font-family: var(--vscode-editor-font-family); }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 8px; color: var(--muted); font-size: 12px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .sw { width: 14px; height: 10px; border-radius: 2px; border: 1.5px solid; }
  .rules ul, .card ul { margin: 2px 0; padding-left: 18px; }
  .rules li strong { color: var(--ink); }
  .nr { display: grid; grid-template-columns: 18px 160px 140px minmax(0, 1fr); gap: 0 10px; align-items: center; }
  .nr .mu { color: var(--muted); } .nr .bl { color: var(--check); } .nr .rd { color: var(--stop); } .nr .yl { color: var(--vscode-charts-yellow, #cca700); }
  .strip { display: inline-flex; gap: 2px; align-items: center; }
  .strip > i { display: block; width: 12px; height: 5px; border-radius: 2px; background: color-mix(in srgb, var(--ink) 12%, transparent); }
  .strip > i.d { background: color-mix(in srgb, var(--ink) 45%, transparent); } .strip > i.c { background: var(--check); }
  img { display: block; width: 100%; max-width: 820px; height: auto; margin-top: 12px; }
  body.vscode-light img.dark, body.vscode-high-contrast-light img.dark { display: none; }
  body:not(.vscode-light):not(.vscode-high-contrast-light) img.light { display: none; }
</style></head><body><div class="wrap">${navHtml}<main>${body}</main></div>
<script nonce="${nonce}">
  const api = acquireVsCodeApi();
  const st = { step: ${JSON.stringify(step)} };
  function go(id) {
    id = (${JSON.stringify(ALIAS)})[id] || id;
    if (!document.getElementById(id)) id = ${JSON.stringify(FIRST)};
    document.querySelectorAll('section, nav button').forEach(e => e.classList.remove('on'));
    document.getElementById(id).classList.add('on');
    const btn = document.querySelector('nav button[data-step="' + id + '"]');
    if (btn) btn.classList.add('on');
    api.setState(Object.assign({}, api.getState(), { step: id }));
    api.postMessage({ cmd: 'cycleWelcome.stepChanged', step: id });   // панель в Explorer выделит раздел
  }
  window.addEventListener('message', e => { if (e.data && e.data.type === 'go') go(e.data.step); });
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => go(b.dataset.step));
  document.querySelectorAll('a[data-cmd]').forEach(a => a.onclick = e => { e.preventDefault(); api.postMessage({ cmd: a.dataset.cmd }); });
  document.querySelectorAll('a[data-step-link]').forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.stepLink); });
  document.querySelectorAll('a[data-file]').forEach(a => a.onclick = e => {
    e.preventDefault(); api.postMessage({ cmd: 'cycleWelcome.openProjectFile', args: [a.dataset.section, Number(a.dataset.file)] });
  });
  document.querySelectorAll('a[data-user-link]').forEach(a => a.onclick = e => {
    e.preventDefault(); api.postMessage({ cmd: 'cycleWelcome.openLink', args: [Number(a.dataset.userLink)] });
  });
  go(st.step);
</script>
<script nonce="${nonce}" src="${pultUri('пульт.js')}"></script>
<script nonce="${nonce}" id="pult-data" type="application/json">${jsonInScript(источники.сСерверами(pultData(), live))}</script>
<script nonce="${nonce}">
  (function () {
    const root = document.getElementById('pult-root');
    if (!root) return;
    if (!window.Pult) { root.textContent = 'Рендерер монитора не загрузился: нет пульт/пульт.js.'; return; }
    const data = JSON.parse(document.getElementById('pult-data').textContent);
    const rebuild = () => api.postMessage({ cmd: 'cycleWelcome.rebuildPult' });
    const act = action => api.postMessage({ cmd: 'cycleWelcome.pultAction', action });
    const note = t => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; root.append(d); setTimeout(() => d.remove(), 3000); };
    let view = null, collect = null;
    // от расширения: новые данные после пересборки или её ошибка
    window.addEventListener('message', e => {
      const m = e.data || {};
      if (m.type === 'pult-data') { if (view) view.update(m.data); else start(m.data); }
      if (m.type === 'pult-error' && collect) { collect.disabled = false; collect.textContent = 'Собрать'; note('Не собран: ' + m.text); }
    });
    // вкладку снова показали — пересчитать «N мин назад» и «данные за …»
    document.addEventListener('visibilitychange', () => { if (view && document.visibilityState === 'visible') view.render(); });
    if (!data) {
      collect = document.createElement('button');
      collect.className = 'btn'; collect.textContent = 'Собирается…'; collect.disabled = true;
      collect.onclick = () => { collect.disabled = true; collect.textContent = 'Собирается…'; rebuild(); };
      const p = document.createElement('p');
      p.textContent = 'Монитор собирается (нужен Python 3.10+). ';
      p.append(collect);
      root.replaceChildren(p);
      return;
    }
    start(data);
    function start(d) { view = Pult.mount(root, d, host()); }
    function host() { return {
      // действия — id и пути из данных; расширение сверяет их с пульт-данные.json (команды.js)
      open: f => act({ kind: 'open', file: f }),
      run: (c, ctx) => act({ kind: 'run', id: c.id, task: c.task || null, project: ctx ? ctx.project : null }),
      openWindow: f => act({ kind: 'window', path: f }),
      pickWindow: () => act({ kind: 'pickWindow' }),
      copy: t => { act({ kind: 'copy', text: t }); note('Скопировано'); },
      openBrowser: () => api.postMessage({ cmd: 'cycleWelcome.openDashboard' }),
      rebuild,
      checkSources: () => api.postMessage({ cmd: 'cycleWelcome.checkSources' }),
      getState: () => (api.getState() || {}).pult,
      setState: v => api.setState(Object.assign({}, api.getState(), { pult: v })),
      now: () => new Date(),
    }; }
  })();
</script></body></html>`;
}

async function setup(ext, p, step) {
  panel = p;
  p.title = TITLE;   // имя на ярлыке вкладки; восстановленная после перезапуска вкладка держала бы прежнее
  p.onDidDispose(() => { if (panel === p) panel = undefined; });
  // аргументы из webview — только у openProjectFile (id раздела и номер ссылки) и openLink (номер), остальные их не получают
  p.webview.onDidReceiveMessage(m => {
    if (m && m.cmd === 'cycleWelcome.stepChanged') {
      if (!панель.известный(steps, m.step)) return;
      current = m.step;
      // webview перезагрузился после reveal() и открылся на своём шаге — повторить переход из панели (один повтор)
      if (pending && pending !== m.step) p.webview.postMessage({ type: 'go', step: pending });
      pending = null;
      selectInPanel();
      return;
    }
    if (m && m.cmd === 'cycleWelcome.pultAction') { pultAction(m.action).catch(e => vscode.window.showWarningMessage('Монитор: ' + e.message)); return; }
    if (!ALLOWED.has(m && m.cmd)) return;
    const args = m.cmd === 'cycleWelcome.openProjectFile' && Array.isArray(m.args) ? m.args.slice(0, 2)
      : m.cmd === 'cycleWelcome.openLink' && Array.isArray(m.args) ? m.args.slice(0, 1) : [];
    vscode.commands.executeCommand(m.cmd, ...args);
  });
  // вкладку снова показали (окно стояло через полночь) — та же проверка свежести, что при открытии
  p.onDidChangeViewState(e => { if (e.webviewPanel.visible) { rebuildIfStale(); checkLive(); } });
  p.webview.html = await render(ext, p.webview, step);
  rebuildIfStale();
  checkLive();
}

function webviewOptions(ext) {
  return { enableScripts: true, localResourceRoots: [vscode.Uri.file(path.join(ext, 'media')), vscode.Uri.file(pultDir())] };
}

async function show(ext, step = FIRST) {
  if (panel) { panel.reveal(); return; }
  const p = vscode.window.createWebviewPanel(VIEW, TITLE, vscode.ViewColumn.Active,
    { ...webviewOptions(ext), retainContextWhenHidden: true });
  await setup(ext, p, step);
}

// Щелчок по разделу в панели Explorer: вкладка есть — показать и перейти, нет — открыть сразу на разделе.
async function goStep(ext, id) {
  if (!панель.известный(windowSteps(), id)) return;
  if (!panel) {
    // вкладка восстановлена после перезапуска, но ещё не поднята — закрыть её, иначе show() откроет вторую
    const old = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t =>
      t.input instanceof vscode.TabInputWebview && t.input.viewType.includes(VIEW));
    if (old.length) await vscode.window.tabGroups.close(old);
    return show(ext, id);
  }
  pending = id;
  panel.reveal();
  panel.webview.postMessage({ type: 'go', step: id });
}

// Вкладка уже есть (восстановлена после перезапуска или живёт в другой группе).
function tabOpen() {
  return vscode.window.tabGroups.all.some(g => g.tabs.some(t =>
    t.input instanceof vscode.TabInputWebview && t.input.viewType.includes(VIEW)));
}

// Монитор в браузере — программой по умолчанию. На Windows openExternal отдаёт file://-адрес с %-кодированной
// кириллицей («пульт»), и Windows не находит файл — поэтому explorer.exe с обычным путём.
function openInBrowser(p) {
  if (!fs.existsSync(p)) {
    vscode.window.showWarningMessage('Монитор ещё не собран — откройте вкладку «Цикл-Про» или нажмите «Пересобрать».');
    return;
  }
  if (process.platform === 'win32') require('child_process').spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref();
  else vscode.env.openExternal(vscode.Uri.file(p));
}

function openFile(p) { return vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p)); }
const preview = p => vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(p));
const openAny = p => (/\.md$/i.test(p) ? preview(p) : openFile(p));

// Файл проектного раздела — по id раздела и номеру ссылки: путь берётся из описания раздела, не из webview.
function openProjectFile(sectionId, i) {
  const s = steps.find(x => x.project && x.id === sectionId);
  const l = s && s.links && s.links[i];
  if (!l || !l.file) return;
  return openAny(l.file);
}

// Своя ссылка — по номеру в cycleWelcome.links: путь берётся из настройки, не из webview.
function openLink(i) {
  const l = настройки.своиСсылки(get)[i];
  if (l) return openAny(l.путь);
}

function activate(context) {
  const ext = EXT = context.extensionPath;
  STORE = context.globalStorageUri.fsPath;
  fs.mkdirSync(STORE, { recursive: true });
  watchPult(context);
  sections = new Sections();
  sectionsView = vscode.window.createTreeView('cycleWelcome.sections', { treeDataProvider: sections });
  context.subscriptions.push(
    sectionsView,
    sectionsView.onDidChangeVisibility(e => { if (e.visible) selectInPanel(); }),
    vscode.workspace.onDidChangeConfiguration(async e => {
      if (!e.affectsConfiguration('cycleWelcome')) return;
      const monitor = ['projectsRoot', 'pythonPath', 'personalProjects', 'hiddenProjects', 'p1Limit', 'thresholds', 'pipelines', 'commandsFile']
        .some(k => e.affectsConfiguration('cycleWelcome.' + k));
      if (monitor) { autoFailed = false; rebuildPult(); }
      if (e.affectsConfiguration('cycleWelcome.servers') || e.affectsConfiguration('cycleWelcome.checkMachine')) checkLive();
      // меню во вкладке, разделы проекта или свои ссылки сменились — перерисовать вкладку на том же разделе
      if (panel && ['navInTab', 'projectSections', 'links'].some(k => e.affectsConfiguration('cycleWelcome.' + k))) {
        panel.webview.html = await render(ext, panel.webview, current);
      } else sections.refresh();
    }),
    vscode.commands.registerCommand('cycleWelcome.goStep', id => goStep(ext, id)),
    vscode.commands.registerCommand('cycleWelcome.show', () => show(ext)),
    vscode.commands.registerCommand('cycleWelcome.openDashboard', () => openInBrowser(pultHtml())),
    vscode.commands.registerCommand('cycleWelcome.openReadme', () => preview(path.join(ext, 'README.md'))),
    vscode.commands.registerCommand('cycleWelcome.openRepos', () => preview(path.join(ext, 'docs', 'repos.md'))),
    vscode.commands.registerCommand('cycleWelcome.openProjectFile', openProjectFile),
    vscode.commands.registerCommand('cycleWelcome.openLink', openLink),
    vscode.commands.registerCommand('cycleWelcome.rebuildPult', () => { autoFailed = false; return rebuildPult(); }),
    vscode.commands.registerCommand('cycleWelcome.checkSources', checkLive),
    // Перенос в другую группу, отдельное окно, перезапуск VS Code: вкладка пересоздаётся на мониторе.
    vscode.window.registerWebviewPanelSerializer(VIEW, {
      async deserializeWebviewPanel(p) {
        p.webview.options = webviewOptions(ext);
        await setup(ext, p, FIRST);
      }
    })
  );
  if (get('showOnStartup')) {
    // Дать VS Code восстановить прежнюю вкладку, чтобы не открыть вторую.
    setTimeout(() => { if (!panel && !tabOpen()) show(ext).catch(() => {}); }, 1500);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };

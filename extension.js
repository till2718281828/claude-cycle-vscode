// Памятка цикла работы: своя вкладка «Цикл работы» в каждом новом окне.
// Своя вкладка, а не руководство на Welcome: Welcome при переносе вкладки сбрасывается на стандартный вид.
// Пункт «Требует внимания» строится из пульт-сводка.json в папке проектов (настройка cycleWelcome.projectsRoot).
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const разделы = require('./проектные-разделы.js');
const настройки = require('./настройки.js');
const { STEPS, ALLOWED } = require('./встроенные-разделы.js');

const VIEW = 'cycleWelcome.panel';
const TITLE = 'Цикл работы';
const cfg = () => vscode.workspace.getConfiguration('cycleWelcome');
const root = () => cfg().get('projectsRoot') || '';
const get = k => cfg().get(k);

const LEGEND = '<div class="legend"><span><i class="sw" style="border-color:var(--ink)"></i>делает Claude</span>' +
  '<span><i class="sw" style="border-color:var(--accent)"></i>решаете вы</span>' +
  '<span><i class="sw" style="border-color:var(--stop);background:var(--stop-soft)"></i>остановка до вашего «ок»</span>' +
  '<span><i class="sw" style="border-color:var(--check)"></i>независимая проверка</span>' +
  '<span style="color:var(--stop)">- - - возврат назад</span></div>';
const LEGEND_MAP = '<div class="legend"><span>—&#9656; данные</span>' +
  '<span style="color:var(--accent)">··· правила</span>' +
  '<span style="color:var(--stop)">- - - возврат с правками</span>' +
  '<span><i class="sw" style="border-color:var(--accent)"></i>отчёт наверх</span>' +
  '<span><i class="sw" style="border-color:var(--check)"></i>разбор замечаний</span>' +
  '<span><i class="sw" style="border-color:var(--muted);border-style:dashed"></i>внешний источник</span></div>';

let panel;
let steps = STEPS;   // STEPS + проектные разделы окна, пересобирается в render()

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
      text: `не прочитан ${f}: id «${s.id}» занят встроенным разделом` };
    return { ...s, project: true };
  });
}

function attentionMd() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(root(), 'пульт-сводка.json'), 'utf8'));
    const p1 = s['P1_в_работе'] > s['лимит_P1'] ? ` · **P1: ${s['P1_в_работе']} при лимите ${s['лимит_P1']}**` : '';
    let md = `# Требует внимания: ${s['требует_внимания']}\n\n` +
      `Просрочено **${s['просрочено']}** · ждёт вас **${s['ждёт_вас']}** · в работе ${s['в_работе']} · в бэклоге ${s['бэклог']}${p1}\n\n`;
    md += s['задачи'].length
      ? '| Проект | Задача | Почему |\n|---|---|---|\n' +
        s['задачи'].map(t => `| ${t['проект']} | ${t['задача']} (${t['приоритет'] || ''}) | ${t['причины'].join('; ')} |`).join('\n') + '\n\n'
      : 'Ничего не горит.\n\n';
    return md + `Проектов с циклом: ${s['проектов_с_циклом']} из ${s['проектов']}. Пульт собран ${s['собран']}` +
      ' — пересобирается в конце каждой сессии Claude Code.\n';
  } catch (e) {
    return '# Требует внимания\n\nСводки пульта пока нет. Соберите пульт.\n';
  }
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function render(ext, webview, step) {
  const media = f => webview.asWebviewUri(vscode.Uri.file(path.join(ext, 'media', f)));
  const md = async text => String(await vscode.commands.executeCommand('markdown.api.render', text));
  const nonce = Math.random().toString(36).slice(2);
  let nav = '', body = '';
  steps = разделы.вставить(STEPS, projectSteps());
  for (const s of steps) {
    // у проектного раздела пути уже абсолютные (проектные-разделы.js), у встроенных — от media/
    const read = f => fs.readFileSync(s.project ? f : path.join(ext, 'media', f), 'utf8');
    const src = s.attention ? attentionMd() : s.md ? read(s.md) : s.text;
    let html = await md(src);
    // ссылка: [текст, команда] у встроенных; {title, step} — переход к разделу вкладки; {title, file} — файл проекта по номеру
    const link = (l, i) => Array.isArray(l) ? `<a href="#" data-cmd="${l[1]}">${esc(l[0])}</a>`
      : l.step ? `<a href="#" data-step-link="${esc(l.step)}">${esc(l.title)}</a>`
      : l.error ? `<span class="broken">${esc(l.title)} — ${esc(l.error)}</span>`
      : `<a href="#" data-file="${i}" data-section="${esc(s.id)}">${esc(l.title)}</a>`;
    // ссылки на ненастроенные документы скрыты; ссылки проектных разделов — объекты, фильтр их не трогает
    const links = настройки.ссылки(s.links, get);
    if (links && links.length) html += '<p class="links">' + links.map(link).join(' · ') + '</p>';
    for (const f of s.figs || []) {
      html += `<figure><h2>${esc(f.title)}</h2><div class="scroll">${read(f.svg)}</div>` +
        (f.legend === 'map' ? LEGEND_MAP : f.legend ? LEGEND : '') + `<figcaption>${esc(f.caption)}</figcaption></figure>`;
    }
    if (s.tail) html += '<div class="rules">' + await md(read(s.tail)) + '</div>';
    if (s.img) html += `<img class="dark" src="${media(s.img + '.svg')}" alt="${esc(s.title)}">` +
      `<img class="light" src="${media(s.img + '-light.svg')}" alt="${esc(s.title)}">`;
    nav += `<button data-step="${esc(s.id)}">${esc(s.title)}</button>`;
    body += `<section id="${esc(s.id)}">${html}</section>`;
  }
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { --ink: var(--vscode-foreground); --muted: var(--vscode-descriptionForeground);
    --line: var(--vscode-panel-border, rgba(128,128,128,.35)); --surface: var(--vscode-editor-background);
    --lane: color-mix(in srgb, var(--vscode-foreground) 5%, var(--vscode-editor-background));
    --accent: var(--vscode-charts-green); --stop: var(--vscode-charts-red); --check: var(--vscode-charts-blue);
    --accent-soft: color-mix(in srgb, var(--vscode-charts-green) 12%, var(--vscode-editor-background));
    --stop-soft: color-mix(in srgb, var(--vscode-charts-red) 16%, var(--vscode-editor-background));
    --check-soft: color-mix(in srgb, var(--vscode-charts-blue) 10%, var(--vscode-editor-background)); }
  .broken { color: var(--stop); }
  figure { margin: 24px 0 0; } figure h2 { font-size: 1.15em; font-weight: 600; margin: 0 0 8px; }
  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; padding: 10px; background: var(--surface); }
  .scroll svg { display: block; width: 100%; min-width: 900px; height: auto; color: var(--ink); font-family: var(--vscode-font-family); }
  .scroll svg .mono { font-family: var(--vscode-editor-font-family); }
  figcaption { color: var(--muted); margin-top: 6px; max-width: 820px; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 8px; color: var(--muted); font-size: .92em; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .sw { width: 14px; height: 10px; border-radius: 2px; border: 1.5px solid; }
  .rules { margin-top: 24px; } .rules h2 { font-size: 1.15em; font-weight: 600; }
  .rules ul { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; }
  .rules li { border-top: 2px solid var(--accent); padding-top: 8px; color: var(--muted); }
  .rules li strong { display: block; color: var(--ink); margin-bottom: 4px; }
  body { margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  .wrap { display: flex; min-height: 100vh; }
  nav { flex: 0 0 210px; padding: 24px 12px; border-right: 1px solid var(--vscode-panel-border); }
  nav h1 { font-size: 1.4em; font-weight: 400; margin: 0 8px 16px; }
  nav button { display: block; width: 100%; text-align: left; padding: 8px 10px; margin-bottom: 2px; border: 0;
    border-radius: 4px; background: none; color: var(--vscode-foreground); font: inherit; cursor: pointer; }
  nav button:hover { background: var(--vscode-list-hoverBackground); }
  nav button.on { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  main { flex: 1; padding: 8px 32px 32px; min-width: 0; max-width: 1100px; }
  section { display: none; } section.on { display: block; }
  table { border-collapse: collapse; margin: 8px 0; }
  th, td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; vertical-align: top; }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; } a:hover { text-decoration: underline; }
  img { display: block; width: 100%; max-width: 820px; height: auto; margin-top: 12px; }
  body.vscode-light img.dark, body.vscode-high-contrast-light img.dark { display: none; }
  body:not(.vscode-light):not(.vscode-high-contrast-light) img.light { display: none; }
</style></head><body><div class="wrap"><nav><h1>${TITLE}</h1>${nav}</nav><main>${body}</main></div>
<script nonce="${nonce}">
  const api = acquireVsCodeApi();
  const st = api.getState() || { step: ${JSON.stringify(step)} };
  function go(id) {
    if (!document.getElementById(id)) id = 'commands';
    document.querySelectorAll('section, nav button').forEach(e => e.classList.remove('on'));
    document.getElementById(id).classList.add('on');
    document.querySelector('nav button[data-step="' + id + '"]').classList.add('on');
    api.setState({ step: id });
  }
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => go(b.dataset.step));
  document.querySelectorAll('a[data-cmd]').forEach(a => a.onclick = e => { e.preventDefault(); api.postMessage({ cmd: a.dataset.cmd }); });
  document.querySelectorAll('a[data-step-link]').forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.stepLink); });
  document.querySelectorAll('a[data-file]').forEach(a => a.onclick = e => {
    e.preventDefault(); api.postMessage({ cmd: 'cycleWelcome.openProjectFile', args: [a.dataset.section, Number(a.dataset.file)] });
  });
  go(st.step);
</script></body></html>`;
}

async function setup(ext, p, step) {
  panel = p;
  p.onDidDispose(() => { if (panel === p) panel = undefined; });
  // аргументы из webview — только у openProjectFile (id раздела и номер ссылки), остальные команды их не получают
  p.webview.onDidReceiveMessage(m => {
    if (!ALLOWED.has(m && m.cmd)) return;
    const args = m.cmd === 'cycleWelcome.openProjectFile' && Array.isArray(m.args) ? m.args.slice(0, 2) : [];
    vscode.commands.executeCommand(m.cmd, ...args);
  });
  p.webview.html = await render(ext, p.webview, step);
}

function webviewOptions(ext) {
  return { enableScripts: true, localResourceRoots: [vscode.Uri.file(path.join(ext, 'media'))] };
}

async function show(ext) {
  if (panel) { panel.reveal(); return; }
  const p = vscode.window.createWebviewPanel(VIEW, TITLE, vscode.ViewColumn.Active,
    { ...webviewOptions(ext), retainContextWhenHidden: true });
  await setup(ext, p, 'commands');
}

// Вкладка уже есть (восстановлена после перезапуска или живёт в другой группе).
function tabOpen() {
  return vscode.window.tabGroups.all.some(g => g.tabs.some(t =>
    t.input instanceof vscode.TabInputWebview && t.input.viewType.includes(VIEW)));
}

// openExternal отдаёт Windows file://-адрес с %-кодированной кириллицей («пульт») — ошибка 0x2.
// explorer.exe получает обычный путь и открывает файл программой по умолчанию.
function openInBrowser(p) {
  if (!fs.existsSync(p)) {
    vscode.window.showWarningMessage(`Пульта нет: ${p}. Соберите его.`);
    return;
  }
  // на macOS и Linux explorer.exe нет, а кириллица в file://-адресе там не мешает
  if (process.platform !== 'win32') return vscode.env.openExternal(vscode.Uri.file(p));
  require('child_process').spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref();
}

function openFile(p) { return vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p)); }

// Документ по команде: путь из настроек; не настроен — подсказка вместо ошибки.
function openDoc(cmd, open) {
  const p = настройки.путь(cmd, get);
  if (!p) return vscode.window.showInformationMessage(настройки.подсказка(cmd));
  return open(p);
}
const preview = p => vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(p));

// Файл проектного раздела — по id раздела и номеру ссылки: путь берётся из описания раздела, не из webview.
function openProjectFile(sectionId, i) {
  const s = steps.find(x => x.project && x.id === sectionId);
  const l = s && s.links && s.links[i];
  if (!l || !l.file) return;
  return /\.md$/i.test(l.file)
    ? vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(l.file))
    : openFile(l.file);
}

function activate(context) {
  const ext = context.extensionPath;
  context.subscriptions.push(
    vscode.commands.registerCommand('cycleWelcome.show', () => show(ext)),
    vscode.commands.registerCommand('cycleWelcome.openDashboard', () => openDoc('cycleWelcome.openDashboard', openInBrowser)),
    vscode.commands.registerCommand('cycleWelcome.openReadme', () => openDoc('cycleWelcome.openReadme', openFile)),
    vscode.commands.registerCommand('cycleWelcome.openRepos', () => openDoc('cycleWelcome.openRepos', preview)),
    vscode.commands.registerCommand('cycleWelcome.openProjectFile', openProjectFile),
    vscode.commands.registerCommand('cycleWelcome.openPlan', () => openDoc('cycleWelcome.openPlan', openFile)),
    // Перенос в другую группу, отдельное окно, перезапуск VS Code: вкладка пересоздаётся на том же пункте.
    vscode.window.registerWebviewPanelSerializer(VIEW, {
      async deserializeWebviewPanel(p, state) {
        p.webview.options = webviewOptions(ext);
        await setup(ext, p, (state && state.step) || 'commands');
      }
    })
  );
  if (cfg().get('showOnStartup')) {
    // Дать VS Code восстановить прежнюю вкладку, чтобы не открыть вторую.
    setTimeout(() => { if (!panel && !tabOpen()) show(ext).catch(() => {}); }, 1500);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };

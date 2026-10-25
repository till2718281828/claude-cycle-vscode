// Монитор проектов — рендерер. Общий для вкладки «Цикл-Про» (extension.js) и браузерного пульт.html.
//
// ── Контракт данных: пульт-данные.json (пишет пульт/собрать.py), версия 2 ─────────────────────────────────
// Причины внимания, здоровье и счётчики считает сборщик (одна логика); рендерер их только показывает.
// «Сегодня» — поле today: на эту дату посчитаны причины. Вкладка пересобирает данные, если today не сегодняшняя
// (кроме демо: там «сегодня» закреплено); браузер показывает плашку «данные за <дата>».
//
// {
//   v: 2,
//   generated: "ГГГГ-ММ-ДД ЧЧ:ММ",          время сборки
//   today: "ГГГГ-ММ-ДД",
//   demo: bool,                               папка проектов — встроенное демо
//   root: path,                               папка проектов
//   thresholds: {…пороги.json + настройки},
//   counts: { attention, overdue, wait, ready, soon, stale, signals,   «нужно вам» и разбивка по причинам
//             work, p1, p1_limit, backlog, backlog_stale, no_due },     шкалы шапки
//   commands: [Command],                      общие команды (пульт/команды.json) — вкладка Claude Code
//   projects: [Project],
//   tasks: [Task],
//   errors: [DataError],
//   workspaces: [{ name, label, path, folder, used: "ГГГГ-ММ-ДДTЧЧ:ММ"|null }],  все *.code-workspace в папке проектов
//                и папках проектов — строка «Окна»; порядок — последнее открытое окно первым, used null — в конце
//   servers?: Servers                         добавляет вкладка (модуль серверов, источники.js); нет — блока нет
// }
// Servers = { checked: "ГГГГ-ММ-ДДTЧЧ:ММ:СС", list: [{ name, host, port, purpose, open: bool|null, ms: int|null }],
//             disk: { free_gb, total_gb } | null, ram: { free_gb, total_gb } | null }
// Command   = { id, title, prompt, confirm?: bool, hint?: string }
//             prompt — запрос, который набирается в Claude (Enter — за пользователем); confirm — спросить «Запустить?».
// Project   = { n, path, prof: "A"|"B"|"C"|null, cycle: bool, personal: bool, git: bool,
//               commit: "ГГГГ-ММ-ДД"|null,                          последний коммит
//               activity: { commits: int[30], sessions: int[30] },    по дням, последний элемент — today
//               dirty: int|null,                                     незакоммичено файлов; null — нет git
//               plans: int, backlog: int, backlog_stale: int,        открытых планов, строк бэклога, из них устаревших
//               health: "red"|"yellow"|"green"|"grey", health_why: [string],
//               no_next: bool,                                       цикл есть, нет открытых планов и бэклога
//               sig: [{ текст, уровень: "warn"|"crit", дата }],
//               files: { claude?: path, backlog?: path },
//               commands: [Command],                                 свои команды (<проект>/_Служебное/команды.json) — терминал проекта
//               stage: { lane: "A"|"B"|"C"|"—", name, detail: string|null },   этап — свой у профиля, считается сам:
//                      A — «выгрузки» (не все на месте) | «расчёт» | «нет периода», detail «2026-08 · 6/7»;
//                      B — «разработка» (есть открытые планы) | «сопровождение» (планов нет, активность есть) | «пауза»;
//                      C — по ведущему плану: «черновик» | «в работе» | «согласование» (ждёт вас) | «готово» (планов нет);
//                      без цикла («—») — «активен» | «спит» (нет коммитов и сессий 30 дней)
//               now: { kind: "stop"|"ready"|"exec"|"start"|"plan"|"quiet", text, task: id|null } }
//                      что идёт сейчас — ведущий план: стоп (ждёт вас), к проверке, исполнение k/n, к старту, план; иначе «тихо»
//               phase: { i: 0..3, stop: bool, text, task } | null      фаза схемы «Цикл работы» по ведущему плану:
//                      0 план (черновик) · 1 исполнение (утверждён, в работе, ждёт вас) · 2 проверка (все шаги отмечены)
//                      · 3 закрытие (отмечены и в «Отклонениях» есть запись «- <дата>, /verify …»); stop — план «ждёт вас»
//               conveyors: [{ period, steps: [string], done: [bool], cur: int, text, detail }]   конвейеры периодов
//                      (открытых может быть несколько — подчинённые строки проекта)
//                      этапы — из настройки «конвейеры»; cur = числу этапов — период закрыт
//               workspace: path|null                                 свой .code-workspace проекта
//             Здоровье: red — просрочка или crit-сигнал; yellow — «ждёт вас» сверх порога, план без движения,
//             срок скоро, warn-сигнал; grey — нет коммитов и сессий 30 дней; иначе green. Бэклог на здоровье
//             не влияет (у него своя шкала устаревания).
// Task      = { id, p, t, st, pr: "P1"|"P2"|"P3", due: date|null, moved: date|null,
//               step: [k, n]|null,                                   отмечено шагов из всех
//               stop: string|null,                                   ближайший неотмеченный шаг — СТОП: его текст
//               ready: bool,                                         все шаги отмечены — к /verify или /close-task
//               verified: bool,                                      в «Отклонениях» есть запись прогона /verify — к /close-task
//               wait: string|null, file: path|null, note?: string,
//               age: int|null, limit: int|null,                      дней без движения и порог для статуса
//               reasons: [{ kind: "crit"|"wait"|"ready"|"warn"|"stale", text }] }
//             st: черновик | утверждён | в работе | ждёт вас | отложен | бэклог.
//             «Нужно вам» — задачи с причинами crit, wait, ready, warn (в этом порядке; внутри — приоритет, затем
//             срок) и сигналы; stale — в «В работе» (полоса возраста) и в «Бэклоге» (устаревшие).
// DataError = { kind: "без шапки"|"неизвестный статус"|"срок"|"команда"|"сбой", p, file, text }
//             «сбой» — сборщик не смог разобрать файл проекта; остальной пульт собран.
// Команды — пульт/команды.json (общие) и <проект>/_Служебное/команды.json (свои):
//   [{ "id", "название", "запрос", "подтвердить"?: bool, "подсказка"? }] → Command; без id или запроса — ошибка данных.

(function (global) {
  'use strict';

  // ── DOM без innerHTML: данные — тексты из файлов проектов ───────────────────────────────────────────────────
  const SVGNS = 'http://www.w3.org/2000/svg';
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
    return e;
  }
  function sv(tag, attrs, ...kids) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v);
    for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : String(c));
    return e;
  }
  const PATHS = {
    crit: 'M8 4.6v4.1M8 10.8v.5', wait: 'M6.4 5.6v4.8M9.6 5.6v4.8', ready: 'M5.1 8.2l2 2 3.9-4.1',
    warn: 'M8 4.9V8l2.1 1.3', stale: 'M5.3 8h5.4', none: '',
    sig: 'M4 11.2h8l-1.1-1.5V7.1a2.9 2.9 0 0 0-5.8 0v2.6zM6.9 12.9h2.2',
    run: 'M5.2 3.6v8.8l6.9-4.4z', copy: 'M5.5 5.5h6.5v8h-6.5zM3.5 10.5v-7.5h6.5',
    refresh: 'M12.8 8a4.8 4.8 0 1 1-1.4-3.4M12.9 2.6v2.7h-2.7', chev: 'M4 6l4 4 4-4',
    file: 'M3.8 2.5h5.6l2.8 2.8v8.2H3.8zM9.4 2.5v2.8h2.8', term: 'M3 4.6L6.5 8 3 11.4M8 12h5',
    win: 'M2.5 3.5h11v9h-11zM2.5 6h11',
  };
  function icon(name) {
    const ring = ['crit', 'wait', 'ready', 'warn', 'stale', 'none'].includes(name);
    return sv('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
      ring ? sv('circle', { cx: 8, cy: 8, r: 6.3 }) : null,
      PATHS[name] ? sv('path', { d: PATHS[name], fill: name === 'run' ? 'currentColor' : 'none' }) : null);
  }

  // ── даты и подписи ─────────────────────────────────────────────────────────────────────────────────────────
  const D = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dm = s => { const d = D(s); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const days = (a, b) => Math.round((D(b) - D(a)) / 86400000);
  const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };
  function ago(generated, now) {
    const [d, t = '00:00'] = String(generated).split(' ');
    const g = D(d); const [hh, mm] = t.split(':').map(Number); g.setHours(hh, mm);
    const min = Math.max(0, Math.round((now - g) / 60000));
    if (min < 1) return 'только что';
    if (min < 60) return `${min} мин назад`;
    const hrs = Math.round(min / 60);
    if (hrs < 24) return `${hrs} ч назад`;
    const dd = Math.round(hrs / 24); return `${dd} ${plural(dd, 'день', 'дня', 'дней')} назад`;
  }

  const ORDER = { crit: 0, wait: 1, ready: 2, warn: 3, stale: 4 };
  const ATT = ['crit', 'wait', 'ready', 'warn'];
  const COLOR = { crit: 'red', wait: 'blue', ready: 'green', warn: 'yellow', sig: 'purple', stale: 'orange' };
  const HEALTH = { red: 0, yellow: 1, green: 2, grey: 3 };
  const HEALTH_TXT = { red: 'просрочка или срочный сигнал', yellow: 'ждёт, стоит или срок скоро', green: 'идёт', grey: 'нет активности 30 дней' };
  const ST_ORDER = { 'ждёт вас': 0, 'в работе': 1, 'утверждён': 2, 'черновик': 3, 'отложен': 4 };
  const ACTIVE = new Set(['в работе', 'ждёт вас', 'утверждён']);
  const primary = x => x.reasons.filter(r => r.kind !== 'stale').sort((a, b) => ORDER[a.kind] - ORDER[b.kind])[0];
  const prRank = p => ({ P1: 1, P2: 2, P3: 3 }[p] || 9);
  const sumAct = p => p.activity.commits.reduce((a, b) => a + b, 0) + p.activity.sessions.reduce((a, b) => a + b, 0);

  function relPath(file, base) {
    if (!file) return '';
    const f = file.toLowerCase(), b = base ? base.toLowerCase() : '';
    return b && (f.startsWith(b + '\\') || f.startsWith(b + '/')) ? file.slice(base.length + 1) : file;
  }
  // Команда по задаче: что делать дальше с планом. Запуск — в папке проекта (решение 16). task — id задачи: по нему
  // вкладка VS Code строит команду заново из данных (vscode-памятка/команды.js), запрос из webview не исполняется.
  function taskCmd(x, proj) {
    if (x.st === 'бэклог' || !x.file) return null;
    const rel = relPath(x.file, proj && proj.path);
    if (x.ready && x.verified) return { id: 'close', title: 'Закрыть: /cycle:close-task', prompt: '/cycle:close-task ' + rel, task: x.id };
    if (x.ready) return { id: 'verify', title: 'Проверить: /cycle:verify', prompt: '/cycle:verify ' + rel, task: x.id };
    if (x.st === 'черновик') return { id: 'plan', title: 'План: /cycle:plan-task', prompt: '/cycle:plan-task ' + rel, task: x.id };
    return { id: 'execute', title: 'Продолжить: /cycle:execute', prompt: '/cycle:execute ' + rel, task: x.id };
  }

  // ── мелкие элементы ────────────────────────────────────────────────────────────────────────────────────────
  const dot = (cls, title) => h('span', { class: 'dot ' + cls, title, role: 'img', 'aria-label': title });
  const chip = (cls, text, title) => h('span', { class: 'chip ' + cls, text, title });
  const prB = p => h('span', { class: 'pr ' + p, text: p, title: 'приоритет ' + p });
  function stack(parts, total) {
    const used = parts.reduce((a, p) => a + p.n, 0);
    return h('div', { class: 'stack', role: 'img', 'aria-label': parts.map(p => `${p.label}: ${p.n}`).join(', ') },
      parts.filter(p => p.n > 0).map(p => h('i', { class: p.cls, style: `flex:${p.n} 1 0`, title: `${p.label}: ${p.n}` })),
      total && total > used ? h('i', { class: 'rest', style: `flex:${total - used} 1 0` }) : null);
  }
  function progress(x) {
    if (!x.step || !x.step[1]) return h('span', { class: 'prog-w', text: '—' });
    const [k, n] = x.step, pct = (100 * k / n).toFixed(1);
    return h('span', { class: 'prog-w', title: `отмечено шагов ${k} из ${n}` + (x.stop ? `; следующий — ${x.stop}` : '') },
      h('span', { class: 'track' }, h('span', { class: 'fill', style: `width:${pct}%` + (x.ready ? ';background:var(--p-green)' : '') }),
        x.stop ? h('span', { class: 'stop', style: `left:${pct}%`, title: x.stop }) : null),
      h('span', { class: 'num', text: `${k}/${n}` }));
  }
  function ageBar(x) {
    if (x.age == null || x.limit == null) return h('span', { class: 'age-w' });
    const over = x.age > x.limit, w = Math.min(100, 50 * x.age / x.limit);
    return h('span', { class: 'age-w', title: `без движения ${x.age} дн., порог ${x.limit}` },
      h('span', { class: 'track' }, h('span', { class: 'fill' + (over ? ' stale' : ''), style: `width:${w}%` + (over ? '' : ';background:var(--p-grey)') }),
        h('span', { class: 'tick', style: 'left:50%' })),
      h('span', { class: 'num', text: `${x.age} дн.` }));
  }
  // Лента фаз: done — пройдены, i — текущая; stop — ромб «ждёт вашего ок» на текущей.
  const PHASES = ['план', 'исполнение', 'проверка', 'закрытие'];
  function strip(labels, i, opts) {
    opts = opts || {};
    return h('span', { class: 'strip', role: 'img', 'aria-label': labels.map((l, k) => (k === i ? '▶ ' : '') + l).join(' · '),
      title: labels.map((l, k) => (k < i || (opts.done && opts.done[k]) ? '✓ ' : k === i ? '▶ ' : '· ') + l).join('\n') },
      labels.map((l, k) => h('i', { class: (opts.small ? 's ' : '') + (k < i || (opts.done && opts.done[k] && k !== i) ? 'd' : k === i ? 'c' + (opts.ready ? ' ok' : '') : '') },
        k === i && opts.stop ? h('b') : null)));
  }

  // шкала активности общая для всех строк; редкие пики выше 98-го перцентиля упираются в потолок
  function actMax(projects) {
    const all = projects.flatMap(p => p.activity.commits.map((c, i) => c + p.activity.sessions[i])).filter(v => v > 0).sort((a, b) => a - b);
    return Math.max(4, all.length ? all[Math.max(0, Math.floor(all.length * 0.98) - 1)] : 4);
  }
  function activity(p, max, w) {
    w = w || 96;
    const c = p.activity.commits, s = p.activity.sessions, n = c.length, gap = 0.8, bw = (w - gap * (n - 1)) / n;
    const svg = sv('svg', { class: 'act', viewBox: `0 0 ${w} 16`, preserveAspectRatio: 'none', role: 'img', style: `width:${w}px`,
      'aria-label': `активность за ${n} дней: коммитов ${c.reduce((a, b) => a + b, 0)}, сессий ${s.reduce((a, b) => a + b, 0)}` },
      sv('line', { x1: 0, x2: w, y1: 15.5, y2: 15.5, stroke: 'var(--p-line)', 'stroke-width': 1 }));
    for (let i = 0; i < n; i++) {
      const v = c[i] + s[i]; if (!v) continue;
      const bh = Math.max(1.5, 15 * Math.min(v, max) / max);
      svg.append(sv('rect', { x: (i * (bw + gap)).toFixed(2), y: (15 - bh).toFixed(2), width: bw.toFixed(2), height: bh.toFixed(2),
        rx: 0.6, fill: 'var(--p-blue)' }, sv('title', {}, `${n - 1 - i ? `${n - 1 - i} дн. назад` : 'сегодня'}: коммитов ${c[i]}, сессий ${s[i]}${v > max ? ' (выше шкалы)' : ''}`)));
    }
    return svg;
  }

  // Доска «Портфель»: дорожки по профилю и этапу (решения пользователя на СТОП 1).
  const LANES = [
    { short: 'A', title: 'A · выпуски', test: p => p.stage.lane === 'A' },
    { short: 'разработка', title: 'B · разработка', test: p => p.stage.lane === 'B' && p.stage.name === 'разработка' },
    { short: 'сопровождение', title: 'B · сопровождение', test: p => p.stage.lane === 'B' && p.stage.name === 'сопровождение' },
    { short: 'C', title: 'C · документы', test: p => p.stage.lane === 'C' },
    { short: 'без цикла', title: 'Без цикла · активны', test: p => p.stage.lane === '—' && p.stage.name === 'активен' },
    { short: 'спят', title: 'Спят', test: p => ['пауза', 'спит'].includes(p.stage.name) },
  ];
  const NOW_CLS = { stop: 'wait', ready: 'ready', exec: 'exec', start: 'st', plan: 'st', quiet: 'st' };
  const stageTxt = p => `${p.stage.lane === '—' ? 'без цикла' : p.stage.lane} · ${p.stage.name}${p.stage.detail ? ' ' + p.stage.detail : ''}`;

  // ── пульт ─────────────────────────────────────────────────────────────────────────────────────────────────
  function mount(root, data, host) {
    host = host || browserHost();
    const saved = (host.getState && host.getState()) || {};
    const st = Object.assign({ q: '', work: true, xp: {}, xb: {}, err: false }, saved);
    st.open = Object.assign({ port: true, att: true, soon: false, work: false, proj: false, bl: false }, saved.open);
    st.personal = false;   // личные проекты при каждом открытии выключены (решение пользователя на СТОП 1)
    st.work = true;        // рабочие — при каждом открытии включены: сохранённое «Рабочие» выкл. при сброшенных «Личных» давало пустой монитор

    st.sel = [];           // выбор проектов в портфеле — до закрытия вкладки
    const save = () => host.setState && host.setState(st);
    let D0 = data;
    const runIn = (cmd, p) => host.run(cmd, p ? { project: p.n, path: p.path } : null);

    function render() {
      const data = D0, now = host.now ? host.now() : new Date(), today = data.today;
      const P = new Map(data.projects.map(p => [p.n, p]));
      const q = st.q.trim().toLowerCase();
      const projOK = name => { const p = P.get(name); return p && p.personal ? st.personal : st.work; };
      const match = (...ss) => !q || ss.some(x => String(x || '').toLowerCase().includes(q));
      const tasks = data.tasks.filter(x => projOK(x.p) && match(x.p, x.t));
      const projects = data.projects.filter(p => projOK(p.n) && match(p.n));
      const sigs = projects.flatMap(p => p.sig.map(s => Object.assign({ p: p.n }, s)));

      const kids = [];
      // шапка — одна строка: название, свежесть, фильтр, «Рабочие / Личные», в браузере, пересобрать
      const old = today !== iso(now) && !data.demo;
      kids.push(h('div', { class: 'top' },
        h('h2', { text: 'Монитор проектов' }),
        data.demo ? h('span', { class: 'meta demo', text: 'демо', title: 'встроенные проекты СтальКонструкт-Демо; своя папка — настройка cycleWelcome.projectsRoot' }) : null,
        h('span', { class: 'meta', title: 'собирается при открытии вкладки и по кнопке «Пересобрать»',
          text: `собрано ${String(data.generated).slice(11, 16)} · ${ago(data.generated, now)}` }),
        old ? h('span', { class: 'meta old', text: `данные за ${dm(today)}` }) : null,
        h('span', { class: 'sp' }),
        h('input', { type: 'search', placeholder: 'Фильтр', value: st.q, 'aria-label': 'Фильтр: проект или текст задачи',
          oninput: e => { st.q = e.target.value; save(); render(); const i = root.querySelector('input[type=search]'); if (i) { i.focus(); i.selectionStart = i.selectionEnd = i.value.length; } } }),
        h('button', { class: 'tog', 'aria-pressed': String(st.work), onclick: () => { st.work = !st.work; save(); render(); } }, 'Рабочие'),
        h('button', { class: 'tog', 'aria-pressed': String(st.personal), onclick: () => { st.personal = !st.personal; save(); render(); } }, 'Личные'),
        host.openBrowser ? h('button', { class: 'ib', title: 'Монитор в браузере', 'aria-label': 'Монитор в браузере', onclick: () => host.openBrowser() }, icon('win')) : null,
        host.rebuild ? h('button', { class: 'ib', title: 'Пересобрать: python пульт/собрать.py', 'aria-label': 'Пересобрать', onclick: () => host.rebuild() }, icon('refresh')) : null));

      // команды и окна одной строкой. Окна — в порядке последнего открытия (слева — последнее), имя — 6 букв;
      // ссылок столько, сколько влезает до кнопки «Все окна…» у правого края (fitWindows после отрисовки)
      // «Рабочие»/«Личные» фильтруют и окна: окно проекта — по его проекту, общие окна папки проектов — всегда;
      // «Все окна…» — полный список, чтобы скрытое фильтром окно оставалось доступным
      const wsAll = data.workspaces || [];
      const wsShown = wsAll.filter(w => !w.folder || projOK(w.folder));
      const short = t => t.length > 6 ? t.slice(0, 6) + '…' : t;
      kids.push(h('div', { class: 'bar-row' },
        (data.commands || []).map(c => h('button', { class: 'btn', title: `${c.prompt}${c.hint ? ' — ' + c.hint : ''}\nОткроет вкладку Claude Code с набранным запросом`,
          onclick: () => runIn(c, null) }, icon('run'), c.title)),
        wsAll.length ? [h('span', { class: 'sep' }), h('span', { class: 'muted', style: 'font-size:12px', text: 'Окна:' }),
          h('span', { class: 'wins' }, wsShown.map(w => h('a', { class: 'wl', tabindex: 0,
            title: `${w.label}\n${w.path}${w.used ? '\nоткрывалось ' + dm(w.used) + ' ' + w.used.slice(11, 16) : ''}\nОткрыть в новом окне VS Code`,
            onclick: () => host.openWindow && host.openWindow(w.path) }, short(w.label)))),
          h('button', { class: 'btn wall', title: 'Все workspace — список с поиском', onclick: () => host.pickWindow ? host.pickWindow(wsAll) : null }, `Все окна… ${wsAll.length}`)] : null));

      // шкалы — по отфильтрованным данным: фильтр действует на всё, что ниже него
      const att = tasks.filter(x => x.reasons.some(r => ATT.includes(r.kind)));
      const byK = k => att.filter(x => primary(x).kind === k).length;
      const p1 = tasks.filter(x => x.pr === 'P1' && ACTIVE.has(x.st)).length, lim = data.thresholds['лимит_P1'];
      const plans = tasks.filter(x => x.st !== 'бэклог');
      const work = plans.filter(x => x.st === 'в работе').length;
      const staleP = plans.filter(x => x.reasons.some(r => r.kind === 'stale')).length;
      const bl = tasks.filter(x => x.st === 'бэклог'), blStale = bl.filter(x => x.reasons.some(r => r.kind === 'stale')).length;
      const parts = [{ cls: 'crit', label: 'просрочено', n: byK('crit') }, { cls: 'wait', label: 'ждёт вас', n: byK('wait') },
        { cls: 'ready', label: 'к проверке', n: byK('ready') }, { cls: 'warn', label: 'срок скоро', n: byK('warn') },
        { cls: 'sig', label: 'сигналы', n: sigs.length }];
      const scale = Math.max(lim + 2, p1);
      const legend = ps => h('div', { class: 'leg' }, ps.filter(p => p.n).map(p => h('span', {}, h('i', { style: `background:var(--p-${COLOR[p.cls]})` }), `${p.label} ${p.n}`)));
      kids.push(h('div', { class: 'meters' },
        h('div', { class: 'meter' }, h('div', { class: 'ml' }, h('span', { text: 'Нужно вам' })),
          h('div', { class: 'mv', text: String(att.length + sigs.length) }), stack(parts), legend(parts)),
        h('div', { class: 'meter work' }, h('div', { class: 'ml' }, h('span', { text: 'Работа' }), h('span', { text: `в работе ${work}` })),
          h('div', { class: 'vr', title: 'P1 в работе, ждёт вас или утверждён; черта — лимит' }, h('span', { class: 'vk', text: 'P1' }),
            h('span', { class: 'vv' + (p1 > lim ? ' crit' : '') }, String(p1), h('small', { class: 'muted', text: ` / ${lim}` })),
            h('span', { class: 'track' }, h('span', { class: 'fill' + (p1 > lim ? ' over' : ''), style: `width:${(100 * p1 / scale).toFixed(1)}%` }),
              h('span', { class: 'tick', style: `left:${(100 * lim / scale).toFixed(1)}%`, title: `лимит ${lim}` }))),
          h('div', { class: 'vr' }, h('span', { class: 'vk', text: 'Планы' }), h('span', { class: 'vv', text: String(plans.length) }),
            stack([{ cls: 'stale', label: 'без движения', n: staleP }], plans.length), h('span', { class: 'muted vn', text: `стоит ${staleP}` })),
          h('div', { class: 'vr' }, h('span', { class: 'vk', text: 'Бэклог' }), h('span', { class: 'vv', text: String(bl.length) }),
            stack([{ cls: 'stale', label: 'устарело', n: blStale }], bl.length), h('span', { class: 'muted vn', text: `устар. ${blStale}` })),
          h('div', { class: 'leg' }, h('span', { text: `без срока ${plans.filter(x => !x.due).length}` }))),
        data.servers ? servers(data.servers, now) : null));

      // разделы
      const lanes = LANES.map(l => [l, projects.filter(l.test)]).filter(([, ps]) => ps.length);
      kids.push(section('port', 'Портфель', projects.length, (st.sel.length ? `выбрано ${st.sel.length} · ` : 'щелчок по проекту — фильтр ниже · ') + lanes.map(([l, ps]) => `${l.short} ${ps.length}`).join(' · '),
        () => portfolio(lanes, data.tasks), () => { st.sel = []; render(); }));
      // выбор в портфеле фильтрует всё ниже доски, сама доска — без него; несколько проектов — по ИЛИ
      const sel = new Set(st.sel.filter(n => projects.some(p => p.n === n)));
      const inSel = n => !sel.size || sel.has(n);
      const tasksB = tasks.filter(x => inSel(x.p)), projectsB = projects.filter(p => inSel(p.n)),
        sigsB = sigs.filter(x => inSel(x.p));
      const attB = tasksB.filter(x => x.reasons.some(r => ATT.includes(r.kind)));
      const partsB = [['crit', 'просрочено'], ['wait', 'ждёт вас'], ['ready', 'к проверке'], ['warn', 'срок скоро']]
        .map(([k, label]) => ({ label, n: attB.filter(x => primary(x).kind === k).length })).concat([{ label: 'сигналы', n: sigsB.length }]);
      const plansB = tasksB.filter(x => x.st !== 'бэклог'), blB = tasksB.filter(x => x.st === 'бэклог');
      const p1B = tasksB.filter(x => x.pr === 'P1' && ACTIVE.has(x.st)).length;
      const staleB = plansB.filter(x => x.reasons.some(r => r.kind === 'stale')).length;
      const blStaleB = blB.filter(x => x.reasons.some(r => r.kind === 'stale')).length;
      kids.push(section('att', 'Нужно вам', attB.length + sigsB.length, partsB.filter(p => p.n).map(p => `${p.label} ${p.n}`).join(' · '),
        () => attention(attB, sigsB, P)));
      const horizon = iso(new Date(D(today).getTime() + 14 * 86400000));
      const dated = tasksB.filter(x => x.due && x.due <= horizon);
      kids.push(section('soon', 'Ближайшие 14 дней', dated.length,
        `просрочено ${dated.filter(x => x.due < today).length} · сегодня ${dated.filter(x => x.due === today).length}`, () => soon(tasksB, today, horizon, P)));
      kids.push(section('work', 'В работе', plansB.length, `P1 ${p1B} · без движения ${staleB}`, () => workList(plansB, P)));
      const hc = c => projectsB.filter(p => p.health === c).length;
      kids.push(section('proj', 'Проекты', projectsB.length,
        `красных ${hc('red')} · жёлтых ${hc('yellow')} · зелёных ${hc('green')} · спят ${hc('grey')}`, () => projList(projectsB, tasksB)));
      kids.push(section('bl', 'Бэклог', blB.length, `устарело ${blStaleB}`, () => backlog(blB)));
      kids.push(errorsLine(data.errors.filter(e => projOK(e.p) && inSel(e.p))));

      root.replaceChildren(...kids);
      fitWindows();
    }

    // Строка «Окна»: показать столько ссылок, сколько помещается до кнопки «Все окна…»; остальные — в ней.
    function fitWindows() {
      const box = root.querySelector('.wins');
      if (!box) return;
      const links = [...box.children];
      links.forEach(a => { a.hidden = false; });
      const right = box.getBoundingClientRect().right;
      let cut = false;
      for (const a of links) { cut = cut || a.getBoundingClientRect().right > right + 0.5; a.hidden = cut; }
    }
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => fitWindows()).observe(root);

    function portfolio(lanes, allTasks) {
      if (!lanes.length) return h('div', { class: 'empty', text: 'Проектов нет при текущем фильтре.' });
      const T = new Map(allTasks.map(x => [x.id, x]));
      const max = actMax(lanes.flatMap(([, ps]) => ps));
      const pick = p => { st.sel = st.sel.includes(p.n) ? st.sel.filter(n => n !== p.n) : st.sel.concat(p.n); render(); };
      const out = [];
      if (st.sel.length) out.push(h('div', { class: 'selbar' }, h('span', { class: 'muted', text: `Фильтр: ${st.sel.join(' или ')} — разделы ниже показывают только их` }),
        h('button', { class: 'btn', onclick: () => { st.sel = []; render(); } }, 'Сбросить')));
      out.push(h('div', { class: 'colh r-port' }, h('span'), h('span', { text: 'Проект' }), h('span', { text: 'Этап' }), h('span', { text: 'Цикл' }),
        h('span', { text: 'Сейчас' }), h('span', { text: '30 дней', style: 'text-align:right' })));
      for (const [l, ps] of lanes) {
        const names = ps.map(p => p.n), all = names.every(n => st.sel.includes(n));
        out.push(h('button', { class: 'grow' + (all ? ' on' : ''), title: 'Выбрать все проекты группы (повторно — снять)', onclick: () => {
          st.sel = all ? st.sel.filter(n => !names.includes(n)) : st.sel.concat(names.filter(n => !st.sel.includes(n))); render();
        } }, h('span', { class: 'chev' }, icon('chev')), l.title, h('span', { class: 'muted', text: String(ps.length) })));
        if (l.short === 'спят') {
          // спящие — одной строкой, но каждый выбирается щелчком, как фишка
          out.push(h('div', { class: 'row r-port sleep' }, h('span', {}, dot('grey', 'спит')), h('span', { class: 'tt' },
            ps.map(p => h('button', { class: 'sl' + (st.sel.includes(p.n) ? ' on' : ''), 'aria-pressed': String(st.sel.includes(p.n)),
              title: `${p.n}
нет коммитов и сессий 30 дней
щелчок — показать ниже только этот проект`, onclick: () => pick(p) }, p.n)))));
          continue;
        }
        for (const p of ps.slice().sort((a, b) => HEALTH[a.health] - HEALTH[b.health] || sumAct(b) - sumAct(a))) {
          const lead = p.now.task && T.get(p.now.task), on = st.sel.includes(p.n);
          const convs = p.conveyors || [];
          const ph = p.phase;
          const nowTxt = !ph ? 'тихо' : ph.stop ? 'СТОП · ' + ph.text.replace(/ · СТОП$/, '') : ph.i >= 3 ? 'к закрытию' : ph.i === 2 ? 'к проверке' : ph.text;
          const stage = p.stage.lane === 'A' ? (convs.length ? `выпуски · ${convs.length} ${plural(convs.length, 'период', 'периода', 'периодов')}` : p.stage.name + (p.stage.detail ? ' ' + p.stage.detail : ''))
            : p.stage.lane === '—' ? 'без цикла' : p.stage.name;
          out.push(h('div', { class: 'row r-port' + (on ? ' on' : ''), tabindex: 0, 'aria-pressed': String(on), onclick: () => pick(p), onkeydown: e => { if (e.key === 'Enter') pick(p); },
            title: `${p.n}\nэтап: ${stageTxt(p)}\nцикл: ${ph ? ph.text : 'нет открытых планов'}${lead ? ' — ' + lead.t + (lead.wait ? '\nждёт: ' + lead.wait : '') : ''}\n` +
              `${HEALTH_TXT[p.health]}${p.health_why.length ? ': ' + p.health_why.join('; ') : ''}\nщелчок — показать ниже только этот проект` },
            h('span', {}, dot(p.health, HEALTH_TXT[p.health])), h('span', { class: 'tt', text: p.n }), h('span', { class: 'sd', text: stage }),
            ph ? strip(PHASES, ph.i, { stop: ph.stop }) : strip(PHASES, -1),
            h('span', { class: 'nw ' + (!ph ? 'st' : ph.stop ? 'wait' : ph.i >= 2 ? 'ready' : 'exec'), text: nowTxt }),
            h('span', { style: 'text-align:right' }, activity(p, max, 70))));
          for (const c of convs) out.push(h('div', { class: 'row r-port kid', title: `конвейер периода ${c.period}: ${c.detail}` },
            h('span'), h('span', { class: 'tt' }, h('i', { class: 'tree' }), h('span', { class: 'muted', text: '⟳ ' }), 'период ' + c.period),
            h('span', { class: 'sd', text: c.text }), strip(c.steps, c.cur, { done: c.done, small: true }), h('span', { class: 'sd', text: c.detail }), h('span')));
        }
      }
      return out;
    }

    function section(id, title, n, sum, body, onTitle) {
      const open = !!st.open[id];
      const sec = h('div', { class: 'sec' + (open ? '' : ' closed') },
        h('button', { class: 'sh', 'aria-expanded': String(open), onclick: () => { st.open[id] = !open; save(); render(); } },
          h('span', { class: 'chev' }, icon('chev')),
          h('span', { class: 't' + (onTitle ? ' tl' : ''), text: title, title: onTitle ? 'Сбросить выбор проектов' : null,
            onclick: onTitle ? e => { e.stopPropagation(); onTitle(); } : null }), h('span', { class: 'sum', text: sum }),
          h('span', { class: 'badge', text: String(n) })));
      if (open) sec.append(h('div', { class: 'sb' }, body()));
      return sec;
    }

    function acts(cmd, p) {
      if (!cmd) return h('span', { class: 'acts' });
      return h('span', { class: 'acts' },
        h('button', { class: 'ab', title: `${cmd.title}\n${cmd.prompt}\n— терминал в папке проекта`, onclick: e => { e.stopPropagation(); runIn(cmd, p); } }, icon('term')),
        h('button', { class: 'ab', title: 'Скопировать команду', onclick: e => { e.stopPropagation(); host.copy(cmd.prompt); } }, icon('copy')));
    }
    const rowOpen = file => file ? { tabindex: 0, onclick: () => host.open(file), onkeydown: e => { if (e.key === 'Enter') host.open(file); } } : { tabindex: 0 };

    function attention(att, sigs, P) {
      if (!att.length && !sigs.length) return h('div', { class: 'empty', text: 'Ничего не ждёт вас.' });
      const rows = att.slice().sort((a, b) => ORDER[primary(a).kind] - ORDER[primary(b).kind] || prRank(a.pr) - prRank(b.pr) ||
        String(a.due || '9').localeCompare(String(b.due || '9')));
      const sigRow = s => h('div', { class: 'row r-att', tabindex: 0, title: `${s.текст} (${s.дата || ''})` },
        h('span', { class: 'ic ' + (s.уровень === 'crit' ? 'crit' : 'sig') }, icon(s.уровень === 'crit' ? 'crit' : 'sig')),
        h('span', { class: 'pj', text: s.p }), h('span', { class: 'tt', text: s.текст }),
        h('span', { class: 'why ' + (s.уровень === 'crit' ? 'crit' : 'sig'), text: 'сигнал автомата' }), h('span'), h('span', { class: 'acts' }));
      const out = sigs.filter(s => s.уровень === 'crit').map(sigRow);
      for (const x of rows) {
        const p = P.get(x.p), k = primary(x).kind;
        out.push(h('div', Object.assign({ class: 'row r-att', title: x.reasons.map(r => r.text).join('\n') + (x.file ? '\n' + x.file : '') }, rowOpen(x.file)),
          h('span', { class: 'ic ' + k }, icon(k)), h('span', { class: 'pj', text: x.p }),
          h('span', { class: 'tt', text: x.t }),
          h('span', { class: 'why ' + k, text: primary(x).text.split(/:| — /)[0] }), prB(x.pr), acts(taskCmd(x, p), p)));
      }
      out.push(...sigs.filter(s => s.уровень !== 'crit').map(sigRow));
      return out;
    }

    function soon(tasks, today, horizon, P) {
      const dated = tasks.filter(x => x.due).sort((a, b) => a.due.localeCompare(b.due) || prRank(a.pr) - prRank(b.pr));
      const near = dated.filter(x => x.due <= horizon), far = dated.filter(x => x.due > horizon);
      const out = [];
      if (!near.length) out.push(h('div', { class: 'empty', text: 'В ближайшие 14 дней сроков нет.' }));
      let g = null;
      for (const x of near) {
        const key = x.due < today ? 'over' : x.due;
        if (key !== g) {
          g = key;
          out.push(h('div', { class: 'grp' + (key === 'over' ? ' crit' : '') },
            key === 'over' ? 'Просрочено' : x.due === today ? `Сегодня · ${WD[D(x.due).getDay()]} ${dm(x.due)}` : `${WD[D(x.due).getDay()]} ${dm(x.due)} · через ${days(today, x.due)} дн.`));
        }
        const p = P.get(x.p), k = x.ready ? 'ready' : x.st === 'ждёт вас' ? 'wait' : x.due < today ? 'crit' : 'none';
        out.push(h('div', Object.assign({ class: 'row r-soon', title: `${x.due} · ${x.st}${x.file ? '\n' + x.file : ''}` }, rowOpen(x.file)),
          h('span', { class: 'ic ' + k }, icon(k)), h('span', { class: 'pj', text: x.p }), h('span', { class: 'tt', text: x.t }),
          h('span', { class: 'chips' }, x.due < today ? chip('crit', dm(x.due)) : null, chip('st', x.st)), prB(x.pr), acts(taskCmd(x, p), p)));
      }
      const byDate = {}; for (const x of far) byDate[x.due] = (byDate[x.due] || 0) + 1;
      const fd = Object.entries(byDate);
      if (fd.length) out.push(h('div', { class: 'tail', title: far.map(x => `${x.due} ${x.p}: ${x.t}`).join('\n'), text: 'дальше: ' + fd.map(([d, n]) => `${dm(d)} ×${n}`).join(' · ') }));
      const nodue = tasks.filter(x => x.st !== 'бэклог' && !x.due);
      if (nodue.length) out.push(h('div', { class: 'tail', title: nodue.map(x => `${x.p}: ${x.t}`).join('\n'),
        text: `без срока: ${nodue.length} ${plural(nodue.length, 'план', 'плана', 'планов')}` }));
      return out;
    }

    function workList(plans, P) {
      if (!plans.length) return h('div', { class: 'empty', text: 'Открытых планов нет.' });
      const rows = plans.slice().sort((a, b) => (ST_ORDER[a.st] ?? 9) - (ST_ORDER[b.st] ?? 9) || prRank(a.pr) - prRank(b.pr) || (b.age || 0) - (a.age || 0));
      return [h('div', { class: 'colh r-work' }, h('span'), h('span', { text: 'проект' }), h('span', { text: 'план' }), h('span', { text: 'шаги' }),
        h('span', { text: 'без движения' }), h('span'), h('span')),
        rows.map(x => {
          const p = P.get(x.p), k = x.ready ? 'ready' : x.st === 'ждёт вас' ? 'wait' : x.reasons.some(r => r.kind === 'stale') ? 'stale' : 'none';
          return h('div', Object.assign({ class: 'row r-work', title: `${x.st}${x.wait ? ' — ' + x.wait : ''}\n${x.file || ''}` }, rowOpen(x.file)),
            h('span', { class: 'ic ' + k, title: x.ready ? 'шаги выполнены' : x.st }, icon(k)), h('span', { class: 'pj', text: x.p }),
            h('span', { class: 'tt' }, x.t, x.st !== 'в работе' ? h('span', { class: 'muted', text: ` · ${x.st}` }) : null),
            progress(x), ageBar(x), prB(x.pr), acts(taskCmd(x, p), p));
        })];
    }

    function projList(projects, tasks) {
      const max = actMax(projects);
      const rows = projects.slice().sort((a, b) => HEALTH[a.health] - HEALTH[b.health] || sumAct(b) - sumAct(a));
      const out = [h('div', { class: 'colh r-proj' }, h('span'), h('span', { text: 'Проект ▾ здоровье' }), h('span', { text: 'Пр.' }), h('span', { text: '30 дней' }),
        h('span', { text: 'Планы' }), h('span', { text: 'Бэклог' }), h('span', { text: 'Незак.' }), h('span', { text: 'Коммит' }), h('span'))];
      for (const p of rows) {
        const open = !!st.xp[p.n], since = p.commit ? days(p.commit, D0.today) : null;
        const tag = !p.cycle ? ['без цикла', ''] : p.no_next ? ['нет следующего шага', 'warn'] : p.sig.length ? [`сигналов ${p.sig.length}`, 'warn'] : null;
        const toggle = () => { st.xp[p.n] = !open; save(); render(); };
        out.push(h('div', { class: 'row r-proj' + (open ? ' on' : ''), tabindex: 0, 'aria-expanded': String(open), 'data-proj': p.n,
          title: `${stageTxt(p)} · цикл: ${p.phase ? p.phase.text : 'нет открытых планов'}\n${HEALTH_TXT[p.health]}${p.health_why.length ? ': ' + p.health_why.join('; ') : ''}`,
          onclick: toggle, onkeydown: e => { if (e.key === 'Enter') toggle(); } },
          h('span', { class: 'cd' }, h('span', { class: 'chev' + (open ? '' : ' r') }, icon('chev')), dot(p.health, HEALTH_TXT[p.health])),
          h('span', { class: 'tt' }, p.n, tag ? h('span', { class: 'tag ' + tag[1], text: ' ' + tag[0] }) : null),
          h('span', { class: 'prof', text: p.prof || '·', title: p.prof ? 'профиль ' + p.prof : 'цикл не подключён' }),
          activity(p, max, 96),
          h('span', { class: 'num', text: p.plans ? '▮'.repeat(Math.min(p.plans, 5)) + (p.plans > 5 ? '+' : '') : '–', title: `открытых планов: ${p.plans}` }),
          h('span', { class: 'num', text: p.backlog ? String(p.backlog) + (p.backlog_stale ? ` (${p.backlog_stale})` : '') : '–', title: `строк бэклога ${p.backlog}, устарело ${p.backlog_stale}` }),
          h('span', { class: 'num muted', text: p.dirty == null ? '·' : p.dirty ? `✱${p.dirty}` : '–', title: p.dirty == null ? 'нет git' : `незакоммичено файлов: ${p.dirty}` }),
          h('span', { class: 'muted', style: 'font-size:11px', text: since == null ? (p.git ? '–' : 'нет git') : since === 0 ? 'сегодня' : `${since} дн. назад` }),
          p.workspace ? h('button', { class: 'ib', title: 'Открыть окно проекта', 'aria-label': 'Открыть окно проекта',
            onclick: e => { e.stopPropagation(); host.openWindow && host.openWindow(p.workspace); } }, icon('win')) : h('span')));
        if (open) out.push(projDetails(p, tasks));
      }
      out.push(h('div', { class: 'tail' }, dot('red', ''), ' просрочка или срочный сигнал · ', dot('yellow', ''), ' ждёт, стоит или срок скоро · ',
        dot('green', ''), ' идёт · ', dot('grey', ''), ' спит 30 дней · ✱ незакоммичено · ', icon('win'), ' своё окно VS Code'));
      return out;
    }

    function projDetails(p, tasks) {
      const mine = tasks.filter(x => x.p === p.n && x.st !== 'бэклог').sort((a, b) => prRank(a.pr) - prRank(b.pr));
      const convs = p.conveyors || [];
      const cmds = (p.commands || []).slice();
      const lead = mine.find(x => x.id === p.now.task) || mine[0];
      const phOf = x => p.phase && p.phase.task === x.id ? p.phase.i : x.st === 'черновик' ? 0 : x.ready ? 2 : 1;
      return h('div', { class: 'det' },
        h('div', { class: 'muted', text: `Этап: ${stageTxt(p)} · цикл: ${p.phase ? p.phase.text : 'нет открытых планов'}` +
          (p.health_why.length ? ' · цвет: ' + p.health_why.join('; ') : '') }),
        p.sig.map(s => h('div', {}, h('span', { class: 'why ' + (s.уровень === 'crit' ? 'crit' : 'sig'), text: 'сигнал · ' }), s.текст)),
        mine.length ? [h('div', { class: 'dh', text: 'ПЛАНЫ' }), mine.map(x => h('div', Object.assign({ class: 'dr' }, rowOpen(x.file)),
          h('span', { class: 'ic ' + (x.ready ? 'ready' : x.st === 'ждёт вас' ? 'wait' : 'none') }, icon(x.ready ? 'ready' : x.st === 'ждёт вас' ? 'wait' : 'none')),
          h('span', { class: 'tt', text: x.t }), strip(PHASES, phOf(x), { stop: x.st === 'ждёт вас' }),
          h('span', { class: 'nw ' + (x.st === 'ждёт вас' ? 'wait' : x.ready ? 'ready' : 'exec'),
            text: `${x.st === 'ждёт вас' ? 'СТОП · ' : x.ready ? 'к проверке · ' : x.st + ' · '}${x.step ? x.step.join('/') : ''} · ${x.pr}` })))] : null,
        convs.length ? [h('div', { class: 'dh', text: 'КОНВЕЙЕРЫ' }), convs.map(c => h('div', { class: 'dr' }, h('span', { class: 'muted', text: '⟳' }),
          h('span', { class: 'tt', text: `период ${c.period} · ${c.text}` }), strip(c.steps, c.cur, { done: c.done, small: true }), h('span', { class: 'muted', text: c.detail })))] : null,
        h('div', { class: 'links' },
          p.files.claude ? h('a', { tabindex: 0, onclick: () => host.open(p.files.claude) }, 'CLAUDE.md') : null,
          p.files.backlog ? h('a', { tabindex: 0, onclick: () => host.open(p.files.backlog) }, 'Бэклог') : null,
          lead && taskCmd(lead, p) ? h('button', { class: 'btn', title: taskCmd(lead, p).prompt + '\n— терминал в папке проекта', onclick: () => runIn(taskCmd(lead, p), p) },
            icon('term'), taskCmd(lead, p).title.split(':')[0]) : null,
          cmds.map(c => h('button', { class: 'btn', title: `${c.prompt}\n— терминал в папке проекта`, onclick: () => runIn(c, p) }, icon('term'), c.title)),
          p.workspace ? h('button', { class: 'btn', title: p.workspace, onclick: () => host.openWindow && host.openWindow(p.workspace) }, icon('win'), 'Окно проекта') : null));
    }

    function backlog(bl) {
      if (!bl.length) return h('div', { class: 'empty', text: 'Бэклог пуст.' });
      const out = [];
      const stale = bl.filter(x => x.reasons.some(r => r.kind === 'stale'));
      if (stale.length) {
        out.push(h('div', { class: 'grp', text: 'Устарели — решить на недельном обзоре' }));
        for (const x of stale) out.push(blItem(x, true));
      }
      const by = new Map(); for (const x of bl) { if (!by.has(x.p)) by.set(x.p, []); by.get(x.p).push(x); }
      const maxN = Math.max(...[...by.values()].map(v => v.length));
      out.push(h('div', { class: 'grp', text: 'По проектам' }));
      for (const [name, items] of [...by.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const open = !!st.xb[name], s = items.filter(x => x.reasons.some(r => r.kind === 'stale')).length;
        const toggle = () => { st.xb[name] = !open; save(); render(); };
        out.push(h('div', { class: 'row r-bl', tabindex: 0, 'aria-expanded': String(open), onclick: toggle, onkeydown: e => { if (e.key === 'Enter') toggle(); } },
          h('span', { class: 'tt', text: name }),
          h('span', { class: 'track', style: 'flex:none;width:120px' },
            h('span', { class: 'fill', style: `width:${(100 * items.length / maxN).toFixed(1)}%;background:var(--p-grey)` }),
            s ? h('span', { class: 'fill stale', style: `width:${(100 * s / maxN).toFixed(1)}%` }) : null),
          h('span', { class: 'num muted', text: `${items.length}${s ? ` · устарело ${s}` : ''} · ` +
            ['P1', 'P2', 'P3'].map(k => [k, items.filter(x => x.pr === k).length]).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') }), h('span')));
        if (open) for (const x of items) out.push(blItem(x, false));
      }
      return out;
    }
    function blItem(x, withProj) {
      const k = x.reasons.length ? (primary(x) || x.reasons[0]).kind : 'none';
      return h('div', Object.assign({ class: 'row r-bli', title: `${x.t}\n${x.note || ''}\nсоздана ${x.moved || '?'}` }, rowOpen(x.file)),
        h('span', { class: 'ic ' + k }, icon(k)), h('span', { class: 'tt', text: (withProj ? x.p + ' · ' : '') + x.t }),
        h('span', { class: 'chips' }, x.due ? chip(x.due < D0.today ? 'crit' : 'st', 'срок ' + dm(x.due)) : null, x.age != null ? chip('st', `${x.age} дн.`) : null), prB(x.pr));
    }

    function errorsLine(errs) {
      if (!errs.length) return h('div', { class: 'err', text: 'Ошибок в данных нет.' });
      const by = {}; for (const e of errs) by[e.kind] = (by[e.kind] || 0) + 1;
      const txt = Object.entries(by).map(([k, n]) => `${k} ${n}`).join(' · ');
      return h('div', { class: 'err' },
        h('button', { 'aria-expanded': String(st.err), onclick: () => { st.err = !st.err; save(); render(); } },
          `${st.err ? '▾' : '▸'} Ошибки данных: ${txt}`),
        st.err ? h('ul', {}, errs.map(e => h('li', {}, h('a', { tabindex: 0, onclick: () => host.open(e.file) }, `${e.p}: ${e.text}`),
          h('span', { class: 'muted', text: ` — ${e.kind}` })))) : null);
    }

    // Блок «Серверы» — в ряду шкал: порты из настройки cycleWelcome.servers и свободные диск и ОЗУ этой машины.
    // Данные добавляет вкладка (источники.js); список пуст — вкладка блок не передаёт.
    function servers(src, now) {
      const list = src.list || [];
      const state = s => s.open === true ? 'ok' : s.open === false ? 'crit' : 'unknown';
      const level = list.some(s => state(s) === 'crit') ? 'crit' : 'ok';
      const row = h('div', { class: 'meter srcs lv-' + level }, h('span', { class: 'm-t' }, dot(level, level), ' Серверы'));
      row.append(h('span', { class: 'seg ' + level }, list.map(s => h('span', { class: 'src',
        title: `${s.name}${s.purpose ? ' — ' + s.purpose : ''}\n${s.host}:${s.port}\n` +
          (s.open == null ? 'не проверялся' : s.open ? `порт открыт${s.ms != null ? `, ${s.ms} мс` : ''}` : 'порт закрыт') },
        dot(state(s), state(s)), s.name))));
      const gbTxt = v => String(Math.round(v * 10) / 10).replace('.', ',');
      if (src.disk) row.append(h('span', { class: 'seg', title: 'свободно на диске с папкой проектов' }, h('span', { class: 'm-k', text: 'Диск' }),
        `${gbTxt(src.disk.free_gb)} из ${gbTxt(src.disk.total_gb)} ГБ`));
      if (src.ram) row.append(h('span', { class: 'seg', title: 'свободная оперативная память этой машины' }, h('span', { class: 'm-k', text: 'ОЗУ' }),
        `${gbTxt(src.ram.free_gb)} из ${gbTxt(src.ram.total_gb)} ГБ`));
      row.append(h('span', { class: 'm-gap' }));
      if (src.checked) {
        const min = Math.round((now - new Date(src.checked)) / 60000);
        row.append(h('span', { class: 'muted', style: 'font-size:11px;margin-left:6px',
          text: `проверено ${String(src.checked).slice(11, 16)}` + (min >= 0 && min < 1440 ? ` · ${min < 1 ? 'только что' : min + ' мин назад'}` : '') }));
      }
      if (host.checkSources) row.append(h('button', { class: 'btn', title: 'Проверить порты сейчас', onclick: () => host.checkSources() }, icon('refresh'), 'Проверить'));
      return row;
    }

    render();
    return { update(d) { D0 = d; render(); }, render };
  }

  // ── хост браузера: файлы — в VS Code по ссылке vscode://file, команды — в буфер обмена ────────────────────
  function browserHost() {
    const KEY = 'pult-state';
    function toast(text) {
      const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
      (document.querySelector('.pult') || document.body).append(t); setTimeout(() => t.remove(), 2500);
    }
    function copy(text) {
      const done = () => toast('Скопировано: ' + text);
      const fallback = () => {
        const a = document.createElement('textarea'); a.value = text; document.body.append(a); a.select();
        try { document.execCommand('copy'); done(); } catch (e) { toast(text); }
        a.remove();
      };
      try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
    }
    return {
      open: p => { location.href = 'vscode://file/' + encodeURI(String(p).replace(/\\/g, '/')); },
      run: cmd => copy(cmd.prompt),
      openWindow: p => { location.href = 'vscode://file/' + encodeURI(String(p).replace(/\\/g, '/')); },
      pickWindow: ws => toast('Окна: ' + ws.map(w => w.label).join(' · ')),
      copy,
      getState: () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } },
      setState: s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* без памяти — не беда */ } },
      now: () => new Date(),
    };
  }

  global.Pult = { mount, browserHost };
})(typeof window !== 'undefined' ? window : globalThis);

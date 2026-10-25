# -*- coding: utf-8 -*-
"""Собирает данные «Монитора проектов» вкладки «Цикл-Про».

Пишет в папку --out два файла: пульт-данные.json по контракту v2 (комментарий в начале пульт/пульт.js) — их
показывает вкладка; пульт.html — монитор для браузера (шаблон.html + пульт.css + пульт.js + данные).
Причины, здоровье и счётчики считаются только здесь, рендерер их показывает.

Источник данных — только файлы папки проектов: шапки и шаги планов, таблица бэклога, git, сигналы автоматов
проекта (`_Служебное/сигналы.json`), команды (`пульт/команды.json`, `<проект>/_Служебное/команды.json`), сессии
Claude Code (`~/.claude/projects` или `$CLAUDE_CONFIG_DIR/projects`), файлы периодов проектов из настройки «конвейеры»,
файл состояния сервера из настройки «сервер» (плитка сервера). Пульт ничего не хранит сам.
Битый файл проекта пульт не роняет: он попадает в «ошибки данных».

Соглашение сигналов: автомат проекта сам пишет `<проект>/_Служебное/сигналы.json` — список
`[{"текст", "уровень": ok|warn|crit, "дата"}]`. Монитор показывает warn и crit; ok и пустой список — тишина.

Демо (--demo или папка проектов — встроенная demo/): «сегодня», коммиты, сессии, даты движения планов и
«незакоммичено» берутся из `_активность.json`, а настройки — из `_настройки.json` рядом (в демо нет .git).

    python собрать.py --root ПАПКА --out ПАПКА_ВЫВОДА [--config НАСТРОЙКИ.json] [--commands КОМАНДЫ.json]
                      [--demo] [--today ГГГГ-ММ-ДД] [--quiet]
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import unquote

HERE = Path(__file__).resolve().parent
OPEN_STATUSES = {"черновик", "утверждён", "в работе", "ждёт вас", "отложен"}
ATTENTION = ("crit", "wait", "ready", "warn")          # причины «Нужно вам» в порядке показа
DEMO_FILE, DEMO_SETTINGS = "_активность.json", "_настройки.json"


# ── чтение файлов проекта ──────────────────────────────────────────────────────────────────────────────────────
def read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


def load_json(f: Path):
    """JSON файла или None: файла нет или он битый."""
    try:
        return json.loads(f.read_text(encoding="utf-8-sig")) if f and f.exists() else None
    except Exception:
        return None


def is_demo(root: Path, flag=False):
    """Демо — по ключу --demo или если папка проектов — встроенная demo/; файл _активность.json в чужой папке
    демо не включает."""
    return bool(flag) or root.resolve() == (HERE.parent / "demo").resolve()


def load_config(root: Path, config, demo=False):
    """Пороги по умолчанию (пороги.json) поверх — настройки демо или пользователя (--config)."""
    th = json.loads(read(HERE / "пороги.json"))
    if config:
        over = load_json(Path(config))
        if not isinstance(over, dict):
            raise SystemExit(f"Настройки монитора не прочитаны: {config}")
    else:
        over = load_json(root / DEMO_SETTINGS) if demo else None
    if isinstance(over, dict):
        th.update(over)
    return th


def inside(proj: Path, rel: str):
    """Путь из блока «Цикл» или настроек — только внутри папки проекта; «..» наружу — None."""
    p = (proj / rel).resolve()
    return p if p == proj.resolve() or proj.resolve() in p.parents else None


def data_error(errors, kind, p, f, text):
    errors.append({"kind": kind, "p": p, "file": str(f), "text": text})


def guarded(errors, p, f, what, fn, default):
    """Вызов fn(); сбой на чужом файле — ошибка данных «сбой» и значение default, сборка идёт дальше."""
    try:
        return fn()
    except Exception as e:
        data_error(errors, "сбой", p, f, f"{what}: {type(e).__name__} {e}"[:200])
        return default


def cycle_config(proj: Path):
    md = proj / "CLAUDE.md"
    if not md.exists():
        return None
    m = re.search(r"(?ms)^##\s+Цикл\s*$.*?```ya?ml\s*\n(.*?)```", read(md))
    if not m:
        return None
    cfg = {}
    for line in m.group(1).splitlines():
        line = re.sub(r"\s+#.*$", "", line).strip()
        mm = re.match(r"^([^:#]+):\s*(.*)$", line)
        if mm and mm.group(2).strip() and not re.match(r"^\{.*\}$", mm.group(2).strip()):
            cfg[mm.group(1).strip()] = mm.group(2).strip()
    return cfg


def front_matter(text: str) -> dict:
    m = re.match(r"(?s)\A---\s*\n(.*?)\n---", text)
    fm = {}
    if m:
        for line in m.group(1).splitlines():
            mm = re.match(r"^([^:]+):\s*(.*)$", line)
            if mm:
                fm[mm.group(1).strip()] = mm.group(2).strip()
    return fm


def date_or_none(s):
    try:
        return dt.date.fromisoformat(str(s).strip()[:10])
    except Exception:
        return None


def period_info(proj: Path, cfg: dict):
    """Период проекта A и сколько ожидаемых выгрузок на месте."""
    if not cfg or cfg.get("профиль") != "A" or not cfg.get("выгрузки"):
        return None
    period = None
    pf = inside(proj, cfg["период_файл"]) if cfg.get("период_файл") else None
    if pf and pf.exists():
        period = read(pf).strip()
    if not period:
        base = inside(proj, cfg["выгрузки"].split("{период}")[0])
        if base and base.exists():
            ps = sorted(p.name for p in base.iterdir() if p.is_dir() and re.match(r"^\d{4}-\d{2}$", p.name))
            period = ps[-1] if ps else None
    if not period:
        return None
    src = inside(proj, cfg["выгрузки"].replace("{период}", period))
    if not src:
        return None
    exp = [x.strip() for x in cfg.get("ожидаемые", "").split(",") if x.strip()]
    have = sum(1 for x in exp if any(src.glob(x))) if src.exists() else 0
    return {"period": period, "have": have, "need": len(exp)}


def signals(proj: Path):
    """Сигналы автоматов проекта; битый или чужой формат — пусто, пульт из-за них не падает."""
    data = load_json(proj / "_Служебное" / "сигналы.json")
    out = []
    for s in data if isinstance(data, list) else []:
        if isinstance(s, dict) and s.get("текст") and s.get("уровень") in ("warn", "crit"):
            out.append({"текст": str(s["текст"]), "уровень": s["уровень"], "дата": s.get("дата")})
    return out


def backlog_rows(path: Path):
    rows = []
    if not path.exists():
        return rows
    for line in read(path).splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4 or not line.strip().startswith("|"):
            continue
        if cells[0] in ("Задача", "") or set(cells[0]) <= set("-: "):
            continue
        rows.append({"t": cells[0], "pr": cells[1] or "P2", "due": cells[2] or None,
                     "moved": cells[3] or None, "note": cells[4] if len(cells) > 4 else ""})
    return rows


def read_commands(f: Path, p, errors):
    """Команды из json-списка {id, название, запрос, подтвердить?, подсказка?}; без id или запроса — ошибка данных."""
    if not f.exists():
        return []
    raw = load_json(f)
    if not isinstance(raw, list):
        data_error(errors, "команда", p, f, f"{f.name}: не JSON-список")
        return []
    out = []
    for c in raw:
        if not (isinstance(c, dict) and c.get("id") and c.get("запрос")):
            name = c.get("название", "?") if isinstance(c, dict) else c
            data_error(errors, "команда", p, f, f"{f.name}: нет id или запроса — {name}")
            continue
        x = {"id": str(c["id"]), "title": str(c.get("название") or c["id"]), "prompt": str(c["запрос"])}
        if c.get("подтвердить"):
            x["confirm"] = True
        if c.get("подсказка"):
            x["hint"] = str(c["подсказка"])
        out.append(x)
    return out


# ── git, сессии, демо ──────────────────────────────────────────────────────────────────────────────────────────
def real_git(proj: Path, *args):
    """Вывод git в папке проекта; None — у проекта нет git или git не ответил. Пустой вывод — ""."""
    if not (proj / ".git").exists():
        return None
    try:
        r = subprocess.run(["git", "-C", str(proj), *args], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=20)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def demo_git(demo: dict):
    """git для демо: коммиты, последний коммит, «незакоммичено» и даты движения планов из _активность.json."""
    def git(proj: Path, *args):
        name = proj.name
        commits = demo.get("коммиты", {}).get(name, {})
        if args[:1] == ("status",):
            return "\n".join(["?? файл"] * demo.get("незакоммичено", {}).get(name, 0)) if commits else None
        if args[:3] == ("log", "-1", "--format=%cs") and len(args) == 5 and args[3] == "--":
            # план без даты в демо — «сегодня» демо, а не дата клонирования репозитория
            rel = (name + "/" + args[4]).replace("\\", "/")
            return demo.get("изменён", {}).get(rel) or demo.get("сегодня")
        if args[:2] == ("log", "-1"):
            return max(commits) if commits else None
        if args[:1] == ("log",):
            return "\n".join(d for d, n in sorted(commits.items()) for _ in range(n))
        return None
    return git


def claude_folder(path: Path) -> str:
    """Имя папки сессий Claude Code для пути: каждый символ, кроме латиницы и цифр, — «-»."""
    return re.sub(r"[^A-Za-z0-9]", "-", str(path))


def claude_projects_dir():
    """Папка сессий Claude Code: $CLAUDE_CONFIG_DIR/projects или ~/.claude/projects."""
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "projects"


def session_cwd(f: Path):
    """Рабочая папка сессии — поле cwd в первых записях её .jsonl; не нашлась — None."""
    try:
        with open(f, encoding="utf-8", errors="replace") as fh:
            for _, line in zip(range(50), fh):
                m = re.search(r'"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"', line)
                if m:
                    return Path(json.loads(f'"{m.group(1)}"'))
    except OSError:
        pass
    return None


def sessions_by_day(root: Path, claude_projects: Path):
    """Сессии Claude Code по (проект, дата): файл *.jsonl в <папка сессий>/<путь>, дата — последняя запись.
    Проект — по полю cwd сессии: имя папки сессий ненадёжно (кириллица в нём становится «-», имена совпадают).
    Сессии в подпапках проекта считаются за проект."""
    c = Counter()
    if not claude_projects.is_dir() or not root.is_dir():
        return c
    base = str(root.resolve()).casefold()
    prefix = claude_folder(root.resolve()).casefold()
    for d in claude_projects.iterdir():
        if not d.is_dir() or not d.name.casefold().startswith(prefix):
            continue
        for f in d.glob("*.jsonl"):
            cwd = session_cwd(f)
            if not cwd or not str(cwd).casefold().startswith(base):
                continue
            parts = Path(str(cwd)[len(base):].lstrip("\\/")).parts
            if parts and (root / parts[0]).is_dir():
                c[(parts[0], dt.date.fromtimestamp(f.stat().st_mtime).isoformat())] += 1
    return c


def activity(proj: Path, days, git, sess):
    log = git(proj, "log", "--since=" + days[0].isoformat() + "T00:00", "--format=%cs")
    cc = Counter(log.split()) if log else Counter()
    return {"commits": [cc.get(d.isoformat(), 0) for d in days],
            "sessions": [sess.get((proj.name, d.isoformat()), 0) for d in days]}


def active(P):
    return sum(P["activity"]["commits"]) + sum(P["activity"]["sessions"]) > 0


# ── планы и задачи ─────────────────────────────────────────────────────────────────────────────────────────────
def steps_info(text: str):
    """[отмечено, всего] шагов и текст ближайшего неотмеченного шага, если это СТОП."""
    sec = re.search(r"(?ms)^##\s+Шаги\s*$(.*?)(?=^##\s|\Z)", text)
    lines = re.findall(r"(?m)^\s*-\s\[( |x|X)\]\s*(.*)$", sec.group(1) if sec else text)
    stop = None
    for b, t in lines:
        if b == " ":
            if "СТОП" in t:
                stop = re.split(r"\s+—\s+|\.\s", re.sub(r"\*\*", "", t).strip())[0][:120]
            break
    return [sum(1 for b, _ in lines if b != " "), len(lines)], stop


def verified_mark(text):
    """Фаза «закрытие»: в «Отклонениях» есть запись прогона — строка «- <дата>, /verify …» (или /cycle:verify);
    упоминание /verify внутри другой записи не считается."""
    dev = re.search(r"(?ms)^##\s+Отклонения\s*$(.*?)(?=^##\s|\Z)", text)
    return bool(dev and re.search(r"(?m)^\s*-\s*\**\s*\d{4}-\d{2}-\d{2}[,:]?\s*`?/(cycle:)?verify\b", dev.group(1)))


def check_due(due, p, f: Path, what, errors, plan=False):
    """Срок датой или None. Пусто — нет срока; «—» — тоже нет срока, у плана с пометкой в ошибках данных;
    иное — ошибка данных «срок»."""
    due = (due or "").strip()
    if not due:
        return None
    if due in ("—", "-"):
        if plan:
            data_error(errors, "срок", p, f, f"«{due}» — {what}")
        return None
    if date_or_none(due) is None:
        data_error(errors, "срок", p, f, f"«{due}» — {what}")
        return None
    return due[:10]


def read_plan(proj: Path, f: Path, git, errors):
    """Открытый план задачей; без шапки и с неизвестным статусом — в ошибки данных."""
    text = read(f)
    fm = front_matter(text)
    st = fm.get("статус", "")
    if not fm:
        data_error(errors, "без шапки", proj.name, f, f.name)
        return None
    if st == "закрыт":
        return None
    if st not in OPEN_STATUSES:
        data_error(errors, "неизвестный статус", proj.name, f, f"«{st}» — {f.name}")
        return None
    title = re.search(r"(?m)^#\s+(.+)$", text)
    moved = git(proj, "log", "-1", "--format=%cs", "--", f.relative_to(proj).as_posix()) \
        or dt.date.fromtimestamp(f.stat().st_mtime).isoformat()
    step, stop = steps_info(text)
    return {"id": f"{proj.name}/{f.stem}", "p": proj.name, "t": title.group(1).strip() if title else f.stem,
            "st": st, "pr": fm.get("приоритет") or "P2", "due": check_due(fm.get("срок"), proj.name, f, f.name, errors, plan=True),
            "moved": moved, "step": step, "stop": stop,
            "ready": step[1] > 0 and step[0] == step[1] and st != "отложен",
            "wait": fm.get("ждёт") or None, "file": str(f), "verified": verified_mark(text)}


def backlog_tasks(name, bl: Path, errors):
    out = []
    for i, r in enumerate(backlog_rows(bl)):
        out.append({"id": f"{name}/бэклог/{i}", "p": name, "t": r["t"], "st": "бэклог", "pr": r["pr"],
                    "due": check_due(r["due"], name, bl, r["t"][:60], errors), "moved": r["moved"],
                    "step": None, "stop": None, "ready": False, "wait": None, "file": str(bl), "note": r["note"]})
    return out


def task_reasons(x, today, th):
    """Причины внимания задачи; заодно age (дней без движения) и limit (порог статуса)."""
    r = []
    due, moved = date_or_none(x.get("due")), date_or_none(x.get("moved"))
    age = (today - moved).days if moved else None
    if x["st"] == "бэклог":
        lim = th["бэклог_P3_дней"] if x["pr"] == "P3" else th["бэклог_P1_P2_дней"]
    else:
        lim = {"в работе": th["в_работе_дней"], "ждёт вас": th["ждёт_вас_дней"],
               "утверждён": th["утверждён_не_начат_дней"]}.get(x["st"])
    x["age"], x["limit"] = age, lim
    if due:
        left = (due - today).days
        if left < 0:
            r.append({"kind": "crit", "text": f"просрочено на {-left} дн."})
        elif left <= th["срок_скоро_дней"]:
            r.append({"kind": "warn", "text": "срок сегодня" if left == 0 else f"срок через {left} дн."})
    if x.get("ready"):
        r.append({"kind": "ready", "text": "шаги выполнены — /cycle:verify или /close-task"})
    elif x["st"] == "ждёт вас":
        r.append({"kind": "wait", "text": f"ждёт вас {age} дн." + (f": {x['wait']}" if x.get("wait") else "")})
    elif lim is not None and age is not None and age > lim:
        if x["st"] == "бэклог":
            r.append({"kind": "stale", "text": f"в бэклоге {age} дн." + (" — удалить?" if x["pr"] == "P3" else "")})
        elif x["st"] == "утверждён":
            r.append({"kind": "stale", "text": f"утверждён, не начат {age} дн."})
        else:
            r.append({"kind": "stale", "text": f"без движения {age} дн. (порог {lim})"})
    return r


def has(x, kind):
    return any(r["kind"] == kind for r in x["reasons"])


# ── проект: здоровье, ведущий план, этап ───────────────────────────────────────────────────────────────────────
def health(P, mine):
    """Здоровье проекта, «нет следующего шага», устаревший бэклог. Бэклог на цвет не влияет (контракт пульт.js)."""
    plans = [x for x in mine if x["st"] != "бэклог"]
    P["backlog_stale"] = sum(1 for x in mine if x["st"] == "бэклог" and has(x, "stale"))
    red = any(has(x, "crit") for x in plans) or any(s["уровень"] == "crit" for s in P["sig"])
    yellow = any(has(x, "stale") or has(x, "warn") or
                 (x["st"] == "ждёт вас" and x["age"] is not None and x["age"] > x["limit"]) for x in plans) \
        or any(s["уровень"] == "warn" for s in P["sig"])
    P["health"] = "red" if red else "yellow" if yellow else "green" if active(P) else "grey"
    why = []
    if red:
        why.append("просрочка или срочный сигнал")
    if yellow:
        why.append("ждёт, стоит или срок скоро")
    if P["health"] == "grey":
        why.append("нет активности 30 дн.")
    P["health_why"] = why
    P["no_next"] = P["cycle"] and P["plans"] == 0 and P["backlog"] == 0


PHASES = ["план", "исполнение", "проверка", "закрытие"]
NOW = {"stop": "стоп", "ready": "к проверке", "exec": "исполнение", "start": "к старту", "plan": "план"}
PRIORITY = {"P1": 1, "P2": 2, "P3": 3}


def lead_rank(x):
    """Ведущий план: стоп, к проверке, исполнение, к старту, план; при равенстве — выше приоритет."""
    kind = 0 if x["st"] == "ждёт вас" and not x["ready"] else 1 if x["ready"] else \
        2 if x["st"] == "в работе" else 3 if x["st"] == "утверждён" else 4
    return kind, PRIORITY.get(x["pr"], 9)


def lead_and_stage(P, mine, cfg, verified, errors=None):
    """«Сейчас», фаза схемы «Цикл работы» и этап проекта по профилю."""
    plans = [x for x in mine if x["st"] not in ("бэклог", "отложен")]
    lead = min(plans, key=lead_rank) if plans else None
    if lead:
        kind = ["stop", "ready", "exec", "start", "plan"][lead_rank(lead)[0]]
        k, n = lead["step"]
        steps = f"{k}/{n}" if n else ""
        P["now"] = {"kind": kind, "text": f"{NOW[kind]} {steps}".strip() if kind == "exec" else NOW[kind],
                    "task": lead["id"]}
        i = 0 if lead["st"] == "черновик" else (3 if lead["id"] in verified else 2) if lead["ready"] else 1
        text = PHASES[i] + (f" {steps}" if i == 1 and steps else "")
        stop = lead["st"] == "ждёт вас"
        P["phase"] = {"i": i, "stop": stop, "text": text + (" · СТОП" if stop else ""), "task": lead["id"]}
    else:
        P["now"] = {"kind": "quiet", "text": "тихо", "task": None}
        P["phase"] = None
    if P["prof"] == "A":
        pi = guarded(errors if errors is not None else [], P["n"], P["path"], "период", lambda: period_info(Path(P["path"]), cfg), None)
        if pi:
            P["stage"] = {"lane": "A", "name": "выгрузки" if pi["have"] < pi["need"] else "расчёт",
                          "detail": f"{pi['period']} · {pi['have']}/{pi['need']}"}
        else:
            P["stage"] = {"lane": "A", "name": "нет периода", "detail": None}
    elif P["prof"] == "C":
        name = "готово" if not lead else {"черновик": "черновик", "ждёт вас": "согласование"}.get(lead["st"], "в работе")
        P["stage"] = {"lane": "C", "name": name, "detail": None}
    elif P["cycle"]:
        name = "разработка" if plans else "сопровождение" if active(P) else "пауза"
        P["stage"] = {"lane": "B", "name": name, "detail": None}
    else:
        P["stage"] = {"lane": "—", "name": "активен" if active(P) else "спит", "detail": None}


# ── конвейер периода ───────────────────────────────────────────────────────────────────────────────────────────
# Настройка «конвейеры»: {"<проект>": {"папка": "Периоды", "этапы": [["<этап>", "<признак>"], …]}}. Период — подпапка
# ГГГГ-ММ; этап пройден, если в папке периода есть файл по маске-признаку (пустой признак — пройден всегда).
def next_period(period):
    y, m = int(period[:4]), int(period[5:])
    return f"{y + (m == 12)}-{m % 12 + 1:02d}"


def stage_done(pd: Path, mask: str):
    return True if not mask else any(f.is_file() for f in pd.glob(mask))


def conveyor(proj: Path, spec: dict, period: str):
    pd = proj / spec.get("папка", "Периоды") / period
    stages = spec.get("этапы", [])
    if not all(isinstance(e, (list, tuple)) and len(e) == 2 for e in stages):
        raise ValueError("этап конвейера — пара [название, маска файла]")
    names = [str(e[0]) for e in stages]
    done = [stage_done(pd, str(e[1])) for e in stages]
    cur = len(done) if all(done) else done.index(False)
    nxt = next_period(period)
    nxt_open = (pd.parent / nxt).exists()
    text = "закрыт" if cur == len(done) else names[cur]
    detail = f"этапы {sum(done)}/{len(done)} · {nxt} {'открыт' if nxt_open else 'не открыт'}"
    return {"period": period, "steps": names, "done": done, "cur": cur, "text": text, "detail": detail}


def conveyors(proj: Path, spec):
    """Открытые конвейеры: последний период и прошлые, у которых пройдены не все этапы."""
    if not isinstance(spec, dict) or not spec.get("этапы"):
        return []
    per = inside(proj, spec.get("папка", "Периоды"))
    if not per:
        raise ValueError("папка периодов вне папки проекта")
    ps = sorted(q.name for q in per.iterdir() if q.is_dir() and re.match(r"^\d{4}-\d{2}$", q.name)) \
        if per.exists() else []
    out = []
    for i, period in enumerate(ps):
        c = conveyor(proj, spec, period)
        if i == len(ps) - 1 or c["cur"] < len(c["done"]):
            out.append(c)
    return out


# ── плитка сервера ─────────────────────────────────────────────────────────────────────────────────────────────
# Настройка «сервер»: {"файл": "<путь к JSON состояния сервера>", "пороги": {disk_warn, disk_crit, commit_warn, commit_crit}}.
# Файл пишет свой монитор сервера (раз в час и т. п.); формат — README, пример — demo/_сервер.json. Относительный путь —
# от папки проектов.
SERVER_THRESHOLDS = {"disk_warn": 10, "disk_crit": 5, "commit_warn": 85, "commit_crit": 90}


def level(value, warn, crit, low_is_bad):
    if low_is_bad:
        return "crit" if value < crit else "warn" if value < warn else "ok"
    return "crit" if value >= crit else "warn" if value >= warn else "ok"


def server_history(rows, days):
    """Тренды 30 дней из «истории» файла: последнее значение за день; дня нет — null."""
    disk, com = {}, {}
    for r in rows if isinstance(rows, list) else []:
        d = str((r or {}).get("дата") or "")[:10]
        try:
            disk[d], com[d] = float(r["диск_свободно_гб"]), round(float(r["commit_процент"]))
        except (KeyError, TypeError, ValueError):
            continue
    if not disk:
        return None
    return {"days": [d.isoformat() for d in days], "disk_free_gb": [disk.get(d.isoformat()) for d in days],
            "commit_pct": [com.get(d.isoformat()) for d in days]}


def server_tile(root: Path, spec, days):
    """Плитка сервера из файла состояния (контракт Server в пульт.js); нет настройки, файла или чисел — None."""
    if not isinstance(spec, dict) or not spec.get("файл"):
        return None
    f = Path(spec["файл"])
    f = f if f.is_absolute() else root / f
    m = load_json(f)
    if m is None:
        if f.exists():
            raise ValueError(f"не JSON: {f.name}")
        return None
    disk, ram, com = m.get("диск") or {}, m.get("озу") or {}, m.get("commit") or {}
    free, pct = disk.get("свободно_гб"), com.get("процент")
    if pct is None and com.get("занято_гб") is not None and com.get("предел_гб"):
        pct = round(100 * com["занято_гб"] / com["предел_гб"])
    if not isinstance(free, (int, float)) or not isinstance(pct, (int, float)):
        raise ValueError("нет чисел: диск.свободно_гб и commit.процент")
    t = {**SERVER_THRESHOLDS, **(spec.get("пороги") or {})}
    name, mark = str(m.get("имя") or "Сервер"), str(disk.get("метка") or "")
    disk_lvl = level(free, t["disk_warn"], t["disk_crit"], low_is_bad=True)
    com_lvl = level(pct, t["commit_warn"], t["commit_crit"], low_is_bad=False)
    bak = m.get("бэкап") if isinstance(m.get("бэкап"), dict) else {}
    backup = bak.get("изменён") if bak.get("есть") else None
    why = []
    if disk_lvl != "ok":
        why.append({"kind": disk_lvl, "text": f"диск {mark}: свободно {free} ГБ".replace("диск :", "диск:")})
    if com_lvl != "ok":
        why.append({"kind": com_lvl, "text": f"commit памяти {pct} %"})
    if not backup:
        why.append({"kind": "crit", "text": "бэкапа нет"})
    if m.get("ожидает_перезагрузки"):
        why.append({"kind": "warn", "text": "ждёт перезагрузки после обновлений"})
    if m.get("аварийных_14д"):
        why.append({"kind": "warn", "text": f"аварийных перезагрузок за 14 дней: {m['аварийных_14д']}"})
    return {"name": name, "checked": m.get("замер"), "file": str(f), "thresholds": t,
            "disk": {"free_gb": free, "total_gb": disk.get("всего_гб"), "mark": mark, "level": disk_lvl},
            "ram": {"free_gb": ram.get("свободно_гб"), "total_gb": ram.get("всего_гб")},
            "commit": {"used_gb": com.get("занято_гб"), "total_gb": com.get("предел_гб"), "pct": pct, "level": com_lvl},
            "sessions": [{"user": x.get("пользователь"), "gb": x.get("гб")} for x in m.get("сеансы", [])
                         if isinstance(x, dict) and x.get("пользователь")],
            "top": [{"name": x.get("имя"), "n": x.get("n"), "gb": x.get("гб")} for x in m.get("топ", [])
                    if isinstance(x, dict) and x.get("имя")],
            "boot": m.get("загрузка"), "reboot_pending": bool(m.get("ожидает_перезагрузки")),
            "crashes_14d": m.get("аварийных_14д") or 0,
            "backup": {"last": backup, "level": "ok" if backup else "crit"},
            "history": server_history(m.get("история"), days),
            "level": "crit" if any(w["kind"] == "crit" for w in why) else "warn" if why else "ok", "why": why}


# ── окна VS Code ───────────────────────────────────────────────────────────────────────────────────────────────
def vscode_storage():
    """workspaceStorage VS Code по ОС: там видно, когда окно последний раз работало."""
    if sys.platform.startswith("win"):
        return Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming")) / "Code/User/workspaceStorage"
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/Code/User/workspaceStorage"
    return Path.home() / ".config/Code/User/workspaceStorage"


def workspace_use(storage: Path):
    """Когда окно workspace последний раз работало: папка на окно, в ней workspace.json со ссылкой на
    .code-workspace — время последней записи в папке. Ключ — путь в нижнем регистре."""
    used = {}
    for d in storage.iterdir() if storage.is_dir() else []:
        meta = load_json(d / "workspace.json")
        uri = meta.get("workspace") if isinstance(meta, dict) else None
        if not isinstance(uri, str) or not uri.startswith("file://"):
            continue
        raw = unquote(uri[len("file://"):])
        key = str(Path(raw[1:] if re.match(r"^/[A-Za-z]:", raw) else raw)).casefold()
        try:
            stamp = max(f.stat().st_mtime for f in d.iterdir())
        except (OSError, ValueError):
            continue
        used[key] = max(used.get(key, 0), stamp)
    return used


def workspaces(root: Path, storage: Path):
    """Все *.code-workspace в папке проектов и папках проектов: сначала недавно открытые, затем по имени."""
    used = workspace_use(storage)
    files = list(root.glob("*.code-workspace")) + list(root.glob("*/*.code-workspace"))
    ws = []
    for f in files:
        stamp = used.get(str(f).casefold())
        ws.append({"name": f.stem, "path": str(f), "folder": "" if f.parent == root else f.parent.name,
                   "used": dt.datetime.fromtimestamp(stamp).strftime("%Y-%m-%dT%H:%M") if stamp else None})
    ws.sort(key=lambda w: w["path"].casefold())
    ws.sort(key=lambda w: w["used"] or "", reverse=True)     # устойчивая: без used — в конце, по пути
    names = [w["name"] for w in ws]
    for w in ws:
        unique = names.count(w["name"]) == 1 or w["folder"] in ("", w["name"])
        w["label"] = w["name"] if unique else f"{w['name']} ({w['folder']})"
    return ws


def project_workspace(ws, name):
    """Своё окно проекта: одноимённый workspace в его папке, иначе первый в ней."""
    own = [w for w in ws if w["folder"] == name]
    return next((w["path"] for w in own if w["name"] == name), own[0]["path"] if own else None)


# ── сборка ─────────────────────────────────────────────────────────────────────────────────────────────────────
def count(projects, tasks, th, server=None):
    """Шкалы шапки и «Нужно вам»: задачи с причинами ATTENTION, сигналы проектов и строки плитки сервера."""
    sigs = sum(len(P["sig"]) for P in projects)
    att = sum(1 for x in tasks if any(has(x, k) for k in ATTENTION))
    return {
        "attention": att + sigs + (len(server["why"]) if server else 0),
        "overdue": sum(1 for x in tasks if has(x, "crit")),
        "wait": sum(1 for x in tasks if x["st"] == "ждёт вас"),
        "ready": sum(1 for x in tasks if x["ready"]),
        "soon": sum(1 for x in tasks if has(x, "warn")),
        "stale": sum(1 for x in tasks if x["st"] != "бэклог" and has(x, "stale")),
        "signals": sigs,
        "work": sum(1 for x in tasks if x["st"] == "в работе"),
        "p1": sum(1 for x in tasks if x["pr"] == "P1" and x["st"] in ("в работе", "ждёт вас", "утверждён")),
        "p1_limit": th["лимит_P1"],
        "backlog": sum(1 for x in tasks if x["st"] == "бэклог"),
        "backlog_stale": sum(P["backlog_stale"] for P in projects),
        "no_due": sum(1 for x in tasks if x["st"] != "бэклог" and not x["due"]),
    }


def build(root: Path, th: dict, today: dt.date = None, *, demo=False, git=None, commands=None, claude_projects=None):
    """Данные пульта v2 (контракт — комментарий в начале пульт/пульт.js)."""
    demo = load_json(root / DEMO_FILE) if demo else None
    demo = demo if isinstance(demo, dict) else None
    if demo:
        today = today or date_or_none(demo.get("сегодня"))
        git = git or demo_git(demo)
        sess = Counter({(p, d): n for p, days_ in demo.get("сессии", {}).items() for d, n in days_.items()})
    else:
        git = git or real_git
        sess = sessions_by_day(root, Path(claude_projects) if claude_projects else claude_projects_dir())
    today = today or dt.date.today()
    skip = set(th.get("не_показывать", []))
    days = [today - dt.timedelta(days=29 - i) for i in range(30)]
    storage = Path(th["vscode_storage"]) if th.get("vscode_storage") else vscode_storage()
    ws = workspaces(root, storage)
    projects, tasks, errors, cfgs, verified = [], [], [], {}, set()
    for proj in sorted(p for p in root.iterdir() if p.is_dir()):
        name = proj.name
        if name.startswith((".", "_")) or name in skip:
            continue
        cfg = cfgs[name] = cycle_config(proj)
        status = git(proj, "status", "--porcelain")
        P = {"n": name, "path": str(proj), "prof": (cfg or {}).get("профиль"), "cycle": bool(cfg),
             "personal": name in th.get("личные", []), "git": status is not None,
             "commit": git(proj, "log", "-1", "--format=%cs") or None, "activity": activity(proj, days, git, sess),
             "dirty": None if status is None else len([l for l in status.splitlines() if l.strip()]),
             "plans": 0, "backlog": 0, "backlog_stale": 0, "sig": signals(proj) if cfg else [], "files": {},
             "commands": read_commands(proj / "_Служебное" / "команды.json", name, errors),
             "workspace": project_workspace(ws, name)}
        if (proj / "CLAUDE.md").exists():
            P["files"]["claude"] = str(proj / "CLAUDE.md")
        if cfg:
            pd = inside(proj, cfg.get("планы", "_Служебное/Планы"))
            for f in sorted(pd.glob("*.md")) if pd and pd.exists() else []:
                x = guarded(errors, name, f, "план", lambda: read_plan(proj, f, git, errors), None)
                if x:
                    if x["verified"]:
                        verified.add(x["id"])
                    tasks.append(x)
                    P["plans"] += 1
            bl = inside(proj, cfg.get("бэклог", "_Служебное/Бэклог.md"))
            if bl and bl.exists():
                P["files"]["backlog"] = str(bl)
                rows = guarded(errors, name, bl, "бэклог", lambda: backlog_tasks(name, bl, errors), [])
                tasks.extend(rows)
                P["backlog"] = len(rows)
        projects.append(P)
    for x in tasks:
        x["reasons"] = task_reasons(x, today, th)
    for P in projects:
        mine = [x for x in tasks if x["p"] == P["n"]]
        health(P, mine)
        lead_and_stage(P, mine, cfgs.get(P["n"]), verified, errors)
        spec = th.get("конвейеры", {}).get(P["n"])
        P["conveyors"] = guarded(errors, P["n"], P["path"], "конвейер", lambda: conveyors(Path(P["path"]), spec), [])
    server = guarded(errors, "сервер", (th.get("сервер") or {}).get("файл", ""), "плитка сервера",
                     lambda: server_tile(root, th.get("сервер"), days), None)
    return {"v": 2, "generated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "today": today.isoformat(),
            "demo": bool(demo), "root": str(root), "thresholds": th, "counts": count(projects, tasks, th, server),
            "server": server,
            "commands": read_commands(Path(commands) if commands else HERE / "команды.json", "", errors),
            "projects": projects, "tasks": tasks, "errors": errors, "workspaces": ws}


# ── вывод ──────────────────────────────────────────────────────────────────────────────────────────────────────
def script_json(data):
    """JSON для вставки в <script>: «<» как \\u003c, чтобы данные не закрыли тег и не открыли комментарий."""
    return json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")


def write_atomic(f: Path, text: str):
    """Запись через временный файл: вкладка следит за файлом и не должна прочитать его наполовину."""
    tmp = f.with_name(f".{f.name}.{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, f)


def write(out: Path, data):
    """Пишет в папку out пульт-данные.json и пульт.html (если рядом есть шаблон)."""
    out.mkdir(parents=True, exist_ok=True)
    write_atomic(out / "пульт-данные.json", json.dumps(data, ensure_ascii=False, indent=1))
    if all((HERE / n).exists() for n in ("шаблон.html", "пульт.css", "пульт.js")):
        parts = {"CSS": read(HERE / "пульт.css"), "JS": read(HERE / "пульт.js"), "DATA": script_json(data)}
        html = re.sub(r"/\*(CSS|JS|DATA)\*/", lambda m: parts[m.group(1)], read(HERE / "шаблон.html"))
        write_atomic(out / "пульт.html", html)


def main():
    ap = argparse.ArgumentParser(description="Сборщик монитора проектов «Цикл-Про»")
    ap.add_argument("--root", default=str(HERE.parent / "demo"), help="папка проектов (по умолчанию — демо)")
    ap.add_argument("--out", required=True, help="папка для пульт-данные.json и пульт.html")
    ap.add_argument("--config", default=None, help="JSON с настройками монитора поверх пороги.json")
    ap.add_argument("--commands", default=None, help="JSON с общими командами вместо пульт/команды.json")
    ap.add_argument("--demo", action="store_true", help="папка проектов — демо (_активность.json, _настройки.json)")
    ap.add_argument("--today", default=None)
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    root = Path(a.root)
    demo = is_demo(root, a.demo)
    data = build(root, load_config(root, a.config, demo), date_or_none(a.today), demo=demo, commands=a.commands)
    write(Path(a.out), data)
    if not a.quiet:
        print(f"Монитор: {a.out} · проектов {len(data['projects'])}, задач {len(data['tasks'])}, "
              f"ошибок данных {len(data['errors'])}")


if __name__ == "__main__":
    if sys.version_info < (3, 10):
        sys.exit("Монитору нужен Python 3.10 или новее, запущен " + sys.version.split()[0])
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()

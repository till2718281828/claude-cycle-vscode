# -*- coding: utf-8 -*-
"""Тесты сборщика монитора на demo/ (ожидаемое — таблица demo/README.md). Запуск: python -m pytest пульт"""
import datetime as dt
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import собрать as s  # noqa: E402

DEMO = HERE.parent / "demo"


@pytest.fixture(scope="module")
def data():
    return s.build(DEMO, s.load_config(DEMO, None, demo=True), demo=True)


def proj(data, name):
    return next(p for p in data["projects"] if p["n"] == name)


def task(data, title):
    return next(x for x in data["tasks"] if x["t"] == title)


def kinds(x):
    return {r["kind"] for r in x["reasons"]}


def test_demo_today_pinned(data):
    assert data["today"] == "2026-11-16"
    assert data["demo"] is True


def test_projects_and_hidden_service_files(data):
    names = [p["n"] for p in data["projects"]]
    assert names == sorted(["Бюджет 2027", "Закрытие месяца", "Казначейство", "Обучение", "Отчётность для банка",
                            "Справочники", "Учётная политика"])


def test_health_colors(data):
    assert {p["n"]: p["health"] for p in data["projects"]} == {
        "Закрытие месяца": "yellow", "Бюджет 2027": "yellow", "Казначейство": "red", "Отчётность для банка": "yellow",
        "Учётная политика": "green", "Обучение": "grey", "Справочники": "green"}


def test_reasons(data):
    z = task(data, "Закрытие октября")
    assert [r["text"] for r in z["reasons"]] == ["срок через 3 дн.", "без движения 11 дн. (порог 7)"]
    assert task(data, "Допущения бюджета")["reasons"][0]["text"] == "ждёт вас 5 дн.: согласовать курс и цену металла"
    assert task(data, "Платёжный календарь на скрипте")["reasons"][0]["text"] == "просрочено на 4 дн."
    assert task(data, "Прогноз ликвидности на 13 недель")["ready"] is True
    assert task(data, "Лимиты по банкам")["verified"] is True
    assert task(data, "Курсовые разницы")["stop"] == "СТОП: выбор метода переоценки"
    assert task(data, "Расчёт ковенантов")["reasons"][0]["text"] == "утверждён, не начат 11 дн."
    assert task(data, "Сверка с банком одним скриптом")["reasons"][0]["text"] == "в бэклоге 138 дн. — удалить?"
    assert task(data, "Пакет документов для банка")["st"] == "отложен" and task(data, "Пакет документов для банка")["due"] is None
    assert task(data, "Сценарий «цена металла −15 %»")["reasons"][0]["text"] == "срок через 4 дн."


def test_closed_plan_hidden(data):
    assert all(x["t"] != "Анкета заёмщика" for x in data["tasks"])


def test_data_errors(data):
    errs = {(e["kind"], e["p"]) for e in data["errors"]}
    assert errs == {("без шапки", "Казначейство"), ("неизвестный статус", "Казначейство"), ("срок", "Казначейство")}


def test_counts(data):
    c = data["counts"]
    assert (c["overdue"], c["wait"], c["ready"], c["p1"], c["p1_limit"], c["signals"]) == (1, 1, 2, 4, 3, 2)
    assert c["no_due"] == 2          # отложенный пакет и черновик учётной политики
    assert c["backlog"] == 8
    assert [s["уровень"] for s in proj(data, "Казначейство")["sig"]] == ["crit", "warn"]


def test_due_within_14_days(data):
    soon = sorted((x["due"], x["t"]) for x in data["tasks"] if x["due"] and "2026-11-16" <= x["due"] <= "2026-11-30")
    assert soon == [("2026-11-19", "Закрытие октября"), ("2026-11-20", "Лимиты по банкам"),
                    ("2026-11-20", "Сценарий «цена металла −15 %»"), ("2026-11-28", "Допущения бюджета"),
                    ("2026-11-30", "Прогноз ликвидности на 13 недель")]


def test_now_and_stage(data):
    assert proj(data, "Бюджет 2027")["now"]["kind"] == "stop"
    assert proj(data, "Бюджет 2027")["stage"]["name"] == "согласование"
    assert proj(data, "Казначейство")["now"]["kind"] == "ready"
    assert proj(data, "Закрытие месяца")["now"]["text"] == "исполнение 2/4"
    assert proj(data, "Отчётность для банка")["now"]["kind"] == "start"
    assert proj(data, "Учётная политика")["now"]["kind"] == "plan"
    assert proj(data, "Справочники")["now"]["kind"] == "quiet" and proj(data, "Справочники")["no_next"] is True
    assert proj(data, "Обучение")["cycle"] is False and proj(data, "Обучение")["personal"] is True
    assert proj(data, "Закрытие месяца")["stage"] == {"lane": "A", "name": "выгрузки", "detail": "2026-11 · 2/3"}
    assert proj(data, "Учётная политика")["stage"]["name"] == "черновик"


def test_conveyors(data):
    cs = proj(data, "Закрытие месяца")["conveyors"]
    assert [(c["period"], c["text"]) for c in cs] == [("2026-10", "закрытие"), ("2026-11", "отчёт")]


def test_activity_and_dirty(data):
    k = proj(data, "Казначейство")
    assert sum(k["activity"]["commits"]) == 13 and sum(k["activity"]["sessions"]) == 6
    assert k["dirty"] == 2 and k["commit"] == "2026-11-15"
    assert sum(proj(data, "Обучение")["activity"]["commits"]) == 0


def test_commands_and_workspaces(data):
    k = proj(data, "Казначейство")
    assert [c["id"] for c in k["commands"]] == ["calendar", "pay"] and k["commands"][1]["confirm"] is True
    assert proj(data, "Бюджет 2027")["workspace"].endswith("Бюджет 2027.code-workspace")
    assert {w["name"] for w in data["workspaces"]} == {"СтальКонструкт-Демо", "Бюджет 2027"}


def test_no_owner_blocks(data):
    assert not {"vps", "subs", "sources"} & set(data)


def session(claude, path):
    """Сессия Claude Code, как её пишет Claude Code: папка по пути, в первой записи — cwd."""
    folder = claude / s.claude_folder(path.resolve())
    folder.mkdir(parents=True, exist_ok=True)
    f = folder / f"{len(list(folder.iterdir()))}.jsonl"
    f.write_text('{"type":"summary"}\n' + json.dumps({"cwd": str(path.resolve())}) + "\n", encoding="utf-8")
    return dt.date.fromtimestamp(f.stat().st_mtime).isoformat()


def test_sessions_from_claude_projects(tmp_path):
    root, claude = tmp_path / "Projects", tmp_path / "claude-projects"
    for n in ("Альфа", "Альфа-плюс", "Бета", "Гамма"):
        (root / n).mkdir(parents=True)
    (root / "Альфа" / "подпапка").mkdir()
    day = session(claude, root / "Альфа" / "подпапка")   # имя папки сессий совпадает по длине с «Альфа-плюс»
    session(claude, root / "Альфа-плюс")
    session(claude, root / "Гамма")
    session(claude, root / "Гамма")
    session(claude, tmp_path / "Чужое")                    # вне папки проектов — не считаем
    sess = s.sessions_by_day(root, claude)
    assert (sess[("Альфа", day)], sess[("Альфа-плюс", day)], sess[("Бета", day)], sess[("Гамма", day)]) == (1, 1, 0, 2)
    assert sum(sess.values()) == 4


def test_user_config_overrides_defaults(tmp_path):
    cfg = tmp_path / "c.json"
    cfg.write_text(json.dumps({"лимит_P1": 9, "личные": ["X"]}), encoding="utf-8")
    th = s.load_config(tmp_path, cfg)
    assert th["лимит_P1"] == 9 and th["личные"] == ["X"] and th["в_работе_дней"] == 7


def test_missing_config_is_error(tmp_path):
    with pytest.raises(SystemExit):
        s.load_config(tmp_path, tmp_path / "нет.json")


def test_paths_stay_inside_project(tmp_path):
    proj = tmp_path / "П"
    proj.mkdir()
    assert s.inside(proj, "_Служебное/Планы") == (proj / "_Служебное" / "Планы").resolve()
    assert s.inside(proj, "../чужое") is None


def test_bad_conveyor_is_data_error(tmp_path):
    proj = tmp_path / "П"
    (proj / "Периоды" / "2026-11").mkdir(parents=True)
    with pytest.raises(ValueError):
        s.conveyors(proj, {"этапы": [["только название"]]})
    with pytest.raises(ValueError):
        s.conveyors(proj, {"папка": "../..", "этапы": [["а", ""]]})


def test_demo_only_by_flag_or_builtin_folder(tmp_path):
    assert s.is_demo(DEMO) and s.is_demo(tmp_path, True) and not s.is_demo(tmp_path)
    (tmp_path / "Проект").mkdir()
    (tmp_path / "_активность.json").write_text('{"сегодня": "2020-01-01"}', encoding="utf-8")
    d = s.build(tmp_path, s.load_config(tmp_path, None), demo=s.is_demo(tmp_path))
    assert d["demo"] is False and d["today"] != "2020-01-01"


def test_write_outputs(tmp_path, data):
    s.write(tmp_path, data)
    assert json.loads((tmp_path / "пульт-данные.json").read_text(encoding="utf-8"))["today"] == "2026-11-16"


def test_bad_cycle_block_is_data_error_not_crash(tmp_path):
    proj = tmp_path / "А-проект"
    (proj / "Периоды").mkdir(parents=True)
    (proj / "CLAUDE.md").write_text("# А\n\n## Цикл\n\n```yaml\nпрофиль: A\nвыгрузки: Выгрузки/{период}\n"
                                    "период_файл: Периоды\n```\n", encoding="utf-8")
    d = s.build(tmp_path, s.load_config(tmp_path, None))
    assert [e["kind"] for e in d["errors"]] == ["сбой"]
    assert d["projects"][0]["stage"]["name"] == "нет периода"


def test_server_tile_on_demo(data):
    v = data["server"]
    assert (v["name"], v["disk"]["free_gb"], v["disk"]["level"], v["commit"]["pct"], v["commit"]["level"]) == ("VPS", 24.4, "ok", 87, "warn")
    assert [w["text"] for w in v["why"]] == ["commit памяти 87 %", "ждёт перезагрузки после обновлений"]
    assert v["level"] == "warn" and v["backup"]["last"] == "2026-11-15"
    assert len(v["history"]["days"]) == 30 and v["history"]["disk_free_gb"].count(None) == 2
    assert data["counts"]["attention"] == 8 + 2


def test_server_tile_absent_or_broken(tmp_path):
    (tmp_path / "П").mkdir()
    assert s.build(tmp_path, s.load_config(tmp_path, None))["server"] is None
    th = {**s.load_config(tmp_path, None), "сервер": {"файл": "нет.json"}}
    assert s.build(tmp_path, th)["server"] is None
    (tmp_path / "битый.json").write_text("{", encoding="utf-8")
    d = s.build(tmp_path, {**th, "сервер": {"файл": "битый.json"}})
    assert d["server"] is None and [e["kind"] for e in d["errors"]] == ["сбой"]
    (tmp_path / "мало.json").write_text('{"диск": {}}', encoding="utf-8")
    d = s.build(tmp_path, {**th, "сервер": {"файл": "мало.json", "пороги": {"disk_warn": 50}}})
    assert d["server"] is None and d["errors"][0]["kind"] == "сбой"

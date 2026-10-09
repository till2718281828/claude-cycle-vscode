// Проектные разделы вкладки «Цикл работы»: раздел описывает сам проект JSON-файлом в своём репозитории,
// включает его настройка cycleWelcome.projectSections в файле workspace.
// Модуль без зависимости от vscode — его покрывают тесты test/*.test.js (node --test).
// JSON лежит в репозитории проекта и считается доверенным: пути с «..» за его папку разрешены.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// JSON раздела → элемент в форме STEPS (extension.js) с абсолютными путями от папки JSON.
// Любая ошибка (нет файла, битый JSON, нет обязательного поля или файла) → раздел с текстом ошибки
// вместо содержимого: поломка видна сразу, остальная вкладка работает.
function загрузить(jsonPath) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return разобрать(j, path.dirname(jsonPath));
  } catch (e) {
    const текст = `не прочитан \`${jsonPath}\`: ${e.message}`;   // в кавычках — markdown не съест «\_» пути
    // id идёт в <section id> и в селектор data-step — без двоеточий и слэшей пути
    const id = 'project-' + crypto.createHash('md5').update(jsonPath).digest('hex').slice(0, 8);
    const title = j && typeof j.title === 'string' ? j.title : 'Раздел проекта';
    return { id, title, after: j && j.after, error: текст, text: текст };
  }
}

function разобрать(j, база) {
  const абс = путь => {
    if (!путь) throw new Error('пустой путь в описании раздела');
    const найден = раскрыть(путь, база);
    if (!найден) throw new Error(`нет файла ${путь}`);
    return найден;
  };
  if (!j || typeof j !== 'object') throw new Error('описание раздела — не объект JSON');
  for (const поле of ['id', 'title', 'md']) if (!j[поле]) throw new Error(`нет поля ${поле}`);
  // id идёт в <section id> и в селектор data-step вкладки — только буквы, цифры, _ и -
  if (!/^[\w-]+$/.test(j.id)) throw new Error(`id «${j.id}» — только латинские буквы, цифры, _ и -`);
  if (typeof j.title !== 'string') throw new Error('title — не строка');
  return {
    id: j.id, title: j.title, after: j.after,
    md: абс(j.md),
    tail: j.tail && абс(j.tail),
    figs: (j.figs || []).map(f => ({ ...f, svg: абс(f.svg) })),
    links: (j.links || []).map(l => {
      if (l.step) return l;
      // битая ссылка помечается сама, раздел со схемой остаётся
      try { return { ...l, file: абс(l.file) }; } catch (e) { return { title: l.title, error: e.message }; }
    })
  };
}

// Путь от папки база; сегмент * — последняя по имени подпапка, в которой остаток пути есть
// («Периоды/*/Состояние выпуска.md» → последний период). Нет файла (или это папка) → null.
function раскрыть(шаблон, база) {
  if (path.isAbsolute(шаблон)) {
    const корень = path.parse(шаблон).root;
    return раскрыть(шаблон.slice(корень.length), корень);
  }
  const [первый, ...остаток] = шаблон.split(/[\\/]/);
  if (первый !== '*') {
    const путь = path.resolve(база, первый);
    if (остаток.length) return раскрыть(остаток.join('/'), путь);
    return fs.existsSync(путь) && fs.statSync(путь).isFile() ? путь : null;
  }
  if (!fs.existsSync(база)) return null;
  const папки = fs.readdirSync(база, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  for (const имя of папки.sort().reverse()) {
    const найден = раскрыть(остаток.join('/'), path.join(база, имя));
    if (найден) return найден;
  }
  return null;
}

// Новый список разделов: каждый проектный — сразу за разделом after (и за проектными, вставленными туда раньше),
// при неизвестном after — в конец. Исходный список не меняется.
function вставить(steps, разделы) {
  const итог = [...steps];
  for (const раздел of разделы) {
    const i = итог.findIndex(s => s.id === раздел.after);
    if (i < 0) { итог.push(раздел); continue; }
    let j = i + 1;
    while (j < итог.length && итог[j].after === раздел.after) j++;
    итог.splice(j, 0, раздел);
  }
  return итог;
}

module.exports = { загрузить, раскрыть, вставить };

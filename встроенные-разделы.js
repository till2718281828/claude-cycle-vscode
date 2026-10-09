// Встроенные разделы вкладки «Цикл работы» и команды, которые может вызвать webview.
// Модуль без зависимости от vscode — его покрывают тесты test/*.test.js (node --test).
// Порядок пунктов = порядок в списке слева; первым открывается «Команды».
const STEPS = [
  { id: 'commands', title: 'Команды', md: 'commands.md' },
  {
    id: 'cycle', title: 'Цикл работы', md: 'cycle.md', tail: 'cycle-rules.md',
    figs: [
      {
        svg: 'cycle-flow.svg', title: 'Цикл задачи: кто что делает', legend: true,
        caption: 'Замечания и расхождения не порождают новый план: они возвращают в исполнение того же плана ' +
          '(раздел «Отклонения»), и результат снова проходит проверку и допуск. Закрыть задачу можно, когда правок нет.'
      },
      {
        svg: 'cycle-step.svg', title: 'Один шаг внутри /execute',
        caption: 'Шаг закрывается, только когда его критерий из плана проверен фактом — запуском, сверкой, чтением ' +
          'результата. Коммит на каждый шаг: ход работы виден в Git Graph.'
      }
    ]
  },
  {
    id: 'repos', title: 'Репозитории',
    text: '# Репозитории\n\nКакой репозиторий что хранит, откуда берёт и кому отдаёт.',
    links: [['Подробнее: таблица и схемы', 'cycleWelcome.openRepos']],
    figs: [{
      svg: 'repos-map.svg', title: 'Потоки данных', legend: 'map',
      caption: 'Схема на демо-примере.'
    }]
  },
  {
    id: 'period', title: 'Процесс периода',
    text: '# Процесс периода\n\nМесяц по этапам: какой репозиторий, чем запускается, что передаёт дальше.',
    links: [['Подробнее: этапы таблицей', 'cycleWelcome.openRepos']],
    figs: [{
      svg: 'period-map.svg', title: 'Месяц по репозиториям', legend: 'map',
      caption: 'Внутри любого репозитория задачи идут по циклу: /grill-me → /plan-task → /execute → /verify → /close-task.'
    }]
  },
  { id: 'rules', title: 'Клавиши и правила', md: 'rules.md' },
  { id: 'attention', title: 'Требует внимания', attention: true, links: [['Открыть пульт', 'cycleWelcome.openDashboard']] },
  {
    id: 'links', title: 'Пульт и документы', md: 'links.md',
    links: [['Открыть пульт', 'cycleWelcome.openDashboard'], ['README плагина', 'cycleWelcome.openReadme'],
      ['План цикла', 'cycleWelcome.openPlan'], ['Карта репозиториев', 'cycleWelcome.openRepos']]
  }
];
const ALLOWED = new Set(['cycleWelcome.openDashboard', 'cycleWelcome.openReadme', 'cycleWelcome.openPlan', 'cycleWelcome.openRepos',
  'cycleWelcome.openProjectFile']);

module.exports = { STEPS, ALLOWED };

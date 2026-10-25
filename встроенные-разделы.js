// Встроенные разделы вкладки «Цикл-Про» и команды, которые может вызвать webview.
// Модуль без зависимости от vscode — его покрывают тесты test/*.test.js (node --test).
// Порядок разделов = порядок в панели «Цикл-Про»; первым открывается «Монитор проектов».
const FIRST = 'pult';
const STEPS = [
  { id: 'pult', title: 'Монитор проектов', icon: '◫', pult: true },
  {
    id: 'commands', title: 'Команды', icon: '⌘', md: 'commands.md', more: 'links.md',
    links: [['README', 'cycleWelcome.openReadme'], ['Монитор в браузере', 'cycleWelcome.openDashboard'],
      ['Карта репозиториев', 'cycleWelcome.openRepos']],
    userLinks: true   // плюс свои ссылки из настройки cycleWelcome.links
  },
  {
    id: 'cycle', title: 'Цикл работы', icon: '↻', md: 'cycle.md', tail: 'cycle-rules.md', more: 'rules.md',
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
    id: 'repos', title: 'Контур данных', icon: '⇄',
    text: '# Контур данных\n\nКакой репозиторий что хранит, откуда берёт и кому отдаёт — и как по ним проходит месяц. ' +
      'Пример — вымышленная компания СтальКонструкт-Демо; ссылку на свою карту можно добавить в «Команды» настройкой ' +
      '`cycleWelcome.links`.',
    links: [['Подробнее: таблицы и схемы', 'cycleWelcome.openRepos']],
    figs: [{
      svg: 'repos-map.svg', title: 'Потоки данных', legend: 'map',
      caption: 'Отчёт и проверка — разные репозитории и разные исполнители: проверка пересчитывает те же снимки своим ' +
        'способом и код отчёта не читает. Замечание получателя превращается в правило — для отчёта и для проверки.'
    }, {
      svg: 'period-map.svg', title: 'Месяц по репозиториям', legend: 'map',
      caption: 'Выпуск уходит получателю только после пересчёта без расхождений. Внутри любого репозитория задачи идут ' +
        'по циклу: /grill-me → /plan-task → /execute → /verify → /close-task.'
    }]
  }
];
// Прежние id разделов (проектные разделы ссылаются на них в after и в ссылках «step») → куда они вошли в 2.0.
const ALIAS = { period: 'repos', rules: 'cycle', attention: 'pult', links: 'commands' };
const ALLOWED = new Set(['cycleWelcome.openDashboard', 'cycleWelcome.openRepos', 'cycleWelcome.openReadme',
  'cycleWelcome.openProjectFile', 'cycleWelcome.openLink', 'cycleWelcome.rebuildPult', 'cycleWelcome.checkSources']);
// Служебные: вызываются только из webview (с номером ссылки или без аргументов), в палитре команд их нет.
const SERVICE = new Set(['cycleWelcome.openProjectFile', 'cycleWelcome.openLink', 'cycleWelcome.checkSources']);

module.exports = { FIRST, STEPS, ALIAS, ALLOWED, SERVICE };

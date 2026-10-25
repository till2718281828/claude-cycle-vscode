// Модуль серверов вкладки: порты серверов из настройки cycleWelcome.servers (TCP-подключение, 2 с) и свободные диск
// и ОЗУ этой машины. По умолчанию выключен: список пуст и cycleWelcome.checkMachine = false — блока «Серверы» нет.
// Чистые функции и проверка порта с подменяемым connect — тесты в test/источники.test.js.
const net = require('net');

const pad = n => String(n).padStart(2, '0');
const localIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const round1 = x => Math.round(x * 10) / 10;

// TCP-подключение с тайм-аутом: { open, ms } — ms только у открытого.
function проверитьПорт(host, port, { timeout = 2000, connect = net.connect } = {}) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let done = false;
    let s;
    try {
      s = connect({ host, port });
    } catch (e) {   // битый адрес или порт — «не открыт», остальные серверы проверяются
      resolve({ open: false, ms: null });
      return;
    }
    const end = open => {
      if (done) return;
      done = true;
      s.destroy();
      resolve({ open, ms: open ? Date.now() - t0 : null });
    };
    s.setTimeout(timeout, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });
}

// Блок «Серверы» для монитора: серверы с проверенными портами и замер машины. Нечего показывать — null.
// machine — { diskFreeGb, diskTotalGb, ramFreeGb, ramTotalGb } или null.
async function проверитьСерверы(list, machine, { check = проверитьПорт, now = new Date() } = {}) {
  const servers = Array.isArray(list) ? list : [];
  if (!servers.length && !machine) return null;
  const checked = await Promise.all(servers.map(async s => ({ ...s, ...(await check(s.host, s.port)) })));
  return {
    checked: localIso(now), list: checked,
    disk: machine ? { free_gb: round1(machine.diskFreeGb), total_gb: round1(machine.diskTotalGb) } : null,
    ram: machine ? { free_gb: round1(machine.ramFreeGb), total_gb: round1(machine.ramTotalGb) } : null,
  };
}

// Данные монитора с блоком «Серверы» вкладки; данные сборщика не меняются.
const сСерверами = (data, servers) => (!data ? data : servers ? { ...data, servers } : (({ servers: _, ...rest }) => rest)(data));

module.exports = { проверитьПорт, проверитьСерверы, сСерверами, localIso };

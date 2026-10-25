// Тесты модуля серверов: проверка порта, блок «Серверы», выключенный модуль. Запуск: node --test
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { проверитьПорт, проверитьСерверы, сСерверами, localIso } = require('../источники.js');

const NOW = new Date(2026, 10, 16, 9, 5, 7);

test('пустой список и без замера машины — модуль выключен, блока нет', async () => {
  assert.strictEqual(await проверитьСерверы([], null), null);
  assert.strictEqual(await проверитьСерверы(undefined, null), null);
  const data = { v: 2, servers: { list: [] } };
  assert.deepStrictEqual(сСерверами(data, null), { v: 2 });
  assert.strictEqual(сСерверами(null, null), null);
});

test('серверы проверяются, данные сборщика не меняются', async () => {
  const check = async (host, port) => (port === 5432 ? { open: true, ms: 12 } : { open: false, ms: null });
  const s = await проверитьСерверы([{ name: 'База', host: 'h', port: 5432 }, { name: 'Почта', host: 'h', port: 25 }], null, { check, now: NOW });
  assert.deepStrictEqual(s, { checked: '2026-11-16T09:05:07', disk: null, ram: null, list: [
    { name: 'База', host: 'h', port: 5432, open: true, ms: 12 }, { name: 'Почта', host: 'h', port: 25, open: false, ms: null }] });
  const data = { v: 2 };
  assert.deepStrictEqual(сСерверами(data, s), { v: 2, servers: s });
  assert.deepStrictEqual(data, { v: 2 });
});

test('только замер машины — блок без серверов, числа округлены до десятых', async () => {
  const s = await проверитьСерверы([], { diskFreeGb: 10.66, diskTotalGb: 99.94, ramFreeGb: 3.04, ramTotalGb: 16 }, { now: NOW });
  assert.deepStrictEqual(s, { checked: localIso(NOW), list: [], disk: { free_gb: 10.7, total_gb: 99.9 }, ram: { free_gb: 3, total_gb: 16 } });
});

test('проверка порта: открытый — с временем, закрытый и недоступный за тайм-аут — нет', async () => {
  const srv = net.createServer(c => c.end());
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const open = await проверитьПорт('127.0.0.1', port);
  assert.strictEqual(open.open, true);
  assert.ok(Number.isInteger(open.ms));
  await new Promise(r => srv.close(r));
  assert.deepStrictEqual(await проверитьПорт('127.0.0.1', port), { open: false, ms: null });
  // connect, который не отвечает, — тайм-аут
  const silent = () => { const s = new (require('events'))(); s.setTimeout = (ms, fn) => setTimeout(fn, ms); s.destroy = () => {}; return s; };
  assert.deepStrictEqual(await проверитьПорт('10.255.255.1', 1, { timeout: 50, connect: silent }), { open: false, ms: null });
  // битый адрес — исключение в connect
  assert.deepStrictEqual(await проверитьПорт('', -1, { connect: () => { throw new Error('bad'); } }), { open: false, ms: null });
});

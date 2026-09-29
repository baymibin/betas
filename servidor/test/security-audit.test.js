// Registro de seguridad (src/audit.js): anotar, filtrar, resumir y purgar, en SQLite y MySQL.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.js';
import {createAudit, clientIp} from '../src/audit.js';
import {resetMysql} from './helpers/mysql.js';

const engines = [['sqlite', ':memory:']];
if (process.env.TEST_MYSQL_URL) engines.push(['mysql', process.env.TEST_MYSQL_URL]);

for (const [engine, url] of engines) {
  test(`[${engine}] security audit: log, filter, summary and retention`, async () => {
    if (url.startsWith('mysql')) await resetMysql(url);
    const db = await openDatabase(url);
    try {
      const audit = createAudit(db);
      await audit.log({event: 'auth.login', userId: 'u1', ip: '10.0.0.1', ua: 'Test\nBrowser', detail: {provider: 'google'}});
      await audit.log({event: 'auth.login', ok: false, ip: '10.0.0.9', detail: {provider: 'discord', error: 'invalid_state'}});
      await audit.log({event: 'shop.purchase', userId: 'u1', ip: '10.0.0.1', detail: {itemId: 'wing:5', price: 1000}});
      await audit.log({event: 'x'.repeat(80), detail: {big: 'y'.repeat(5000)}});   // se recorta, no falla
      const all = await audit.list();
      assert.equal(all.length, 4);
      assert.equal(all[0].event.length, 48);
      assert.deepEqual((await audit.list({event: 'auth.'})).map(e => e.outcome), ['fail', 'ok']);
      assert.deepEqual((await audit.list({userId: 'u1'})).map(e => e.event), ['shop.purchase', 'auth.login']);
      assert.equal((await audit.list({outcome: 'fail'}))[0].detail.error, 'invalid_state');
      assert.equal((await audit.list({ip: '10.0.0.1'})).length, 2);
      assert.equal((await audit.list({userId: 'u1'}))[1].userAgent, 'Test Browser', 'sin saltos de línea en el registro');
      const sum = await audit.summary();
      assert.ok(sum.events.some(e => e.event === 'auth.login' && e.outcome === 'fail' && e.n === 1));
      assert.deepEqual(sum.topFailIps, [{ip: '10.0.0.9', n: 1}]);
      // Retención: lo antiguo se borra y lo reciente se queda.
      await db.run("UPDATE security_events SET created_at = ? WHERE event = 'shop.purchase'", ['2000-01-01 00:00:00.000']);
      assert.equal(await audit.purge(365), 1);
      assert.equal((await audit.list()).length, 3);
    } finally { await db.close(); }
  });
}

test('client IP: proxy headers are only trusted with TRUST_PROXY', () => {
  const res = {getRemoteAddressAsText: () => Buffer.from('127.0.0.1')};
  const req = headers => ({getHeader: name => headers[name] || ''});
  assert.equal(clientIp(res, req({'x-forwarded-for': '203.0.113.7'}), false), '127.0.0.1', 'sin TRUST_PROXY no se cree la cabecera');
  assert.equal(clientIp(res, req({'x-forwarded-for': '203.0.113.7, 10.0.0.2'}), true), '203.0.113.7');
  assert.equal(clientIp(res, req({'x-real-ip': '2001:db8::1'}), true), '2001:db8::1');
  assert.equal(clientIp(res, req({'x-forwarded-for': '<script>'}), true), '127.0.0.1', 'valores raros se ignoran');
});

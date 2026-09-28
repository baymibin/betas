// Compra de Tablas de Oro con PayPal (src/payments.js + src/paypal.js) contra un PayPal simulado,
// en SQLite y (con TEST_MYSQL_URL) en MySQL/MariaDB. Reglas clave: el precio lo pone el servidor,
// volver de PayPal no acredita por sí mismo, se acredita una sola vez y los webhooks sin firma
// válida no hacen nada.
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {openDatabase, syncCatalog, loadEconomyConfig} from '../src/db.js';
import {createEconomy} from '../src/economy.js';
import {createPayments} from '../src/payments.js';
import {createPayPal, formatMinor, parseMinor} from '../src/paypal.js';
import {resetMysql} from './helpers/mysql.js';

const engines = [['sqlite', ':memory:']];
if (process.env.TEST_MYSQL_URL) engines.push(['mysql', process.env.TEST_MYSQL_URL]);

// PayPal simulado: guarda las órdenes creadas y decide qué devuelve cada captura.
function fakePayPal() {
  const orders = new Map();
  let n = 0;
  const fake = {
    enabled: true, mode: 'sandbox', webhookEnabled: true, captureResult: null, signatureOk: true, calls: {capture: 0},
    orders,
    async createOrder({referenceId, amountMinor, currency, returnUrl, cancelUrl}) {
      const id = 'PP' + (++n);
      orders.set(id, {referenceId, amountMinor, currency, returnUrl, cancelUrl, captured: false});
      return {id, approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=' + id};
    },
    async captureOrder(id) {
      fake.calls.capture++;
      const o = orders.get(id);
      const capture = fake.captureResult ? fake.captureResult(o) : {status: 'COMPLETED', amount: {currency_code: o.currency, value: formatMinor(o.amountMinor)}};
      o.captured = true;
      return {id, status: 'COMPLETED', purchase_units: [{payments: {captures: [{id: 'CAP-' + id, custom_id: o.referenceId, ...capture}]}}]};
    },
    async verifyWebhook() { return fake.signatureOk; }
  };
  return fake;
}

async function setup(url) {
  if (url.startsWith('mysql')) await resetMysql(url);
  const db = await openDatabase(url);
  const config = loadEconomyConfig(fileURLToPath(new URL('../config/economy.json', import.meta.url)));
  config.goldProducts = config.goldProducts.map((p, i) => ({...p, priceMinor: [199, 999, null][i], currency: 'USD'}));
  await syncCatalog(db, config);
  const eco = createEconomy(db, config);
  await eco.loadCache();
  const paypal = fakePayPal();
  const pay = createPayments({db, economy: eco, paypal, publicUrl: 'https://surf.example'});
  const user = await eco.createUser({nickname: 'Kai'});
  const gold = async () => (await eco.wallet(user)).GOLD_COIN;
  const event = (type, resource, id = 'WH-' + Math.random().toString(36).slice(2)) => JSON.stringify({id, event_type: type, resource});
  return {db, eco, paypal, pay, user, gold, event};
}
const expectCode = (promise, code) => assert.rejects(promise, e => e.code === code, 'se esperaba ' + code);

for (const [engine, url] of engines) {
  const t = (name, fn) => test(`[${engine}] paypal: ${name}`, async () => { const ctx = await setup(url); try { await fn(ctx); } finally { await ctx.db.close(); } });

  t('products carry the server price and only priced ones can be bought', async ({pay}) => {
    const list = await pay.products();
    assert.deepEqual(list.map(p => [p.id, p.price, p.currency, p.available]), [['gold_small', '1.99', 'USD', true], ['gold_medium', '9.99', 'USD', true], ['gold_large', null, 'USD', false]]);
  });

  t('checkout creates a PayPal order with the server price and the return URLs', async ({pay, paypal, user, db}) => {
    const r = await pay.checkout(user, 'gold_medium');
    assert.match(r.approveUrl, /^https:\/\/www\.sandbox\.paypal\.com\//);
    const [order] = [...paypal.orders.values()];
    assert.deepEqual([order.referenceId, order.amountMinor, order.currency], [r.orderId, 999, 'USD']);
    assert.equal(order.returnUrl, 'https://surf.example/api/payments/paypal/return');
    const row = await db.get('SELECT status, provider_ref, gold_amount FROM payment_orders WHERE id = ?', [r.orderId]);
    assert.deepEqual([row.status, row.provider_ref, Number(row.gold_amount)], ['PENDING', 'PP1', 550]);
    await expectCode(pay.checkout(user, 'gold_large'), 'product_unavailable');
    await expectCode(pay.checkout(user, 'nope'), 'product_not_found');
  });

  t('returning from PayPal captures on the server and credits the gold exactly once', async ({pay, user, gold, paypal}) => {
    const {orderId} = await pay.checkout(user, 'gold_small');
    assert.equal(await gold(), 0, 'crear la orden no da oro');
    assert.deepEqual(await pay.completeReturn('PP1'), {status: 'CREDITED', orderId});
    assert.equal(await gold(), 100);
    assert.equal((await pay.completeReturn('PP1')).status, 'CREDITED', 'recargar la vuelta no vuelve a cobrar ni acredita');
    assert.equal(paypal.calls.capture, 1);
    assert.equal(await gold(), 100);
    assert.equal((await pay.orderStatus(user, orderId)).status, 'CREDITED');
  });

  t('a capture with a different amount or currency, or not completed, credits nothing', async ({pay, user, gold, paypal}) => {
    await pay.checkout(user, 'gold_small');
    paypal.captureResult = () => ({status: 'COMPLETED', amount: {currency_code: 'USD', value: '0.01'}});
    assert.equal((await pay.completeReturn('PP1')).status, 'AMOUNT_MISMATCH');
    await pay.checkout(user, 'gold_small');
    paypal.captureResult = o => ({status: 'COMPLETED', amount: {currency_code: 'EUR', value: formatMinor(o.amountMinor)}});
    assert.equal((await pay.completeReturn('PP2')).status, 'AMOUNT_MISMATCH');
    await pay.checkout(user, 'gold_small');
    paypal.captureResult = o => ({status: 'PENDING', amount: {currency_code: 'USD', value: formatMinor(o.amountMinor)}});
    assert.equal((await pay.completeReturn('PP3')).status, 'PENDING');
    await pay.checkout(user, 'gold_small');
    paypal.captureResult = o => ({status: 'DECLINED', amount: {currency_code: 'USD', value: formatMinor(o.amountMinor)}});
    assert.equal((await pay.completeReturn('PP4')).status, 'FAILED');
    assert.equal(await gold(), 0);
    assert.equal((await pay.completeReturn('NOT-OURS')).status, 'UNKNOWN');
  });

  t('cancel from PayPal marks the order canceled and later returns do not charge it', async ({pay, user, gold, paypal}) => {
    const {orderId} = await pay.checkout(user, 'gold_small');
    assert.deepEqual(await pay.cancel('PP1'), {status: 'CANCELED', orderId});
    assert.equal((await pay.completeReturn('PP1')).status, 'CANCELED');
    assert.equal(paypal.calls.capture, 0);
    assert.equal(await gold(), 0);
  });

  t('webhooks: invalid signature is rejected; a verified capture credits once even if resent', async ({pay, user, gold, paypal, event}) => {
    const {orderId} = await pay.checkout(user, 'gold_medium');
    const capture = {id: 'CAP1', status: 'COMPLETED', custom_id: orderId, amount: {currency_code: 'USD', value: '9.99'}, supplementary_data: {related_ids: {order_id: 'PP1'}}};
    paypal.signatureOk = false;
    assert.equal((await pay.webhook({}, event('PAYMENT.CAPTURE.COMPLETED', capture, 'WH-1'))).status, 400);
    assert.equal(await gold(), 0);
    paypal.signatureOk = true;
    const ok = await pay.webhook({}, event('PAYMENT.CAPTURE.COMPLETED', capture, 'WH-1'));
    assert.deepEqual([ok.status, ok.body.result], [200, 'CREDITED']);
    assert.equal((await pay.webhook({}, event('PAYMENT.CAPTURE.COMPLETED', capture, 'WH-1'))).body.duplicate, true);
    assert.equal((await pay.webhook({}, event('PAYMENT.CAPTURE.COMPLETED', capture, 'WH-2'))).body.result, 'CREDITED');
    assert.equal(await gold(), 550, 'webhook repetido o con otro id: el oro se acredita una vez');
    assert.equal((await pay.completeReturn('PP1')).status, 'CREDITED', 'la vuelta después del webhook tampoco duplica');
    assert.equal(await gold(), 550);
  });

  t('webhook for an approved order that the player never returned from captures it', async ({pay, user, gold, event}) => {
    await pay.checkout(user, 'gold_small');
    assert.equal((await pay.webhook({}, event('CHECKOUT.ORDER.APPROVED', {id: 'PP1', status: 'APPROVED'}))).body.result, 'CREDITED');
    assert.equal(await gold(), 100);
  });

  t('refunds and chargebacks take back the gold that is left, never below zero', async ({pay, eco, user, gold, event}) => {
    const a = await pay.checkout(user, 'gold_medium');
    await pay.completeReturn('PP1');
    assert.equal(await gold(), 550);
    await eco.move(user, 'GOLD_COIN', -500, 'GOLD_EXCHANGE', 'spent-for-test');   // ya cambió casi todo
    const refund = {id: 'RF1', status: 'COMPLETED', custom_id: a.orderId, amount: {currency_code: 'USD', value: '9.99'}};
    assert.equal((await pay.webhook({}, event('PAYMENT.CAPTURE.REFUNDED', refund))).body.result, 'REFUNDED');
    assert.equal(await gold(), 0);
    assert.equal((await pay.webhook({}, event('PAYMENT.CAPTURE.REFUNDED', refund))).body.result, 'REFUNDED');
    assert.equal(await gold(), 0);

    const b = await pay.checkout(user, 'gold_small');
    await pay.completeReturn('PP2');
    assert.equal((await pay.webhook({}, event('PAYMENT.CAPTURE.REVERSED', {id: 'CAP9', custom_id: b.orderId}))).body.result, 'CHARGEBACK');
    assert.equal(await gold(), 0);
  });

  t('without PayPal credentials nothing can be bought and webhooks are disabled', async ({db, eco, user}) => {
    const pay = createPayments({db, economy: eco, paypal: createPayPal({clientId: '', clientSecret: '', webhookId: '', mode: 'sandbox', apiBase: 'http://127.0.0.1:9'}), publicUrl: 'https://surf.example'});
    assert.equal((await pay.products()).some(p => p.available), false);
    await expectCode(pay.checkout(user, 'gold_small'), 'payments_disabled');
    assert.equal((await pay.webhook({}, '{}')).status, 503);
  });

  t('an open-order limit stops a user from spamming checkouts', async ({pay, user}) => {
    for (let i = 0; i < 5; i++) await pay.checkout(user, 'gold_small');
    await expectCode(pay.checkout(user, 'gold_small'), 'too_many_open_orders');
  });
}

test('paypal client: money format, token cache, order links and already-captured orders', async () => {
  assert.deepEqual([formatMinor(199), formatMinor(1000), formatMinor(5)], ['1.99', '10.00', '0.05']);
  assert.deepEqual([parseMinor('9.99'), parseMinor('10'), parseMinor('0.5'), parseMinor('x')].map(String), ['999', '1000', '50', 'NaN']);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([init.method, url.replace('https://pp.test', ''), init.headers]);
    const reply = (status, json) => ({ok: status < 300, status, text: async () => JSON.stringify(json)});
    if (url.endsWith('/v1/oauth2/token')) return reply(200, {access_token: 'TOKEN', expires_in: 32400});
    if (url.endsWith('/v2/checkout/orders')) return reply(201, {id: 'ORDER1', links: [{rel: 'payer-action', href: 'https://paypal.test/approve'}]});
    if (url.endsWith('/capture')) return reply(422, {name: 'UNPROCESSABLE_ENTITY', details: [{issue: 'ORDER_ALREADY_CAPTURED'}]});
    if (url.endsWith('/v2/checkout/orders/ORDER1')) return reply(200, {id: 'ORDER1', status: 'COMPLETED'});
    if (url.endsWith('/verify-webhook-signature')) return reply(200, {verification_status: 'FAILURE'});
    return reply(404, {});
  };
  const pp = createPayPal({clientId: 'id', clientSecret: 'secret', webhookId: 'WH', mode: 'sandbox', apiBase: 'https://pp.test', brandName: 'Surf'}, fetchImpl);
  assert.deepEqual(await pp.createOrder({referenceId: 'r1', amountMinor: 999, currency: 'USD', description: 'x', returnUrl: 'a', cancelUrl: 'b'}), {id: 'ORDER1', approveUrl: 'https://paypal.test/approve'});
  assert.equal((await pp.captureOrder('ORDER1', 'r1')).status, 'COMPLETED');
  assert.equal(calls.filter(c => c[1] === '/v1/oauth2/token').length, 1, 'el token se reutiliza');
  assert.equal(calls.find(c => c[1] === '/v1/oauth2/token')[2].Authorization, 'Basic ' + Buffer.from('id:secret').toString('base64'));
  assert.equal(await pp.verifyWebhook({}, {}), false, 'sin cabeceras de firma no se consulta ni se acepta');
  const signed = {'paypal-auth-algo': 'a', 'paypal-cert-url': 'b', 'paypal-transmission-id': 'c', 'paypal-transmission-sig': 'd', 'paypal-transmission-time': 'e'};
  assert.equal(await pp.verifyWebhook(signed, {id: 'x'}), false, 'PayPal dice FAILURE');
});

// Compra de Tablas de Oro con PayPal.
//
// Flujo (el servidor decide el precio y es el único que acredita):
//  1. POST /api/payments/checkout {productId}: crea payment_orders (CREATED) con el precio de
//     payment_products, crea la orden en PayPal (custom_id = id de nuestra orden) y devuelve la
//     URL de aprobación. La orden pasa a PENDING.
//  2. El jugador paga en PayPal y vuelve a /api/payments/paypal/return?token=<orden PayPal>.
//     Volver NO acredita nada por sí mismo: el servidor pide a PayPal que COBRE la orden y solo
//     si PayPal responde con una captura COMPLETED por el importe y la divisa exactos la orden
//     pasa a PAID y se acredita el oro (creditPaidOrder, una sola vez).
//  3. Webhook firmado (/api/payments/webhook/paypal), verificado con la API de PayPal: cubre al
//     jugador que cierra el navegador tras pagar (CHECKOUT.ORDER.APPROVED / PAYMENT.CAPTURE.COMPLETED),
//     cobros denegados y reembolsos o contracargos (retira el oro que quede, sin saldo negativo).
// Cada evento se guarda en payment_events (único por id): un reenvío no se procesa dos veces.
import {randomUUID} from 'node:crypto';
import {EconomyError} from './economy.js';
import {nowSql, isUniqueViolation} from './db.js';
import {formatMinor, parseMinor, PayPalError} from './paypal.js';

const OPEN_ORDER_LIMIT = 5;   // órdenes sin terminar por cuenta en la última hora
const num = v => typeof v === 'bigint' ? Number(v) : Number(v ?? 0);

export function createPayments({db, economy, paypal, publicUrl}) {
  const base = String(publicUrl || '').replace(/\/$/, '');

  async function products() {
    return (await economy.goldProducts()).map(p => ({
      id: p.id, name: p.name, goldAmount: p.goldAmount, priceMinor: p.priceMinor, currency: p.currency,
      price: p.priceMinor ? formatMinor(p.priceMinor) : null,
      available: paypal.enabled && !!p.priceMinor && /^[A-Z]{3}$/.test(p.currency || '')
    }));
  }

  const orderRow = async (sql, args, t = db) => {
    const row = await t.get('SELECT id, user_id, product_id, provider_ref, amount_minor, currency, gold_amount, status FROM payment_orders WHERE ' + sql + (t === db ? '' : t.forUpdate), args);
    return row && {...row, amount_minor: num(row.amount_minor), gold_amount: num(row.gold_amount)};
  };
  const setStatus = (t, id, status) => t.run('UPDATE payment_orders SET status = ?, updated_at = ? WHERE id = ?', [status, nowSql(), id]);

  async function checkout(userId, productId) {
    if (!paypal.enabled) throw new EconomyError('payments_disabled', 503);
    const product = (await products()).find(p => p.id === productId);
    if (!product) throw new EconomyError('product_not_found', 404);
    if (!product.available) throw new EconomyError('product_unavailable', 409);
    const since = nowSql(new Date(Date.now() - 3600_000));
    const open = await db.get("SELECT COUNT(*) AS n FROM payment_orders WHERE user_id = ? AND status IN ('CREATED','PENDING') AND created_at > ?", [userId, since]);
    if (num(open?.n) >= OPEN_ORDER_LIMIT) throw new EconomyError('too_many_open_orders', 429);

    const id = randomUUID();
    await db.run("INSERT INTO payment_orders (id, user_id, product_id, provider, amount_minor, currency, gold_amount, status) VALUES (?, ?, ?, 'paypal', ?, ?, ?, 'CREATED')",
      [id, userId, product.id, product.priceMinor, product.currency, product.goldAmount]);
    try {
      const order = await paypal.createOrder({referenceId: id, amountMinor: product.priceMinor, currency: product.currency,
        description: `${product.goldAmount} Tablas de Oro · Surf Salvaje`,
        returnUrl: base + '/api/payments/paypal/return', cancelUrl: base + '/api/payments/paypal/cancel'});
      await db.run("UPDATE payment_orders SET provider_ref = ?, status = 'PENDING', updated_at = ? WHERE id = ?", [order.id, nowSql(), id]);
      return {orderId: id, approveUrl: order.approveUrl};
    } catch (e) {
      await db.run("UPDATE payment_orders SET status = 'FAILED', updated_at = ? WHERE id = ?", [nowSql(), id]);
      if (e instanceof PayPalError) throw new EconomyError('paypal_unavailable', 502);
      throw e;
    }
  }

  // Aplica una captura devuelta por PayPal (respuesta de /capture o recurso de un webhook
  // verificado). Solo una captura COMPLETED con el importe y la divisa exactos de la orden
  // la marca PAID y acredita el oro.
  async function applyCapture(order, capture) {
    if (!order || !capture) return order?.status || 'UNKNOWN';
    const status = String(capture.status || '');
    if (status === 'COMPLETED') {
      const amount = capture.amount || {};
      if (amount.currency_code !== order.currency || parseMinor(amount.value) !== order.amount_minor) {
        console.error('[payments] importe de PayPal distinto al de la orden', order.id, amount);
        return 'AMOUNT_MISMATCH';
      }
      await db.tx(async t => {
        const row = await orderRow('id = ?', [order.id], t);
        if (row && ['CREATED', 'PENDING'].includes(row.status)) await setStatus(t, row.id, 'PAID');
      });
      const current = await orderRow('id = ?', [order.id]);
      if (current.status === 'PAID') await economy.creditPaidOrder(order.id);
      return (await orderRow('id = ?', [order.id])).status;
    }
    if (status === 'DECLINED' || status === 'FAILED') {
      await db.tx(async t => {
        const row = await orderRow('id = ?', [order.id], t);
        if (row && ['CREATED', 'PENDING'].includes(row.status)) await setStatus(t, row.id, 'FAILED');
      });
      return 'FAILED';
    }
    return order.status;   // PENDING (p. ej. revisión de PayPal): lo terminará el webhook
  }
  const captureOf = json => json?.purchase_units?.[0]?.payments?.captures?.[0];

  // Vuelta del jugador desde PayPal: el servidor cobra la orden y comprueba el resultado.
  async function completeReturn(paypalOrderId) {
    const order = paypalOrderId && await orderRow("provider = 'paypal' AND provider_ref = ?", [String(paypalOrderId)]);
    if (!order) return {status: 'UNKNOWN'};
    if (['CREDITED', 'REFUNDED', 'CHARGEBACK', 'CANCELED', 'FAILED'].includes(order.status)) return {status: order.status, orderId: order.id};
    try {
      const json = await paypal.captureOrder(order.provider_ref, order.id);
      return {status: await applyCapture(order, captureOf(json)), orderId: order.id};
    } catch (e) {
      console.error('[payments] no se pudo cobrar la orden', order.id, e.message, e.details || '');
      return {status: 'ERROR', orderId: order.id};
    }
  }

  async function cancel(paypalOrderId) {
    const order = paypalOrderId && await orderRow("provider = 'paypal' AND provider_ref = ?", [String(paypalOrderId)]);
    if (!order) return {status: 'UNKNOWN'};
    await db.tx(async t => {
      const row = await orderRow('id = ?', [order.id], t);
      if (row && ['CREATED', 'PENDING'].includes(row.status)) await setStatus(t, row.id, 'CANCELED');
    });
    return {status: (await orderRow('id = ?', [order.id])).status, orderId: order.id};
  }

  async function orderStatus(userId, orderId) {
    const order = await orderRow('id = ? AND user_id = ?', [String(orderId || ''), userId]);
    if (!order) throw new EconomyError('order_not_found', 404);
    return {orderId: order.id, status: order.status, goldAmount: order.gold_amount, productId: order.product_id};
  }

  // Reembolso o contracargo: retira el oro de la compra que aún quede (nunca deja saldo negativo;
  // lo ya cambiado por Tablas Normales no se puede recuperar y queda anotado en el registro).
  async function reverse(order, status) {
    if (order.status === 'REFUNDED' || order.status === 'CHARGEBACK') return order.status;
    const wasCredited = order.status === 'CREDITED';
    await db.tx(async t => {
      const row = await orderRow('id = ?', [order.id], t);
      if (row && row.status !== 'REFUNDED' && row.status !== 'CHARGEBACK') await setStatus(t, row.id, status);
    });
    if (wasCredited) {
      const wallet = await economy.wallet(order.user_id);
      const take = Math.min(num(wallet.GOLD_COIN), order.gold_amount);
      if (take > 0) {
        try { await economy.move(order.user_id, 'GOLD_COIN', -take, 'GOLD_REFUND', 'refund:' + order.id, (status === 'CHARGEBACK' ? 'Contracargo' : 'Reembolso') + ' de PayPal'); }
        catch (e) { if (e.code !== 'duplicate_operation') throw e; }
      }
      if (take < order.gold_amount) console.warn('[payments] reembolso con oro ya gastado', order.id, 'retirado', take, 'de', order.gold_amount);
    }
    return status;
  }

  // Webhook: la firma se comprueba con PayPal antes de mirar el contenido.
  async function webhook(headers, rawBody) {
    if (!paypal.webhookEnabled) return {status: 503, body: {error: 'webhook_disabled'}};
    let event;
    try { event = JSON.parse(rawBody); } catch { return {status: 400, body: {error: 'invalid_json'}}; }
    let valid = false;
    try { valid = await paypal.verifyWebhook(headers, event); } catch (e) { console.error('[payments] no se pudo verificar el webhook', e.message); return {status: 502, body: {error: 'verification_unavailable'}}; }
    if (!valid || !event?.id || !event.event_type) return {status: 400, body: {error: 'invalid_signature'}};

    const resource = event.resource || {};
    const type = String(event.event_type);
    const paypalOrderId = type.startsWith('CHECKOUT.ORDER.') ? resource.id : resource.supplementary_data?.related_ids?.order_id;
    const ourId = resource.custom_id || resource.invoice_id || resource.purchase_units?.[0]?.custom_id;
    const order = (paypalOrderId && await orderRow("provider = 'paypal' AND provider_ref = ?", [String(paypalOrderId)]))
      || (ourId && await orderRow("provider = 'paypal' AND id = ?", [String(ourId)])) || null;

    try {
      await db.run('INSERT INTO payment_events (provider, event_id, order_id, type, payload) VALUES (?, ?, ?, ?, ?)',
        ['paypal', String(event.id).slice(0, 128), order?.id || null, type.slice(0, 64), rawBody.slice(0, 60000)]);
    } catch (e) {
      if (isUniqueViolation(e)) return {status: 200, body: {ok: true, duplicate: true}};
      throw e;
    }
    if (!order) return {status: 200, body: {ok: true, ignored: 'unknown_order'}};

    let result = order.status;
    if (type === 'CHECKOUT.ORDER.APPROVED') result = (await completeReturn(order.provider_ref)).status;
    else if (type === 'PAYMENT.CAPTURE.COMPLETED' || type === 'PAYMENT.CAPTURE.DENIED') result = await applyCapture(order, resource);
    else if (type === 'PAYMENT.CAPTURE.REFUNDED') result = await reverse(order, 'REFUNDED');
    else if (type === 'PAYMENT.CAPTURE.REVERSED') result = await reverse(order, 'CHARGEBACK');
    return {status: 200, body: {ok: true, order: order.id, result}};
  }

  return {enabled: paypal.enabled, mode: paypal.mode, products, checkout, completeReturn, cancel, orderStatus, webhook};
}

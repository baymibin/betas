// Economía de Surf Salvaje: cuentas, monedero (Tablas Normales / Tablas de Oro), inventario,
// equipamiento, compras, conversión Oro -> Normales, recompensas y pagos (preparados).
//
// Reglas que se cumplen aquí, en el servidor, y nunca en el navegador:
//  - Los precios, saldos y la propiedad salen de la base de datos, no de la petición.
//  - Cada cambio de saldo va en una transacción atómica con su fila en wallet_transactions.
//  - Ningún saldo puede quedar negativo (comprobación + CHECK en la tabla).
//  - Compras y conversiones son idempotentes por requestId: doble clic o F5 no repiten nada.
//  - La tiendita solo vende con NORMAL_COIN. GOLD_COIN solo sirve para conseguir NORMAL_COIN.
//  - El oro solo entra por un pago confirmado por el proveedor o por un ajuste administrativo.
import {randomUUID} from 'node:crypto';
import {transaction} from './db.js';
import {SLOTS, parseItemId, itemId} from '../../client/src/shared/catalog.js';

export const NORMAL = 'NORMAL_COIN', GOLD = 'GOLD_COIN';
export class EconomyError extends Error {
  constructor(code, status = 400, detail) { super(code); this.code = code; this.status = status; this.detail = detail; }
}
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const checkRequestId = id => { if (!REQUEST_ID.test(String(id || ''))) throw new EconomyError('invalid_request_id'); return String(id); };
const plain = row => row && {...row};

export function sanitizeNickname(value, fallback = 'Surfer') {
  const nick = String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return nick || fallback;
}

export function createEconomy(db, config = {}) {
  const q = sql => db.prepare(sql);

  // ---------- Cuentas ----------
  function createUser({nickname, avatarUrl = null}) {
    const id = randomUUID();
    transaction(db, () => {
      q('INSERT INTO users (id, nickname, avatar_url) VALUES (?, ?, ?)').run(id, sanitizeNickname(nickname), avatarUrl);
      for (const currency of [NORMAL, GOLD]) q('INSERT INTO wallets (user_id, currency, balance) VALUES (?, ?, 0)').run(id, currency);
      for (const slot of SLOTS) q('INSERT INTO equipped_items (user_id, slot, item_id) VALUES (?, ?, ?)').run(id, slot, itemId(slot, 0));
    });
    return id;
  }
  const getUser = id => plain(q('SELECT id, nickname, avatar_url AS avatarUrl, created_at AS createdAt, local_migrated AS localMigrated FROM users WHERE id = ?').get(id));
  function setNickname(userId, value) {
    const nick = sanitizeNickname(value, null);
    if (!nick) throw new EconomyError('invalid_nickname');
    q("UPDATE users SET nickname = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(nick, userId);
    return nick;
  }

  // ---------- Monedero ----------
  function wallet(userId) {
    const out = {[NORMAL]: 0, [GOLD]: 0};
    for (const row of q('SELECT currency, balance FROM wallets WHERE user_id = ?').all(userId)) out[row.currency] = row.balance;
    return out;
  }
  // Único punto que cambia saldos. Lanza insufficient_funds antes de dejar nada a medias y
  // duplicate_operation si (usuario, moneda, tipo, referencia) ya se aplicó.
  function move(userId, currency, amount, type, reference, description = null) {
    if (!Number.isSafeInteger(amount) || amount === 0) throw new EconomyError('invalid_amount');
    return transaction(db, () => {
      const row = q('SELECT balance FROM wallets WHERE user_id = ? AND currency = ?').get(userId, currency);
      if (!row) throw new EconomyError('wallet_not_found', 404);
      const balance = row.balance + amount;
      if (balance < 0) throw new EconomyError('insufficient_funds', 409, {currency, balance: row.balance, needed: -amount});
      try {
        q('INSERT INTO wallet_transactions (user_id, currency, amount, balance_after, type, reference, description) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(userId, currency, amount, balance, type, reference, description);
      } catch (error) {
        if (/UNIQUE/.test(error.message)) throw new EconomyError('duplicate_operation', 409);
        throw error;
      }
      q("UPDATE wallets SET balance = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND currency = ?").run(balance, userId, currency);
      return balance;
    });
  }
  const transactions = (userId, limit = 30) => q(`SELECT id, currency, amount, balance_after AS balanceAfter, type, reference, description, created_at AS createdAt
      FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?`).all(userId, Math.max(1, Math.min(100, limit | 0))).map(plain);

  // ---------- Catálogo, inventario y equipamiento ----------
  const itemRow = id => plain(q('SELECT id, category, asset_index AS assetIndex, name, description, asset, price_normal AS price, available FROM shop_items WHERE id = ?').get(id));
  const owns = (userId, id) => !!q('SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ?').get(userId, id);
  const inventory = userId => q('SELECT item_id AS itemId, source, acquired_at AS acquiredAt FROM user_inventory WHERE user_id = ? ORDER BY acquired_at').all(userId).map(plain);
  // ¿Puede esta cuenta (o un invitado, userId = null) usar el artículo? Gratis o comprado.
  function canUse(userId, slot, index) {
    const item = itemRow(itemId(slot, index));
    if (!item || !item.available) return false;
    return item.price === 0 || (!!userId && owns(userId, item.id));
  }
  function equipped(userId) {
    const out = {character: 0, board: 0, wing: 0, hat: 0};
    for (const row of q('SELECT slot, item_id FROM equipped_items WHERE user_id = ?').all(userId)) {
      const parsed = parseItemId(row.item_id);
      if (parsed && canUse(userId, parsed.slot, parsed.index)) out[row.slot] = parsed.index;
    }
    return out;
  }
  function catalog(userId = null) {
    const eq = userId ? equipped(userId) : null;
    const owned = new Set(userId ? inventory(userId).map(i => i.itemId) : []);
    return q('SELECT id, category, asset_index AS assetIndex, name, description, asset, price_normal AS price FROM shop_items WHERE available = 1 ORDER BY sort_order').all()
      .map(row => ({...row, free: row.price === 0, owned: row.price === 0 || owned.has(row.id), equipped: !!eq && eq[row.category] === row.assetIndex}));
  }
  function equip(userId, id) {
    const parsed = parseItemId(id), item = parsed && itemRow(id);
    if (!item || !item.available) throw new EconomyError('item_not_found', 404);
    if (!canUse(userId, parsed.slot, parsed.index)) throw new EconomyError('not_owned', 403);
    q(`INSERT INTO equipped_items (user_id, slot, item_id) VALUES (?, ?, ?)
       ON CONFLICT(user_id, slot) DO UPDATE SET item_id = excluded.item_id, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`).run(userId, parsed.slot, id);
    return equipped(userId);
  }

  // ---------- Compra de artículos (solo Tablas Normales) ----------
  function purchase(userId, id, requestIdValue) {
    const requestId = checkRequestId(requestIdValue);
    return transaction(db, () => {
      const previous = q('SELECT item_id FROM item_purchases WHERE user_id = ? AND request_id = ?').get(userId, requestId);
      if (previous) {
        if (previous.item_id !== id) throw new EconomyError('request_id_reused', 409);
        return {itemId: id, replayed: true, wallet: wallet(userId)};
      }
      const item = parseItemId(id) && itemRow(id);
      if (!item || !item.available) throw new EconomyError('item_not_found', 404);
      if (item.price === 0) throw new EconomyError('item_is_free', 409);
      if (owns(userId, id)) throw new EconomyError('already_owned', 409);
      move(userId, NORMAL, -item.price, 'ITEM_PURCHASE', 'purchase:' + requestId, item.name);
      q('INSERT INTO user_inventory (user_id, item_id, source, reference) VALUES (?, ?, ?, ?)').run(userId, id, 'PURCHASE', requestId);
      q('INSERT INTO item_purchases (user_id, item_id, price_normal, request_id) VALUES (?, ?, ?, ?)').run(userId, id, item.price, requestId);
      return {itemId: id, replayed: false, price: item.price, wallet: wallet(userId)};
    });
  }

  // ---------- Conversión Tablas de Oro -> Tablas Normales ----------
  const packages = () => q('SELECT id, name, normal_amount AS normalAmount, gold_price AS goldPrice, active FROM coin_exchange_packages ORDER BY sort_order').all()
    .map(row => ({...row, active: !!row.active && row.goldPrice > 0}));
  function exchange(userId, packageId, requestIdValue) {
    const requestId = checkRequestId(requestIdValue);
    return transaction(db, () => {
      const previous = q('SELECT package_id FROM coin_exchange_transactions WHERE user_id = ? AND request_id = ?').get(userId, requestId);
      if (previous) {
        if (previous.package_id !== packageId) throw new EconomyError('request_id_reused', 409);
        return {packageId, replayed: true, wallet: wallet(userId)};
      }
      const pack = q('SELECT id, name, normal_amount, gold_price, active FROM coin_exchange_packages WHERE id = ?').get(String(packageId));
      if (!pack) throw new EconomyError('package_not_found', 404);
      if (!pack.active || !(pack.gold_price > 0)) throw new EconomyError('package_inactive', 409);
      const reference = 'exchange:' + requestId;
      move(userId, GOLD, -pack.gold_price, 'GOLD_EXCHANGE', reference, pack.name);
      move(userId, NORMAL, pack.normal_amount, 'GOLD_EXCHANGE', reference, pack.name);
      q('INSERT INTO coin_exchange_transactions (user_id, package_id, gold_spent, normal_received, request_id) VALUES (?, ?, ?, ?, ?)')
        .run(userId, pack.id, pack.gold_price, pack.normal_amount, requestId);
      return {packageId: pack.id, replayed: false, goldSpent: pack.gold_price, normalReceived: pack.normal_amount, wallet: wallet(userId)};
    });
  }

  // ---------- Recompensas de carrera (las decide el servidor con el resultado real) ----------
  function rewardAmount(place, humans) {
    const r = config.rewards || {};
    if (!r.enabled || humans < (r.minHumans || 1) || !(place > 0)) return 0;
    return (r.finish || 0) + ((r.placeBonus || [])[place - 1] || 0);
  }
  function rewardRace(userId, raceId, place, humans, now = new Date()) {
    let amount = rewardAmount(place, humans);
    const day = now.toISOString().slice(0, 10);
    return transaction(db, () => {
      if (q('SELECT 1 FROM race_rewards WHERE user_id = ? AND race_id = ?').get(userId, raceId)) return {amount: 0, duplicate: true};
      const cap = config.rewards?.dailyCap;
      if (Number.isInteger(cap)) {
        const today = q('SELECT COALESCE(SUM(amount), 0) AS total FROM race_rewards WHERE user_id = ? AND day = ?').get(userId, day).total;
        amount = Math.max(0, Math.min(amount, cap - today));
      }
      q('INSERT INTO race_rewards (user_id, race_id, place, amount, day) VALUES (?, ?, ?, ?, ?)').run(userId, raceId, place, amount, day);
      if (amount > 0) move(userId, NORMAL, amount, 'RACE_REWARD', 'race:' + raceId, `Carrera · puesto ${place}`);
      return {amount, duplicate: false};
    });
  }

  // ---------- Ajuste administrativo (solo desde la consola del servidor) ----------
  function adminAdjust(userId, currency, amount, reason, reference = randomUUID()) {
    if (![NORMAL, GOLD].includes(currency)) throw new EconomyError('invalid_currency');
    if (!String(reason || '').trim()) throw new EconomyError('reason_required');
    return move(userId, currency, amount, 'ADMIN_ADJUSTMENT', 'admin:' + reference, String(reason).slice(0, 200));
  }

  // ---------- Pagos reales (preparado; sin proveedor integrado no se acredita nada) ----------
  const goldProducts = () => q('SELECT id, name, gold_amount AS goldAmount, price_minor AS priceMinor, price_currency AS currency, active FROM payment_products ORDER BY sort_order').all()
    .map(row => ({...row, active: !!row.active}));
  // Lo llamará únicamente el manejador verificado del proveedor (webhook con firma comprobada)
  // cuando confirme el cobro. Pasa la orden a CREDITED una sola vez.
  function creditPaidOrder(orderId) {
    return transaction(db, () => {
      const order = q('SELECT id, user_id, gold_amount, status FROM payment_orders WHERE id = ?').get(orderId);
      if (!order) throw new EconomyError('order_not_found', 404);
      if (order.status === 'CREDITED') return {credited: false, replayed: true};
      if (order.status !== 'PAID') throw new EconomyError('order_not_paid', 409);
      move(order.user_id, GOLD, order.gold_amount, 'GOLD_CREDIT', 'order:' + order.id, 'Compra de Tablas de Oro');
      q("UPDATE payment_orders SET status = 'CREDITED', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(order.id);
      return {credited: true, replayed: false};
    });
  }

  // ---------- Migración del equipamiento guardado en el navegador ----------
  // Solo equipa lo que la cuenta ya puede usar (gratis o comprado); nunca regala artículos.
  function migrateLocal(userId, local = {}) {
    return transaction(db, () => {
      const user = getUser(userId);
      if (!user || user.localMigrated) return {migrated: false, equipped: equipped(userId)};
      for (const slot of SLOTS) {
        const index = local[slot];
        if (Number.isInteger(index) && canUse(userId, slot, index)) equip(userId, itemId(slot, index));
      }
      q('UPDATE users SET local_migrated = 1 WHERE id = ?').run(userId);
      return {migrated: true, equipped: equipped(userId)};
    });
  }

  return {createUser, getUser, setNickname, wallet, move, transactions, catalog, inventory, equipped, equip, canUse,
    purchase, packages, exchange, rewardAmount, rewardRace, adminAdjust, goldProducts, creditPaidOrder, migrateLocal};
}

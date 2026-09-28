// Economía de Surf Salvaje: cuentas, monedero (Tablas Normales / Tablas de Oro), inventario,
// equipamiento, compras, conversión Oro -> Normales, recompensas y pagos (preparados).
//
// Reglas que se cumplen aquí, en el servidor, y nunca en el navegador:
//  - Los precios, saldos y la propiedad salen de la base de datos, no de la petición.
//  - Cada cambio de saldo va en una transacción atómica con su fila en wallet_transactions, y
//    la fila del monedero se bloquea (SELECT ... FOR UPDATE en MySQL) hasta el commit: dos
//    compras simultáneas no pueden gastar el mismo saldo.
//  - Ningún saldo puede quedar negativo (comprobación + CHECK en la tabla).
//  - Compras y conversiones son idempotentes por requestId: doble clic o F5 no repiten nada.
//  - La tiendita solo vende con NORMAL_COIN. GOLD_COIN solo sirve para conseguir NORMAL_COIN.
//  - El oro solo entra por un pago confirmado por el proveedor o por un ajuste administrativo.
// Todas las funciones son asíncronas; `r` es la base de datos o la transacción en curso.
import {randomUUID} from 'node:crypto';
import {nowSql, isUniqueViolation} from './db.js';
import {SLOTS, parseItemId, itemId} from '../../client/src/shared/catalog.js';

export const NORMAL = 'NORMAL_COIN', GOLD = 'GOLD_COIN';
export class EconomyError extends Error {
  constructor(code, status = 400, detail) { super(code); this.code = code; this.status = status; this.detail = detail; }
}
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const checkRequestId = id => { if (!REQUEST_ID.test(String(id || ''))) throw new EconomyError('invalid_request_id'); return String(id); };
const num = v => Number(v ?? 0);

export function sanitizeNickname(value, fallback = 'Surfer') {
  const nick = String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return nick || fallback;
}

export function createEconomy(db, config = {}) {
  // Precios en memoria para decisiones que no pueden esperar a la base de datos (qué puede
  // lucir un invitado en el WebSocket). Se cargan con loadCache() tras syncCatalog().
  let priceCache = new Map();
  async function loadCache() {
    priceCache = new Map((await db.all('SELECT id, price_normal, available FROM shop_items')).map(r => [r.id, {price: num(r.price_normal), available: !!num(r.available)}]));
  }
  // ¿Artículo gratuito y disponible? (sin consultar la base de datos)
  const isFree = (slot, index) => { const p = priceCache.get(itemId(slot, index)); return !!p && p.available && p.price === 0; };

  // ---------- Cuentas ----------
  async function createUser({nickname, avatarUrl = null}, r = db) {
    const id = randomUUID();
    await r.tx(async t => {
      await t.run('INSERT INTO users (id, nickname, avatar_url) VALUES (?, ?, ?)', [id, sanitizeNickname(nickname), avatarUrl]);
      for (const currency of [NORMAL, GOLD]) await t.run('INSERT INTO wallets (user_id, currency, balance) VALUES (?, ?, 0)', [id, currency]);
      for (const slot of SLOTS) await t.run('INSERT INTO equipped_items (user_id, slot, item_id) VALUES (?, ?, ?)', [id, slot, itemId(slot, 0)]);
    });
    return id;
  }
  async function getUser(id, r = db) {
    const row = await r.get('SELECT id, nickname, avatar_url AS avatarUrl, created_at AS createdAt, local_migrated AS localMigrated FROM users WHERE id = ?', [id]);
    return row && {...row, localMigrated: num(row.localMigrated)};
  }
  async function setNickname(userId, value) {
    const nick = sanitizeNickname(value, null);
    if (!nick) throw new EconomyError('invalid_nickname');
    await db.run('UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?', [nick, nowSql(), userId]);
    return nick;
  }

  // ---------- Monedero ----------
  async function wallet(userId, r = db) {
    const out = {[NORMAL]: 0, [GOLD]: 0};
    for (const row of await r.all('SELECT currency, balance FROM wallets WHERE user_id = ?', [userId])) out[row.currency] = num(row.balance);
    return out;
  }
  // Único punto que cambia saldos. Lanza insufficient_funds antes de dejar nada a medias y
  // duplicate_operation si (usuario, moneda, tipo, referencia) ya se aplicó.
  async function move(userId, currency, amount, type, reference, description = null, r = db) {
    if (!Number.isSafeInteger(amount) || amount === 0) throw new EconomyError('invalid_amount');
    return r.tx(async t => {
      const row = await t.get('SELECT balance FROM wallets WHERE user_id = ? AND currency = ?' + t.forUpdate, [userId, currency]);
      if (!row) throw new EconomyError('wallet_not_found', 404);
      const current = num(row.balance), balance = current + amount;
      if (balance < 0) throw new EconomyError('insufficient_funds', 409, {currency, balance: current, needed: -amount});
      try {
        await t.run('INSERT INTO wallet_transactions (user_id, currency, amount, balance_after, type, reference, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [userId, currency, amount, balance, type, reference, description]);
      } catch (error) {
        if (isUniqueViolation(error)) throw new EconomyError('duplicate_operation', 409);
        throw error;
      }
      await t.run('UPDATE wallets SET balance = ?, updated_at = ? WHERE user_id = ? AND currency = ?', [balance, nowSql(), userId, currency]);
      return balance;
    });
  }
  // Bloqueo de la fila del monedero hasta el final de la transacción (MySQL). Debe ser la primera
  // lectura: así las lecturas normales posteriores ven lo que confirmaron las operaciones previas.
  const lockWallet = (t, userId, currency) => t.get('SELECT balance FROM wallets WHERE user_id = ? AND currency = ?' + t.forUpdate, [userId, currency]);
  const transactions = async (userId, limit = 30) => (await db.all(`SELECT id, currency, amount, balance_after AS balanceAfter, type, reference, description, created_at AS createdAt
      FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?`, [userId, Math.max(1, Math.min(100, limit | 0))]))
    .map(t => ({...t, id: num(t.id), amount: num(t.amount), balanceAfter: num(t.balanceAfter)}));

  // ---------- Catálogo, inventario y equipamiento ----------
  async function itemRow(id, r = db) {
    const row = await r.get('SELECT id, category, asset_index AS assetIndex, name, description, asset, price_normal AS price, available FROM shop_items WHERE id = ?', [id]);
    return row && {...row, assetIndex: num(row.assetIndex), price: num(row.price), available: num(row.available)};
  }
  const owns = async (userId, id, r = db) => !!(await r.get('SELECT 1 AS ok FROM user_inventory_v2 WHERE user_id = ? AND item_id = ?', [userId, id]));
  const inventory = async (userId, r = db) => r.all('SELECT item_id AS itemId, source, acquired_at AS acquiredAt FROM user_inventory_v2 WHERE user_id = ? ORDER BY acquired_at', [userId]);
  // ¿Puede esta cuenta (o un invitado, userId = null) usar el artículo? Gratis o comprado.
  async function canUse(userId, slot, index, r = db) {
    const item = await itemRow(itemId(slot, index), r);
    if (!item || !item.available) return false;
    return item.price === 0 || (!!userId && await owns(userId, item.id, r));
  }
  async function equipped(userId, r = db) {
    const out = {character: 0, board: 0, wing: 0, hat: 0};
    for (const row of await r.all('SELECT slot, item_id FROM equipped_items WHERE user_id = ?', [userId])) {
      const parsed = parseItemId(row.item_id);
      if (parsed && await canUse(userId, parsed.slot, parsed.index, r)) out[row.slot] = parsed.index;
    }
    return out;
  }
  async function catalog(userId = null) {
    const eq = userId ? await equipped(userId) : null;
    const owned = new Set(userId ? (await inventory(userId)).map(i => i.itemId) : []);
    return (await db.all('SELECT id, category, asset_index AS assetIndex, name, description, asset, price_normal AS price FROM shop_items WHERE available = 1 ORDER BY sort_order'))
      .map(row => ({...row, assetIndex: num(row.assetIndex), price: num(row.price)}))
      .map(row => ({...row, free: row.price === 0, owned: row.price === 0 || owned.has(row.id), equipped: !!eq && eq[row.category] === row.assetIndex,
        rarity: rarity(row.id), tradeable: tradeable(row.id, row.price)}));
  }
  // Rareza (solo presentación, desde economy.json) y si el item puede ir en un trade: los
  // gratuitos no (todo el mundo los tiene), ni los que la configuración excluya.
  const RARITIES = ['common', 'rare', 'epic', 'legendary'];
  function rarity(id) { const r = config.itemRarity?.[id]; return RARITIES.includes(r) ? r : 'common'; }
  function tradeable(id, price = priceCache.get(id)?.price) { return price > 0 && !(config.trade?.untradeable || []).includes(id); }
  async function equip(userId, id, r = db) {
    const parsed = parseItemId(id), item = parsed && await itemRow(id, r);
    if (!item || !item.available) throw new EconomyError('item_not_found', 404);
    if (!await canUse(userId, parsed.slot, parsed.index, r)) throw new EconomyError('not_owned', 403);
    await r.upsert('equipped_items', {user_id: userId, slot: parsed.slot, item_id: id, updated_at: nowSql()}, ['user_id', 'slot'], ['item_id', 'updated_at']);
    return equipped(userId, r);
  }

  // ---------- Compra de artículos (solo Tablas Normales) ----------
  async function purchase(userId, id, requestIdValue) {
    const requestId = checkRequestId(requestIdValue);
    try {
      return await db.tx(async t => {
        // Primero se bloquea el monedero: las compras de una misma cuenta van de una en una y
        // todo lo que se lee después (repetición, propiedad) ya incluye la compra anterior.
        await lockWallet(t, userId, NORMAL);
        const previous = await t.get('SELECT item_id FROM item_purchases_v2 WHERE user_id = ? AND request_id = ?', [userId, requestId]);
        if (previous) {
          if (previous.item_id !== id) throw new EconomyError('request_id_reused', 409);
          return {itemId: id, replayed: true, wallet: await wallet(userId, t)};
        }
        const item = parseItemId(id) && await itemRow(id, t);
        if (!item || !item.available) throw new EconomyError('item_not_found', 404);
        if (item.price === 0) throw new EconomyError('item_is_free', 409);
        if (await owns(userId, id, t)) throw new EconomyError('already_owned', 409);
        await move(userId, NORMAL, -item.price, 'ITEM_PURCHASE', 'purchase:' + requestId, item.name, t);
        await t.run('INSERT INTO user_inventory_v2 (user_id, item_id, source, reference) VALUES (?, ?, ?, ?)', [userId, id, 'PURCHASE', requestId]);
        await t.run('INSERT INTO item_purchases_v2 (user_id, item_id, price_normal, request_id) VALUES (?, ?, ?, ?)', [userId, id, item.price, requestId]);
        return {itemId: id, replayed: false, price: item.price, wallet: await wallet(userId, t)};
      });
    } catch (error) {
      // Dos peticiones simultáneas con el mismo requestId: la segunda choca con la restricción
      // única; se responde como repetición, sin cobrar dos veces.
      if (error instanceof EconomyError && error.code === 'duplicate_operation' || isUniqueViolation(error)) {
        if (await db.get('SELECT 1 AS ok FROM item_purchases_v2 WHERE user_id = ? AND request_id = ?', [userId, requestId])) return {itemId: id, replayed: true, wallet: await wallet(userId)};
        if (await owns(userId, id)) throw new EconomyError('already_owned', 409);
      }
      throw error;
    }
  }

  // ---------- Conversión Tablas de Oro -> Tablas Normales ----------
  const packages = async () => (await db.all('SELECT id, name, normal_amount AS normalAmount, gold_price AS goldPrice, active FROM coin_exchange_packages ORDER BY sort_order'))
    .map(row => ({...row, normalAmount: num(row.normalAmount), goldPrice: row.goldPrice === null ? null : num(row.goldPrice), active: !!num(row.active) && num(row.goldPrice) > 0}));
  async function exchange(userId, packageId, requestIdValue) {
    const requestId = checkRequestId(requestIdValue);
    try {
      return await db.tx(async t => {
        await lockWallet(t, userId, GOLD);
        const previous = await t.get('SELECT package_id FROM coin_exchange_transactions WHERE user_id = ? AND request_id = ?', [userId, requestId]);
        if (previous) {
          if (previous.package_id !== packageId) throw new EconomyError('request_id_reused', 409);
          return {packageId, replayed: true, wallet: await wallet(userId, t)};
        }
        const pack = await t.get('SELECT id, name, normal_amount, gold_price, active FROM coin_exchange_packages WHERE id = ?', [String(packageId)]);
        if (!pack) throw new EconomyError('package_not_found', 404);
        const goldPrice = num(pack.gold_price), normalAmount = num(pack.normal_amount);
        if (!num(pack.active) || !(goldPrice > 0)) throw new EconomyError('package_inactive', 409);
        const reference = 'exchange:' + requestId;
        await move(userId, GOLD, -goldPrice, 'GOLD_EXCHANGE', reference, pack.name, t);
        await move(userId, NORMAL, normalAmount, 'GOLD_EXCHANGE', reference, pack.name, t);
        await t.run('INSERT INTO coin_exchange_transactions (user_id, package_id, gold_spent, normal_received, request_id) VALUES (?, ?, ?, ?, ?)',
          [userId, pack.id, goldPrice, normalAmount, requestId]);
        return {packageId: pack.id, replayed: false, goldSpent: goldPrice, normalReceived: normalAmount, wallet: await wallet(userId, t)};
      });
    } catch (error) {
      if ((error instanceof EconomyError && error.code === 'duplicate_operation' || isUniqueViolation(error)) &&
          await db.get('SELECT 1 AS ok FROM coin_exchange_transactions WHERE user_id = ? AND request_id = ?', [userId, requestId])) {
        return {packageId, replayed: true, wallet: await wallet(userId)};
      }
      throw error;
    }
  }

  // ---------- Recompensas de carrera (las decide el servidor con el resultado real) ----------
  function rewardAmount(place, humans) {
    const r = config.rewards || {};
    if (!r.enabled || humans < (r.minHumans || 1) || !(place > 0)) return 0;
    return (r.finish || 0) + ((r.placeBonus || [])[place - 1] || 0);
  }
  async function rewardRace(userId, raceId, place, humans, now = new Date()) {
    let amount = rewardAmount(place, humans);
    const day = now.toISOString().slice(0, 10);
    try {
      return await db.tx(async t => {
        // Se bloquea el monedero para que dos llegadas simultáneas no superen el tope diario.
        await lockWallet(t, userId, NORMAL);
        if (await t.get('SELECT 1 AS ok FROM race_rewards WHERE user_id = ? AND race_id = ?', [userId, raceId])) return {amount: 0, duplicate: true};
        const cap = config.rewards?.dailyCap;
        if (Number.isInteger(cap)) {
          const today = num((await t.get('SELECT COALESCE(SUM(amount), 0) AS total FROM race_rewards WHERE user_id = ? AND day = ?', [userId, day])).total);
          amount = Math.max(0, Math.min(amount, cap - today));
        }
        await t.run('INSERT INTO race_rewards (user_id, race_id, place, amount, day) VALUES (?, ?, ?, ?, ?)', [userId, raceId, place, amount, day]);
        if (amount > 0) await move(userId, NORMAL, amount, 'RACE_REWARD', 'race:' + raceId, `Carrera · puesto ${place}`, t);
        return {amount, duplicate: false};
      });
    } catch (error) {
      if (isUniqueViolation(error)) return {amount: 0, duplicate: true};
      throw error;
    }
  }

  // ---------- Ajuste administrativo (solo desde la consola del servidor) ----------
  async function adminAdjust(userId, currency, amount, reason, reference = randomUUID()) {
    if (![NORMAL, GOLD].includes(currency)) throw new EconomyError('invalid_currency');
    if (!String(reason || '').trim()) throw new EconomyError('reason_required');
    return move(userId, currency, amount, 'ADMIN_ADJUSTMENT', 'admin:' + reference, String(reason).slice(0, 200));
  }

  // Entrega un item (p. ej. premio de un evento o para probar el Trade). Solo consola.
  async function adminGiveItem(userId, id, reason) {
    if (!String(reason || '').trim()) throw new EconomyError('reason_required');
    const item = parseItemId(id) && await itemRow(id);
    if (!item || !item.available) throw new EconomyError('item_not_found', 404);
    if (item.price === 0) throw new EconomyError('item_is_free', 409);
    if (await owns(userId, id)) throw new EconomyError('already_owned', 409);
    await db.run('INSERT INTO user_inventory_v2 (user_id, item_id, source, reference) VALUES (?, ?, ?, ?)', [userId, id, 'ADMIN', String(reason).slice(0, 120)]);
    return inventory(userId);
  }

  // ---------- Pagos reales (preparado; sin proveedor integrado no se acredita nada) ----------
  const goldProducts = async () => (await db.all('SELECT id, name, gold_amount AS goldAmount, price_minor AS priceMinor, price_currency AS currency, active FROM payment_products ORDER BY sort_order'))
    .map(row => ({...row, goldAmount: num(row.goldAmount), priceMinor: row.priceMinor === null ? null : num(row.priceMinor), active: !!num(row.active)}));
  // Lo llamará únicamente el manejador verificado del proveedor (webhook con firma comprobada)
  // cuando confirme el cobro. Pasa la orden a CREDITED una sola vez.
  async function creditPaidOrder(orderId) {
    return db.tx(async t => {
      const order = await t.get('SELECT id, user_id, gold_amount, status FROM payment_orders WHERE id = ?' + t.forUpdate, [orderId]);
      if (!order) throw new EconomyError('order_not_found', 404);
      if (order.status === 'CREDITED') return {credited: false, replayed: true};
      if (order.status !== 'PAID') throw new EconomyError('order_not_paid', 409);
      await move(order.user_id, GOLD, num(order.gold_amount), 'GOLD_CREDIT', 'order:' + order.id, 'Compra de Tablas de Oro', t);
      await t.run("UPDATE payment_orders SET status = 'CREDITED', updated_at = ? WHERE id = ?", [nowSql(), order.id]);
      return {credited: true, replayed: false};
    });
  }

  // ---------- Migración del equipamiento guardado en el navegador ----------
  // Solo equipa lo que la cuenta ya puede usar (gratis o comprado); nunca regala artículos.
  async function migrateLocal(userId, local = {}) {
    return db.tx(async t => {
      const user = await t.get('SELECT local_migrated FROM users WHERE id = ?' + t.forUpdate, [userId]);
      if (!user || num(user.local_migrated)) return {migrated: false, equipped: await equipped(userId, t)};
      for (const slot of SLOTS) {
        const index = local[slot];
        if (Number.isInteger(index) && await canUse(userId, slot, index, t)) await equip(userId, itemId(slot, index), t);
      }
      await t.run('UPDATE users SET local_migrated = 1 WHERE id = ?', [userId]);
      return {migrated: true, equipped: await equipped(userId, t)};
    });
  }

  return {loadCache, isFree, rarity, tradeable, itemRow, owns, lockWallet, createUser, getUser, setNickname, wallet, move, transactions, catalog, inventory, equipped, equip, canUse,
    purchase, packages, exchange, rewardAmount, rewardRace, adminAdjust, adminGiveItem, goldProducts, creditPaidOrder, migrateLocal};
}

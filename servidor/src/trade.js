// Trade de Surf Salvaje: intercambio de items por items (sin monedas) entre cuentas registradas.
//
// Reglas que se cumplen aquí, en el servidor, y nunca en el navegador:
//  - Solo se ofrecen items que la cuenta posee de verdad y que no son gratuitos (los gratuitos
//    los tiene todo el mundo). Quien recibe no puede tener ya el item.
//  - Una oferta no se edita: cambiar algo es una contraoferta nueva. Aceptar exige la huella
//    (contentHash) de lo que vio quien acepta, así nadie puede cambiarla en el último momento.
//  - Aceptar es una sola transacción: se bloquean los monederos de las dos cuentas (siempre en
//    el mismo orden, sin interbloqueos), se vuelve a comprobar todo, se mueven los items, se
//    desequipan los entregados, se anota cada movimiento en item_transfers y las demás ofertas
//    que dependían de esos items pasan a INVALID. Repetir la petición no repite el trade.
import {randomUUID, randomInt, createHash} from 'node:crypto';
import {nowSql, isUniqueViolation} from './db.js';
import {EconomyError, NORMAL} from './economy.js';
import {parseItemId, itemId} from '../../client/src/shared/catalog.js';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // sin 0/O ni 1/I
const CODE_LENGTH = 5;
const num = v => Number(v ?? 0);
const toMs = value => { const s = String(value || ''); return Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z'); };
const dayStart = (now = new Date()) => nowSql(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));

// "surf 4f7kq", "4F7KQ" o "SURF-4F7KQ" -> "SURF-4F7KQ"
export function normalizeCode(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^SURF/, '');
  return raw.length === CODE_LENGTH && [...raw].every(c => CODE_ALPHABET.includes(c)) ? 'SURF-' + raw : null;
}
export const contentHash = (fromUser, toUser, offer, request) =>
  createHash('sha256').update(JSON.stringify([fromUser, toUser, [...offer].sort(), [...request].sort()])).digest('hex');

export function createTrade(db, economy, config = {}) {
  const settings = () => ({enabled: true, maxItemsPerSide: 4, maxOpenOffers: 10, maxOpenListings: 5, listingTTLHours: 168, offerTTLHours: 72, minAccountAgeHours: 24, dailyTradeLimit: 20, ...(config.trade || {})});
  const fail = (code, status = 409, detail) => { throw new EconomyError(code, status, detail); };

  // ---------- Código de surfista ----------
  async function code(userId, r = db) {
    const row = await r.get('SELECT public_code FROM trade_profiles WHERE user_id = ?', [userId]);
    if (row) return row.public_code;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = 'SURF-' + Array.from({length: CODE_LENGTH}, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      try { await r.run('INSERT INTO trade_profiles (user_id, public_code) VALUES (?, ?)', [userId, candidate]); return candidate; }
      catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const again = await r.get('SELECT public_code FROM trade_profiles WHERE user_id = ?', [userId]);   // otra petición lo creó
        if (again) return again.public_code;
      }
    }
    throw new EconomyError('code_unavailable', 500);
  }
  async function userByCode(value, r = db) {
    const normalized = normalizeCode(value);
    if (!normalized) fail('invalid_code', 400);
    const row = await r.get(`SELECT u.id, u.nickname, u.avatar_url AS avatarUrl, p.public_code AS code
      FROM trade_profiles p JOIN users u ON u.id = p.user_id WHERE p.public_code = ?`, [normalized]);
    return row || fail('user_not_found', 404);
  }

  // ---------- Requisitos ----------
  async function eligibility(userId, r = db) {
    const s = settings();
    if (!s.enabled) return {ok: false, reason: 'trade_disabled'};
    const user = await r.get('SELECT created_at FROM users WHERE id = ?', [userId]);
    if (!user) return {ok: false, reason: 'login_required'};
    const readyAt = toMs(user.created_at) + s.minAccountAgeHours * 3600_000;
    if (Date.now() < readyAt) return {ok: false, reason: 'account_too_new', readyAt: new Date(readyAt).toISOString()};
    return {ok: true};
  }
  async function requireEligible(userId, r = db) {
    const e = await eligibility(userId, r);
    if (!e.ok) fail(e.reason, e.reason === 'trade_disabled' ? 503 : 403, e.readyAt ? {readyAt: e.readyAt} : undefined);
  }
  const blockedBetween = async (a, b, r = db) =>
    !!await r.get('SELECT 1 AS ok FROM trade_blocks WHERE (user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?)', [a, b, b, a]);
  const completedToday = async (userId, r) => num((await r.get(`SELECT COUNT(*) AS n FROM trade_offers
      WHERE status = 'COMPLETED' AND (from_user = ? OR to_user = ?) AND completed_at >= ?`, [userId, userId, dayStart()])).n);
  const expireOld = () => db.run("UPDATE trade_offers SET status = 'EXPIRED', updated_at = ? WHERE status = 'OPEN' AND expires_at < ?", [nowSql(), Date.now()]);

  // Items intercambiables que posee una cuenta.
  async function tradeableItems(userId, r = db) {
    const rows = await r.all('SELECT item_id FROM user_inventory_v2 WHERE user_id = ? ORDER BY acquired_at', [userId]);
    return rows.map(row => row.item_id).filter(id => economy.tradeable(id));
  }
  async function inventory(userId) {
    const equipped = await economy.equipped(userId);
    const rows = await db.all('SELECT item_id, acquired_at FROM user_inventory_v2 WHERE user_id = ? ORDER BY acquired_at', [userId]);
    return rows.map(row => {
      const parsed = parseItemId(row.item_id);
      return {itemId: row.item_id, tradeable: economy.tradeable(row.item_id), equipped: !!parsed && equipped[parsed.slot] === parsed.index, acquiredAt: row.acquired_at};
    });
  }
  async function partner(viewerId, value) {
    const user = await userByCode(value);
    if (user.id === viewerId) fail('trade_self', 400);
    return {code: user.code, nickname: user.nickname, avatarUrl: user.avatarUrl, items: await tradeableItems(user.id), blocked: await blockedBetween(viewerId, user.id)};
  }

  // Comprueba cada item de un lado: existe, se puede intercambiar, lo tiene quien lo entrega y
  // no lo tiene quien lo recibe. Devuelve null si todo cuadra o el primer problema.
  async function checkSide(items, giver, receiver, r) {
    for (const id of items) {
      if (!parseItemId(id)) return {code: 'invalid_items', itemId: id};
      const item = await economy.itemRow(id, r);
      if (!item || !item.available || !economy.tradeable(id, item.price)) return {code: 'item_not_tradeable', itemId: id};
      if (!await economy.owns(giver, id, r)) return {code: 'not_owned', itemId: id, owner: giver};
      if (await economy.owns(receiver, id, r)) return {code: 'already_owned', itemId: id, owner: receiver};
    }
    return null;
  }
  function cleanList(list) {
    if (!Array.isArray(list)) fail('invalid_items', 400);
    const ids = list.map(String);
    if (new Set(ids).size !== ids.length || ids.some(id => !parseItemId(id))) fail('invalid_items', 400);
    return ids;
  }

  // ---------- Crear oferta (contraoferta con parentId; negociación de una publicación con listingId) ----------
  async function create(fromUser, {toCode, offer, request, requestId, parentId = null, listingId = null} = {}) {
    if (!REQUEST_ID.test(String(requestId || ''))) fail('invalid_request_id', 400);
    const s = settings();
    const give = cleanList(offer), get = cleanList(request);
    if (!give.length || !get.length || give.length > s.maxItemsPerSide || get.length > s.maxItemsPerSide) fail('invalid_items', 400, {max: s.maxItemsPerSide});
    if (give.some(id => get.includes(id))) fail('invalid_items', 400);
    await requireEligible(fromUser);
    let target;
    if (listingId) {
      const listing = await db.get('SELECT user_id, status, expires_at FROM trade_listings WHERE id = ?', [String(listingId)]);
      if (!listing) fail('listing_not_found', 404);
      if (listing.status !== 'OPEN' || num(listing.expires_at) < Date.now()) fail('listing_closed', 409);
      target = listing.user_id;
    } else if (parentId) {
      const parent = await db.get('SELECT id, from_user, to_user, status FROM trade_offers WHERE id = ?', [String(parentId)]);
      if (!parent || parent.to_user !== fromUser) fail('offer_not_found', 404);
      if (parent.status !== 'OPEN') fail('offer_closed', 409, {status: parent.status});
      target = parent.from_user;
    } else target = (await userByCode(toCode)).id;
    if (target === fromUser) fail('trade_self', 400);
    if (await blockedBetween(fromUser, target)) fail('trade_blocked', 403);
    await code(fromUser);
    await expireOld();
    const hash = contentHash(fromUser, target, give, get);
    try {
      return await db.tx(async t => {
        await economy.lockWallet(t, fromUser, NORMAL);   // las ofertas de una cuenta, de una en una
        const previous = await t.get('SELECT id, content_hash FROM trade_offers WHERE from_user = ? AND request_id = ?', [fromUser, requestId]);
        if (previous) {
          if (previous.content_hash !== hash) fail('request_id_reused', 409);
          return {offerId: previous.id, contentHash: hash, replayed: true};
        }
        if (num((await t.get("SELECT COUNT(*) AS n FROM trade_offers WHERE from_user = ? AND status = 'OPEN'", [fromUser])).n) >= s.maxOpenOffers) fail('too_many_offers', 429, {max: s.maxOpenOffers});
        if (await t.get("SELECT 1 AS ok FROM trade_offers WHERE from_user = ? AND to_user = ? AND content_hash = ? AND status = 'OPEN'", [fromUser, target, hash])) fail('offer_exists', 409);
        const problem = await checkSide(give, fromUser, target, t) || await checkSide(get, target, fromUser, t);
        if (problem) fail(problem.code, 409, {itemId: problem.itemId, side: problem.owner === fromUser ? 'you' : 'partner'});
        if (parentId) {
          const parent = await t.get('SELECT status FROM trade_offers WHERE id = ?' + t.forUpdate, [parentId]);
          if (parent?.status !== 'OPEN') fail('offer_closed', 409, {status: parent?.status});
          await t.run("UPDATE trade_offers SET status = 'COUNTERED', updated_at = ? WHERE id = ?", [nowSql(), parentId]);
        }
        if (listingId && (await t.get('SELECT status FROM trade_listings WHERE id = ?' + t.forUpdate, [listingId]))?.status !== 'OPEN') fail('listing_closed', 409);
        const id = randomUUID(), now = nowSql();
        await t.run(`INSERT INTO trade_offers (id, from_user, to_user, status, parent_id, content_hash, request_id, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?)`, [id, fromUser, target, parentId, hash, requestId, Date.now() + s.offerTTLHours * 3600_000, now, now]);
        for (const item of give) await t.run("INSERT INTO trade_offer_items (offer_id, side, item_id) VALUES (?, 'OFFER', ?)", [id, item]);
        for (const item of get) await t.run("INSERT INTO trade_offer_items (offer_id, side, item_id) VALUES (?, 'REQUEST', ?)", [id, item]);
        if (listingId) await t.run('INSERT INTO trade_listing_offers (offer_id, listing_id) VALUES (?, ?)', [id, listingId]);
        return {offerId: id, contentHash: hash, replayed: false};
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const previous = await db.get('SELECT id, content_hash FROM trade_offers WHERE from_user = ? AND request_id = ?', [fromUser, requestId]);
        if (previous?.content_hash === hash) return {offerId: previous.id, contentHash: hash, replayed: true};
      }
      throw error;
    }
  }

  // Cambia el dueño de un item y, si lo llevaba puesto quien lo entrega, vuelve al gratuito.
  async function transfer(t, tradeId, item, from, to, reason) {
    const now = nowSql();
    const moved = await t.run("UPDATE user_inventory_v2 SET user_id = ?, source = 'TRADE', reference = ?, acquired_at = ? WHERE user_id = ? AND item_id = ?", [to, tradeId, now, from, item]);
    if (moved.changes !== 1) fail('items_changed', 409, {itemId: item});
    const slot = parseItemId(item).slot;
    await t.run('UPDATE equipped_items SET item_id = ?, updated_at = ? WHERE user_id = ? AND item_id = ?', [itemId(slot, 0), now, from, item]);
    await t.run('INSERT INTO item_transfers (trade_id, item_id, from_user, to_user, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)', [tradeId, item, from, to, reason, now]);
  }
  const lockPair = async (t, a, b) => { for (const u of [a, b].sort()) await economy.lockWallet(t, u, NORMAL); };
  const offerItems = async (id, r = db) => {
    const rows = await r.all('SELECT side, item_id FROM trade_offer_items WHERE offer_id = ? ORDER BY item_id', [id]);
    return {give: rows.filter(x => x.side === 'OFFER').map(x => x.item_id), get: rows.filter(x => x.side === 'REQUEST').map(x => x.item_id)};
  };

  // ---------- Aceptar ----------
  async function accept(userId, offerId, expectedHash) {
    const head = await db.get('SELECT from_user, to_user FROM trade_offers WHERE id = ?', [String(offerId || '')]);
    if (!head || head.to_user !== userId) fail('offer_not_found', 404);
    await requireEligible(userId);
    const s = settings();
    const result = await db.tx(async t => {
      await lockPair(t, head.from_user, head.to_user);
      const offer = await t.get('SELECT id, from_user, to_user, status, content_hash, expires_at FROM trade_offers WHERE id = ?' + t.forUpdate, [offerId]);
      const items = await offerItems(offerId, t);
      if (offer.status === 'COMPLETED') return {completed: true, replayed: true, offerId, received: items.give, given: items.get};
      if (offer.status !== 'OPEN') return {error: 'offer_closed', detail: {status: offer.status}};
      if (offer.content_hash !== String(expectedHash || '')) return {error: 'offer_changed'};
      if (num(offer.expires_at) < Date.now()) {
        await t.run("UPDATE trade_offers SET status = 'EXPIRED', updated_at = ? WHERE id = ?", [nowSql(), offerId]);
        return {error: 'offer_expired'};
      }
      for (const u of [offer.from_user, offer.to_user]) {
        if (await completedToday(u, t) >= s.dailyTradeLimit) return {error: 'daily_trade_limit', detail: {max: s.dailyTradeLimit, side: u === userId ? 'you' : 'partner'}};
      }
      const problem = await checkSide(items.give, offer.from_user, offer.to_user, t) || await checkSide(items.get, offer.to_user, offer.from_user, t);
      if (problem) {
        // Alguien ya no tiene (o ya tiene) un item: la oferta deja de valer para siempre.
        await t.run("UPDATE trade_offers SET status = 'INVALID', updated_at = ? WHERE id = ?", [nowSql(), offerId]);
        return {error: 'items_changed', detail: {itemId: problem.itemId}};
      }
      for (const item of items.give) await transfer(t, offerId, item, offer.from_user, offer.to_user, 'TRADE');
      for (const item of items.get) await transfer(t, offerId, item, offer.to_user, offer.from_user, 'TRADE');
      const now = nowSql();
      await t.run("UPDATE trade_offers SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE id = ?", [now, now, offerId]);
      const moved = [...items.give, ...items.get];
      await t.run(`UPDATE trade_offers SET status = 'INVALID', updated_at = ? WHERE status = 'OPEN' AND id <> ?
          AND (from_user IN (?, ?) OR to_user IN (?, ?))
          AND id IN (SELECT offer_id FROM trade_offer_items WHERE item_id IN (${moved.map(() => '?').join(', ')}))`,
        [now, offerId, offer.from_user, offer.to_user, offer.from_user, offer.to_user, ...moved]);
      // La publicación de la que salió el trade se cierra; las que ofrecían items entregados ya no valen.
      await t.run(`UPDATE trade_listings SET status = 'COMPLETED', updated_at = ? WHERE status = 'OPEN' AND id IN (SELECT listing_id FROM trade_listing_offers WHERE offer_id = ?)`, [now, offerId]);
      await t.run(`UPDATE trade_listings SET status = 'INVALID', updated_at = ? WHERE status = 'OPEN' AND user_id IN (?, ?)
          AND id IN (SELECT listing_id FROM trade_listing_items WHERE side = 'OFFER' AND item_id IN (${moved.map(() => '?').join(', ')}))`,
        [now, offer.from_user, offer.to_user, ...moved]);
      return {completed: true, replayed: false, offerId, received: items.give, given: items.get, users: [offer.from_user, offer.to_user]};
    });
    if (result.error) fail(result.error, 409, result.detail);
    return result;
  }

  // ---------- Rechazar (quien recibe) y cancelar (quien envía) ----------
  async function close(userId, offerId, column, status) {
    const offer = await db.get('SELECT id, from_user, to_user, status FROM trade_offers WHERE id = ?', [String(offerId || '')]);
    if (!offer || offer[column] !== userId) fail('offer_not_found', 404);
    const changed = await db.run(`UPDATE trade_offers SET status = ?, updated_at = ? WHERE id = ? AND status = 'OPEN'`, [status, nowSql(), offer.id]);
    if (!changed.changes) {
      const now = await db.get('SELECT status FROM trade_offers WHERE id = ?', [offer.id]);
      if (now.status !== status) fail('offer_closed', 409, {status: now.status});
    }
    return {offerId: offer.id, status};
  }
  const decline = (userId, offerId) => close(userId, offerId, 'to_user', 'DECLINED');
  const cancel = (userId, offerId) => close(userId, offerId, 'from_user', 'CANCELED');

  // ---------- Listados, desde el punto de vista de quien mira ----------
  async function list(userId, box = 'received') {
    await expireOld();
    const where = {
      received: "o.to_user = ? AND o.status = 'OPEN'",
      sent: "o.from_user = ? AND o.status = 'OPEN'",
      history: "(o.from_user = ? OR o.to_user = ?) AND o.status <> 'OPEN'"
    }[box] || fail('invalid_box', 400);
    const params = box === 'history' ? [userId, userId] : [userId];
    const rows = await db.all(`SELECT o.id, o.from_user, o.to_user, o.status, o.parent_id AS parentId, o.content_hash AS contentHash, o.expires_at AS expiresAt,
        o.created_at AS createdAt, o.updated_at AS updatedAt, o.completed_at AS completedAt, lo.listing_id AS listingId
      FROM trade_offers o LEFT JOIN trade_listing_offers lo ON lo.offer_id = o.id WHERE ${where} ORDER BY o.updated_at DESC, o.created_at DESC LIMIT 40`, params);
    const out = [];
    for (const row of rows) {
      const mine = row.from_user === userId, other = mine ? row.to_user : row.from_user;
      const who = await db.get(`SELECT u.nickname, u.avatar_url AS avatarUrl, p.public_code AS code FROM users u LEFT JOIN trade_profiles p ON p.user_id = u.id WHERE u.id = ?`, [other]);
      const items = await offerItems(row.id);
      out.push({
        id: row.id, status: row.status, direction: mine ? 'sent' : 'received', parentId: row.parentId || null, listingId: row.listingId || null,
        partner: who || {nickname: 'Surfer', avatarUrl: null, code: null},
        give: mine ? items.give : items.get, get: mine ? items.get : items.give,
        contentHash: row.contentHash, expiresAt: num(row.expiresAt), createdAt: row.createdAt, updatedAt: row.updatedAt, completedAt: row.completedAt || null
      });
    }
    return out;
  }
  async function summary(userId) {
    await expireOld();
    const s = settings(), e = await eligibility(userId);
    const received = num((await db.get("SELECT COUNT(*) AS n FROM trade_offers WHERE to_user = ? AND status = 'OPEN'", [userId])).n);
    await expireListings();
    const publicCount = num((await db.get("SELECT COUNT(*) AS n FROM trade_listings WHERE status = 'OPEN' AND user_id <> ?", [userId])).n);
    return {code: await code(userId), received, publicCount, eligible: e.ok, reason: e.ok ? null : e.reason, readyAt: e.readyAt || null,
      limits: {maxItemsPerSide: s.maxItemsPerSide, maxOpenOffers: s.maxOpenOffers, maxOpenListings: s.maxOpenListings, offerTTLHours: s.offerTTLHours, listingTTLHours: s.listingTTLHours, dailyTradeLimit: s.dailyTradeLimit}};
  }

  // ---------- Trades públicos (tablón) ----------
  // Una publicación dice "ofrezco estos items (y busco estos otros)". No mueve nada por sí sola:
  // quien la ve negocia enviando una oferta normal al dueño (create con listingId).
  const expireListings = () => db.run("UPDATE trade_listings SET status = 'EXPIRED', updated_at = ? WHERE status = 'OPEN' AND expires_at < ?", [nowSql(), Date.now()]);
  async function listingItems(ids, r = db) {
    const out = new Map(ids.map(id => [id, {give: [], want: []}]));
    if (!ids.length) return out;
    for (const row of await r.all(`SELECT listing_id, side, item_id FROM trade_listing_items WHERE listing_id IN (${ids.map(() => '?').join(', ')}) ORDER BY item_id`, ids)) {
      out.get(row.listing_id)[row.side === 'OFFER' ? 'give' : 'want'].push(row.item_id);
    }
    return out;
  }
  async function publish(userId, {offer, want = [], requestId} = {}) {
    if (!REQUEST_ID.test(String(requestId || ''))) fail('invalid_request_id', 400);
    const s = settings();
    const give = cleanList(offer), wanted = cleanList(want);
    if (!give.length || give.length > s.maxItemsPerSide || wanted.length > s.maxItemsPerSide || give.some(id => wanted.includes(id))) fail('invalid_items', 400, {max: s.maxItemsPerSide});
    await requireEligible(userId);
    await code(userId);
    await expireListings();
    const hash = createHash('sha256').update(JSON.stringify([userId, [...give].sort(), [...wanted].sort()])).digest('hex');
    try {
      return await db.tx(async t => {
        await economy.lockWallet(t, userId, NORMAL);
        const previous = await t.get('SELECT id, content_hash FROM trade_listings WHERE user_id = ? AND request_id = ?', [userId, requestId]);
        if (previous) {
          if (previous.content_hash !== hash) fail('request_id_reused', 409);
          return {listingId: previous.id, replayed: true};
        }
        if (num((await t.get("SELECT COUNT(*) AS n FROM trade_listings WHERE user_id = ? AND status = 'OPEN'", [userId])).n) >= s.maxOpenListings) fail('too_many_listings', 429, {max: s.maxOpenListings});
        if (await t.get("SELECT 1 AS ok FROM trade_listings WHERE user_id = ? AND content_hash = ? AND status = 'OPEN'", [userId, hash])) fail('listing_exists', 409);
        for (const id of give) {
          const item = await economy.itemRow(id, t);
          if (!item || !item.available || !economy.tradeable(id, item.price)) fail('item_not_tradeable', 409, {itemId: id});
          if (!await economy.owns(userId, id, t)) fail('not_owned', 409, {itemId: id, side: 'you'});
        }
        for (const id of wanted) {
          const item = await economy.itemRow(id, t);
          if (!item || !item.available || !economy.tradeable(id, item.price)) fail('item_not_tradeable', 409, {itemId: id});
          if (await economy.owns(userId, id, t)) fail('already_owned', 409, {itemId: id, side: 'you'});
        }
        const id = randomUUID(), now = nowSql();
        await t.run(`INSERT INTO trade_listings (id, user_id, status, request_id, content_hash, expires_at, created_at, updated_at) VALUES (?, ?, 'OPEN', ?, ?, ?, ?, ?)`,
          [id, userId, requestId, hash, Date.now() + s.listingTTLHours * 3600_000, now, now]);
        for (const item of give) await t.run("INSERT INTO trade_listing_items (listing_id, side, item_id) VALUES (?, 'OFFER', ?)", [id, item]);
        for (const item of wanted) await t.run("INSERT INTO trade_listing_items (listing_id, side, item_id) VALUES (?, 'WANT', ?)", [id, item]);
        return {listingId: id, replayed: false};
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const previous = await db.get('SELECT id, content_hash FROM trade_listings WHERE user_id = ? AND request_id = ?', [userId, requestId]);
        if (previous?.content_hash === hash) return {listingId: previous.id, replayed: true};
      }
      throw error;
    }
  }
  // Tablón: las publicaciones abiertas de los demás (o las propias con mine). Las que ofrecen algo
  // que su dueño ya no tiene se cierran aquí mismo como INVALID.
  // Tablón: todas las publicaciones abiertas, también las propias (marcadas mine: antes el dueño no
  // veía la suya, creía que no se había publicado, lo repetía y recibía listing_exists 409).
  async function listings(viewerId, {mine = false} = {}) {
    await expireListings();
    const rows = await db.all(`SELECT l.id, l.user_id, l.created_at AS createdAt, l.expires_at AS expiresAt, u.nickname, u.avatar_url AS avatarUrl, p.public_code AS code,
        (SELECT COUNT(*) FROM trade_listing_offers lo JOIN trade_offers o ON o.id = lo.offer_id WHERE lo.listing_id = l.id AND o.status = 'OPEN') AS offers
      FROM trade_listings l JOIN users u ON u.id = l.user_id LEFT JOIN trade_profiles p ON p.user_id = l.user_id
      WHERE l.status = 'OPEN' AND ${mine ? 'l.user_id = ?' : `(l.user_id = ? OR NOT EXISTS (SELECT 1 FROM trade_blocks b WHERE (b.user_id = l.user_id AND b.blocked_user_id = ?) OR (b.user_id = ? AND b.blocked_user_id = l.user_id)))`}
      ORDER BY l.created_at DESC LIMIT 60`, mine ? [viewerId] : [viewerId, viewerId, viewerId]);
    const items = await listingItems(rows.map(r => r.id));
    const mineOwned = new Set((await db.all('SELECT item_id FROM user_inventory_v2 WHERE user_id = ?', [viewerId])).map(r => r.item_id));
    const out = [];
    for (const row of rows) {
      const {give, want} = items.get(row.id);
      const owned = new Set((await db.all(`SELECT item_id FROM user_inventory_v2 WHERE user_id = ? AND item_id IN (${give.map(() => '?').join(', ') || "''"})`, [row.user_id, ...give])).map(r => r.item_id));
      if (give.some(id => !owned.has(id))) {
        await db.run("UPDATE trade_listings SET status = 'INVALID', updated_at = ? WHERE id = ? AND status = 'OPEN'", [nowSql(), row.id]);
        continue;
      }
      out.push({id: row.id, mine: row.user_id === viewerId, owner: {nickname: row.nickname, avatarUrl: row.avatarUrl, code: row.code}, give, want,
        offers: num(row.offers), createdAt: row.createdAt, expiresAt: num(row.expiresAt),
        // ¿Tiene quien mira todo lo que se busca (y nada de lo que se ofrece)? Solo es una pista para la interfaz.
        youHaveWanted: !!want.length && want.every(id => mineOwned.has(id)), youOwnSome: give.some(id => mineOwned.has(id))});
    }
    return out;
  }
  async function withdrawListing(userId, listingId) {
    const listing = await db.get('SELECT id, user_id, status FROM trade_listings WHERE id = ?', [String(listingId || '')]);
    if (!listing || listing.user_id !== userId) fail('listing_not_found', 404);
    if (listing.status !== 'OPEN') fail('listing_closed', 409, {status: listing.status});
    await db.run("UPDATE trade_listings SET status = 'CANCELED', updated_at = ? WHERE id = ? AND status = 'OPEN'", [nowSql(), listing.id]);
    return {listingId: listing.id, status: 'CANCELED'};
  }

  // ---------- Bloqueos ----------
  async function block(userId, value) {
    const user = await userByCode(value);
    if (user.id === userId) fail('trade_self', 400);
    await db.upsert('trade_blocks', {user_id: userId, blocked_user_id: user.id, created_at: nowSql()}, ['user_id', 'blocked_user_id'], ['created_at']);
    // Lo pendiente entre las dos cuentas deja de valer.
    await db.run(`UPDATE trade_offers SET status = 'CANCELED', updated_at = ? WHERE status = 'OPEN' AND ((from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?))`,
      [nowSql(), userId, user.id, user.id, userId]);
    return {blocked: true, code: user.code};
  }
  async function unblock(userId, value) {
    const user = await userByCode(value);
    await db.run('DELETE FROM trade_blocks WHERE user_id = ? AND blocked_user_id = ?', [userId, user.id]);
    return {blocked: false, code: user.code};
  }
  const blocked = async userId => db.all(`SELECT u.nickname, p.public_code AS code FROM trade_blocks b JOIN users u ON u.id = b.blocked_user_id
      LEFT JOIN trade_profiles p ON p.user_id = u.id WHERE b.user_id = ? ORDER BY b.created_at DESC`, [userId]);

  // ---------- Administración (solo consola del servidor) ----------
  const adminTrades = async (userId, limit = 30) => db.all(`SELECT id, from_user AS fromUser, to_user AS toUser, status, created_at AS createdAt, completed_at AS completedAt
      FROM trade_offers WHERE from_user = ? OR to_user = ? ORDER BY created_at DESC LIMIT ?`, [userId, userId, limit]);
  // Deshace un trade completado si los items siguen en manos de quien los recibió.
  async function adminRevert(offerId) {
    const head = await db.get('SELECT from_user, to_user FROM trade_offers WHERE id = ?', [String(offerId)]);
    if (!head) fail('offer_not_found', 404);
    return db.tx(async t => {
      await lockPair(t, head.from_user, head.to_user);
      const offer = await t.get('SELECT status FROM trade_offers WHERE id = ?' + t.forUpdate, [offerId]);
      if (offer.status !== 'COMPLETED') fail('offer_not_completed', 409, {status: offer.status});
      const moves = await t.all("SELECT item_id, from_user, to_user FROM item_transfers WHERE trade_id = ? AND reason = 'TRADE' ORDER BY id", [offerId]);
      for (const m of moves) {
        if (!await economy.owns(m.to_user, m.item_id, t) || await economy.owns(m.from_user, m.item_id, t)) fail('items_changed', 409, {itemId: m.item_id});
      }
      for (const m of moves) await transfer(t, offerId, m.item_id, m.to_user, m.from_user, 'REVERT');
      await t.run("UPDATE trade_offers SET status = 'REVERTED', updated_at = ? WHERE id = ?", [nowSql(), offerId]);
      return {reverted: moves.length, users: [head.from_user, head.to_user]};
    });
  }

  return {code, normalizeCode, eligibility, inventory, partner, create, publish, listings, withdrawListing, accept, decline, cancel, list, summary, block, unblock, blocked, adminTrades, adminRevert};
}

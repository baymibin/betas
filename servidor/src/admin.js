// Panel administrativo de Surf Salvaje: cuentas de administrador con usuario y contraseña,
// consultas sobre la base de datos (usuarios, compras, movimientos, trades) y acciones
// (ajustar monedas, entregar o quitar items, revertir trades, editar la tienda, subir tablas,
// wings y hats nuevos y editar los paquetes de monedas). Cada acción queda en admin_audit.
//
// Seguridad:
//  - Contraseñas con scrypt (sal aleatoria); nunca se guardan ni se registran en claro.
//  - Sesión en cookie HttpOnly + SameSite=Strict limitada a /admin; en la base solo su SHA-256.
//  - Cada petición que cambia algo exige la cabecera X-Admin-CSRF y el Origin propio.
//  - Tras 5 intentos fallidos, ese usuario/IP queda bloqueado 15 minutos.
//  - Las imágenes subidas se validan por su firma real (PNG, WebP o JPEG) y tamaño, y se
//    guardan con un nombre aleatorio en data/uploads (fuera de git y de la carpeta del cliente).
import {randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {nowSql, isUniqueViolation, syncCatalog} from './db.js';
import {EconomyError, NORMAL, GOLD} from './economy.js';
import {parseItemId, itemId, slotSize, SLOTS} from '../../client/src/shared/catalog.js';

const scrypt = promisify(scryptCb);
const SCRYPT = {N: 16384, r: 8, p: 1, keylen: 64};
const SESSION_MS = 8 * 3600_000;
const MAX_FAILS = 5, LOCK_MS = 15 * 60_000;
const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const num = v => Number(v ?? 0);
const sha = value => createHash('sha256').update(String(value)).digest('hex');
const fail = (code, status = 400, detail) => { throw new EconomyError(code, status, detail); };
const today = () => new Date().toISOString().slice(0, 10);
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, SCRYPT.keylen, {N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024});
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}
export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length, {N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024});
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Firma real del archivo (no la extensión que diga el navegador).
function imageType(buffer) {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  return null;
}
function decodeImage(dataUrl, maxBytes) {
  const match = /^data:image\/(png|webp|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) fail('invalid_image');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > maxBytes) fail('image_too_large', 413, {maxBytes});
  const type = imageType(buffer);
  if (!type) fail('invalid_image');
  return {buffer, type};
}

export function createAdmin(db, {economy, trade, config, uploadsDir, secure = false}) {
  const attempts = new Map();   // "ip|usuario" -> {fails, until}
  setInterval(() => { const now = Date.now(); for (const [k, v] of attempts) if (v.until < now && !v.fails) attempts.delete(k); }, 60_000).unref();

  // ---------- Cuentas de administrador ----------
  async function setUser(username, password) {
    if (!USERNAME.test(String(username || ''))) fail('invalid_username');
    if (String(password || '').length < 10) fail('weak_password', 400, {min: 10});
    const hash = await hashPassword(password);
    const existing = await db.get('SELECT id FROM admin_users WHERE username = ?', [username]);
    if (existing) {
      await db.run('UPDATE admin_users SET password_hash = ?, disabled = 0 WHERE id = ?', [hash, existing.id]);
      await db.run('DELETE FROM admin_sessions WHERE admin_id = ?', [existing.id]);   // cambia la contraseña: fuera las sesiones abiertas
      return {username, created: false};
    }
    await db.run('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', [username, hash]);
    return {username, created: true};
  }
  const countUsers = async () => num((await db.get('SELECT COUNT(*) AS n FROM admin_users')).n);

  async function login(username, password, ip = '') {
    const key = ip + '|' + String(username || '').toLowerCase(), state = attempts.get(key) || {fails: 0, until: 0};
    if (state.until > Date.now()) fail('too_many_attempts', 429, {retryAt: new Date(state.until).toISOString()});
    const user = USERNAME.test(String(username || '')) ? await db.get('SELECT id, username, password_hash, disabled FROM admin_users WHERE username = ?', [username]) : null;
    // Siempre se calcula un scrypt (aunque el usuario no exista) para no revelar cuáles existen.
    const ok = await verifyPassword(password, user?.password_hash || 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA') && user && !num(user.disabled);
    if (!ok) {
      state.fails++;
      if (state.fails >= MAX_FAILS) { state.until = Date.now() + LOCK_MS; state.fails = 0; }
      attempts.set(key, state);
      await audit(null, 'login_failed', String(username || '').slice(0, 64), ip);
      fail('invalid_credentials', 401);
    }
    attempts.delete(key);
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('base64url');
    await db.run('INSERT INTO admin_sessions (token_hash, admin_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)', [sha(token), user.id, csrf, Date.now() + SESSION_MS]);
    await db.run('UPDATE admin_users SET last_login_at = ? WHERE id = ?', [nowSql(), user.id]);
    await db.run('DELETE FROM admin_sessions WHERE expires_at < ?', [Date.now()]);
    await audit(user.id, 'login', user.username, ip);
    return {token, csrf, username: user.username};
  }
  async function session(token) {
    if (!token || token.length > 128) return null;
    const row = await db.get(`SELECT s.admin_id, s.csrf_token, s.expires_at, u.username, u.disabled FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id WHERE s.token_hash = ?`, [sha(token)]);
    if (!row || num(row.expires_at) < Date.now() || num(row.disabled)) return null;
    return {adminId: num(row.admin_id), username: row.username, csrf: row.csrf_token};
  }
  const logout = token => token ? db.run('DELETE FROM admin_sessions WHERE token_hash = ?', [sha(token)]) : null;
  const cookie = token => `ss_admin=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
  const clearCookie = () => `ss_admin=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
  const audit = (adminId, action, target = null, detail = null) =>
    db.run('INSERT INTO admin_audit (admin_id, action, target, detail) VALUES (?, ?, ?, ?)', [adminId, action, target, typeof detail === 'string' ? detail.slice(0, 1000) : JSON.stringify(detail)?.slice(0, 1000) ?? null]);

  // ---------- Resumen ----------
  async function stats() {
    const n = async (sql, params = []) => num((await db.get(sql, params))?.n);
    const circulation = {};
    for (const row of await db.all('SELECT currency, COALESCE(SUM(balance), 0) AS total FROM wallets GROUP BY currency')) circulation[row.currency] = num(row.total);
    return {
      users: await n('SELECT COUNT(*) AS n FROM users'),
      usersToday: await n('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', [today()]),
      purchases: await n('SELECT COUNT(*) AS n FROM item_purchases_v2'),
      spent: await n('SELECT COALESCE(SUM(price_normal), 0) AS n FROM item_purchases_v2'),
      purchasesToday: await n('SELECT COUNT(*) AS n FROM item_purchases_v2 WHERE created_at >= ?', [today()]),
      rewardsToday: await n('SELECT COALESCE(SUM(amount), 0) AS n FROM race_rewards WHERE day = ?', [today()]),
      tradesCompleted: await n("SELECT COUNT(*) AS n FROM trade_offers WHERE status = 'COMPLETED'"),
      offersOpen: await n("SELECT COUNT(*) AS n FROM trade_offers WHERE status = 'OPEN'"),
      listingsOpen: await n("SELECT COUNT(*) AS n FROM trade_listings WHERE status = 'OPEN'"),
      itemsOwned: await n('SELECT COUNT(*) AS n FROM user_inventory_v2'),
      circulation: {[NORMAL]: circulation[NORMAL] || 0, [GOLD]: circulation[GOLD] || 0},
      recentPurchases: await purchases(8),
      recentTrades: await trades({limit: 8})
    };
  }

  // ---------- Usuarios ----------
  async function users(q = '', limit = 50) {
    const query = text(q, 64), like = '%' + query.replace(/[%_]/g, '') + '%';
    const where = query ? 'WHERE u.nickname LIKE ? OR p.public_code = ? OR u.id = ?' : '';
    const rows = await db.all(`SELECT u.id, u.nickname, u.created_at AS createdAt, p.public_code AS code,
        (SELECT balance FROM wallets w WHERE w.user_id = u.id AND w.currency = 'NORMAL_COIN') AS normal,
        (SELECT balance FROM wallets w WHERE w.user_id = u.id AND w.currency = 'GOLD_COIN') AS gold,
        (SELECT COUNT(*) FROM user_inventory_v2 i WHERE i.user_id = u.id) AS items,
        (SELECT GROUP_CONCAT(a.provider) FROM auth_identities a WHERE a.user_id = u.id) AS providers
      FROM users u LEFT JOIN trade_profiles p ON p.user_id = u.id ${where} ORDER BY u.created_at DESC LIMIT ?`,
      query ? [like, query.toUpperCase(), query, clamp(limit)] : [clamp(limit)]);
    return rows.map(r => ({...r, normal: num(r.normal), gold: num(r.gold), items: num(r.items), providers: r.providers ? String(r.providers).split(',') : []}));
  }
  async function user(id) {
    const u = await economy.getUser(String(id || ''));
    if (!u) fail('user_not_found', 404);
    return {
      user: u,
      code: (await db.get('SELECT public_code FROM trade_profiles WHERE user_id = ?', [u.id]))?.public_code || null,
      identities: await db.all('SELECT provider, display_name AS displayName, created_at AS createdAt, last_login_at AS lastLoginAt FROM auth_identities WHERE user_id = ?', [u.id]),
      wallet: await economy.wallet(u.id), equipped: await economy.equipped(u.id), inventory: await economy.inventory(u.id),
      transactions: await economy.transactions(u.id, 60), trades: await trades({userId: u.id, limit: 30})
    };
  }
  async function grant(adminId, {userId, currency, amount, reason}) {
    if (!await economy.getUser(String(userId || ''))) fail('user_not_found', 404);
    const value = Number(amount);
    if (!Number.isSafeInteger(value) || value === 0 || Math.abs(value) > 1e9) fail('invalid_amount');
    const balance = await economy.adminAdjust(String(userId), String(currency), value, text(reason, 200) || fail('reason_required'));
    await audit(adminId, 'grant', userId, {currency, amount: value, reason: text(reason, 200)});
    return {balance};
  }
  async function giveItem(adminId, {userId, itemId: id, reason}) {
    if (!await economy.getUser(String(userId || ''))) fail('user_not_found', 404);
    await economy.adminGiveItem(String(userId), String(id), text(reason, 120) || fail('reason_required'));
    await audit(adminId, 'give_item', userId, {itemId: id, reason: text(reason, 120)});
    return {inventory: await economy.inventory(String(userId))};
  }
  async function removeItem(adminId, {userId, itemId: id, reason}) {
    const p = parseItemId(id);
    if (!p) fail('item_not_found', 404);
    if (!text(reason, 120)) fail('reason_required');
    const removed = await db.tx(async t => {
      await economy.lockWallet(t, String(userId), NORMAL);
      const r = await t.run('DELETE FROM user_inventory_v2 WHERE user_id = ? AND item_id = ?', [String(userId), id]);
      if (r.changes) await t.run('UPDATE equipped_items SET item_id = ?, updated_at = ? WHERE user_id = ? AND item_id = ?', [itemId(p.slot, 0), nowSql(), String(userId), id]);
      return r.changes;
    });
    if (!removed) fail('not_owned', 409);
    await audit(adminId, 'remove_item', userId, {itemId: id, reason: text(reason, 120)});
    return {inventory: await economy.inventory(String(userId))};
  }

  // ---------- Compras, movimientos y trades ----------
  const clamp = (limit, max = 200) => Math.max(1, Math.min(max, Number(limit) | 0 || 50));
  async function purchases(limit = 50) {
    return (await db.all(`SELECT p.id, p.created_at AS createdAt, p.price_normal AS price, p.item_id AS itemId, s.name AS itemName, u.id AS userId, u.nickname
      FROM item_purchases_v2 p JOIN users u ON u.id = p.user_id LEFT JOIN shop_items s ON s.id = p.item_id ORDER BY p.id DESC LIMIT ?`, [clamp(limit)]))
      .map(r => ({...r, id: num(r.id), price: num(r.price)}));
  }
  async function transactions({type = '', limit = 100} = {}) {
    const valid = ['RACE_REWARD', 'ITEM_PURCHASE', 'GOLD_EXCHANGE', 'GOLD_CREDIT', 'GOLD_REFUND', 'ADMIN_ADJUSTMENT'].includes(type);
    return (await db.all(`SELECT t.id, t.created_at AS createdAt, t.currency, t.amount, t.balance_after AS balanceAfter, t.type, t.description, u.id AS userId, u.nickname
      FROM wallet_transactions t JOIN users u ON u.id = t.user_id ${valid ? 'WHERE t.type = ?' : ''} ORDER BY t.id DESC LIMIT ?`, valid ? [type, clamp(limit)] : [clamp(limit)]))
      .map(r => ({...r, id: num(r.id), amount: num(r.amount), balanceAfter: num(r.balanceAfter)}));
  }
  async function trades({status = '', userId = null, limit = 60} = {}) {
    const where = [], params = [];
    if (['OPEN', 'COMPLETED', 'DECLINED', 'CANCELED', 'EXPIRED', 'INVALID', 'COUNTERED', 'REVERTED'].includes(status)) { where.push('o.status = ?'); params.push(status); }
    if (userId) { where.push('(o.from_user = ? OR o.to_user = ?)'); params.push(userId, userId); }
    const rows = await db.all(`SELECT o.id, o.status, o.created_at AS createdAt, o.completed_at AS completedAt, o.from_user AS fromId, o.to_user AS toId, f.nickname AS fromNick, t.nickname AS toNick
      FROM trade_offers o JOIN users f ON f.id = o.from_user JOIN users t ON t.id = o.to_user ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY o.created_at DESC LIMIT ?`, [...params, clamp(limit)]);
    if (!rows.length) return [];
    const items = await db.all(`SELECT offer_id, side, item_id FROM trade_offer_items WHERE offer_id IN (${rows.map(() => '?').join(', ')})`, rows.map(r => r.id));
    return rows.map(r => ({...r, give: items.filter(i => i.offer_id === r.id && i.side === 'OFFER').map(i => i.item_id), get: items.filter(i => i.offer_id === r.id && i.side === 'REQUEST').map(i => i.item_id)}));
  }
  async function revertTrade(adminId, tradeId) {
    const result = await trade.adminRevert(String(tradeId || ''));
    await audit(adminId, 'trade_revert', tradeId, result);
    return result;
  }
  const auditLog = (limit = 100) => db.all(`SELECT a.id, a.action, a.target, a.detail, a.created_at AS createdAt, u.username FROM admin_audit a LEFT JOIN admin_users u ON u.id = a.admin_id ORDER BY a.id DESC LIMIT ?`, [clamp(limit)]);

  // ---------- Tienda (catálogo) ----------
  async function refreshCatalog() { await syncCatalog(db, config); await economy.loadCache(); }
  async function catalog() {
    const owners = new Map((await db.all('SELECT item_id, COUNT(*) AS n FROM user_inventory_v2 GROUP BY item_id')).map(r => [r.item_id, num(r.n)]));
    const custom = new Set((config.customItems || []).map(i => i.id));
    const rows = await db.all('SELECT id, category, asset_index AS assetIndex, name, description, asset, price_normal AS price, available FROM shop_items ORDER BY sort_order');
    return rows.filter(r => num(r.available)).map(r => ({
      id: r.id, category: r.category, assetIndex: num(r.assetIndex), name: r.name, description: r.description, asset: r.asset, price: num(r.price),
      rarity: economy.rarity(r.id), forSale: !(config.notForSale || []).includes(r.id), tradeable: economy.tradeable(r.id, num(r.price)),
      owners: owners.get(r.id) || 0, custom: custom.has(r.id), color: (config.customItems || []).find(i => i.id === r.id)?.color || null
    }));
  }
  async function updateItem(adminId, {itemId: id, price, rarity, name, description, forSale}) {
    const p = parseItemId(id);
    if (!p) fail('item_not_found', 404);
    const values = {};
    if (price !== undefined) {
      const v = Number(price);
      if (!Number.isSafeInteger(v) || v < 0 || v > 1e7) fail('invalid_price');
      if (p.index === 0 && v !== 0) fail('default_item_free');   // el item 0 de cada ranura es el de serie: siempre gratis
      values.price_normal = v;
    }
    if (rarity !== undefined) { if (!RARITIES.includes(rarity)) fail('invalid_rarity'); values.rarity = rarity; }
    if (name !== undefined) values.name = text(name, 40) || null;
    if (description !== undefined) values.description = text(description, 200) || null;
    if (forSale !== undefined) values.for_sale = forSale ? 1 : 0;
    if (!Object.keys(values).length) fail('nothing_to_update');
    const existing = await db.get('SELECT item_id FROM item_overrides WHERE item_id = ?', [id]);
    const cols = Object.keys(values);
    if (existing) await db.run(`UPDATE item_overrides SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = ? WHERE item_id = ?`, [...cols.map(c => values[c]), nowSql(), id]);
    else await db.run(`INSERT INTO item_overrides (item_id, ${cols.join(', ')}, updated_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`, [id, ...cols.map(c => values[c]), nowSql()]);
    await refreshCatalog();
    await audit(adminId, 'item_update', id, values);
    return (await catalog()).find(i => i.id === id);
  }
  // Sube una tabla, wing o hat nuevo: se añade al final de su lista (nunca cambia un índice).
  async function upload(adminId, {category, name, description, price, rarity, color, width, image, fullImage}) {
    if (!['board', 'wing', 'hat'].includes(category)) fail('invalid_category');
    const cleanName = text(name, 40) || fail('name_required');
    const main = decodeImage(image, 4 * 1024 * 1024);
    const full = fullImage ? decodeImage(fullImage, 4 * 1024 * 1024) : null;
    const v = Number(price ?? 0);
    if (!Number.isSafeInteger(v) || v < 0 || v > 1e7) fail('invalid_price');
    if (rarity !== undefined && !RARITIES.includes(rarity)) fail('invalid_rarity');
    const dir = resolve(uploadsDir, category + 's');
    mkdirSync(dir, {recursive: true});
    const save = ({buffer, type}) => { const file = randomUUID() + '.' + type; writeFileSync(resolve(dir, file), buffer); return `/uploads/${category}s/${file}`; };
    const file = save(main), fullFile = full ? save(full) : null;
    let id;
    for (let attempt = 0; attempt < 3 && !id; attempt++) {
      const index = slotSize(category);   // siguiente índice libre (el catálogo del servidor ya incluye lo subido)
      if (index > 250) fail('catalog_full');
      try {
        await db.run('INSERT INTO custom_items (id, category, asset_index, name, description, file, full_file, color, width) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [itemId(category, index), category, index, cleanName, text(description, 200) || null, file, fullFile,
            /^#[0-9a-f]{6}$/i.test(color || '') ? color : null, category === 'board' ? Math.min(1, Math.max(.6, Number(width) || .84)) : null]);
        id = itemId(category, index);
      } catch (error) { if (!isUniqueViolation(error)) throw error; await refreshCatalog(); }
    }
    if (!id) fail('upload_conflict', 409);
    await db.run('INSERT INTO item_overrides (item_id, price_normal, rarity, updated_at) VALUES (?, ?, ?, ?)', [id, v, rarity || 'common', nowSql()]);
    await refreshCatalog();
    await audit(adminId, 'item_upload', id, {name: cleanName, file, price: v});
    return (await catalog()).find(i => i.id === id);
  }

  // ---------- Monedas (paquetes, oro y recompensas) ----------
  const economySettings = () => ({exchangePackages: config.exchangePackages || [], goldProducts: config.goldProducts || [], rewards: config.rewards || {}});
  function checkEconomy(key, value) {
    const int = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
    const idOk = v => /^[a-z0-9_]{2,32}$/.test(String(v || ''));
    if (key === 'exchangePackages') {
      if (!Array.isArray(value) || value.length > 12) fail('invalid_packages');
      return value.map(p => {
        if (!idOk(p.id) || !int(p.normalAmount, 1) || !(p.goldPrice === null || int(p.goldPrice, 1))) fail('invalid_packages', 400, {id: p.id});
        return {id: p.id, name: text(p.name, 40) || p.id, normalAmount: p.normalAmount, goldPrice: p.goldPrice};
      });
    }
    if (key === 'goldProducts') {
      if (!Array.isArray(value) || value.length > 12) fail('invalid_products');
      return value.map(p => {
        if (!idOk(p.id) || !int(p.goldAmount, 1) || !(p.priceMinor === null || int(p.priceMinor, 1)) || !/^[A-Z]{3}$/.test(p.currency || 'USD')) fail('invalid_products', 400, {id: p.id});
        return {id: p.id, name: text(p.name, 40) || p.id, goldAmount: p.goldAmount, priceMinor: p.priceMinor, currency: p.currency || 'USD'};
      });
    }
    if (key === 'rewards') {
      const r = value || {};
      if (!int(r.finish) || !Array.isArray(r.placeBonus) || r.placeBonus.length > 8 || !r.placeBonus.every(v => int(v)) || !int(r.minHumans, 1) || !(r.dailyCap === null || int(r.dailyCap))) fail('invalid_rewards');
      return {enabled: !!r.enabled, finish: r.finish, placeBonus: r.placeBonus, minHumans: r.minHumans, dailyCap: r.dailyCap};
    }
    fail('invalid_key');
  }
  async function updateEconomy(adminId, body = {}) {
    const keys = ['exchangePackages', 'goldProducts', 'rewards'].filter(k => body[k] !== undefined);
    if (!keys.length) fail('nothing_to_update');
    const clean = Object.fromEntries(keys.map(k => [k, checkEconomy(k, body[k])]));
    for (const k of keys) {
      const json = JSON.stringify(clean[k]);
      if (db.kind === 'mysql') await db.run('INSERT INTO economy_overrides (`key`, value_json, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)', [k, json, nowSql()]);
      else await db.run('INSERT INTO economy_overrides (`key`, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(`key`) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at', [k, json, nowSql()]);
    }
    await refreshCatalog();
    await audit(adminId, 'economy_update', keys.join(','), clean);
    return economySettings();
  }

  return {setUser, countUsers, login, session, logout, cookie, clearCookie, audit, stats, users, user, grant, giveItem, removeItem,
    purchases, transactions, trades, revertTrade, auditLog, catalog, updateItem, upload, economySettings, updateEconomy, slots: SLOTS};
}

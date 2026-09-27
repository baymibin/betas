// Base de datos de cuentas y economía (SQLite embebido de Node, sin dependencias externas).
// DATABASE_URL: "file:./data/surf-salvaje.db" (relativo a servidor/) o ":memory:" para pruebas.
// Las migraciones de servidor/migrations/*.sql se aplican una sola vez y en orden; nunca se
// borran tablas ni datos. El catálogo y los paquetes se sincronizan desde config/economy.json.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync, mkdirSync} from 'node:fs';
import {dirname, resolve, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {catalogItems} from '../../client/src/shared/catalog.js';

const serverRoot = fileURLToPath(new URL('../', import.meta.url));
const migrationsDir = resolve(serverRoot, 'migrations');

export function databasePath(url = process.env.DATABASE_URL || 'file:./data/surf-salvaje.db') {
  if (url === ':memory:') return url;
  const path = url.replace(/^file:/, '');
  return isAbsolute(path) ? path : resolve(serverRoot, path);
}

export function openDatabase(url) {
  const path = databasePath(url);
  if (path !== ':memory:') mkdirSync(dirname(path), {recursive: true});
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  for (const name of readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    transaction(db, () => {
      db.exec(readFileSync(resolve(migrationsDir, name), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
    });
  }
}

// Transacción atómica: si fn lanza, se deshace todo. Las anidadas se unen a la exterior.
export function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function loadEconomyConfig(path = process.env.ECONOMY_CONFIG || resolve(serverRoot, 'config/economy.json')) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const positiveOrNull = v => v === null || v === undefined ? null : (Number.isInteger(v) && v > 0 ? v : invalid(v));
  const invalid = v => { throw Error('economy.json: valor no válido ' + JSON.stringify(v)); };
  for (const [id, price] of Object.entries(config.itemPrices || {})) if (id !== '_comment' && !(Number.isInteger(price) && price >= 0)) invalid(price);
  for (const p of config.exchangePackages || []) { positiveOrNull(p.goldPrice); if (!(Number.isInteger(p.normalAmount) && p.normalAmount > 0)) invalid(p.normalAmount); }
  for (const p of config.goldProducts || []) { positiveOrNull(p.priceMinor); if (!(Number.isInteger(p.goldAmount) && p.goldAmount > 0)) invalid(p.goldAmount); }
  return config;
}

// Aplica la configuración: crea o actualiza artículos y paquetes. Lo que desaparece de la
// configuración no se borra (hay inventarios y compras que lo referencian): se desactiva.
export function syncCatalog(db, config) {
  const prices = config.itemPrices || {};
  transaction(db, () => {
    const upsertItem = db.prepare(`INSERT INTO shop_items (id, category, asset_index, name, description, asset, price_normal, available, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, asset=excluded.asset,
        price_normal=excluded.price_normal, available=1, sort_order=excluded.sort_order`);
    const items = catalogItems();
    items.forEach((item, i) => upsertItem.run(item.id, item.category, item.index, item.name, item.description, item.asset, prices[item.id] ?? 0, i));
    const known = new Set(items.map(i => i.id));
    for (const row of db.prepare('SELECT id FROM shop_items').all()) if (!known.has(row.id)) db.prepare('UPDATE shop_items SET available = 0 WHERE id = ?').run(row.id);

    const upsertPackage = db.prepare(`INSERT INTO coin_exchange_packages (id, name, normal_amount, gold_price, active, sort_order) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, normal_amount=excluded.normal_amount, gold_price=excluded.gold_price, active=excluded.active, sort_order=excluded.sort_order`);
    const packages = config.exchangePackages || [];
    packages.forEach((p, i) => upsertPackage.run(p.id, p.name, p.normalAmount, p.goldPrice ?? null, p.goldPrice ? 1 : 0, i));
    const packageIds = new Set(packages.map(p => p.id));
    for (const row of db.prepare('SELECT id FROM coin_exchange_packages').all()) if (!packageIds.has(row.id)) db.prepare('UPDATE coin_exchange_packages SET active = 0 WHERE id = ?').run(row.id);

    const upsertProduct = db.prepare(`INSERT INTO payment_products (id, name, gold_amount, price_minor, price_currency, active, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, gold_amount=excluded.gold_amount, price_minor=excluded.price_minor, price_currency=excluded.price_currency, sort_order=excluded.sort_order`);
    (config.goldProducts || []).forEach((p, i) => upsertProduct.run(p.id, p.name, p.goldAmount, p.priceMinor ?? null, p.currency || null, i));
  });
}

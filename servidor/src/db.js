// Base de datos de cuentas y economía. Dos motores con la misma interfaz asíncrona:
//
//   DATABASE_URL=mysql://usuario:contraseña@host:3306/base   -> MySQL / MariaDB (p. ej. aaPanel)
//   DATABASE_URL=file:./data/surf-salvaje.db                  -> SQLite embebido (por defecto)
//   DATABASE_URL=:memory:                                      -> SQLite en memoria (pruebas)
//
// Interfaz: db.get(sql, params) · db.all · db.run · db.upsert · db.tx(async t => ...) · db.close()
// Dentro de db.tx se usa el objeto t (misma interfaz). Las lecturas que preceden a un cambio de
// saldo usan `t.forUpdate` para bloquear la fila en MySQL (en SQLite la transacción ya es única).
// Las migraciones de servidor/migrations/<motor>/*.sql se aplican una vez y en orden; nunca se
// borran tablas ni datos. El catálogo y los paquetes se sincronizan desde config/economy.json.
import {readFileSync, readdirSync, mkdirSync} from 'node:fs';
import {dirname, resolve, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {catalogItems} from '../../client/src/shared/catalog.js';

const serverRoot = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_URL = 'file:./data/surf-salvaje.db';

// Fecha en UTC con milisegundos, válida para DATETIME(3) de MySQL y para SQLite (texto).
export const nowSql = (date = new Date()) => date.toISOString().replace('T', ' ').replace('Z', '');
export const isUniqueViolation = error => /UNIQUE|ER_DUP_ENTRY|Duplicate entry/i.test(`${error?.code} ${error?.message}`);

export function databaseKind(url = process.env.DATABASE_URL || DEFAULT_URL) {
  return /^mysql:\/\//i.test(url) ? 'mysql' : 'sqlite';
}
export function databasePath(url = process.env.DATABASE_URL || DEFAULT_URL) {
  if (url === ':memory:') return url;
  const path = url.replace(/^file:/, '');
  return isAbsolute(path) ? path : resolve(serverRoot, path);
}
// Para mostrar sin contraseña: mysql://surf:***@localhost:3306/surf_salvaje
export const describeDatabase = (url = process.env.DATABASE_URL || DEFAULT_URL) =>
  databaseKind(url) === 'mysql' ? 'MySQL ' + url.replace(/\/\/([^:@/]+):[^@]*@/, '//$1:***@') : 'SQLite ' + databasePath(url);

export async function openDatabase(url = process.env.DATABASE_URL || DEFAULT_URL) {
  const db = databaseKind(url) === 'mysql' ? await openMysql(url) : openSqlite(url);
  await migrate(db);
  return db;
}

// ---------- SQLite ----------
function openSqlite(url) {
  // Import perezoso: con MySQL no hace falta node:sqlite (ni su aviso experimental).
  const {DatabaseSync} = process.getBuiltinModule('node:sqlite');
  const path = databasePath(url);
  if (path !== ':memory:') mkdirSync(dirname(path), {recursive: true});
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') raw.exec('PRAGMA journal_mode = WAL;');
  const plain = row => row ? {...row} : undefined;
  const clean = params => params.map(v => v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);
  const direct = {
    get: async (sql, params = []) => plain(raw.prepare(sql).get(...clean(params))),
    all: async (sql, params = []) => raw.prepare(sql).all(...clean(params)).map(plain),
    run: async (sql, params = []) => ({changes: Number(raw.prepare(sql).run(...clean(params)).changes)}),
    exec: async sql => raw.exec(sql),
    forUpdate: ''
  };
  // Una sola conexión: las transacciones se encolan para que otra petición no se cuele entre
  // dos await de una transacción abierta. Las consultas sueltas esperan a que no haya ninguna.
  let lock = Promise.resolve();
  const idle = () => lock;
  const db = {
    kind: 'sqlite',
    get: async (...a) => { await idle(); return direct.get(...a); },
    all: async (...a) => { await idle(); return direct.all(...a); },
    run: async (...a) => { await idle(); return direct.run(...a); },
    exec: direct.exec, forUpdate: '',
    upsert: (table, values, keys, updates) => upsertSql('sqlite', direct, table, values, keys, updates, idle),
    async tx(fn) {
      let release;
      const previous = lock;
      lock = new Promise(r => { release = r; });
      await previous;
      const t = {...direct, kind: 'sqlite', upsert: (...a) => upsertSql('sqlite', direct, ...a), tx: f => f(t)};
      raw.exec('BEGIN IMMEDIATE');
      try { const result = await fn(t); raw.exec('COMMIT'); return result; }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
      finally { release(); }
    },
    async close() { await idle(); raw.close(); }
  };
  return db;
}

// ---------- MySQL / MariaDB ----------
async function openMysql(url) {
  let mysql;
  try { mysql = (await import('mysql2/promise')).default; }
  catch { throw Error('Falta la librería mysql2: ejecuta "npm install" en la carpeta servidor.'); }
  const pool = mysql.createPool({uri: url, waitForConnections: true, connectionLimit: Number(process.env.DATABASE_POOL || 10),
    dateStrings: true, timezone: 'Z', charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: false, decimalNumbers: true});
  // Todas las fechas en UTC, igual que en SQLite.
  pool.pool.on('connection', connection => connection.query("SET time_zone = '+00:00'"));
  const on = runner => ({
    get: async (sql, params = []) => (await runner.query(sql, params))[0][0],
    all: async (sql, params = []) => (await runner.query(sql, params))[0],
    run: async (sql, params = []) => ({changes: (await runner.query(sql, params))[0].affectedRows}),
    forUpdate: ' FOR UPDATE'
  });
  await pool.query('SELECT 1');   // falla pronto si las credenciales o la base no son correctas
  const base = on(pool);
  return {
    kind: 'mysql', ...base,
    upsert: (...a) => upsertSql('mysql', base, ...a),
    // Migraciones: una conexión aparte que admite varias sentencias.
    async exec(sql) {
      const connection = await mysql.createConnection({uri: url, multipleStatements: true, charset: 'utf8mb4'});
      try { await connection.query(sql); } finally { await connection.end(); }
    },
    async tx(fn) {
      const connection = await pool.getConnection();
      const t = {...on(connection), kind: 'mysql', upsert: (...a) => upsertSql('mysql', on(connection), ...a), tx: f => f(t)};
      try {
        await connection.beginTransaction();
        const result = await fn(t);
        await connection.commit();
        return result;
      } catch (error) { await connection.rollback().catch(() => {}); throw error; }
      finally { connection.release(); }
    },
    close: () => pool.end()
  };
}

// INSERT ... o actualizar si ya existe, con la sintaxis de cada motor.
async function upsertSql(kind, runner, table, values, keys, updates, before) {
  if (before) await before();
  const cols = Object.keys(values), marks = cols.map(() => '?').join(', ');
  const tail = kind === 'mysql'
    ? 'ON DUPLICATE KEY UPDATE ' + updates.map(c => `${c} = VALUES(${c})`).join(', ')
    : `ON CONFLICT(${keys.join(', ')}) DO UPDATE SET ` + updates.map(c => `${c} = excluded.${c}`).join(', ');
  return runner.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${marks}) ${tail}`, Object.values(values));
}

export async function migrate(db) {
  await db.exec(db.kind === 'mysql'
    ? 'CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(191) NOT NULL PRIMARY KEY, applied_at VARCHAR(32) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    : 'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((await db.all('SELECT name FROM schema_migrations')).map(r => r.name));
  const dir = resolve(serverRoot, 'migrations', db.kind);
  for (const name of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    const sql = readFileSync(resolve(dir, name), 'utf8');
    if (db.kind === 'mysql') {
      // En MySQL el DDL no es transaccional: la migración usa IF NOT EXISTS y se anota al final.
      await db.exec(sql);
      await db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [name, new Date().toISOString()]);
    } else {
      await db.tx(async t => {
        await t.exec(sql);
        await t.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [name, new Date().toISOString()]);
      });
    }
  }
}

export function loadEconomyConfig(path = process.env.ECONOMY_CONFIG || resolve(serverRoot, 'config/economy.json')) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const invalid = v => { throw Error('economy.json: valor no válido ' + JSON.stringify(v)); };
  const positiveOrNull = v => v === null || v === undefined ? null : (Number.isInteger(v) && v > 0 ? v : invalid(v));
  for (const [id, price] of Object.entries(config.itemPrices || {})) if (id !== '_comment' && !(Number.isInteger(price) && price >= 0)) invalid(price);
  for (const p of config.exchangePackages || []) { positiveOrNull(p.goldPrice); if (!(Number.isInteger(p.normalAmount) && p.normalAmount > 0)) invalid(p.normalAmount); }
  for (const p of config.goldProducts || []) { positiveOrNull(p.priceMinor); if (!(Number.isInteger(p.goldAmount) && p.goldAmount > 0)) invalid(p.goldAmount); }
  return config;
}

// Aplica la configuración: crea o actualiza artículos y paquetes. Lo que desaparece de la
// configuración no se borra (hay inventarios y compras que lo referencian): se desactiva.
export async function syncCatalog(db, config) {
  const prices = config.itemPrices || {};
  await db.tx(async t => {
    const items = catalogItems();
    for (const [i, item] of items.entries()) {
      await t.upsert('shop_items', {id: item.id, category: item.category, asset_index: item.index, name: item.name, description: item.description,
        asset: item.asset, price_normal: prices[item.id] ?? 0, available: 1, sort_order: i}, ['id'], ['name', 'description', 'asset', 'price_normal', 'available', 'sort_order']);
    }
    const known = new Set(items.map(i => i.id));
    for (const row of await t.all('SELECT id FROM shop_items')) if (!known.has(row.id)) await t.run('UPDATE shop_items SET available = 0 WHERE id = ?', [row.id]);

    const packages = config.exchangePackages || [];
    for (const [i, p] of packages.entries()) {
      await t.upsert('coin_exchange_packages', {id: p.id, name: p.name, normal_amount: p.normalAmount, gold_price: p.goldPrice ?? null, active: p.goldPrice ? 1 : 0, sort_order: i},
        ['id'], ['name', 'normal_amount', 'gold_price', 'active', 'sort_order']);
    }
    const packageIds = new Set(packages.map(p => p.id));
    for (const row of await t.all('SELECT id FROM coin_exchange_packages')) if (!packageIds.has(row.id)) await t.run('UPDATE coin_exchange_packages SET active = 0 WHERE id = ?', [row.id]);

    for (const [i, p] of (config.goldProducts || []).entries()) {
      await t.upsert('payment_products', {id: p.id, name: p.name, gold_amount: p.goldAmount, price_minor: p.priceMinor ?? null, price_currency: p.currency || null, active: 0, sort_order: i},
        ['id'], ['name', 'gold_amount', 'price_minor', 'price_currency', 'sort_order']);
    }
  });
}

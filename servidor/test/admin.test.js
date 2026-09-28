// Panel administrativo en los dos motores: SQLite (siempre) y MySQL/MariaDB si se define
// TEST_MYSQL_URL (la base DEBE acabar en "_test": se borra y se recrea en cada prueba).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, existsSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase, syncCatalog, loadEconomyConfig} from '../src/db.js';
import {createEconomy, NORMAL} from '../src/economy.js';
import {createTrade} from '../src/trade.js';
import {createAdmin, hashPassword, verifyPassword} from '../src/admin.js';
import {slotSize, catalogItems} from '../../client/src/shared/catalog.js';
import {resetMysql} from './helpers/mysql.js';

const engines = [['sqlite', ':memory:']];
if (process.env.TEST_MYSQL_URL) engines.push(['mysql', process.env.TEST_MYSQL_URL]);
// PNG real de 1×1 transparente.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function setup(url) {
  if (url.startsWith('mysql')) await resetMysql(url);
  const db = await openDatabase(url);
  const config = loadEconomyConfig(fileURLToPath(new URL('../config/economy.json', import.meta.url)));
  await syncCatalog(db, config);
  const eco = createEconomy(db, config);
  await eco.loadCache();
  const tr = createTrade(db, eco, config);
  const uploadsDir = mkdtempSync(join(tmpdir(), 'surf-uploads-'));
  const admin = createAdmin(db, {economy: eco, trade: tr, config, uploadsDir});
  await admin.setUser('capitan', 'olas-grandes-2026');
  const {token} = await admin.login('capitan', 'olas-grandes-2026', '1.1.1.1');
  const adminId = (await admin.session(token)).adminId;
  return {db, eco, admin, adminId, config, uploadsDir, user: await eco.createUser({nickname: 'Kai'})};
}
const expectCode = (promise, code) => assert.rejects(promise, e => e.code === code, 'se esperaba ' + code);

test('passwords are hashed with scrypt and verified in constant time', async () => {
  const hash = await hashPassword('una-clave-larga');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!hash.includes('una-clave-larga'));
  assert.equal(await verifyPassword('una-clave-larga', hash), true);
  assert.equal(await verifyPassword('otra', hash), false);
});

for (const [engine, url] of engines) {
  const t = (name, fn) => test(`[${engine}] admin: ${name}`, async () => { const ctx = await setup(url); try { await fn(ctx); } finally { await ctx.db.close(); } });

  t('login with username and password, sessions and lockout', async ({admin}) => {
    await expectCode(admin.setUser('x', 'olas-grandes-2026'), 'invalid_username');
    await expectCode(admin.setUser('otro', 'corta'), 'weak_password');
    await expectCode(admin.login('capitan', 'mala', '2.2.2.2'), 'invalid_credentials');
    await expectCode(admin.login('nadie', 'olas-grandes-2026', '2.2.2.2'), 'invalid_credentials');
    const {token, csrf} = await admin.login('capitan', 'olas-grandes-2026', '2.2.2.2');
    const session = await admin.session(token);
    assert.deepEqual([session.username, session.csrf], ['capitan', csrf]);
    assert.equal(await admin.session('token-falso'), null);
    await admin.logout(token);
    assert.equal(await admin.session(token), null);
    for (let i = 0; i < 5; i++) await expectCode(admin.login('capitan', 'mala', '3.3.3.3'), 'invalid_credentials');
    await expectCode(admin.login('capitan', 'olas-grandes-2026', '3.3.3.3'), 'too_many_attempts');
    // Cambiar la contraseña cierra las sesiones abiertas.
    const again = await admin.login('capitan', 'olas-grandes-2026', '4.4.4.4');
    await admin.setUser('capitan', 'otra-clave-segura');
    assert.equal(await admin.session(again.token), null);
  });

  t('reads users, purchases and stats from the database', async ({eco, admin, user}) => {
    await eco.adminAdjust(user, NORMAL, 1000, 'prueba');
    await eco.purchase(user, 'wing:5', 'admin-test-0001');
    const stats = await admin.stats();
    assert.equal(stats.users, 1);
    assert.equal(stats.purchases, 1);
    assert.equal(stats.spent, 1000);
    assert.equal(stats.circulation.NORMAL_COIN, 0);
    assert.equal((await admin.users('Kai'))[0].items, 1);
    const detail = await admin.user(user);
    assert.deepEqual(detail.inventory.map(i => i.itemId), ['wing:5']);
    assert.equal((await admin.purchases())[0].itemId, 'wing:5');
    assert.equal((await admin.transactions({type: 'ITEM_PURCHASE'})).length, 1);
  });

  t('actions on a user are validated and audited', async ({admin, adminId, user, eco}) => {
    await expectCode(admin.grant(adminId, {userId: user, currency: NORMAL, amount: 50, reason: ''}), 'reason_required');
    assert.equal((await admin.grant(adminId, {userId: user, currency: NORMAL, amount: 50, reason: 'Evento'})).balance, 50);
    await expectCode(admin.grant(adminId, {userId: user, currency: NORMAL, amount: -500, reason: 'x'}), 'insufficient_funds');
    await admin.giveItem(adminId, {userId: user, itemId: 'wing:7', reason: 'Premio'});
    await eco.equip(user, 'wing:7');
    await admin.removeItem(adminId, {userId: user, itemId: 'wing:7', reason: 'Error'});
    assert.equal((await eco.equipped(user)).wing, 0, 'lo quitado se desequipa');
    await expectCode(admin.removeItem(adminId, {userId: user, itemId: 'wing:7', reason: 'x'}), 'not_owned');
    const log = (await admin.auditLog()).map(a => a.action);
    for (const action of ['grant', 'give_item', 'remove_item']) assert.ok(log.includes(action), action);
  });

  t('shop items can be repriced, renamed and taken off sale', async ({admin, adminId, user, eco}) => {
    await expectCode(admin.updateItem(adminId, {itemId: 'wing:0', price: 100}), 'default_item_free');
    const item = await admin.updateItem(adminId, {itemId: 'wing:5', price: 250, rarity: 'legendary', name: 'Murciélago'});
    assert.deepEqual([item.price, item.rarity], [250, 'legendary']);
    assert.ok(item.name.startsWith('Murciélago'));
    await eco.adminAdjust(user, NORMAL, 300, 'prueba');
    assert.equal((await eco.purchase(user, 'wing:5', 'admin-test-0002')).price, 250, 'la compra usa el precio nuevo');
    await admin.updateItem(adminId, {itemId: 'board:2', forSale: false});
    await expectCode(eco.purchase(user, 'board:2', 'admin-test-0003'), 'item_not_for_sale');
  });

  t('new wings, boards and hats are appended to the catalog', async ({admin, adminId, uploadsDir, eco, user}) => {
    const before = slotSize('hat');
    await expectCode(admin.upload(adminId, {category: 'hat', name: 'Falso', image: 'data:image/png;base64,' + Buffer.from('no soy una imagen').toString('base64')}), 'invalid_image');
    await expectCode(admin.upload(adminId, {category: 'character', name: 'X', image: PNG}), 'invalid_category');
    const hat = await admin.upload(adminId, {category: 'hat', name: 'Gorra Surf', description: 'Para el sol', price: 400, rarity: 'rare', image: PNG});
    assert.equal(hat.id, 'hat:' + before);
    assert.deepEqual([hat.price, hat.rarity, hat.custom], [400, 'rare', true]);
    assert.ok(existsSync(join(uploadsDir, hat.asset.replace('/uploads/', ''))));
    assert.ok(readFileSync(join(uploadsDir, hat.asset.replace('/uploads/', ''))).subarray(1, 4).equals(Buffer.from('PNG')));
    assert.ok(catalogItems().some(i => i.id === hat.id), 'el catálogo compartido lo incluye');
    const board = await admin.upload(adminId, {category: 'board', name: 'Neón', price: 700, color: '#ff00aa', width: .8, image: PNG});
    assert.equal(board.color, '#ff00aa');
    // Se puede comprar y equipar como cualquier otro.
    await eco.adminAdjust(user, NORMAL, 400, 'prueba');
    await eco.purchase(user, hat.id, 'admin-test-0004');
    assert.equal((await eco.equip(user, hat.id)).hat, before);
  });

  t('coin packages and rewards are edited with validation', async ({admin, adminId, config, eco}) => {
    await expectCode(admin.updateEconomy(adminId, {exchangePackages: [{id: 'MAL ID', normalAmount: 5, goldPrice: 1}]}), 'invalid_packages');
    await expectCode(admin.updateEconomy(adminId, {rewards: {finish: -1, placeBonus: [], minHumans: 1}}), 'invalid_rewards');
    const saved = await admin.updateEconomy(adminId, {exchangePackages: [{id: 'normal_small', name: 'Pequeño', normalAmount: 500, goldPrice: 50}], rewards: {enabled: true, finish: 25, placeBonus: [40, 20], minHumans: 2, dailyCap: 400}});
    assert.equal(saved.exchangePackages[0].goldPrice, 50);
    assert.equal(config.rewards.finish, 25);
    assert.equal(eco.rewardAmount(1, 2), 65, 'las recompensas nuevas se aplican al momento');
    assert.equal((await eco.packages()).find(p => p.id === 'normal_small').active, true);
  });
}

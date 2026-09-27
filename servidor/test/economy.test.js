// Economía en los dos motores: SQLite (siempre) y MySQL/MariaDB si se define TEST_MYSQL_URL,
// p. ej. TEST_MYSQL_URL=mysql://surf:clave@localhost:3306/surf_test (la base DEBE acabar en
// "_test": se borra y se recrea en cada prueba).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase, syncCatalog, loadEconomyConfig} from '../src/db.js';
import {createEconomy, NORMAL, GOLD} from '../src/economy.js';
import {resetMysql} from './helpers/mysql.js';


const engines = [['sqlite', ':memory:']];
if (process.env.TEST_MYSQL_URL) engines.push(['mysql', process.env.TEST_MYSQL_URL]);

// Configuración de prueba: el catálogo real es gratis, así que aquí se ponen precios ficticios.
async function setup(url) {
  if (url.startsWith('mysql')) await resetMysql(url);
  const db = await openDatabase(url);
  const config = {...loadEconomyConfig(), itemPrices: {'wing:5': 300, 'board:2': 120}};
  config.exchangePackages = [{id: 'p500', name: 'Pequeño', normalAmount: 500, goldPrice: 50}, {id: 'nop', name: 'Sin precio', normalAmount: 900, goldPrice: null}];
  await syncCatalog(db, config);
  const eco = createEconomy(db, config);
  await eco.loadCache();
  return {db, eco, user: await eco.createUser({nickname: 'Kai'})};
}
const expectCode = (promise, code) => assert.rejects(promise, e => e.code === code, 'se esperaba ' + code);

for (const [engine, url] of engines) {
  const t = (name, fn) => test(`[${engine}] ${name}`, async () => { const ctx = await setup(url); try { await fn(ctx); } finally { await ctx.db.close(); } });

  t('new accounts start with two independent zero balances and default equipment', async ({eco, user}) => {
    assert.deepEqual(await eco.wallet(user), {[NORMAL]: 0, [GOLD]: 0});
    assert.deepEqual(await eco.equipped(user), {character: 0, board: 0, wing: 0, hat: 0});
    assert.equal((await eco.inventory(user)).length, 0, 'no se regala el catálogo');
  });

  t('buying with normal coins is atomic, recorded and never goes negative', async ({db, eco, user}) => {
    await expectCode(eco.purchase(user, 'wing:5', 'req-00000001'), 'insufficient_funds');
    assert.equal((await eco.wallet(user))[NORMAL], 0);
    assert.equal((await eco.inventory(user)).length, 0, 'sin saldo no se entrega nada');
    await eco.adminAdjust(user, NORMAL, 350, 'prueba');
    const result = await eco.purchase(user, 'wing:5', 'req-00000002');
    assert.equal(result.wallet[NORMAL], 50);
    assert.deepEqual((await eco.inventory(user)).map(i => i.itemId), ['wing:5']);
    assert.equal((await eco.purchase(user, 'wing:5', 'req-00000002')).replayed, true);
    assert.equal((await eco.wallet(user))[NORMAL], 50);
    await eco.adminAdjust(user, NORMAL, 500, 'prueba');
    await expectCode(eco.purchase(user, 'wing:5', 'req-00000003'), 'already_owned');
    await expectCode(eco.purchase(user, 'wing:0', 'req-00000004'), 'item_is_free');
    await expectCode(eco.purchase(user, 'wing:99', 'req-00000005'), 'item_not_found');
    await expectCode(eco.purchase(user, 'wing:5', 'x'), 'invalid_request_id');
    const history = await eco.transactions(user);
    assert.equal(history.find(h => h.type === 'ITEM_PURCHASE').amount, -300);
    assert.ok(history.every(h => Number.isInteger(h.balanceAfter) && h.balanceAfter >= 0));
    // La base de datos también impide un saldo negativo aunque alguien lo intente directamente.
    await assert.rejects(db.run("UPDATE wallets SET balance = -1 WHERE user_id = ? AND currency = 'NORMAL_COIN'", [user]));
  });

  t('items can only be equipped when free or owned', async ({eco, user}) => {
    await expectCode(eco.equip(user, 'wing:5'), 'not_owned');
    assert.equal((await eco.equip(user, 'wing:3')).wing, 3);
    assert.equal(await eco.canUse(null, 'wing', 5), false, 'un invitado no puede lucir artículos de pago');
    assert.equal(eco.isFree('wing', 5), false);
    assert.equal(eco.isFree('wing', 3), true);
    const item = (await eco.catalog(user)).find(i => i.id === 'wing:5');
    assert.deepEqual([item.price, item.owned, item.equipped], [300, false, false]);
  });

  t('gold converts into normal coins only through active packages, atomically and once', async ({eco, user}) => {
    await expectCode(eco.exchange(user, 'p500', 'ex-00000001'), 'insufficient_funds');
    assert.deepEqual(await eco.wallet(user), {[NORMAL]: 0, [GOLD]: 0}, 'no se descuenta oro sin acreditar normales');
    await eco.adminAdjust(user, GOLD, 120, 'prueba');
    assert.deepEqual((await eco.exchange(user, 'p500', 'ex-00000002')).wallet, {[NORMAL]: 500, [GOLD]: 70});
    assert.equal((await eco.exchange(user, 'p500', 'ex-00000002')).replayed, true);
    assert.deepEqual(await eco.wallet(user), {[NORMAL]: 500, [GOLD]: 70});
    await expectCode(eco.exchange(user, 'nop', 'ex-00000003'), 'package_inactive');
    await expectCode(eco.exchange(user, 'nop', 'ex-00000002'), 'request_id_reused');
    const rich = await eco.createUser({nickname: 'Oro'});
    await eco.adminAdjust(rich, GOLD, 10000, 'prueba');
    await expectCode(eco.purchase(rich, 'board:2', 'buy-00000001'), 'insufficient_funds');
    assert.equal((await eco.wallet(rich))[GOLD], 10000);
  });

  t('simultaneous purchases cannot spend the same balance twice', async ({eco, user}) => {
    await eco.adminAdjust(user, NORMAL, 420, 'prueba');   // alcanza para wing:5 (300) o board:2 (120), no para dos wing:5
    // Mismo artículo, 6 clics simultáneos con requestId distintos: se cobra una vez.
    const same = await Promise.allSettled(Array.from({length: 6}, (_, i) => eco.purchase(user, 'wing:5', 'par-wing-' + i + '000')));
    assert.equal(same.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(same.filter(r => r.status === 'rejected').every(r => r.reason.code === 'already_owned'));
    // El mismo requestId enviado 5 veces a la vez: una compra.
    const replay = await Promise.allSettled(Array.from({length: 5}, () => eco.purchase(user, 'board:2', 'par-board-0001')));
    assert.ok(replay.every(r => r.status === 'fulfilled'), JSON.stringify(replay.map(r => r.reason?.code)));
    assert.equal((await eco.wallet(user))[NORMAL], 0);
    assert.equal((await eco.transactions(user)).filter(h => h.type === 'ITEM_PURCHASE').length, 2);
    // Conversiones simultáneas que juntas superan el oro disponible: solo pasan las que caben.
    await eco.adminAdjust(user, GOLD, 120, 'prueba');
    const ex = await Promise.allSettled(Array.from({length: 5}, (_, i) => eco.exchange(user, 'p500', 'par-ex-' + i + '0000')));
    assert.equal(ex.filter(r => r.status === 'fulfilled').length, 2);
    assert.deepEqual(await eco.wallet(user), {[NORMAL]: 1000, [GOLD]: 20});
  });

  t('race rewards come from server results, once per race and capped per day', async ({eco, user}) => {
    assert.equal((await eco.rewardRace(user, 'r1', 1, 1)).amount, 0, 'contra bots solo no hay recompensa');
    assert.equal((await eco.rewardRace(user, 'r2', 1, 3)).amount, 50);
    assert.equal((await eco.rewardRace(user, 'r2', 1, 3)).duplicate, true);
    await Promise.all(Array.from({length: 17}, (_, i) => eco.rewardRace(user, 'r' + (i + 3), 1, 2)));
    assert.equal((await eco.wallet(user))[NORMAL], 300, 'tope diario, también con llegadas simultáneas');
  });

  t('gold is only credited from a paid order, exactly once', async ({db, eco, user}) => {
    await db.run("INSERT INTO payment_orders (id, user_id, product_id, provider, provider_ref, amount_minor, currency, gold_amount, status) VALUES ('o1', ?, 'gold_small', 'test', 'ref1', 199, 'EUR', 100, 'PENDING')", [user]);
    await expectCode(eco.creditPaidOrder('o1'), 'order_not_paid');
    await db.run("UPDATE payment_orders SET status = 'PAID' WHERE id = 'o1'");
    const both = await Promise.all([eco.creditPaidOrder('o1'), eco.creditPaidOrder('o1')]);
    assert.equal(both.filter(r => r.credited).length, 1);
    assert.equal((await eco.wallet(user))[GOLD], 100);
  });

  t('local equipment migrates once and never grants paid items', async ({eco, user}) => {
    const result = await eco.migrateLocal(user, {character: 3, board: 2, wing: 4});
    assert.deepEqual(result.equipped, {character: 3, board: 0, wing: 4, hat: 0});
    assert.equal((await eco.migrateLocal(user, {character: 1})).migrated, false);
  });
}

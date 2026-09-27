import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase, syncCatalog, loadEconomyConfig} from '../src/db.js';
import {createEconomy, NORMAL, GOLD} from '../src/economy.js';

// Configuración de prueba: el catálogo real es gratis, así que aquí se ponen precios ficticios.
function setup(overrides = {}) {
  const db = openDatabase(':memory:');
  const config = {...loadEconomyConfig(), itemPrices: {'wing:5': 300, 'board:2': 120}, ...overrides};
  config.exchangePackages = [{id: 'p500', name: 'Pequeño', normalAmount: 500, goldPrice: 50}, {id: 'nop', name: 'Sin precio', normalAmount: 900, goldPrice: null}];
  syncCatalog(db, config);
  const eco = createEconomy(db, config);
  return {db, eco, user: eco.createUser({nickname: 'Kai'})};
}
const expectCode = (fn, code) => assert.throws(fn, e => e.code === code, 'se esperaba ' + code);

test('new accounts start with two independent zero balances and default equipment', () => {
  const {eco, user} = setup();
  assert.deepEqual(eco.wallet(user), {[NORMAL]: 0, [GOLD]: 0});
  assert.deepEqual(eco.equipped(user), {character: 0, board: 0, wing: 0, hat: 0});
  assert.equal(eco.inventory(user).length, 0, 'no se regala el catálogo');
});

test('buying with normal coins is atomic, recorded and never goes negative', () => {
  const {db, eco, user} = setup();
  expectCode(() => eco.purchase(user, 'wing:5', 'req-00000001'), 'insufficient_funds');
  assert.equal(eco.wallet(user)[NORMAL], 0);
  assert.equal(eco.inventory(user).length, 0, 'sin saldo no se entrega nada');
  eco.adminAdjust(user, NORMAL, 350, 'prueba');
  const result = eco.purchase(user, 'wing:5', 'req-00000002');
  assert.equal(result.wallet[NORMAL], 50);
  assert.deepEqual(eco.inventory(user).map(i => i.itemId), ['wing:5']);
  // Doble clic / F5: el mismo requestId no cobra dos veces.
  assert.equal(eco.purchase(user, 'wing:5', 'req-00000002').replayed, true);
  assert.equal(eco.wallet(user)[NORMAL], 50);
  // Otro requestId para el mismo artículo: ya lo tiene.
  eco.adminAdjust(user, NORMAL, 500, 'prueba');
  expectCode(() => eco.purchase(user, 'wing:5', 'req-00000003'), 'already_owned');
  expectCode(() => eco.purchase(user, 'wing:0', 'req-00000004'), 'item_is_free');
  expectCode(() => eco.purchase(user, 'wing:99', 'req-00000005'), 'item_not_found');
  expectCode(() => eco.purchase(user, 'wing:5', 'x'), 'invalid_request_id');
  const history = eco.transactions(user);
  assert.equal(history.find(t => t.type === 'ITEM_PURCHASE').amount, -300);
  assert.ok(history.every(t => Number.isInteger(t.balanceAfter) && t.balanceAfter >= 0));
  // La base de datos también impide un saldo negativo aunque alguien lo intente directamente.
  assert.throws(() => db.prepare("UPDATE wallets SET balance = -1 WHERE user_id = ? AND currency = 'NORMAL_COIN'").run(user));
});

test('items can only be equipped when free or owned', () => {
  const {eco, user} = setup();
  expectCode(() => eco.equip(user, 'wing:5'), 'not_owned');
  assert.equal(eco.equip(user, 'wing:3').wing, 3);
  assert.equal(eco.canUse(null, 'wing', 5), false, 'un invitado no puede lucir artículos de pago');
  assert.equal(eco.canUse(null, 'wing', 3), true);
  const item = eco.catalog(user).find(i => i.id === 'wing:5');
  assert.deepEqual([item.price, item.owned, item.equipped], [300, false, false]);
});

test('gold converts into normal coins only through active packages, atomically and once', () => {
  const {eco, user} = setup();
  expectCode(() => eco.exchange(user, 'p500', 'ex-00000001'), 'insufficient_funds');
  assert.deepEqual(eco.wallet(user), {[NORMAL]: 0, [GOLD]: 0}, 'no se descuenta oro sin acreditar normales');
  eco.adminAdjust(user, GOLD, 120, 'prueba');
  const result = eco.exchange(user, 'p500', 'ex-00000002');
  assert.deepEqual(result.wallet, {[NORMAL]: 500, [GOLD]: 70});
  assert.equal(eco.exchange(user, 'p500', 'ex-00000002').replayed, true);
  assert.deepEqual(eco.wallet(user), {[NORMAL]: 500, [GOLD]: 70});
  expectCode(() => eco.exchange(user, 'nop', 'ex-00000003'), 'package_inactive');
  expectCode(() => eco.exchange(user, 'nop', 'ex-00000002'), 'request_id_reused');
  // El oro nunca compra artículos: con oro y sin Tablas Normales la compra se rechaza.
  const rich = eco.createUser({nickname: 'Oro'});
  eco.adminAdjust(rich, GOLD, 10000, 'prueba');
  expectCode(() => eco.purchase(rich, 'board:2', 'buy-00000001'), 'insufficient_funds');
  assert.equal(eco.wallet(rich)[GOLD], 10000);
});

test('race rewards come from server results, once per race and capped per day', () => {
  const {eco, user} = setup();
  assert.equal(eco.rewardRace(user, 'r1', 1, 1).amount, 0, 'contra bots solo no hay recompensa');
  const first = eco.rewardRace(user, 'r2', 1, 3);
  assert.equal(first.amount, 50);
  assert.equal(eco.rewardRace(user, 'r2', 1, 3).duplicate, true);
  for (let i = 3; i < 20; i++) eco.rewardRace(user, 'r' + i, 1, 2);
  assert.equal(eco.wallet(user)[NORMAL], 300, 'tope diario');
});

test('gold is only credited from a paid order, exactly once', () => {
  const {db, eco, user} = setup();
  db.prepare("INSERT INTO payment_orders (id, user_id, product_id, provider, provider_ref, amount_minor, currency, gold_amount, status) VALUES ('o1', ?, 'gold_small', 'test', 'ref1', 199, 'EUR', 100, 'PENDING')").run(user);
  expectCode(() => eco.creditPaidOrder('o1'), 'order_not_paid');
  db.prepare("UPDATE payment_orders SET status = 'PAID' WHERE id = 'o1'").run();
  assert.equal(eco.creditPaidOrder('o1').credited, true);
  assert.equal(eco.creditPaidOrder('o1').replayed, true);
  assert.equal(eco.wallet(user)[GOLD], 100);
});

test('local equipment migrates once and never grants paid items', () => {
  const {eco, user} = setup();
  const result = eco.migrateLocal(user, {character: 3, board: 2, wing: 4});
  assert.deepEqual(result.equipped, {character: 3, board: 0, wing: 4, hat: 0});
  assert.equal(eco.migrateLocal(user, {character: 1}).migrated, false);
});

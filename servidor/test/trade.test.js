// Trade en los dos motores: SQLite (siempre) y MySQL/MariaDB si se define TEST_MYSQL_URL
// (la base DEBE acabar en "_test": se borra y se recrea en cada prueba).
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {openDatabase, syncCatalog, loadEconomyConfig} from '../src/db.js';
import {createEconomy} from '../src/economy.js';
import {createTrade, normalizeCode} from '../src/trade.js';
import {resetMysql} from './helpers/mysql.js';

const engines = [['sqlite', ':memory:']];
if (process.env.TEST_MYSQL_URL) engines.push(['mysql', process.env.TEST_MYSQL_URL]);

async function setup(url, trade = {}) {
  if (url.startsWith('mysql')) await resetMysql(url);
  const db = await openDatabase(url);
  const config = loadEconomyConfig(fileURLToPath(new URL('../config/economy.json', import.meta.url)));   // precios reales
  config.trade = {...config.trade, minAccountAgeHours: 0, ...trade};
  await syncCatalog(db, config);
  const eco = createEconomy(db, config);
  await eco.loadCache();
  const tr = createTrade(db, eco, config);
  const [a, b, c] = [await eco.createUser({nickname: 'Ana'}), await eco.createUser({nickname: 'Beto'}), await eco.createUser({nickname: 'Cris'})];
  const give = (user, ...ids) => Promise.all(ids.map(id => eco.adminGiveItem(user, id, 'prueba')));
  return {db, eco, tr, a, b, c, give, code: {a: await tr.code(a), b: await tr.code(b), c: await tr.code(c)}};
}
const expectCode = (promise, code) => assert.rejects(promise, e => e.code === code, 'se esperaba ' + code);
const owned = async (eco, user) => (await eco.inventory(user)).map(i => i.itemId).sort();
let n = 0;
const rid = () => 'trade-req-' + (++n).toString().padStart(6, '0');

for (const [engine, url] of engines) {
  const t = (name, fn, opts) => test(`[${engine}] trade: ${name}`, async () => { const ctx = await setup(url, opts); try { await fn(ctx); } finally { await ctx.db.close(); } });

  t('surfer codes are unique, stable and tolerant to how they are typed', async ({tr, a, code}) => {
    assert.match(code.a, /^SURF-[2-9A-HJ-NP-Z]{5}$/);
    assert.equal(await tr.code(a), code.a);
    assert.notEqual(code.a, code.b);
    assert.equal(normalizeCode(code.a.toLowerCase().replace('-', ' ')), code.a);
    assert.equal(normalizeCode(code.a.slice(5)), code.a);
    assert.equal(normalizeCode('SURF-0O1I'), null);
  });

  t('a full trade swaps ownership, unequips what was given and is logged', async ({db, eco, tr, a, b, code, give}) => {
    await give(a, 'wing:5'); await give(b, 'board:2');
    await eco.equip(a, 'wing:5');
    const partner = await tr.partner(a, code.b);
    assert.deepEqual(partner.items, ['board:2']);
    const offer = await tr.create(a, {toCode: code.b, offer: ['wing:5'], request: ['board:2'], requestId: rid()});
    assert.equal((await tr.summary(b)).received, 1);
    const [received] = await tr.list(b, 'received');
    assert.deepEqual([received.give, received.get, received.partner.code], [['board:2'], ['wing:5'], code.a]);
    const done = await tr.accept(b, offer.offerId, received.contentHash);
    assert.deepEqual([done.completed, done.received, done.given], [true, ['wing:5'], ['board:2']]);
    assert.deepEqual(await owned(eco, a), ['board:2']);
    assert.deepEqual(await owned(eco, b), ['wing:5']);
    assert.equal((await eco.equipped(a)).wing, 0, 'lo entregado vuelve al gratuito');
    assert.equal((await eco.inventory(b))[0].source, 'TRADE');
    assert.equal((await db.all('SELECT * FROM item_transfers WHERE trade_id = ?', [offer.offerId])).length, 2);
    assert.equal((await tr.accept(b, offer.offerId, received.contentHash)).replayed, true, 'repetir no repite el trade');
    assert.equal((await tr.list(a, 'history'))[0].status, 'COMPLETED');
    // Quien entregó un item comprado puede volver a comprarlo.
    await eco.adminAdjust(a, 'NORMAL_COIN', 1000, 'prueba');
    assert.equal((await eco.purchase(a, 'wing:5', rid())).replayed, false);
  });

  t('offers are validated on the server', async ({tr, a, b, code, give}) => {
    await give(a, 'wing:5', 'wing:6'); await give(b, 'board:2', 'wing:6');
    const base = {toCode: code.b, offer: ['wing:5'], request: ['board:2']};
    await expectCode(tr.create(a, {...base, offer: ['wing:1'], requestId: rid()}), 'not_owned');
    await expectCode(tr.create(a, {...base, offer: ['wing:0'], requestId: rid()}), 'item_not_tradeable');
    await expectCode(tr.create(a, {...base, offer: ['wing:6'], requestId: rid()}), 'already_owned');
    await expectCode(tr.create(a, {...base, request: ['wing:6'], requestId: rid()}), 'already_owned');
    await expectCode(tr.create(a, {...base, request: [], requestId: rid()}), 'invalid_items');
    await expectCode(tr.create(a, {...base, offer: ['wing:5', 'wing:5'], requestId: rid()}), 'invalid_items');
    await expectCode(tr.create(a, {...base, offer: ['wing:99'], requestId: rid()}), 'invalid_items');
    await expectCode(tr.create(a, {...base, toCode: code.a, requestId: rid()}), 'trade_self');
    await expectCode(tr.create(a, {...base, toCode: 'SURF-ZZZZZ', requestId: rid()}), 'user_not_found');
    await expectCode(tr.create(a, {...base, requestId: 'x'}), 'invalid_request_id');
    const same = rid();
    const first = await tr.create(a, {...base, requestId: same});
    assert.equal((await tr.create(a, {...base, requestId: same})).offerId, first.offerId);
    await expectCode(tr.create(a, {...base, requestId: rid()}), 'offer_exists');
  });

  t('only the recipient accepts, with the exact content it saw', async ({tr, a, b, c, code, give}) => {
    await give(a, 'wing:5'); await give(b, 'board:2');
    const offer = await tr.create(a, {toCode: code.b, offer: ['wing:5'], request: ['board:2'], requestId: rid()});
    await expectCode(tr.accept(c, offer.offerId, offer.contentHash), 'offer_not_found');
    await expectCode(tr.accept(a, offer.offerId, offer.contentHash), 'offer_not_found');
    await expectCode(tr.accept(b, offer.offerId, 'otra-huella'), 'offer_changed');
    await expectCode(tr.cancel(b, offer.offerId), 'offer_not_found');
    assert.equal((await tr.cancel(a, offer.offerId)).status, 'CANCELED');
    await expectCode(tr.accept(b, offer.offerId, offer.contentHash), 'offer_closed');
  });

  t('simultaneous accepts complete the trade exactly once', async ({eco, tr, a, b, code, give}) => {
    await give(a, 'wing:5', 'wing:7'); await give(b, 'board:2');
    const offer = await tr.create(a, {toCode: code.b, offer: ['wing:5', 'wing:7'], request: ['board:2'], requestId: rid()});
    const results = await Promise.allSettled(Array.from({length: 5}, () => tr.accept(b, offer.offerId, offer.contentHash)));
    assert.ok(results.every(r => r.status === 'fulfilled'), JSON.stringify(results.map(r => r.reason?.code)));
    assert.equal(results.filter(r => !r.value.replayed).length, 1);
    assert.deepEqual(await owned(eco, b), ['wing:5', 'wing:7']);
    assert.deepEqual(await owned(eco, a), ['board:2']);
  });

  t('the same item in two offers: the second one becomes invalid', async ({eco, tr, a, b, c, code, give}) => {
    await give(a, 'wing:5'); await give(b, 'board:2'); await give(c, 'board:3');
    const toB = await tr.create(a, {toCode: code.b, offer: ['wing:5'], request: ['board:2'], requestId: rid()});
    const toC = await tr.create(a, {toCode: code.c, offer: ['wing:5'], request: ['board:3'], requestId: rid()});
    const both = await Promise.allSettled([tr.accept(b, toB.offerId, toB.contentHash), tr.accept(c, toC.offerId, toC.contentHash)]);
    assert.equal(both.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(['offer_closed', 'items_changed'].includes(both.find(r => r.status === 'rejected').reason.code));
    const holders = [(await owned(eco, b)).includes('wing:5'), (await owned(eco, c)).includes('wing:5')];
    assert.equal(holders.filter(Boolean).length, 1, 'el item solo existe una vez');
    assert.deepEqual(await tr.list(a, 'sent'), []);
  });

  t('counter-offers replace the original, and offers expire', async ({tr, a, b, code, give}) => {
    await give(a, 'wing:5', 'wing:6'); await give(b, 'board:2');
    const first = await tr.create(a, {toCode: code.b, offer: ['wing:6'], request: ['board:2'], requestId: rid()});
    const counter = await tr.create(b, {parentId: first.offerId, offer: ['board:2'], request: ['wing:5', 'wing:6'], requestId: rid()});
    assert.equal((await tr.list(a, 'received'))[0].id, counter.offerId);
    assert.equal((await tr.list(b, 'history'))[0].status, 'COUNTERED');
    await expectCode(tr.accept(b, first.offerId, first.contentHash), 'offer_closed');
  });

  t('expired offers cannot be accepted', async ({tr, a, b, code, give}) => {
    await give(a, 'wing:5'); await give(b, 'board:2');
    const offer = await tr.create(a, {toCode: code.b, offer: ['wing:5'], request: ['board:2'], requestId: rid()});
    await expectCode(tr.accept(b, offer.offerId, offer.contentHash), 'offer_expired');
    assert.equal((await tr.list(b, 'history'))[0].status, 'EXPIRED');
  }, {offerTTLHours: -1});

  t('blocking cancels pending offers and prevents new ones', async ({tr, a, b, code, give}) => {
    await give(a, 'wing:5'); await give(b, 'board:2');
    await tr.create(a, {toCode: code.b, offer: ['wing:5'], request: ['board:2'], requestId: rid()});
    await tr.block(b, code.a);
    assert.equal((await tr.summary(b)).received, 0);
    await expectCode(tr.create(a, {toCode: code.b, offer: ['wing:5'], request: ['board:2'], requestId: rid()}), 'trade_blocked');
    assert.deepEqual((await tr.blocked(b)).map(x => x.code), [code.a]);
    await tr.unblock(b, code.a);
    assert.ok(await tr.create(a, {toCode: code.b, offer: ['wing:5'], request: ['board:2'], requestId: rid()}));
  });

  t('new accounts wait before trading', async ({tr, a, code}) => {
    assert.equal((await tr.summary(a)).eligible, false);
    await expectCode(tr.create(a, {toCode: code.b, offer: ['wing:5'], request: ['board:2'], requestId: rid()}), 'account_too_new');
  }, {minAccountAgeHours: 24});

  t('an admin can revert a completed trade', async ({eco, tr, a, b, code, give}) => {
    await give(a, 'wing:5'); await give(b, 'board:2');
    const offer = await tr.create(a, {toCode: code.b, offer: ['wing:5'], request: ['board:2'], requestId: rid()});
    await tr.accept(b, offer.offerId, offer.contentHash);
    assert.equal((await tr.adminRevert(offer.offerId)).reverted, 2);
    assert.deepEqual([await owned(eco, a), await owned(eco, b)], [['wing:5'], ['board:2']]);
    await expectCode(tr.adminRevert(offer.offerId), 'offer_not_completed');
  });
}

for (const [engine, url] of engines) {
  const t = (name, fn, opts) => test(`[${engine}] trade público: ${name}`, async () => { const ctx = await setup(url, opts); try { await fn(ctx); } finally { await ctx.db.close(); } });

  t('a listing shows up for others, not for its owner, and is validated', async ({tr, a, b, give}) => {
    await give(a, 'wing:5', 'board:2');
    await expectCode(tr.publish(a, {offer: ['wing:1'], requestId: rid()}), 'not_owned');
    await expectCode(tr.publish(a, {offer: ['wing:0'], requestId: rid()}), 'item_not_tradeable');
    await expectCode(tr.publish(a, {offer: ['wing:5'], want: ['board:2'], requestId: rid()}), 'already_owned');
    await expectCode(tr.publish(a, {offer: [], requestId: rid()}), 'invalid_items');
    const same = rid();
    const {listingId} = await tr.publish(a, {offer: ['wing:5'], want: ['board:3'], requestId: same});
    assert.equal((await tr.publish(a, {offer: ['wing:5'], want: ['board:3'], requestId: same})).replayed, true);
    await expectCode(tr.publish(a, {offer: ['wing:5'], want: ['board:3'], requestId: rid()}), 'listing_exists');
    const seen = await tr.listings(b);
    assert.deepEqual([seen.length, seen[0].id, seen[0].give, seen[0].want, seen[0].mine], [1, listingId, ['wing:5'], ['board:3'], false]);
    assert.deepEqual((await tr.listings(a)).map(l => [l.id, l.mine]), [[listingId, true]], 'el dueño ve la suya en el tablón, marcada como suya');
    assert.equal((await tr.listings(a, {mine: true})).length, 1);
    assert.equal((await tr.summary(b)).publicCount, 1);
    await expectCode(tr.withdrawListing(b, listingId), 'listing_not_found');
    await tr.withdrawListing(a, listingId);
    assert.equal((await tr.listings(b)).length, 0);
  });

  t('negotiating a listing: the owner accepts and the listing closes', async ({eco, tr, a, b, c, give}) => {
    await give(a, 'wing:5', 'wing:6'); await give(b, 'board:3'); await give(c, 'board:4');
    const {listingId} = await tr.publish(a, {offer: ['wing:5'], want: ['board:3'], requestId: rid()});
    const other = await tr.publish(a, {offer: ['wing:5', 'wing:6'], requestId: rid()});
    await expectCode(tr.create(a, {listingId, offer: ['wing:6'], request: ['board:3'], requestId: rid()}), 'trade_self');
    const fromB = await tr.create(b, {listingId, offer: ['board:3'], request: ['wing:5'], requestId: rid()});
    const fromC = await tr.create(c, {listingId: other.listingId, offer: ['board:4'], request: ['wing:6'], requestId: rid()});
    const received = await tr.list(a, 'received');
    assert.equal(received.find(o => o.id === fromB.offerId).listingId, listingId);
    assert.equal((await tr.listings(a, {mine: true})).find(l => l.id === listingId).offers, 1);
    await tr.accept(a, fromB.offerId, fromB.contentHash);
    assert.deepEqual(await owned(eco, b), ['wing:5']);
    // La publicación negociada se cierra y la otra (que también ofrecía wing:5) deja de valer.
    assert.equal((await tr.listings(c)).length, 0);
    await expectCode(tr.create(c, {listingId, offer: ['board:4'], request: ['wing:5'], requestId: rid()}), 'listing_closed');
    assert.ok(await tr.accept(a, fromC.offerId, fromC.contentHash), 'la oferta de C sobre wing:6 sigue siendo válida');
  });

  t('listings of blocked surfers are hidden', async ({tr, a, b, code, give}) => {
    await give(a, 'wing:5');
    await tr.publish(a, {offer: ['wing:5'], requestId: rid()});
    await tr.block(b, code.a);
    assert.equal((await tr.listings(b)).length, 0);
  });
}

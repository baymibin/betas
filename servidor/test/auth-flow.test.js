// Flujo completo de cuentas contra el servidor real (proceso aparte) con un proveedor OAuth
// SIMULADO que imita a Google (id_token RS256 + JWKS + PKCE) y a Discord (token + /users/@me).
// Prueba login, cuenta nueva/existente, vinculación, desvinculación, sesiones, CSRF, compras,
// conversión, ajuste administrativo y el equipamiento que ven los demás por WebSocket.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {generateKeyPairSync, createSign, createHash} from 'node:crypto';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TYPE, read, states, profilePacket, roomRequest} from '../../client/src/shared/protocol.js';

const serverDir = fileURLToPath(new URL('../', import.meta.url));
const PORT = 3900 + Math.floor(Math.random() * 90), BASE = `http://localhost:${PORT}`;
const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const jwk = {...publicKey.export({format: 'jwk'}), kid: 'test-key', alg: 'RS256', use: 'sig'};
const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function idToken(claims) {
  const head = b64({alg: 'RS256', kid: 'test-key', typ: 'JWT'}), body = b64(claims);
  return head + '.' + body + '.' + createSign('RSA-SHA256').update(head + '.' + body).sign(privateKey).toString('base64url');
}
let mock, server, dir, mockBase;
const discordUsers = {'111111111111': {id: '111111111111', username: 'kai', global_name: 'Kai Discord', avatar: 'abcdef123456'}, '222222222222': {id: '222222222222', username: 'otro', global_name: 'Otro', avatar: null}};

before(async () => {
  mock = createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c).on('end', () => {
      const url = new URL(req.url, 'http://x'), form = new URLSearchParams(body);
      const json = (status, value) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(value)); };
      if (url.pathname === '/google/jwks') return json(200, {keys: [jwk]});
      if (url.pathname === '/google/token') {
        // El "code" del proveedor simulado lleva sub, nonce y challenge PKCE para poder comprobarlo.
        const code = JSON.parse(Buffer.from(form.get('code'), 'base64url').toString());
        if (form.get('client_secret') !== 'google-secret') return json(401, {error: 'invalid_client'});
        if (createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') !== code.challenge) return json(400, {error: 'invalid_grant'});
        const now = Math.floor(Date.now() / 1000);
        return json(200, {id_token: idToken({iss: 'https://mock-google', aud: code.aud || 'google-client', sub: code.sub, name: code.name, picture: 'https://example.com/a.png', nonce: code.nonce, iat: now, exp: now + 3600})});
      }
      if (url.pathname === '/discord/api/oauth2/token') {
        if (form.get('client_secret') !== 'discord-secret') return json(401, {error: 'invalid_client'});
        return json(200, {access_token: 'tok-' + form.get('code'), token_type: 'Bearer'});
      }
      if (url.pathname === '/discord/api/oauth2/token/revoke') return json(200, {});
      if (url.pathname === '/discord/api/users/@me') {
        const user = discordUsers[(req.headers.authorization || '').replace('Bearer tok-', '')];
        return user ? json(200, user) : json(401, {message: '401: Unauthorized'});
      }
      json(404, {});
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  mockBase = `http://127.0.0.1:${mock.address().port}`;
  dir = mkdtempSync(join(tmpdir(), 'surf-auth-'));
  writeFileSync(join(dir, 'economy.json'), JSON.stringify({
    itemPrices: {'wing:5': 300}, rewards: {enabled: false},
    exchangePackages: [{id: 'p500', name: 'Pequeño', normalAmount: 500, goldPrice: 50}], goldProducts: []
  }));
  process.env.TEST_DB = 'file:' + join(dir, 'surf.db');
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {cwd: serverDir, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, RATE_LIMIT_AUTH: '1000', PORT: String(PORT), PUBLIC_URL: BASE, SESSION_SECRET: 'x'.repeat(40), DATABASE_URL: process.env.TEST_DB, ECONOMY_CONFIG: join(dir, 'economy.json'),
    GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret', GOOGLE_AUTH_URL: mockBase + '/google/auth',
    GOOGLE_TOKEN_URL: mockBase + '/google/token', GOOGLE_JWKS_URL: mockBase + '/google/jwks', GOOGLE_ISSUER: 'https://mock-google',
    DISCORD_CLIENT_ID: 'discord-client', DISCORD_CLIENT_SECRET: 'discord-secret', DISCORD_AUTH_URL: mockBase + '/discord/auth', DISCORD_API_BASE: mockBase + '/discord/api'
  }});
  await new Promise((resolve, reject) => { server.stdout.on('data', d => { if (String(d).includes('Cuentas:')) resolve(); }); server.on('exit', c => reject(Error('servidor salió ' + c))); });
});
after(() => { server?.kill(); mock?.close(); rmSync(dir, {recursive: true, force: true}); });

// Un "navegador": guarda cookies y sigue el flujo como lo haría Chrome.
function browser() {
  const jar = {};
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
  async function get(path, extra = {}) {
    const res = await fetch(BASE + path, {redirect: 'manual', headers: {cookie: cookieHeader(), ...extra}});
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'), i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) jar[pair.slice(0, i)] = v; else delete jar[pair.slice(0, i)]; }
    return res;
  }
  async function post(path, body, {csrf, origin = BASE} = {}) {
    const res = await fetch(BASE + path, {method: 'POST', headers: {cookie: cookieHeader(), 'content-type': 'application/json', origin, ...(csrf ? {'x-csrf-token': csrf} : {})}, body: JSON.stringify(body)});
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'), i = pair.indexOf('='); const v = pair.slice(i + 1); if (v) jar[pair.slice(0, i)] = v; else delete jar[pair.slice(0, i)]; }
    return {status: res.status, json: await res.json()};
  }
  const me = async () => (await get('/api/me')).json();
  // Login/vinculación completos. tamper(code) permite simular un proveedor que devuelve algo raro.
  async function signIn(provider, who, {mode = 'login', tamper = c => c} = {}) {
    const start = await get(`/auth/${provider}/start?mode=${mode}`);
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get('location'));
    const state = to.searchParams.get('state');
    let code;
    if (provider === 'google') {
      assert.equal(to.searchParams.get('scope'), 'openid profile');
      assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
      code = b64(tamper({sub: who.sub, name: who.name, nonce: to.searchParams.get('nonce'), challenge: to.searchParams.get('code_challenge')}));
    } else {
      assert.equal(to.searchParams.get('scope'), 'identify');
      code = who.id;
    }
    return {state, code, response: await get(`/auth/${provider}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)};
  }
  return {jar, get, post, me, signIn};
}
const location = r => r.response.headers.get('location');

test('Google and Discord sign-in share one account system with safe linking', async () => {
  const a = browser();
  assert.deepEqual((await a.me()).providers, {google: true, discord: true});
  // Cuenta nueva con Google.
  const first = await a.signIn('google', {sub: 'g-1', name: 'Kai Google'});
  assert.equal(location(first), '/?auth=ok&provider=google&new=1');
  let me = await a.me();
  assert.equal(me.authenticated, true);
  assert.equal(me.user.nickname, 'Kai Google');
  assert.deepEqual(me.wallet, {NORMAL_COIN: 0, GOLD_COIN: 0});
  assert.deepEqual(me.identities.map(i => i.provider), ['google']);
  const userId = me.user.id;
  // El mismo state no sirve dos veces.
  const replay = await a.get(`/auth/google/callback?code=${first.code}&state=${first.state}`);
  assert.match(replay.headers.get('location'), /auth_error=invalid_state/);

  // Vincular Discord desde la cuenta: no crea otra cuenta ni otro monedero.
  const link = await a.signIn('discord', discordUsers['111111111111'], {mode: 'link'});
  assert.equal(location(link), '/?auth=linked&provider=discord');
  me = await a.me();
  assert.deepEqual(me.identities.map(i => i.provider).sort(), ['discord', 'google']);

  // Otro navegador entra con Discord: recupera la MISMA cuenta.
  const b = browser();
  const viaDiscord = await b.signIn('discord', discordUsers['111111111111']);
  assert.equal(location(viaDiscord), '/?auth=ok&provider=discord');
  assert.equal((await b.me()).user.id, userId);

  // Una tercera persona con su Google no puede quedarse ese Discord.
  const c = browser();
  await c.signIn('google', {sub: 'g-2', name: 'Otra'});
  const steal = await c.signIn('discord', discordUsers['111111111111'], {mode: 'link'});
  assert.match(location(steal), /auth_error=identity_in_use/);
  assert.notEqual((await c.me()).user.id, userId);

  // Desvincular: solo si queda otra forma de entrar.
  const csrf = (await a.me()).csrf;
  assert.equal((await a.post('/api/account/unlink', {provider: 'google'}, {csrf})).status, 200);
  assert.equal((await a.post('/api/account/unlink', {provider: 'discord'}, {csrf})).json.error, 'last_identity');

  // Cerrar sesión.
  assert.equal((await b.post('/auth/logout', {}, {csrf: (await b.me()).csrf})).status, 200);
  assert.equal((await b.me()).authenticated, false);
});

test('OAuth callbacks reject forged state, other browsers and invalid id_tokens', async () => {
  const a = browser();
  const start = await a.get('/auth/google/start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  // Callback abierto desde otro navegador (sin la cookie del flujo): login CSRF bloqueado.
  const other = browser();
  const r1 = await other.get(`/auth/google/callback?code=x&state=${state}`);
  assert.match(r1.headers.get('location'), /auth_error=state_browser_mismatch/);
  // id_token para otra app (aud) o con otro nonce.
  const wrongAud = await browser().signIn('google', {sub: 'g-9', name: 'X'}, {tamper: c => ({...c, aud: 'otra-app'})});
  assert.match(location(wrongAud), /auth_error=invalid_id_token/);
  const wrongNonce = await browser().signIn('google', {sub: 'g-9', name: 'X'}, {tamper: c => ({...c, nonce: 'otro'})});
  assert.match(location(wrongNonce), /auth_error=invalid_id_token/);
  // Discord sin identidad válida.
  const bad = await browser().signIn('discord', {id: '999'});
  assert.match(location(bad), /auth_error=identity_unavailable/);
  // Vincular sin sesión.
  const noSession = await browser().get('/auth/discord/start?mode=link');
  assert.match(noSession.headers.get('location'), /auth_error=login_required/);
});

test('shop, exchange and admin credit go through the backend with CSRF and idempotency', async () => {
  const a = browser();
  await a.signIn('google', {sub: 'g-shop', name: 'Compradora'});
  const {csrf, user} = await a.me();
  // Sin token CSRF u otro origen: rechazado.
  assert.equal((await a.post('/api/shop/equip', {itemId: 'wing:2'})).status, 403);
  assert.equal((await a.post('/api/shop/equip', {itemId: 'wing:2'}, {csrf, origin: 'https://evil.example'})).status, 403);
  assert.equal((await a.post('/api/shop/equip', {itemId: 'wing:2'}, {csrf})).json.equipped.wing, 2);
  // Sin saldo.
  const broke = await a.post('/api/shop/purchase', {itemId: 'wing:5', requestId: 'buy-000000001'}, {csrf});
  assert.deepEqual([broke.status, broke.json.error], [409, 'insufficient_funds']);
  // Ajuste administrativo por consola (única vía de acreditar sin pago integrado).
  const env = {...process.env, DATABASE_URL: process.env.TEST_DB, ECONOMY_CONFIG: join(dir, 'economy.json')};
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/admin-economy.mjs', 'grant', user.id, 'GOLD_COIN', '60', 'prueba'], {cwd: serverDir, env});
  assert.deepEqual((await a.me()).wallet, {NORMAL_COIN: 0, GOLD_COIN: 60});
  // Oro -> Normales, idempotente.
  const ex = await a.post('/api/coins/exchange', {packageId: 'p500', requestId: 'ex-000000001'}, {csrf});
  assert.deepEqual(ex.json.wallet, {NORMAL_COIN: 500, GOLD_COIN: 10});
  await a.post('/api/coins/exchange', {packageId: 'p500', requestId: 'ex-000000001'}, {csrf});
  assert.deepEqual((await a.me()).wallet, {NORMAL_COIN: 500, GOLD_COIN: 10});
  // Compra con Normales, idempotente, y el precio lo pone el servidor aunque el cliente mande otro.
  const buy = await a.post('/api/shop/purchase', {itemId: 'wing:5', requestId: 'buy-000000002', price: 1}, {csrf});
  assert.equal(buy.json.wallet.NORMAL_COIN, 200);
  await a.post('/api/shop/purchase', {itemId: 'wing:5', requestId: 'buy-000000002'}, {csrf});
  const me = await a.me();
  assert.equal(me.wallet.NORMAL_COIN, 200);
  assert.deepEqual(me.inventory.map(i => i.itemId), ['wing:5']);
  assert.equal((await a.post('/api/shop/equip', {itemId: 'wing:5'}, {csrf})).json.equipped.wing, 5);
  // Pagos reales: deshabilitados, y el webhook no acredita nada.
  assert.equal((await a.post('/api/payments/checkout', {productId: 'gold_small'}, {csrf})).json.error, 'payments_disabled');
  assert.equal((await fetch(BASE + '/api/payments/webhook/stripe', {method: 'POST', body: '{"paid":true}'})).status, 501);
  assert.equal((await a.me()).wallet.GOLD_COIN, 10);
  const history = await (await a.get('/api/wallet/transactions')).json();
  assert.deepEqual(history.transactions.map(t => t.type), ['ITEM_PURCHASE', 'GOLD_EXCHANGE', 'GOLD_EXCHANGE', 'ADMIN_ADJUSTMENT']);

  // En la sala, los demás ven el equipamiento de la CUENTA aunque el cliente pida otra cosa,
  // y un invitado no puede lucir artículos de pago.
  const cookie = Object.entries(a.jar).map(([k, v]) => k + '=' + v).join('; ');
  const seen = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/play`, {headers: {cookie}});
    ws.binaryType = 'arraybuffer';
    ws.onmessage = ({data}) => {
      const v = read(data), t = v.getUint8(1);
      if (t === TYPE.WELCOME) { ws.send(profilePacket({character: 4, board: 1, wing: 0, hat: 0, nick: 'Falso'})); ws.send(roomRequest(1, 0, '', 8, 0)); }
      if (t === TYPE.SNAPSHOT) { const list = states(v); if (list.length) { ws.close(); resolve(list[0]); } }
    };
    ws.onerror = reject;
  });
  assert.deepEqual([seen.nick, seen.wing, seen.character], ['Compradora', 5, 0]);
  const guest = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/play`);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = ({data}) => {
      const v = read(data), t = v.getUint8(1);
      if (t === TYPE.WELCOME) { ws.send(profilePacket({character: 2, board: 1, wing: 5, hat: 0, nick: 'Invitado'})); ws.send(roomRequest(1, 0, '', 8, 0)); }
      if (t === TYPE.SNAPSHOT) { const list = states(v); if (list.length) { ws.close(); resolve(list[0]); } }
    };
    ws.onerror = reject;
  });
  assert.deepEqual([guest.nick, guest.wing, guest.character], ['Invitado', 0, 2]);
});

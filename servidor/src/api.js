// Rutas HTTP de cuentas y economía sobre uWebSockets.js.
//   /auth/{google|discord}/start?mode=login|link   -> redirección al proveedor
//   /auth/{google|discord}/callback                -> vuelta del proveedor, crea la sesión
//   POST /auth/logout
//   GET  /api/me                                   -> estado de la sesión, perfil, monedero...
//   GET  /api/shop/catalog · POST /api/shop/purchase · POST /api/shop/equip
//   GET  /api/coins/packages · POST /api/coins/exchange · GET /api/wallet/transactions
//   GET  /api/payments/products · POST /api/payments/checkout · POST /api/payments/webhook/:provider
//   POST /api/account/nickname · POST /api/account/unlink · POST /api/account/migrate-local
// Toda petición que cambia algo exige sesión + cabecera X-CSRF-Token + Origin propio.
import {EconomyError} from './economy.js';
import {SESSION_COOKIE, BROWSER_COOKIE} from './auth.js';

const MAX_BODY = 16 * 1024;

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Límite de peticiones por IP y grupo (ventana fija de 1 minuto, en memoria).
export function createRateLimiter(limits) {
  const hits = new Map();
  setInterval(() => hits.clear(), 60_000).unref();
  return (group, ip) => {
    const key = group + '|' + ip, n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    return n <= (limits[group] || 60);
  };
}

export function mountApi(app, {auth, economy, config, onEquipmentChanged = () => {}, payments = {enabled: false}}) {
  // Por IP y minuto. En una LAN varios jugadores comparten IP, por eso no es muy estricto.
  const env = process.env;
  const allow = createRateLimiter({auth: Number(env.RATE_LIMIT_AUTH) || 60, write: Number(env.RATE_LIMIT_WRITE) || 120, read: Number(env.RATE_LIMIT_READ) || 600});
  const origin = new URL(config.publicUrl).origin;

  // Envuelve un manejador: copia lo necesario de req (uWS lo invalida tras el primer await),
  // lee el cuerpo JSON y responde con cork. El manejador devuelve {status, json|redirect, cookies}.
  function route(method, path, handler, {group = 'read', csrf = method === 'post'} = {}) {
    app[method](path, (res, req) => {
      let aborted = false;
      res.onAborted(() => { aborted = true; });
      const ctx = {
        url: req.getUrl(), query: Object.fromEntries(new URLSearchParams(req.getQuery() || '')),
        cookies: parseCookies(req.getHeader('cookie')), origin: req.getHeader('origin'), referer: req.getHeader('referer'),
        csrf: req.getHeader('x-csrf-token'), contentType: req.getHeader('content-type'),
        params: path.includes(':') ? [req.getParameter(0)] : [],
        ip: Buffer.from(res.getRemoteAddressAsText()).toString()
      };
      const send = out => {
        if (aborted) return;
        res.cork(() => {
          res.writeStatus(out.status || (out.redirect ? '302 Found' : '200 OK'));
          res.writeHeader('Cache-Control', 'no-store');
          res.writeHeader('X-Content-Type-Options', 'nosniff');
          res.writeHeader('Referrer-Policy', 'same-origin');
          for (const c of out.cookies || []) res.writeHeader('Set-Cookie', c);
          if (out.redirect) { res.writeHeader('Location', out.redirect); res.end(); return; }
          res.writeHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(out.json ?? {}));
        });
      };
      const fail = error => {
        const known = error instanceof EconomyError;
        if (!known) console.error('[api]', method.toUpperCase(), path, error);
        send({status: `${known ? error.status : 500} Error`, json: {error: known ? error.code : 'server_error', detail: known ? error.detail : undefined}});
      };
      const run = body => {
        try {
          if (!allow(group, ctx.ip)) throw new EconomyError('rate_limited', 429);
          ctx.session = auth.session(ctx.cookies[SESSION_COOKIE]);
          ctx.userId = ctx.session?.userId || null;
          if (csrf) {
            if (!ctx.userId) throw new EconomyError('login_required', 401);
            const from = ctx.origin || (ctx.referer ? new URL(ctx.referer).origin : '');
            if (from !== origin || ctx.csrf !== ctx.session.csrf) throw new EconomyError('csrf_failed', 403);
          }
          ctx.body = body;
          Promise.resolve(handler(ctx)).then(send, fail);
        } catch (error) { fail(error); }
      };
      if (method !== 'post') return run({});
      let chunks = [], size = 0;
      res.onData((chunk, last) => {
        size += chunk.byteLength;
        if (size > MAX_BODY) { if (!aborted) { aborted = true; res.cork(() => res.writeStatus('413 Payload Too Large').end()); } return; }
        chunks.push(Buffer.from(chunk.slice(0)));   // copiar: uWS reutiliza el buffer
        if (!last || aborted) return;
        let body = {};
        try { const text = Buffer.concat(chunks).toString('utf8'); body = text ? JSON.parse(text) : {}; }
        catch { return fail(new EconomyError('invalid_json')); }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail(new EconomyError('invalid_json'));
        run(body);
      });
    });
  }

  const profileOf = userId => {
    const user = economy.getUser(userId);
    return {
      authenticated: true, csrf: null,
      user: {id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl, createdAt: user.createdAt, localMigrated: !!user.localMigrated},
      identities: auth.identities(userId), wallet: economy.wallet(userId),
      inventory: economy.inventory(userId), equipped: economy.equipped(userId)
    };
  };
  const providers = () => ({google: auth.enabled('google'), discord: auth.enabled('discord')});

  // ---------- Autenticación ----------
  for (const provider of ['google', 'discord']) {
    route('get', `/auth/${provider}/start`, ctx => {
      try {
        const {location, cookies} = auth.start(provider, ctx.query.mode === 'link' ? 'link' : 'login', ctx.userId, ctx.cookies[BROWSER_COOKIE]);
        return {redirect: location, cookies};
      } catch (error) {
        if (error instanceof EconomyError) return {redirect: '/?auth_error=' + encodeURIComponent(error.code)};
        throw error;
      }
    }, {group: 'auth', csrf: false});
    route('get', `/auth/${provider}/callback`, async ctx => {
      try {
        const result = await auth.callback(provider, ctx.query, ctx.cookies[BROWSER_COOKIE], ctx.userId);
        if (result.mode === 'link') return {redirect: '/?auth=linked&provider=' + provider};
        if (ctx.session) auth.destroySession(ctx.cookies[SESSION_COOKIE]);   // no heredar sesiones previas
        return {redirect: '/?auth=ok&provider=' + provider + (result.created ? '&new=1' : ''), cookies: [auth.sessionCookie(auth.createSession(result.userId))]};
      } catch (error) {
        if (error instanceof EconomyError) return {redirect: '/?auth_error=' + encodeURIComponent(error.code) + '&provider=' + provider};
        throw error;
      }
    }, {group: 'auth', csrf: false});
  }
  route('post', '/auth/logout', ctx => {
    auth.destroySession(ctx.cookies[SESSION_COOKIE]);
    return {json: {ok: true}, cookies: [auth.clearSessionCookie()]};
  }, {group: 'write'});

  // ---------- Cuenta ----------
  route('get', '/api/me', ctx => {
    const payments_ = {enabled: !!payments.enabled};
    if (!ctx.userId) return {json: {authenticated: false, providers: providers(), payments: payments_}};
    return {json: {...profileOf(ctx.userId), csrf: ctx.session.csrf, providers: providers(), payments: payments_}};
  });
  route('post', '/api/account/nickname', ctx => ({json: {nickname: economy.setNickname(ctx.userId, ctx.body.nickname)}}), {group: 'write'});
  route('post', '/api/account/unlink', ctx => ({json: {identities: auth.unlink(ctx.userId, String(ctx.body.provider || ''))}}), {group: 'write'});
  route('post', '/api/account/migrate-local', ctx => {
    const pick = v => Number.isInteger(v) ? v : undefined;
    const result = economy.migrateLocal(ctx.userId, {character: pick(ctx.body.character), board: pick(ctx.body.board), wing: pick(ctx.body.wing), hat: pick(ctx.body.hat)});
    if (result.migrated) onEquipmentChanged(ctx.userId);
    return {json: result};
  }, {group: 'write'});

  // ---------- La tiendita ----------
  route('get', '/api/shop/catalog', ctx => ({json: {items: economy.catalog(ctx.userId), wallet: ctx.userId ? economy.wallet(ctx.userId) : null}}));
  route('post', '/api/shop/purchase', ctx => ({json: economy.purchase(ctx.userId, String(ctx.body.itemId || ''), ctx.body.requestId)}), {group: 'write'});
  route('post', '/api/shop/equip', ctx => {
    const equipped = economy.equip(ctx.userId, String(ctx.body.itemId || ''));
    onEquipmentChanged(ctx.userId);
    return {json: {equipped}};
  }, {group: 'write'});
  route('get', '/api/wallet/transactions', ctx => {
    if (!ctx.userId) throw new EconomyError('login_required', 401);
    return {json: {transactions: economy.transactions(ctx.userId, Number(ctx.query.limit) || 30), wallet: economy.wallet(ctx.userId)}};
  });

  // ---------- Conseguir monedas ----------
  route('get', '/api/coins/packages', () => ({json: {packages: economy.packages()}}));
  route('post', '/api/coins/exchange', ctx => ({json: economy.exchange(ctx.userId, String(ctx.body.packageId || ''), ctx.body.requestId)}), {group: 'write'});

  // ---------- Pagos reales (preparado, deshabilitado) ----------
  route('get', '/api/payments/products', () => ({json: {enabled: !!payments.enabled, products: economy.goldProducts()}}));
  route('post', '/api/payments/checkout', () => { throw new EconomyError('payments_disabled', 503); }, {group: 'write'});
  // El webhook del proveedor no lleva sesión ni CSRF: se validará con su firma cuando exista la
  // integración. Hasta entonces no acepta nada (no se acredita oro por peticiones sin verificar).
  app.post('/api/payments/webhook/:provider', res => { res.writeStatus('501 Not Implemented').writeHeader('Content-Type', 'application/json').end('{"error":"payments_not_integrated"}'); });
}

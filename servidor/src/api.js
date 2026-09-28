// Rutas HTTP de cuentas y economía sobre uWebSockets.js.
//   /auth/{google|discord}/start?mode=login|link   -> redirección al proveedor
//   /auth/{google|discord}/callback                -> vuelta del proveedor, crea la sesión
//   POST /auth/logout
//   GET  /api/me                                   -> estado de la sesión, perfil, monedero...
//   GET  /api/shop/catalog · POST /api/shop/purchase · POST /api/shop/equip · GET /api/catalog/custom
//   GET  /api/coins/packages · POST /api/coins/exchange · GET /api/wallet/transactions
//   GET  /api/payments/products · POST /api/payments/checkout · GET /api/payments/orders/:id
//   GET  /api/payments/paypal/return|cancel (vuelta de PayPal) · POST /api/payments/webhook/paypal (firmado)
//   POST /api/account/nickname · POST /api/account/unlink · POST /api/account/migrate-local
//   GET  /api/trade/summary · /api/trade/inventory · /api/trade/user?code= · /api/trade/offers?box= · /api/trade/blocked · /api/trade/listings?mine=1
//   POST /api/trade/offers · /api/trade/listings · /api/trade/listings/withdraw · /api/trade/accept · /api/trade/decline · /api/trade/cancel · /api/trade/block · /api/trade/unblock
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

export function mountApi(app, {auth, economy, trade, economyConfig = {}, config, onEquipmentChanged = () => {}, payments = {enabled: false}}) {
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
      const run = async body => {
        try {
          if (!allow(group, ctx.ip)) throw new EconomyError('rate_limited', 429);
          ctx.session = await auth.session(ctx.cookies[SESSION_COOKIE]);
          ctx.userId = ctx.session?.userId || null;
          if (csrf) {
            if (!ctx.userId) throw new EconomyError('login_required', 401);
            let from = ctx.origin;
            if (!from && ctx.referer) try { from = new URL(ctx.referer).origin; } catch {}
            if (from !== origin || ctx.csrf !== ctx.session.csrf) throw new EconomyError('csrf_failed', 403);
          }
          ctx.body = body;
          send(await handler(ctx));
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

  const profileOf = async userId => {
    const user = await economy.getUser(userId);
    if (!user) throw new EconomyError('login_required', 401);
    return {
      authenticated: true, csrf: null,
      user: {id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl, createdAt: user.createdAt, localMigrated: !!user.localMigrated},
      identities: await auth.identities(userId), wallet: await economy.wallet(userId), tradeCode: trade ? await trade.code(userId) : null,
      inventory: await economy.inventory(userId), equipped: await economy.equipped(userId)
    };
  };
  const providers = () => ({google: auth.enabled('google'), discord: auth.enabled('discord')});
  // Enlaces públicos del menú. Solo se publica una URL https (p. ej. la invitación al Discord).
  const links = () => ({discord: /^https:\/\/\S+$/.test(env.DISCORD_INVITE_URL || '') ? env.DISCORD_INVITE_URL : null});

  // ---------- Autenticación ----------
  for (const provider of ['google', 'discord']) {
    route('get', `/auth/${provider}/start`, async ctx => {
      try {
        const {location, cookies} = await auth.start(provider, ctx.query.mode === 'link' ? 'link' : 'login', ctx.userId, ctx.cookies[BROWSER_COOKIE]);
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
        if (ctx.session) await auth.destroySession(ctx.cookies[SESSION_COOKIE]);   // no heredar sesiones previas
        return {redirect: '/?auth=ok&provider=' + provider + (result.created ? '&new=1' : ''), cookies: [auth.sessionCookie(await auth.createSession(result.userId))]};
      } catch (error) {
        if (error instanceof EconomyError) return {redirect: '/?auth_error=' + encodeURIComponent(error.code) + '&provider=' + provider};
        throw error;
      }
    }, {group: 'auth', csrf: false});
  }
  route('post', '/auth/logout', async ctx => {
    await auth.destroySession(ctx.cookies[SESSION_COOKIE]);
    return {json: {ok: true}, cookies: [auth.clearSessionCookie()]};
  }, {group: 'write'});

  // ---------- Cuenta ----------
  route('get', '/api/me', async ctx => {
    const payments_ = {enabled: !!payments.enabled, provider: payments.enabled ? 'paypal' : null, sandbox: payments.mode === 'sandbox'};
    if (!ctx.userId) return {json: {authenticated: false, providers: providers(), payments: payments_, links: links()}};
    return {json: {...await profileOf(ctx.userId), csrf: ctx.session.csrf, providers: providers(), payments: payments_, links: links()}};
  });
  route('post', '/api/account/nickname', async ctx => {
    const nickname = await economy.setNickname(ctx.userId, ctx.body.nickname);
    onEquipmentChanged(ctx.userId);
    return {json: {nickname}};
  }, {group: 'write'});
  route('post', '/api/account/unlink', async ctx => ({json: {identities: await auth.unlink(ctx.userId, String(ctx.body.provider || ''))}}), {group: 'write'});
  route('post', '/api/account/migrate-local', async ctx => {
    const pick = v => Number.isInteger(v) ? v : undefined;
    const result = await economy.migrateLocal(ctx.userId, {character: pick(ctx.body.character), board: pick(ctx.body.board), wing: pick(ctx.body.wing), hat: pick(ctx.body.hat)});
    if (result.migrated) onEquipmentChanged(ctx.userId);
    return {json: result};
  }, {group: 'write'});

  // ---------- La tiendita ----------
  // Items subidos desde el panel y textos editados: el navegador los añade al catálogo al cargar.
  route('get', '/api/catalog/custom', async () => ({json: {
    items: (economyConfig.customItems || []).map(({category, assetIndex, name, description, file, fullFile, color, width}) => ({category, assetIndex, name, description, file, fullFile, color, width})),
    texts: economyConfig.itemTexts || []
  }}));
  route('get', '/api/shop/catalog', async ctx => ({json: {items: await economy.catalog(ctx.userId), wallet: ctx.userId ? await economy.wallet(ctx.userId) : null}}));
  route('post', '/api/shop/purchase', async ctx => ({json: await economy.purchase(ctx.userId, String(ctx.body.itemId || ''), ctx.body.requestId)}), {group: 'write'});
  route('post', '/api/shop/equip', async ctx => {
    const equipped = await economy.equip(ctx.userId, String(ctx.body.itemId || ''));
    onEquipmentChanged(ctx.userId);
    return {json: {equipped}};
  }, {group: 'write'});
  route('get', '/api/wallet/transactions', async ctx => {
    if (!ctx.userId) throw new EconomyError('login_required', 401);
    return {json: {transactions: await economy.transactions(ctx.userId, Number(ctx.query.limit) || 30), wallet: await economy.wallet(ctx.userId)}};
  });

  // ---------- Conseguir monedas ----------
  route('get', '/api/coins/packages', async () => ({json: {packages: await economy.packages()}}));
  route('post', '/api/coins/exchange', async ctx => ({json: await economy.exchange(ctx.userId, String(ctx.body.packageId || ''), ctx.body.requestId)}), {group: 'write'});

  // ---------- Trade (solo cuentas registradas; items por items, sin monedas) ----------
  if (trade) {
    const need = ctx => { if (!ctx.userId) throw new EconomyError('login_required', 401); return ctx.userId; };
    const str = v => String(v ?? '');
    route('get', '/api/trade/summary', async ctx => ({json: await trade.summary(need(ctx))}));
    route('get', '/api/trade/inventory', async ctx => ({json: {items: await trade.inventory(need(ctx))}}));
    route('get', '/api/trade/user', async ctx => ({json: await trade.partner(need(ctx), str(ctx.query.code))}));
    route('get', '/api/trade/offers', async ctx => ({json: {offers: await trade.list(need(ctx), str(ctx.query.box || 'received'))}}));
    route('get', '/api/trade/blocked', async ctx => ({json: {blocked: await trade.blocked(need(ctx))}}));
    route('post', '/api/trade/offers', async ctx => ({json: await trade.create(ctx.userId, {toCode: ctx.body.toCode, offer: ctx.body.offer, request: ctx.body.request,
      requestId: ctx.body.requestId, parentId: ctx.body.parentId ? str(ctx.body.parentId) : null, listingId: ctx.body.listingId ? str(ctx.body.listingId) : null})}), {group: 'write'});
    // Trades públicos (tablón)
    route('get', '/api/trade/listings', async ctx => ({json: {listings: await trade.listings(need(ctx), {mine: ctx.query.mine === '1'})}}));
    route('post', '/api/trade/listings', async ctx => ({json: await trade.publish(ctx.userId, {offer: ctx.body.offer, want: ctx.body.want ?? [], requestId: ctx.body.requestId})}), {group: 'write'});
    route('post', '/api/trade/listings/withdraw', async ctx => ({json: await trade.withdrawListing(ctx.userId, str(ctx.body.listingId))}), {group: 'write'});
    route('post', '/api/trade/accept', async ctx => {
      const result = await trade.accept(ctx.userId, str(ctx.body.offerId), str(ctx.body.contentHash));
      // Lo entregado se desequipa: las salas abiertas de las dos cuentas se actualizan.
      for (const user of result.users || []) onEquipmentChanged(user);
      const {users, ...json} = result;
      return {json: {...json, wallet: await economy.wallet(ctx.userId)}};
    }, {group: 'write'});
    route('post', '/api/trade/decline', async ctx => ({json: await trade.decline(ctx.userId, str(ctx.body.offerId))}), {group: 'write'});
    route('post', '/api/trade/cancel', async ctx => ({json: await trade.cancel(ctx.userId, str(ctx.body.offerId))}), {group: 'write'});
    route('post', '/api/trade/block', async ctx => ({json: await trade.block(ctx.userId, str(ctx.body.code))}), {group: 'write'});
    route('post', '/api/trade/unblock', async ctx => ({json: await trade.unblock(ctx.userId, str(ctx.body.code))}), {group: 'write'});
  }

  // ---------- Pagos reales: Tablas de Oro con PayPal (src/payments.js) ----------
  route('get', '/api/payments/products', async () => ({json: {enabled: !!payments.enabled, provider: payments.enabled ? 'paypal' : null, products: payments.products ? await payments.products() : await economy.goldProducts()}}));
  route('post', '/api/payments/checkout', async ctx => {
    if (!payments.checkout) throw new EconomyError('payments_disabled', 503);
    return {json: await payments.checkout(ctx.userId, String(ctx.body.productId || ''))};
  }, {group: 'write'});
  route('get', '/api/payments/orders/:id', async ctx => {
    if (!ctx.userId) throw new EconomyError('login_required', 401);
    if (!payments.orderStatus) throw new EconomyError('order_not_found', 404);
    return {json: {...await payments.orderStatus(ctx.userId, ctx.params[0]), wallet: await economy.wallet(ctx.userId)}};
  });
  // Vuelta desde PayPal. No acredita por llegar aquí: completeReturn pide a PayPal que cobre la
  // orden y solo acredita si PayPal confirma la captura por el importe exacto.
  const back = r => ({redirect: '/?pago=' + encodeURIComponent(String(r.status || 'UNKNOWN').toLowerCase()) + (r.orderId ? '&orden=' + encodeURIComponent(r.orderId) : '')});
  route('get', '/api/payments/paypal/return', async ctx => back(payments.completeReturn ? await payments.completeReturn(ctx.query.token) : {}), {group: 'write', csrf: false});
  route('get', '/api/payments/paypal/cancel', async ctx => back(payments.cancel ? await payments.cancel(ctx.query.token) : {}), {group: 'write', csrf: false});
  // Webhook de PayPal: sin sesión ni CSRF; se autentica comprobando su firma con PayPal.
  app.post('/api/payments/webhook/:provider', (res, req) => {
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    const provider = req.getParameter(0);
    const headers = {};
    req.forEach((k, v) => { headers[k.toLowerCase()] = v; });
    const reply = (status, body) => { if (!aborted) res.cork(() => res.writeStatus(String(status)).writeHeader('Content-Type', 'application/json').end(JSON.stringify(body))); };
    const supported = provider === 'paypal' && !!payments.webhook;
    const chunks = [];
    let size = 0;
    res.onData((chunk, last) => {
      size += chunk.byteLength;
      if (size > 256 * 1024) { if (!aborted) { aborted = true; res.cork(() => res.writeStatus('413 Payload Too Large').end()); } return; }
      chunks.push(Buffer.from(chunk.slice(0)));
      if (!last || aborted) return;
      if (!supported) return reply(501, {error: 'payments_not_integrated'});
      payments.webhook(headers, Buffer.concat(chunks).toString('utf8'))
        .then(r => reply(r.status, r.body))
        .catch(error => { console.error('[payments] webhook', error); reply(500, {error: 'server_error'}); });
    });
  });
}

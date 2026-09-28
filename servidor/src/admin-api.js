// Rutas del panel administrativo (/admin/api/*). Todas exigen sesión de administrador salvo el
// login; las que cambian algo exigen además X-Admin-CSRF y el Origin propio. Las respuestas
// son JSON sin caché. La subida de imágenes admite cuerpos de hasta 12 MB; el resto, 64 KB.
import {EconomyError} from './economy.js';
import {parseCookies, createRateLimiter} from './api.js';
import {clientIp} from './audit.js';

export function mountAdmin(app, {admin, config}) {
  const origin = new URL(config.publicUrl).origin;
  const allow = createRateLimiter({login: 20, admin: 600});

  function route(method, path, handler, {auth = true, maxBody = 64 * 1024, group = 'admin'} = {}) {
    app[method](path, (res, req) => {
      let aborted = false;
      res.onAborted(() => { aborted = true; });
      const ctx = {
        query: Object.fromEntries(new URLSearchParams(req.getQuery() || '')),
        cookies: parseCookies(req.getHeader('cookie')), origin: req.getHeader('origin'), referer: req.getHeader('referer'),
        csrf: req.getHeader('x-admin-csrf'), ip: clientIp(res, req)
      };
      const send = out => {
        if (aborted) return;
        res.cork(() => {
          res.writeStatus(out.status || '200 OK');
          res.writeHeader('Cache-Control', 'no-store');
          res.writeHeader('X-Content-Type-Options', 'nosniff');
          res.writeHeader('X-Frame-Options', 'DENY');
          res.writeHeader('Referrer-Policy', 'same-origin');
          for (const c of out.cookies || []) res.writeHeader('Set-Cookie', c);
          res.writeHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(out.json ?? {}));
        });
      };
      const fail = error => {
        const known = error instanceof EconomyError;
        if (!known) console.error('[admin]', method.toUpperCase(), path, error);
        send({status: `${known ? error.status : 500} Error`, json: {error: known ? error.code : 'server_error', detail: known ? error.detail : undefined}});
      };
      const run = async body => {
        try {
          if (!allow(group, ctx.ip)) throw new EconomyError('rate_limited', 429);
          if (method === 'post') {
            let from = ctx.origin;
            if (!from && ctx.referer) try { from = new URL(ctx.referer).origin; } catch {}
            if (from !== origin) throw new EconomyError('csrf_failed', 403);
          }
          if (auth) {
            ctx.session = await admin.session(ctx.cookies.ss_admin);
            if (!ctx.session) throw new EconomyError('admin_login_required', 401);
            if (method === 'post' && ctx.csrf !== ctx.session.csrf) throw new EconomyError('csrf_failed', 403);
          }
          ctx.body = body;
          send(await handler(ctx));
        } catch (error) { fail(error); }
      };
      if (method !== 'post') return run({});
      const chunks = []; let size = 0;
      res.onData((chunk, last) => {
        size += chunk.byteLength;
        if (size > maxBody) { if (!aborted) { aborted = true; res.cork(() => res.writeStatus('413 Payload Too Large').end()); } return; }
        chunks.push(Buffer.from(chunk.slice(0)));
        if (!last || aborted) return;
        let body = {};
        try { const text = Buffer.concat(chunks).toString('utf8'); body = text ? JSON.parse(text) : {}; }
        catch { return fail(new EconomyError('invalid_json')); }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail(new EconomyError('invalid_json'));
        run(body);
      });
    });
  }

  // ---------- Sesión ----------
  route('post', '/admin/api/login', async ctx => {
    const {token, csrf, username} = await admin.login(String(ctx.body.username || ''), String(ctx.body.password || ''), ctx.ip);
    return {json: {username, csrf}, cookies: [admin.cookie(token)]};
  }, {auth: false, group: 'login'});
  route('post', '/admin/api/logout', async ctx => {
    await admin.logout(ctx.cookies.ss_admin);
    return {json: {ok: true}, cookies: [admin.clearCookie()]};
  });
  route('get', '/admin/api/me', async ctx => ({json: {username: ctx.session.username, csrf: ctx.session.csrf}}));

  // ---------- Datos ----------
  route('get', '/admin/api/stats', async () => ({json: await admin.stats()}));
  route('get', '/admin/api/users', async ctx => ({json: {users: await admin.users(ctx.query.q || '', ctx.query.limit)}}));
  route('get', '/admin/api/user', async ctx => ({json: await admin.user(ctx.query.id)}));
  route('get', '/admin/api/purchases', async ctx => ({json: {purchases: await admin.purchases(ctx.query.limit)}}));
  route('get', '/admin/api/transactions', async ctx => ({json: {transactions: await admin.transactions({type: ctx.query.type || '', limit: ctx.query.limit})}}));
  route('get', '/admin/api/trades', async ctx => ({json: {trades: await admin.trades({status: ctx.query.status || '', limit: ctx.query.limit})}}));
  route('get', '/admin/api/audit', async ctx => ({json: {audit: await admin.auditLog(ctx.query.limit)}}));
  route('get', '/admin/api/security', async ctx => ({json: await admin.security({event: ctx.query.event || '', userId: ctx.query.user || '', ip: ctx.query.ip || '', outcome: ctx.query.outcome || '', limit: ctx.query.limit})}));
  route('get', '/admin/api/catalog', async () => ({json: {items: await admin.catalog()}}));
  route('get', '/admin/api/economy', async () => ({json: admin.economySettings()}));

  // ---------- Acciones ----------
  route('post', '/admin/api/user/grant', async ctx => ({json: await admin.grant(ctx.session.adminId, ctx.body)}));
  route('post', '/admin/api/user/give-item', async ctx => ({json: await admin.giveItem(ctx.session.adminId, ctx.body)}));
  route('post', '/admin/api/user/remove-item', async ctx => ({json: await admin.removeItem(ctx.session.adminId, ctx.body)}));
  route('post', '/admin/api/trade/revert', async ctx => ({json: await admin.revertTrade(ctx.session.adminId, ctx.body.tradeId)}));
  route('post', '/admin/api/catalog/item', async ctx => ({json: {item: await admin.updateItem(ctx.session.adminId, ctx.body)}}));
  route('post', '/admin/api/catalog/upload', async ctx => ({json: {item: await admin.upload(ctx.session.adminId, ctx.body)}}), {maxBody: 12 * 1024 * 1024});
  route('post', '/admin/api/economy', async ctx => ({json: await admin.updateEconomy(ctx.session.adminId, ctx.body)}));
}

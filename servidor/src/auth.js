// Autenticación de Surf Salvaje: Google (OpenID Connect) y Discord (OAuth2), ambos con el
// flujo de "authorization code" en el servidor. El navegador nunca ve secretos ni tokens de
// los proveedores; solo recibe una cookie de sesión HttpOnly de Surf Salvaje.
//
// - state de un solo uso (guardado como hash, caduca en 10 min) ligado a una cookie del
//   navegador que inició el flujo: evita CSRF de login y callbacks reutilizados.
// - Google: PKCE (S256) + nonce; el id_token se valida con las claves públicas (JWKS) de
//   Google: firma RS256, emisor, audiencia, caducidad y nonce. Identificador = "sub".
// - Discord: scope "identify" (nada de servidores, mensajes ni correo). Identificador = id.
//   El access token se usa una vez para leer la identidad y se revoca; no se guarda.
// - Una identidad (proveedor + id) pertenece a una sola cuenta. Nunca se fusionan cuentas por
//   correo. Vincular requiere estar ya dentro de la cuenta y no crea monederos nuevos.
import {createHash, createHmac, randomBytes, createPublicKey, verify as verifySignature} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {transaction} from './db.js';
import {EconomyError} from './economy.js';

const serverRoot = fileURLToPath(new URL('../', import.meta.url));
export const SESSION_COOKIE = 'ss_session', BROWSER_COOKIE = 'ss_oauth';
const SESSION_MS = 30 * 24 * 3600 * 1000, STATE_MS = 10 * 60 * 1000;
const b64url = buf => Buffer.from(buf).toString('base64url');
const random = (bytes = 32) => b64url(randomBytes(bytes));

// SESSION_SECRET firma (HMAC) lo que se guarda de tokens y states. En local, si falta, se
// genera uno y se guarda en data/ (ignorado por git) para no perder las sesiones al reiniciar.
function sessionSecret(env) {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return env.SESSION_SECRET;
  if (env.NODE_ENV === 'production') throw Error('SESSION_SECRET (32+ caracteres) es obligatorio en producción');
  const file = resolve(serverRoot, 'data/.session-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dirname(file), {recursive: true});
  const secret = random(48);
  writeFileSync(file, secret, {mode: 0o600});
  console.warn('[auth] SESSION_SECRET no definido: se generó uno local en servidor/data/.session-secret');
  return secret;
}

export function authConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  const publicUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  return {
    publicUrl,
    secure: publicUrl.startsWith('https://'),
    secret: sessionSecret(env),
    google: {
      clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: publicUrl + '/auth/google/callback',
      // Sobrescribibles solo para las pruebas automáticas (proveedor simulado).
      authUrl: env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
      jwksUrl: env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs',
      issuers: env.GOOGLE_ISSUER ? [env.GOOGLE_ISSUER] : ['https://accounts.google.com', 'accounts.google.com']
    },
    discord: {
      clientId: env.DISCORD_CLIENT_ID || '', clientSecret: env.DISCORD_CLIENT_SECRET || '',
      redirectUri: publicUrl + '/auth/discord/callback',
      authUrl: env.DISCORD_AUTH_URL || 'https://discord.com/oauth2/authorize',
      apiBase: (env.DISCORD_API_BASE || 'https://discord.com/api').replace(/\/+$/, '')
    }
  };
}
export const providerEnabled = (config, provider) => !!(config[provider]?.clientId && config[provider]?.clientSecret);

export function createAuth(db, economy, config, {fetch: http = globalThis.fetch} = {}) {
  const q = sql => db.prepare(sql);
  const hmac = value => createHmac('sha256', config.secret).update(String(value)).digest('hex');

  // ---------- Sesiones ----------
  function createSession(userId) {
    const token = random(32), csrf = random(24);
    q('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(hmac(token), userId, csrf, Date.now() + SESSION_MS);
    q('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    return token;
  }
  function session(token) {
    if (!token || token.length > 100) return null;
    const row = q('SELECT user_id AS userId, csrf_token AS csrf, expires_at AS expiresAt FROM sessions WHERE token_hash = ?').get(hmac(token));
    if (!row || row.expiresAt < Date.now()) return null;
    return {...row};
  }
  const destroySession = token => token && q('DELETE FROM sessions WHERE token_hash = ?').run(hmac(token));
  const sessionCookie = token => cookie(SESSION_COOKIE, token, {maxAge: SESSION_MS / 1000});
  const clearSessionCookie = () => cookie(SESSION_COOKIE, '', {maxAge: 0});
  function cookie(name, value, {maxAge, path = '/'} = {}) {
    return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax${config.secure ? '; Secure' : ''}${maxAge !== undefined ? '; Max-Age=' + Math.floor(maxAge) : ''}`;
  }

  // ---------- Inicio del flujo ----------
  // Devuelve {location, cookies}. mode 'link' exige una sesión (currentUserId).
  function start(provider, mode, currentUserId, browserToken) {
    if (!['google', 'discord'].includes(provider)) throw new EconomyError('unknown_provider', 404);
    if (!providerEnabled(config, provider)) throw new EconomyError('provider_not_configured', 503);
    if (!['login', 'link'].includes(mode)) throw new EconomyError('invalid_mode');
    if (mode === 'link' && !currentUserId) throw new EconomyError('login_required', 401);
    const cookies = [];
    if (!browserToken) { browserToken = random(24); cookies.push(cookie(BROWSER_COOKIE, browserToken, {maxAge: STATE_MS / 1000, path: '/auth'})); }
    const state = random(32), verifier = random(48), nonce = random(24);
    q('DELETE FROM oauth_states WHERE expires_at < ?').run(Date.now());
    q('INSERT INTO oauth_states (state_hash, provider, mode, link_user_id, code_verifier, nonce, browser_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(hmac(state), provider, mode, mode === 'link' ? currentUserId : null, verifier, nonce, hmac(browserToken), Date.now() + STATE_MS);
    const p = config[provider], url = new URL(p.authUrl);
    const params = {client_id: p.clientId, redirect_uri: p.redirectUri, response_type: 'code', state};
    if (provider === 'google') Object.assign(params, {scope: 'openid profile', nonce, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', prompt: 'select_account'});
    else Object.assign(params, {scope: 'identify'});   // solo la identidad: sin servidores, mensajes ni correo
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return {location: url.href, cookies};
  }

  // ---------- Vuelta del proveedor ----------
  async function callback(provider, query, browserToken, currentUserId) {
    if (!['google', 'discord'].includes(provider) || !providerEnabled(config, provider)) throw new EconomyError('unknown_provider', 404);
    if (query.error) throw new EconomyError('provider_denied', 400);
    const state = String(query.state || ''), code = String(query.code || '');
    if (!state || !code || state.length > 200 || code.length > 2000) throw new EconomyError('invalid_callback');
    // El state se consume aquí (un solo uso) antes de cualquier llamada externa.
    const flow = transaction(db, () => {
      const row = q('SELECT * FROM oauth_states WHERE state_hash = ?').get(hmac(state));
      if (row) q('DELETE FROM oauth_states WHERE state_hash = ?').run(hmac(state));
      return row && {...row};
    });
    if (!flow || flow.provider !== provider || flow.expires_at < Date.now()) throw new EconomyError('invalid_state', 400);
    if (!browserToken || hmac(browserToken) !== flow.browser_hash) throw new EconomyError('state_browser_mismatch', 400);
    const identity = provider === 'google' ? await googleIdentity(code, flow) : await discordIdentity(code);
    if (flow.mode === 'link') {
      if (!currentUserId || currentUserId !== flow.link_user_id) throw new EconomyError('login_required', 401);
      linkIdentity(currentUserId, identity);
      return {userId: currentUserId, mode: 'link', created: false};
    }
    return {...loginIdentity(identity), mode: 'login'};
  }

  async function postForm(url, form) {
    const response = await http(url, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'}, body: new URLSearchParams(form)});
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new EconomyError('token_exchange_failed', 502, json.error);
    return json;
  }

  // ---------- Google (OpenID Connect) ----------
  let jwksCache = {at: 0, keys: []};
  async function googleKeys(force = false) {
    if (!force && Date.now() - jwksCache.at < 3600e3 && jwksCache.keys.length) return jwksCache.keys;
    const response = await http(config.google.jwksUrl);
    if (!response.ok) throw new EconomyError('jwks_unavailable', 502);
    jwksCache = {at: Date.now(), keys: (await response.json()).keys || []};
    return jwksCache.keys;
  }
  async function verifyGoogleIdToken(idToken, nonce) {
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) throw new EconomyError('invalid_id_token', 401);
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (header.alg !== 'RS256') throw new EconomyError('invalid_id_token', 401);
    let jwk = (await googleKeys()).find(k => k.kid === header.kid);
    if (!jwk) jwk = (await googleKeys(true)).find(k => k.kid === header.kid);   // rotación de claves
    if (!jwk) throw new EconomyError('invalid_id_token', 401);
    const ok = verifySignature('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({key: jwk, format: 'jwk'}), Buffer.from(parts[2], 'base64url'));
    const now = Date.now() / 1000;
    if (!ok || !config.google.issuers.includes(claims.iss) || claims.aud !== config.google.clientId ||
        !(claims.exp > now - 60) || !(claims.iat < now + 300) || claims.nonce !== nonce || !claims.sub) throw new EconomyError('invalid_id_token', 401);
    return claims;
  }
  async function googleIdentity(code, flow) {
    const g = config.google;
    const tokens = await postForm(g.tokenUrl, {code, client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: g.redirectUri, grant_type: 'authorization_code', code_verifier: flow.code_verifier});
    const claims = await verifyGoogleIdToken(tokens.id_token, flow.nonce);
    return {provider: 'google', subject: String(claims.sub), displayName: claims.name || claims.given_name || null, avatarUrl: /^https:\/\//.test(claims.picture || '') ? claims.picture : null};
  }

  // ---------- Discord (OAuth2) ----------
  async function discordIdentity(code) {
    const d = config.discord;
    const tokens = await postForm(d.apiBase + '/oauth2/token', {grant_type: 'authorization_code', code, redirect_uri: d.redirectUri, client_id: d.clientId, client_secret: d.clientSecret});
    if (!tokens.access_token) throw new EconomyError('token_exchange_failed', 502);
    const response = await http(d.apiBase + '/users/@me', {headers: {Authorization: 'Bearer ' + tokens.access_token}});
    const me = await response.json().catch(() => ({}));
    // El token no se guarda: se revoca en cuanto se conoce la identidad (best effort).
    postForm(d.apiBase + '/oauth2/token/revoke', {token: tokens.access_token, token_type_hint: 'access_token', client_id: d.clientId, client_secret: d.clientSecret}).catch(() => {});
    if (!response.ok || !/^\d{5,25}$/.test(String(me.id || ''))) throw new EconomyError('identity_unavailable', 502);
    const avatarUrl = /^[a-z0-9_]{6,64}$/i.test(me.avatar || '') ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128` : null;
    return {provider: 'discord', subject: String(me.id), displayName: me.global_name || me.username || null, avatarUrl};
  }

  // ---------- Cuentas e identidades ----------
  const identityOwner = ({provider, subject}) => q('SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?').get(provider, subject)?.user_id || null;
  function touchIdentity({provider, subject, displayName, avatarUrl}) {
    q("UPDATE auth_identities SET display_name = ?, avatar_url = ?, last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE provider = ? AND subject = ?").run(displayName, avatarUrl, provider, subject);
  }
  function loginIdentity(identity) {
    return transaction(db, () => {
      const existing = identityOwner(identity);
      if (existing) { touchIdentity(identity); return {userId: existing, created: false}; }
      const userId = economy.createUser({nickname: identity.displayName, avatarUrl: identity.avatarUrl});
      q("INSERT INTO auth_identities (user_id, provider, subject, display_name, avatar_url, last_login_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
        .run(userId, identity.provider, identity.subject, identity.displayName, identity.avatarUrl);
      return {userId, created: true};
    });
  }
  function linkIdentity(userId, identity) {
    transaction(db, () => {
      const owner = identityOwner(identity);
      if (owner === userId) { touchIdentity(identity); return; }
      if (owner) throw new EconomyError('identity_in_use', 409);
      if (q('SELECT 1 FROM auth_identities WHERE user_id = ? AND provider = ?').get(userId, identity.provider)) throw new EconomyError('provider_already_linked', 409);
      q('INSERT INTO auth_identities (user_id, provider, subject, display_name, avatar_url) VALUES (?, ?, ?, ?, ?)')
        .run(userId, identity.provider, identity.subject, identity.displayName, identity.avatarUrl);
    });
  }
  // Solo si queda otra forma de entrar: la cuenta nunca se queda inaccesible.
  function unlink(userId, provider) {
    return transaction(db, () => {
      const list = identities(userId);
      if (!list.some(i => i.provider === provider)) throw new EconomyError('not_linked', 404);
      if (list.length < 2) throw new EconomyError('last_identity', 409);
      q('DELETE FROM auth_identities WHERE user_id = ? AND provider = ?').run(userId, provider);
      return identities(userId);
    });
  }
  const identities = userId => q('SELECT provider, display_name AS displayName, avatar_url AS avatarUrl, created_at AS linkedAt FROM auth_identities WHERE user_id = ? ORDER BY created_at').all(userId).map(r => ({...r}));

  return {createSession, session, destroySession, sessionCookie, clearSessionCookie, start, callback, identities, unlink,
    loginIdentity, linkIdentity, verifyGoogleIdToken, enabled: provider => providerEnabled(config, provider)};
}

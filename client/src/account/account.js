// Cuenta de Surf Salvaje en el navegador. El servidor es la única autoridad: aquí solo se
// pide el estado (/api/me) y se envían acciones; saldos, precios y propiedad llegan del backend.
// Sin sesión se juega como invitado (nick y equipamiento gratuito guardados en el navegador).
import {profile} from '../ui/shop.js';

const state = {loaded: false, authenticated: false, providers: {google: false, discord: false}, payments: {enabled: false},
  user: null, identities: [], wallet: {NORMAL_COIN: 0, GOLD_COIN: 0}, inventory: [], equipped: null, csrf: null};
export const account = state;
const emit = () => document.dispatchEvent(new CustomEvent('surf:account', {detail: state}));

export const MESSAGES = {
  provider_not_configured: 'Este acceso todavía no está configurado en el servidor.',
  provider_denied: 'Has cancelado el inicio de sesión.',
  invalid_state: 'El inicio de sesión caducó o ya se usó. Vuelve a intentarlo.',
  state_browser_mismatch: 'Inicia sesión desde el mismo navegador en el que empezaste.',
  invalid_id_token: 'No se pudo verificar tu identidad. Vuelve a intentarlo.',
  identity_unavailable: 'El proveedor no devolvió tu identidad. Vuelve a intentarlo.',
  token_exchange_failed: 'El proveedor rechazó el inicio de sesión. Vuelve a intentarlo.',
  identity_in_use: 'Esa cuenta ya está vinculada a otro surfer de Surf Salvaje.',
  provider_already_linked: 'Ya tienes vinculada una cuenta de ese proveedor.',
  login_required: 'Inicia sesión para continuar.',
  last_identity: 'No puedes quitar tu único acceso: vincula otro antes.',
  insufficient_funds: 'Saldo insuficiente.',
  already_owned: 'Ya tienes este artículo.',
  package_inactive: 'Este paquete aún no está disponible.',
  payments_disabled: 'La compra de Tablas de Oro todavía no está disponible.',
  rate_limited: 'Demasiados intentos. Espera un momento.',
  csrf_failed: 'La sesión no es válida. Recarga la página.',
  invalid_nickname: 'Ese nick no es válido.',
  server_error: 'Error del servidor. Inténtalo de nuevo.'
};
export const message = code => MESSAGES[code] || 'No se pudo completar la acción.';
const PROVIDER_NAMES = {google: 'Google', discord: 'Discord'};

// Petición a la API. Las que modifican datos llevan el token CSRF de la sesión.
async function api(path, {method = 'GET', body} = {}) {
  const headers = {Accept: 'application/json'};
  if (method !== 'GET') { headers['Content-Type'] = 'application/json'; if (state.csrf) headers['X-CSRF-Token'] = state.csrf; }
  let response;
  try { response = await fetch(path, {method, headers, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined}); }
  catch { throw Object.assign(Error('network'), {code: 'network'}); }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(json.error || 'server_error'), {code: json.error || 'server_error', detail: json.detail, status: response.status});
  return json;
}
// Identificador único por acción (doble clic o reintento = misma operación en el servidor).
export const requestId = () => (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');

function applyEquipment(equipped) {
  if (!equipped) return;
  const changed = ['character', 'board', 'wing', 'hat'].some(k => profile[k] !== equipped[k]);
  Object.assign(profile, {character: equipped.character, board: equipped.board, wing: equipped.wing, hat: equipped.hat});
  if (changed) document.dispatchEvent(new CustomEvent('surf:appearance'));
}

export async function refresh() {
  try {
    const me = await api('/api/me');
    Object.assign(state, {loaded: true, authenticated: !!me.authenticated, providers: me.providers || state.providers, payments: me.payments || state.payments});
    if (me.authenticated) {
      Object.assign(state, {user: me.user, identities: me.identities, wallet: me.wallet, inventory: me.inventory, equipped: me.equipped, csrf: me.csrf});
      profile.nick = me.user.nickname;
      const nick = document.getElementById('nickname');
      if (nick && document.activeElement !== nick) nick.value = me.user.nickname;
      // Primera vez con cuenta: se importa el equipamiento del navegador (solo lo que ya puede usar).
      if (!me.user.localMigrated) {
        try {
          const migrated = await api('/api/account/migrate-local', {method: 'POST', body: {character: profile.character, board: profile.board, wing: profile.wing}});
          state.user.localMigrated = true; state.equipped = migrated.equipped;
        } catch {}
      }
      applyEquipment(state.equipped);
    } else {
      Object.assign(state, {user: null, identities: [], wallet: {NORMAL_COIN: 0, GOLD_COIN: 0}, inventory: [], equipped: null, csrf: null});
    }
  } catch {
    state.loaded = true;   // sin servidor de cuentas se sigue pudiendo jugar como invitado
  }
  emit();
  return state;
}

export const login = provider => { location.href = `/auth/${provider}/start?mode=login`; };
export const link = provider => { location.href = `/auth/${provider}/start?mode=link`; };
export async function logout() {
  try { await api('/auth/logout', {method: 'POST', body: {}}); } catch {}
  await refresh();
}
export async function unlink(provider) { const r = await api('/api/account/unlink', {method: 'POST', body: {provider}}); state.identities = r.identities; emit(); }
export async function setNickname(nickname) { const r = await api('/api/account/nickname', {method: 'POST', body: {nickname}}); state.user.nickname = profile.nick = r.nickname; emit(); document.dispatchEvent(new CustomEvent('surf:appearance')); return r.nickname; }
export const catalog = () => api('/api/shop/catalog');
export async function purchase(itemId, id = requestId()) {
  const r = await api('/api/shop/purchase', {method: 'POST', body: {itemId, requestId: id}});
  state.wallet = r.wallet; state.inventory = [...state.inventory.filter(i => i.itemId !== itemId), {itemId, source: 'PURCHASE'}]; emit();
  return r;
}
export async function equip(itemId) {
  const r = await api('/api/shop/equip', {method: 'POST', body: {itemId}});
  state.equipped = r.equipped; applyEquipment(r.equipped); emit();
  return r.equipped;
}
export const packages = () => api('/api/coins/packages');
export async function exchange(packageId, id = requestId()) {
  const r = await api('/api/coins/exchange', {method: 'POST', body: {packageId, requestId: id}});
  state.wallet = r.wallet; emit();
  return r;
}
export const transactions = (limit = 30) => api('/api/wallet/transactions?limit=' + limit);
export const goldProducts = () => api('/api/payments/products');

// Formato de saldos: 2,500 (enteros, sin decimales).
export const formatCoins = n => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('en-US');
export const COIN_ICONS = {NORMAL_COIN: '/assets/images/currency/tabla-normal.svg', GOLD_COIN: '/assets/images/currency/tabla-oro.svg'};
export const COIN_NAMES = {NORMAL_COIN: 'Tablas Normales', GOLD_COIN: 'Tablas de Oro'};
export const providerName = p => PROVIDER_NAMES[p] || p;

// Vuelta del proveedor: ?auth=ok|linked · ?auth_error=codigo. Se lee una vez y se limpia la URL.
export function consumeAuthRedirect() {
  const params = new URLSearchParams(location.search);
  const result = params.get('auth'), error = params.get('auth_error'), provider = params.get('provider');
  if (!result && !error) return null;
  for (const key of ['auth', 'auth_error', 'provider', 'new']) params.delete(key);
  history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
  if (error) return {ok: false, text: message(error), code: error, provider};
  if (result === 'linked') return {ok: true, text: `${providerName(provider)} vinculado a tu cuenta.`, provider};
  return {ok: true, text: `Sesión iniciada con ${providerName(provider)}.`, provider};
}

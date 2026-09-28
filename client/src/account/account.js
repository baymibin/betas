// Cuenta de Surf Salvaje en el navegador. El servidor es la única autoridad: aquí solo se
// pide el estado (/api/me) y se envían acciones; saldos, precios y propiedad llegan del backend.
// Sin sesión se juega como invitado (nick y equipamiento gratuito guardados en el navegador).
import {profile} from '../ui/shop.js';

const state = {loaded: false, authenticated: false, providers: {google: false, discord: false}, payments: {enabled: false}, links: {discord: null},
  user: null, identities: [], wallet: {NORMAL_COIN: 0, GOLD_COIN: 0}, inventory: [], equipped: null, csrf: null, tradeCode: null};
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
  product_not_found: 'Ese paquete ya no existe.',
  product_unavailable: 'Ese paquete todavía no está a la venta.',
  too_many_open_orders: 'Tienes varios pagos sin terminar. Espera un poco antes de empezar otro.',
  paypal_unavailable: 'PayPal no responde ahora mismo. Inténtalo en unos minutos.',
  order_not_found: 'No se encontró ese pago.',
  rate_limited: 'Demasiados intentos. Espera un momento.',
  csrf_failed: 'La sesión no es válida. Recarga la página.',
  invalid_nickname: 'Ese nick no es válido.',
  trade_disabled: 'El Trade está desactivado en este momento.',
  account_too_new: 'Tu cuenta es muy nueva: podrás hacer trades en unas horas.',
  invalid_code: 'Ese código de surfista no es válido (ej.: SURF-4F7KQ).',
  user_not_found: 'No hay ningún surfista con ese código.',
  trade_self: 'No puedes hacer un trade contigo mismo.',
  trade_blocked: 'No puedes hacer trades con este surfista.',
  invalid_items: 'Elige al menos un item en cada lado (máximo 4).',
  item_not_tradeable: 'Ese item no se puede intercambiar.',
  not_owned: 'Uno de los items ya no está en el inventario de su dueño.',
  too_many_offers: 'Tienes demasiadas ofertas abiertas. Cancela alguna antes.',
  offer_exists: 'Ya enviaste esa misma oferta a este surfista.',
  offer_not_found: 'Esa oferta ya no existe.',
  offer_closed: 'Esa oferta ya no está abierta.',
  offer_changed: 'La oferta cambió. Vuelve a revisarla.',
  offer_expired: 'La oferta caducó.',
  items_changed: 'Los items de la oferta cambiaron de dueño: ya no es válida.',
  daily_trade_limit: 'Se alcanzó el máximo de trades por hoy.',
  listing_not_found: 'Esa publicación ya no existe.',
  listing_closed: 'Esa publicación ya no está disponible.',
  listing_exists: 'Ya tienes publicada esa misma oferta.',
  too_many_listings: 'Tienes demasiadas publicaciones abiertas. Retira alguna antes.',
  network: 'Sin conexión con el servidor.',
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
    Object.assign(state, {loaded: true, authenticated: !!me.authenticated, providers: me.providers || state.providers, payments: me.payments || state.payments, links: me.links || state.links});
    if (me.authenticated) {
      Object.assign(state, {user: me.user, identities: me.identities, wallet: me.wallet, inventory: me.inventory, equipped: me.equipped, csrf: me.csrf, tradeCode: me.tradeCode || null});
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
      Object.assign(state, {user: null, identities: [], wallet: {NORMAL_COIN: 0, GOLD_COIN: 0}, inventory: [], equipped: null, csrf: null, tradeCode: null});
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
// Crea la orden de PayPal en el servidor (precio del servidor) y devuelve {orderId, approveUrl}.
export const checkout = productId => api('/api/payments/checkout', {method: 'POST', body: {productId}});
export const orderStatus = orderId => api('/api/payments/orders/' + encodeURIComponent(orderId));

// ---------- Trade (items por items, solo con cuenta). El servidor valida todo. ----------
export const trade = {
  summary: () => api('/api/trade/summary'),
  inventory: () => api('/api/trade/inventory'),
  user: code => api('/api/trade/user?code=' + encodeURIComponent(code)),
  offers: box => api('/api/trade/offers?box=' + box),
  blocked: () => api('/api/trade/blocked'),
  create: ({toCode, offer, request, parentId = null, listingId = null}, id = requestId()) => api('/api/trade/offers', {method: 'POST', body: {toCode, offer, request, parentId, listingId, requestId: id}}),
  listings: (mine = false) => api('/api/trade/listings' + (mine ? '?mine=1' : '')),
  publish: ({offer, want}, id = requestId()) => api('/api/trade/listings', {method: 'POST', body: {offer, want, requestId: id}}),
  withdrawListing: listingId => api('/api/trade/listings/withdraw', {method: 'POST', body: {listingId}}),
  async accept(offerId, contentHash) {
    const r = await api('/api/trade/accept', {method: 'POST', body: {offerId, contentHash}});
    await refresh();   // cambian inventario y equipamiento
    return r;
  },
  decline: offerId => api('/api/trade/decline', {method: 'POST', body: {offerId}}),
  cancel: offerId => api('/api/trade/cancel', {method: 'POST', body: {offerId}}),
  block: code => api('/api/trade/block', {method: 'POST', body: {code}}),
  unblock: code => api('/api/trade/unblock', {method: 'POST', body: {code}})
};

// Formato de saldos: 2,500 (enteros, sin decimales).
export const formatCoins = n => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('en-US');
export const COIN_ICONS = {NORMAL_COIN: '/assets/images/currency/tabla-normal.svg', GOLD_COIN: '/assets/images/currency/tabla-oro.svg'};
export const COIN_NAMES = {NORMAL_COIN: 'Tablas Normales', GOLD_COIN: 'Tablas de Oro'};
export const providerName = p => PROVIDER_NAMES[p] || p;
// Avatar por defecto (cuenta sin foto o invitado).
export const DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#0b4b5e"/><circle cx="24" cy="19" r="8" fill="#5ce8f0"/><path d="M9 44c1-9 7-14 15-14s14 5 15 14" fill="#5ce8f0"/></svg>');

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

// Perfil "Mi surfer". Un único modal para invitado y cuenta: la columna izquierda (escena 3D,
// nick y datos de identidad) es la misma; la derecha cambia según haya sesión.
// Todo sale de datos reales: equipo del perfil (sincronizado con la cuenta), /api/me y el
// historial del servidor. La escena 3D reutiliza createShopPreview de La tiendita.
import {account, login, link, logout, unlink, setNickname, transactions, message, formatCoins, COIN_ICONS, COIN_NAMES, providerName, DEFAULT_AVATAR} from './account.js';
import {profile, saveProfile, characters, boards, wings, wingFiles} from '../ui/shop.js';
import {createShopPreview} from '../ui/shop-preview.js';
import {previewSvg} from '../characters/stick-avatar.js';
import {boardSkins} from '../shared/board-cosmetics.js';
import {catalogItems} from '../shared/catalog.js';

const $ = id => document.getElementById(id);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const dialog = $('profile-dialog');
const preview = createShopPreview($('profile-preview-canvas'));
const ITEM_NAMES = new Map(catalogItems().map(i => [i.id, i.name]));
const TYPE_NAMES = {RACE_REWARD: 'Recompensa de carrera', ITEM_PURCHASE: 'Compra en La tiendita', GOLD_EXCHANGE: 'Conversión de moneda', GOLD_CREDIT: 'Tablas de Oro acreditadas', GOLD_REFUND: 'Reembolso', ADMIN_ADJUSTMENT: 'Ajuste administrativo'};

// ---------- Iconos (SVG en línea, sin peticiones extra) ----------
const ICON = {
  google: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
  discord: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#ffffff" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.011c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.332-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.332-.946 2.418-2.157 2.418Z"/></svg>',
  chevron: '<svg class="pf-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 5.4 10 4l8 8-8 8-1.4-1.4 6.6-6.6z"/></svg>',
  coin: '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="pfc" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff6c4"/><stop offset=".45" stop-color="#ffc93a"/><stop offset="1" stop-color="#d87b00"/></radialGradient></defs><circle cx="32" cy="34" r="26" fill="#a85a00"/><circle cx="32" cy="31" r="26" fill="url(#pfc)"/><circle cx="32" cy="31" r="19" fill="none" stroke="#fff3b0" stroke-width="2.5" opacity=".7"/><path d="M35 15 22 34h9l-3 15 14-20h-9z" fill="#fffbe6" stroke="#b86200" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  backpack: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M24 12a8 8 0 0 1 16 0v4h-4v-4a4 4 0 0 0-8 0v4h-4z" fill="#1c6fc9"/><rect x="12" y="16" width="40" height="42" rx="12" fill="#2f8ff0"/><rect x="12" y="16" width="40" height="18" rx="10" fill="#5fb2ff"/><rect x="20" y="36" width="24" height="16" rx="5" fill="#1c6fc9"/><rect x="28" y="33" width="8" height="6" rx="2" fill="#dff1ff"/><rect x="6" y="30" width="8" height="18" rx="4" fill="#1c6fc9"/><rect x="50" y="30" width="8" height="18" rx="4" fill="#1c6fc9"/></svg>',
  monitor: '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="10" width="52" height="34" rx="5" fill="#e8f7ff"/><rect x="10" y="14" width="44" height="26" rx="2" fill="#35b8f5"/><path d="M10 40 40 14h14v8L24 40z" fill="#6fd3ff" opacity=".6"/><path d="M26 44h12l2 8H24z" fill="#b8d9ea"/><rect x="18" y="52" width="28" height="4" rx="2" fill="#e8f7ff"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4.6 4.6 0 1 0 0-9.2 4.6 4.6 0 0 0 0 9.2Zm0 2.2c-4.5 0-8.2 2.6-8.2 5.9V21h16.4v-.9c0-3.3-3.7-5.9-8.2-5.9Z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M10 8.5v7l5.5-3.5z" fill="currentColor"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 10.1A7 7 0 0 0 6.3 8.1 5.5 5.5 0 0 0 6.5 19h12.5a4.5 4.5 0 0 0 .4-8.9Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/></svg>',
  cap: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 40c0-14 10-26 24-26s24 10 24 24v4H8z" fill="#a9bcc4"/><path d="M8 42h36c8 0 14 2 16 6-12 2-40 2-52 0z" fill="#8aa0aa"/><path d="M30 14h4v6h-4z" fill="#8aa0aa"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="#cfe6ee" stroke-width="2"/><path d="M12 7v5l3.5 2" fill="none" stroke="#cfe6ee" stroke-width="2" stroke-linecap="round"/></svg>'
};

// ---------- Columna izquierda (común) ----------
const look = () => ({character: profile.character | 0, board: profile.board | 0, wing: profile.wing | 0, hat: profile.hat | 0});
function renderLeft() {
  const eq = look();
  $('profile-name').textContent = (account.authenticated ? account.user.nickname : profile.nick) || 'Surfer';
  $('profile-style').textContent = [characters[eq.character], boards[eq.board], wings[eq.wing] ? wings[eq.wing] + ' Wings' : null].filter(Boolean).join(' · ');
  $('profile-avatar').src = (account.authenticated && account.user.avatarUrl) || DEFAULT_AVATAR;
  const input = $('profile-nick');
  if (document.activeElement !== input) input.value = (account.authenticated ? account.user.nickname : profile.nick) || '';
  $('profile-nick-save').textContent = account.authenticated ? 'Guardar' : 'Guardar nombre';
  const id = $('profile-id');
  id.hidden = !account.authenticated;
  if (account.authenticated) {
    id.innerHTML = `<span>ID Surf Salvaje: ${escapeHtml(account.user.id)}</span><button type="button" aria-label="Copiar ID" title="Copiar ID">${ICON.copy}</button>`;
    id.querySelector('button').onclick = () => navigator.clipboard?.writeText(account.user.id);
  }
}
// Un solo nick: con cuenta se guarda en el servidor; como invitado, en el navegador (el mismo
// que usa el campo "TU NICK" del menú).
$('profile-nick-save').onclick = async () => {
  const value = $('profile-nick').value.trim();
  if (!value) return;
  const button = $('profile-nick-save');
  button.disabled = true;
  try {
    if (account.authenticated) await setNickname(value);
    else { profile.nick = value.slice(0, 16); saveProfile(); document.dispatchEvent(new CustomEvent('surf:appearance')); }
    const home = $('nickname'); if (home) home.value = account.authenticated ? account.user.nickname : profile.nick;
    renderLeft();
  } catch (e) { alert(message(e.code)); }
  finally { button.disabled = false; }
};
$('profile-nick').addEventListener('keydown', e => { if (e.key === 'Enter') $('profile-nick-save').click(); });

// ---------- Columna derecha: invitado (imagen A) ----------
function renderGuest(box) {
  const off = p => account.loaded && !account.providers[p];
  box.innerHTML = `
    <div class="pf-card pf-guest">
      <h3>GUARDA TU PROGRESO</h3>
      <p>Juegas como invitado. Inicia sesión para guardar tu estilo, monedas e inventario en tu cuenta.</p>
      <button type="button" class="pf-provider-btn google${off('google') ? ' is-unconfigured' : ''}" data-login="google"><span class="pf-logo">${ICON.google}</span>Continuar con Google${ICON.chevron}</button>
      <button type="button" class="pf-provider-btn discord${off('discord') ? ' is-unconfigured' : ''}" data-login="discord"><span class="pf-logo">${ICON.discord}</span>Continuar con Discord${ICON.chevron}</button>
      <p class="pf-message" id="pf-message" role="status"></p>
      <div class="pf-benefits">
        <div class="pf-benefit">${ICON.coin}<strong>Guarda monedas</strong><small>Tu progreso siempre contigo.</small></div>
        <div class="pf-benefit">${ICON.backpack}<strong>Recupera inventario</strong><small>No pierdas tus tablas, wings y hats.</small></div>
        <div class="pf-benefit">${ICON.monitor}<strong>Accede desde cualquier PC</strong><small>Juega en todos tus dispositivos.</small></div>
      </div>
      <div class="pf-guest-note">${ICON.user}<div><b>MODO INVITADO</b><span>Tu estilo se guarda solo en este navegador.<br>Inicia sesión para sincronizar tu progreso en tu cuenta.</span></div></div>
    </div>`;
  box.querySelectorAll('[data-login]').forEach(button => button.onclick = () => {
    const p = button.dataset.login;
    if (off(p)) { $('pf-message').textContent = `El acceso con ${providerName(p)} todavía no está configurado en este servidor.`; return; }
    login(p);
  });
}

// ---------- Columna derecha: cuenta (imagen B) ----------
const equipArt = (slot, index) => slot === 'character' ? previewSvg(index, index)
  : slot === 'board' ? `<img src="${escapeHtml(boardSkins[index]?.file || '')}" alt="">`
  : slot === 'wing' ? `<span class="wing" style="background-image:url('/assets/images/wings/${escapeHtml(wingFiles[index] || '')}')"></span>`
  : `<span class="hat">${ICON.cap}</span>`;
async function renderAccount(box) {
  const eq = look(), linked = new Map(account.identities.map(i => [i.provider, i]));
  const providerRow = p => {
    const who = linked.get(p);
    const action = who
      ? (account.identities.length > 1 ? `<button type="button" class="pf-link-btn" data-unlink="${p}">Desvincular</button>` : `<span class="pf-link-btn is-main">${ICON.check}Acceso principal</span>`)
      : `<button type="button" class="pf-link-btn" data-link="${p}" ${account.providers[p] ? '' : 'disabled title="Sin configurar en el servidor"'}>Vincular ${providerName(p)}</button>`;
    return `<div class="pf-provider-row"><span class="pf-picon ${p}">${ICON[p]}</span><span class="pf-pname">${providerName(p)}${who ? ` <small>· vinculado como ${escapeHtml(who.displayName || '—')}</small>` : ''}</span>${action}</div>`;
  };
  const slots = [['character', characters[eq.character]], ['board', boards[eq.board]], ['wing', wings[eq.wing] ? wings[eq.wing] + ' Wings' : ''], ['hat', null]];
  box.innerHTML = `
    <section class="pf-card"><h3 class="pf-section-title">MONEDERO</h3><div class="pf-wallet">
      ${['NORMAL_COIN', 'GOLD_COIN'].map(c => `<div class="pf-coin${c === 'GOLD_COIN' ? ' gold' : ''}"><img src="${COIN_ICONS[c]}" alt=""><span><small>${COIN_NAMES[c]}</small><b>${formatCoins(account.wallet[c])}</b></span></div>`).join('')}
    </div></section>
    <section class="pf-card"><h3 class="pf-section-title">ACCESOS VINCULADOS</h3><div class="pf-providers">${providerRow('google')}${providerRow('discord')}</div></section>
    <section class="pf-card"><h3 class="pf-section-title">EQUIPAMIENTO</h3><div class="pf-equipment">
      ${slots.map(([slot, name]) => slot === 'hat' && !eq.hat
        ? `<div class="pf-eq is-empty"><div class="pf-eq-art">${equipArt('hat', 0)}</div><strong>Sin hat</strong></div>`
        : `<div class="pf-eq"><div class="pf-eq-art">${equipArt(slot, eq[slot])}</div><strong>${escapeHtml(name)}</strong><em>ACTIVO</em></div>`).join('')}
    </div></section>
    <section class="pf-card"><h3 class="pf-section-title">INVENTARIO</h3>${account.inventory.length
      ? `<div class="pf-inventory">${account.inventory.map(i => `<span class="pf-chip">${escapeHtml(ITEM_NAMES.get(i.itemId) || i.itemId)}</span>`).join('')}<button type="button" data-open-shop>Ver en La tiendita</button></div>`
      : `<div class="pf-row-note">${ICON.backpack}<span>Los artículos gratuitos están disponibles para todos.<br>Lo que compres en La tiendita aparecerá aquí.</span></div>`}</section>
    <section class="pf-card"><h3 class="pf-section-title">HISTORIAL</h3><ul class="pf-history" id="pf-history"><li>${ICON.clock}<span>Cargando movimientos...</span></li></ul></section>`;
  box.querySelectorAll('[data-link]').forEach(b => b.onclick = () => link(b.dataset.link));
  box.querySelectorAll('[data-unlink]').forEach(b => b.onclick = async () => {
    if (!confirm(`¿Desvincular ${providerName(b.dataset.unlink)}? Podrás volver a vincularlo desde aquí.`)) return;
    try { await unlink(b.dataset.unlink); } catch (e) { alert(message(e.code)); }
  });
  box.querySelector('[data-open-shop]')?.addEventListener('click', openShop);
  try {
    const {transactions: list} = await transactions(20);
    const history = $('pf-history');
    if (!history) return;
    history.innerHTML = list.length ? list.map(t => `<li>${ICON.clock}<span>${escapeHtml(TYPE_NAMES[t.type] || t.type)}${t.description ? ' · ' + escapeHtml(t.description) : ''}</span>
        <time datetime="${escapeHtml(t.createdAt)}">${escapeHtml(String(t.createdAt).slice(0, 10))}</time>
        <b class="amount ${t.amount > 0 ? 'plus' : 'minus'}"><img src="${COIN_ICONS[t.currency]}" alt="${COIN_NAMES[t.currency]}">${t.amount > 0 ? '+' : '−'}${formatCoins(Math.abs(t.amount))}</b></li>`).join('')
      : `<li>${ICON.clock}<span>Aún no hay movimientos.</span></li>`;
  } catch { const h = $('pf-history'); if (h) h.innerHTML = `<li>${ICON.clock}<span>No se pudo cargar el historial.</span></li>`; }
}

// ---------- Pie ----------
function openShop() { dialog.close(); $('shop-btn').click(); }
function renderFooter() {
  const secondary = $('profile-secondary'), note = $('profile-note');
  if (account.authenticated) {
    secondary.className = 'profile-secondary is-logout';
    secondary.innerHTML = `${ICON.logout}Cerrar sesión`;
    secondary.onclick = async () => { await logout(); };
    note.innerHTML = `${ICON.cloud}Tu cuenta guarda monedas, inventario y equipamiento: los recuperas en cualquier PC.`;
  } else {
    secondary.className = 'profile-secondary';
    secondary.innerHTML = `${ICON.play}Practicar en solitario`;
    secondary.onclick = () => { dialog.close(); $('practice-btn').click(); };
    note.innerHTML = `${ICON.info}Tu progreso de invitado se guarda solo en este navegador. Inicia sesión para sincronizarlo.`;
  }
}

function render() {
  renderLeft();
  renderFooter();
  const box = $('account-profile');
  box.classList.toggle('is-guest', !account.authenticated);
  if (account.authenticated) renderAccount(box); else renderGuest(box);
}

$('home-profile').onclick = () => {
  render();
  dialog.showModal();
  preview.open(look());
};
dialog.addEventListener('close', () => preview.close());
// Cambios de sesión o de equipamiento con el perfil abierto: se refleja al momento.
document.addEventListener('surf:account', () => { if (dialog.open) render(); });
document.addEventListener('surf:appearance', () => { if (!dialog.open) return; renderLeft(); preview.update(look()); });

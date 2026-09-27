// Menú principal (panel de acceso) y Perfil de la cuenta.
// Botones reales: "Continuar con Google" y "Continuar con Discord" abren el flujo oficial del
// proveedor a través del servidor. Sin sesión se sigue jugando como invitado.
import {account, refresh, login, link, logout, unlink, setNickname, transactions, consumeAuthRedirect, message,
  formatCoins, COIN_ICONS, COIN_NAMES, providerName} from './account.js';
import {profile, characters, boards, wings} from '../ui/shop.js';
import {previewSvg} from '../characters/stick-avatar.js';

const $ = id => document.getElementById(id);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#0b4b5e"/><circle cx="24" cy="19" r="8" fill="#5ce8f0"/><path d="M9 44c1-9 7-14 15-14s14 5 15 14" fill="#5ce8f0"/></svg>');
const TYPE_NAMES = {RACE_REWARD: 'Recompensa de carrera', ITEM_PURCHASE: 'Compra en La tiendita', GOLD_EXCHANGE: 'Conversión de oro', GOLD_CREDIT: 'Compra de Tablas de Oro', GOLD_REFUND: 'Reembolso', ADMIN_ADJUSTMENT: 'Ajuste administrativo'};

function say(text, error = false) {
  const el = $('auth-message');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', !!error);
}

// ---------- Panel del menú ----------
function renderHome() {
  const signed = account.authenticated;
  $('auth-guest').hidden = signed;
  $('auth-user').hidden = !signed;
  $('auth-divider').querySelector('span').textContent = signed ? 'TU CUENTA' : 'O CONTINÚA CON';
  // Los botones mantienen su aspecto; si el servidor aún no tiene credenciales de ese
  // proveedor, al pulsar se explica en vez de abrir un login que no puede funcionar.
  for (const provider of ['google', 'discord']) {
    const off = account.loaded && !account.providers[provider];
    $('login-' + provider).classList.toggle('is-unconfigured', off);
    $('login-' + provider).setAttribute('aria-disabled', String(off));
  }
  if (!signed) return;
  $('auth-avatar').src = account.user.avatarUrl || DEFAULT_AVATAR;
  $('auth-name').textContent = account.user.nickname;
  $('auth-via').textContent = 'Con ' + account.identities.map(i => providerName(i.provider)).join(' y ');
  $('auth-normal').textContent = formatCoins(account.wallet.NORMAL_COIN);
  $('auth-gold').textContent = formatCoins(account.wallet.GOLD_COIN);
}

for (const provider of ['google', 'discord']) $('login-' + provider).onclick = () => {
  if (account.loaded && !account.providers[provider]) return say(`El acceso con ${providerName(provider)} todavía no está configurado en este servidor (faltan sus credenciales).`, true);
  say(`Abriendo ${providerName(provider)}...`);
  login(provider);
};
$('auth-logout').onclick = async () => { await logout(); say('Sesión cerrada. Sigues pudiendo jugar como invitado.'); };
$('auth-open-profile').onclick = () => $('home-profile').click();

// Con sesión, el nick es el de la cuenta: se guarda en el servidor al terminar de escribir.
const nickInput = $('nickname');
let nickTimer = 0;
nickInput.addEventListener('input', () => {
  if (!account.authenticated) return;
  clearTimeout(nickTimer);
  nickTimer = setTimeout(async () => {
    const value = nickInput.value.trim();
    if (!value || value === account.user.nickname) return;
    try { await setNickname(value); say('Nick guardado en tu cuenta.'); }
    catch (e) { say(message(e.code), true); }
  }, 700);
});

// ---------- Perfil ----------
const profileDialog = $('profile-dialog');
function renderProfileBasics() {
  $('profile-preview').innerHTML = previewSvg(profile.character, profile.board);
  $('profile-name').textContent = profile.nick || 'Surfer';
  $('profile-style').textContent = characters[profile.character] + ' · ' + boards[profile.board] + (wings[profile.wing] ? ' · ' + wings[profile.wing] + ' Wings' : '');
}
async function renderProfile() {
  renderProfileBasics();
  const box = $('account-profile');
  if (!account.authenticated) {
    $('profile-note').textContent = 'Juegas como invitado: tu estilo se guarda en este navegador. Inicia sesión para guardar tu progreso, tus monedas y tu inventario en tu cuenta.';
    box.innerHTML = `<section class="account-section"><h3>GUARDA TU PROGRESO</h3><div class="account-providers">
      ${['google', 'discord'].map(p => `<div class="account-provider"><span>${providerName(p)}</span><button type="button" data-login="${p}" ${account.providers[p] ? '' : 'disabled title="Sin configurar en el servidor"'}>Continuar con ${providerName(p)}</button></div>`).join('')}
      </div></section>`;
    box.querySelectorAll('[data-login]').forEach(b => b.onclick = () => login(b.dataset.login));
    return;
  }
  $('profile-note').textContent = 'Tu cuenta guarda monedas, inventario y equipamiento: los recuperas en cualquier PC.';
  const u = account.user, linked = new Map(account.identities.map(i => [i.provider, i]));
  box.innerHTML = `
    <div class="account-head"><img src="${escapeHtml(u.avatarUrl || DEFAULT_AVATAR)}" alt="" referrerpolicy="no-referrer">
      <div><div class="account-nick"><input id="profile-nick" maxlength="16" value="${escapeHtml(u.nickname)}" aria-label="Nickname"><button type="button" id="profile-nick-save">Guardar</button></div>
      <div class="account-id">ID Surf Salvaje: ${escapeHtml(u.id)}</div></div></div>
    <section class="account-section"><h3>MONEDERO</h3><div class="account-wallet">
      ${['NORMAL_COIN', 'GOLD_COIN'].map(c => `<span class="coin-chip${c === 'GOLD_COIN' ? ' gold' : ''}"><img src="${COIN_ICONS[c]}" alt="">${COIN_NAMES[c]}: <b>${formatCoins(account.wallet[c])}</b></span>`).join('')}
    </div></section>
    <section class="account-section"><h3>ACCESOS VINCULADOS</h3><div class="account-providers">
      ${['google', 'discord'].map(p => linked.has(p)
        ? `<div class="account-provider"><span>${providerName(p)} <span class="linked">· vinculado como ${escapeHtml(linked.get(p).displayName || '—')}</span></span>${account.identities.length > 1 ? `<button type="button" data-unlink="${p}">Desvincular</button>` : '<span class="linked">Acceso principal</span>'}</div>`
        : `<div class="account-provider"><span>${providerName(p)}</span><button type="button" data-link="${p}" ${account.providers[p] ? '' : 'disabled title="Sin configurar en el servidor"'}>Vincular ${providerName(p)}</button></div>`).join('')}
    </div></section>
    <section class="account-section"><h3>EQUIPAMIENTO</h3><p>${escapeHtml(characters[profile.character])} · ${escapeHtml(boards[profile.board])} · ${escapeHtml(wings[profile.wing] || '')} Wings · ${profile.hat ? 'Hat ' + profile.hat : 'Sin hat'}</p></section>
    <section class="account-section"><h3>INVENTARIO</h3>${account.inventory.length
      ? `<ul class="account-list">${account.inventory.map(i => `<li><span>${escapeHtml(i.itemId)}</span><span>${escapeHtml(i.source)}</span></li>`).join('')}</ul>`
      : '<p>Los artículos gratuitos están disponibles para todos. Lo que compres en La tiendita aparecerá aquí.</p>'}</section>
    <section class="account-section"><h3>HISTORIAL</h3><ul class="account-list" id="profile-history"><li>Cargando...</li></ul></section>
    <div class="account-actions"><button type="button" class="danger" id="profile-logout">Cerrar sesión</button></div>`;
  box.querySelectorAll('[data-link]').forEach(b => b.onclick = () => link(b.dataset.link));
  box.querySelectorAll('[data-unlink]').forEach(b => b.onclick = async () => {
    try { await unlink(b.dataset.unlink); renderProfile(); } catch (e) { alert(message(e.code)); }
  });
  $('profile-nick-save').onclick = async () => {
    try { await setNickname($('profile-nick').value); renderProfileBasics(); nickInput.value = account.user.nickname; } catch (e) { alert(message(e.code)); }
  };
  $('profile-logout').onclick = async () => { await logout(); profileDialog.close(); };
  try {
    const {transactions: list} = await transactions(20);
    $('profile-history').innerHTML = list.length ? list.map(t => `<li><span>${escapeHtml(TYPE_NAMES[t.type] || t.type)}${t.description ? ' · ' + escapeHtml(t.description) : ''}</span>
      <span class="${t.amount > 0 ? 'plus' : 'minus'} coin-inline"><img src="${COIN_ICONS[t.currency]}" alt="${COIN_NAMES[t.currency]}">${t.amount > 0 ? '+' : '−'}${formatCoins(Math.abs(t.amount))}</span></li>`).join('')
      : '<li>Aún no hay movimientos.</li>';
  } catch { $('profile-history').innerHTML = '<li>No se pudo cargar el historial.</li>'; }
}
$('home-profile').onclick = () => { renderProfile(); profileDialog.showModal(); };

document.addEventListener('surf:account', () => { renderHome(); if (profileDialog.open) renderProfile(); });
// Al terminar una carrera el servidor puede haber dado una recompensa: se refresca el saldo.
document.addEventListener('surf:menu', () => { if (account.authenticated) refresh(); });

const redirect = consumeAuthRedirect();
if (redirect) say(redirect.text, !redirect.ok);
renderHome();
refresh();

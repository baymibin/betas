// Menú principal (panel de acceso) y Perfil de la cuenta.
// Botones reales: "Continuar con Google" y "Continuar con Discord" abren el flujo oficial del
// proveedor a través del servidor. Sin sesión se sigue jugando como invitado.
import {account, refresh, login, logout, setNickname, consumeAuthRedirect, message, formatCoins, providerName, DEFAULT_AVATAR} from './account.js';
import './profile-ui.js';

const $ = id => document.getElementById(id);

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

// El Perfil (invitado y cuenta) vive en profile-ui.js.
document.addEventListener('surf:account', renderHome);
// Al terminar una carrera el servidor puede haber dado una recompensa: se refresca el saldo.
document.addEventListener('surf:menu', () => { if (account.authenticated) refresh(); });

const redirect = consumeAuthRedirect();
if (redirect) say(redirect.text, !redirect.ok);
renderHome();
refresh();

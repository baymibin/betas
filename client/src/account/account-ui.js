// Menú principal (panel de acceso) y Perfil de la cuenta.
// Botones reales: "Continuar con Google" y "Continuar con Discord" abren el flujo oficial del
// proveedor a través del servidor. Sin sesión se sigue jugando como invitado.
import {account, refresh, login, logout, setNickname, consumeAuthRedirect, message, providerName} from './account.js';
import './profile-ui.js';
import './trade-ui.js';

const $ = id => document.getElementById(id);

function say(text, error = false) {
  const el = $('auth-message');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', !!error);
}

// ---------- Panel del menú ----------
// En la caja de JUGAR solo quedan "Jugar en solitario" y, con sesión, "Cerrar sesión". Los botones
// de Google y Discord viven abajo a la izquierda y solo se ven sin sesión.
function renderHome() {
  const signed = account.authenticated;
  $('auth-guest').hidden = signed;
  $('auth-logout').hidden = !signed;
  // Los botones mantienen su aspecto; si el servidor aún no tiene credenciales de ese
  // proveedor, al pulsar se explica en vez de abrir un login que no puede funcionar.
  for (const provider of ['google', 'discord']) {
    const off = account.loaded && !account.providers[provider];
    $('login-' + provider).classList.toggle('is-unconfigured', off);
    $('login-' + provider).setAttribute('aria-disabled', String(off));
  }
  const discord = $('home-discord');
  discord.href = account.links?.discord || '#';
  discord.classList.toggle('is-unconfigured', !account.links?.discord);
}

for (const provider of ['google', 'discord']) $('login-' + provider).onclick = () => {
  if (account.loaded && !account.providers[provider]) return say(`El acceso con ${providerName(provider)} todavía no está configurado en este servidor (faltan sus credenciales).`, true);
  say(`Abriendo ${providerName(provider)}...`);
  login(provider);
};
$('auth-logout').onclick = async () => { await logout(); say('Sesión cerrada. Sigues pudiendo jugar como invitado.'); };
// Comunidad de Discord: el enlace lo da el servidor (DISCORD_INVITE_URL en servidor/.env).
$('home-discord').onclick = e => { if (!account.links?.discord) { e.preventDefault(); say('El enlace de la comunidad de Discord todavía no está configurado en el servidor.', true); } };

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

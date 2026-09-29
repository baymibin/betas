// Trade: intercambio de items por items (sin monedas) entre cuentas registradas.
// El navegador solo muestra y pide: qué items tiene cada uno, si la oferta es válida y el
// intercambio en sí los decide el servidor (/api/trade/*). Sin sesión se muestra el acceso.
import {account, trade, catalog, login, message, providerName, DEFAULT_AVATAR} from './account.js';
import {profile} from '../ui/shop.js';
import {createShopPreview} from '../ui/shop-preview.js';
import {previewSvg} from '../characters/stick-avatar.js';
import {boardSkins} from '../shared/board-cosmetics.js';
import {catalogItems, parseItemId, wingFiles} from '../shared/catalog.js';

const $ = id => document.getElementById(id);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const dialog = $('trade-dialog');
const preview = createShopPreview($('trade-preview-canvas'));
const ITEMS = new Map(catalogItems().map(i => [i.id, i]));
const SLOT_NAMES = {character: 'PERSONAJE', board: 'TABLA', wing: 'WINGS', hat: 'HAT'};
const RARITY_NAMES = {common: 'COMÚN', rare: 'RARO', epic: 'ÉPICO', legendary: 'LEGENDARIO'};
const STATUS_NAMES = {COMPLETED: 'Completado', DECLINED: 'Rechazado', CANCELED: 'Cancelado', EXPIRED: 'Caducado', INVALID: 'Ya no válido', COUNTERED: 'Contraofertado', REVERTED: 'Revertido', OPEN: 'Abierto'};
const FILTERS = [['all', 'Todos'], ['character', 'Personajes'], ['board', 'Tablas'], ['wing', 'Wings'], ['hat', 'Hats']];
const TABS = [['new', 'Mis items'], ['public', 'Trades públicos'], ['received', 'Ofertas recibidas'], ['sent', 'Ofertas enviadas'], ['history', 'Historial']];

const ICON = {
  new: '<svg viewBox="0 0 24 24"><path d="M12 12a4.6 4.6 0 1 0 0-9.2 4.6 4.6 0 0 0 0 9.2Zm0 2.2c-4.5 0-8.2 2.6-8.2 5.9V21h16.4v-.9c0-3.3-3.7-5.9-8.2-5.9Z"/></svg>',
  public: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8ZM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4ZM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3Zm.8 2h2.9c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16ZM8 8H5.1a8 8 0 0 1 4.3-3.6C8.8 5.5 8.3 6.7 8 8Zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4Zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4Zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6Zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4Z"/></svg>',
  received: '<svg viewBox="0 0 24 24"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z"/></svg>',
  sent: '<svg viewBox="0 0 24 24"><path d="M2.5 20.5 22 12 2.5 3.5 2.5 10l13 2-13 2z"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm1-13h-2v6l5 3 1-1.7-4-2.3z"/></svg>',
  all: '', character: '<svg viewBox="0 0 24 24"><circle cx="12" cy="4.5" r="2.5"/><path d="M12 8v7m0 0-3.5 6.5M12 15l3.5 6.5M6 10.5l6-1 6 1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  board: '<svg viewBox="0 0 24 24"><path d="M12 1.5c-4 3-5 8-5 11.5s1.4 7 5 9.5c3.6-2.5 5-6 5-9.5S16 4.5 12 1.5Z"/></svg>',
  wing: '<svg viewBox="0 0 24 24"><path d="M11 18C6 18 2 13 1.5 6c3 2 6 2.5 9.5 3Zm2 0c5 0 9-5 9.5-12-3 2-6 2.5-9.5 3Z"/></svg>',
  hat: '<svg viewBox="0 0 24 24"><path d="M3 16c0-5 4-9 9-9s9 4 9 8v1Zm-2 2h22c-1 2-3 2.5-11 2.5S2 20 1 18Z"/></svg>',
  // Colores planos (sin <defs>): un degradado con id dejaría de pintarse si su primera copia está oculta.
  swap: '<svg viewBox="0 0 64 64"><path d="M12 28a20 20 0 0 1 34-12l4-4v14H36l5-5a13 13 0 0 0-22 7z" fill="#3fd0f0"/><path d="M52 36a20 20 0 0 1-34 12l-4 4V38h14l-5 5a13 13 0 0 0 22-7z" fill="#ffbf3a"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 7v10M7 12h10" stroke="#06283a" stroke-width="2.4" stroke-linecap="round"/></svg>',
  plane: '<svg viewBox="0 0 24 24"><path d="M2.5 20.5 22 12 2.5 3.5 2.5 10l13 2-13 2z"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/></svg>',
  lock: '<svg viewBox="0 0 64 64"><rect x="12" y="28" width="40" height="30" rx="8" fill="#ffd46b"/><path d="M20 28v-8a12 12 0 0 1 24 0v8" fill="none" stroke="#ffd46b" stroke-width="6"/><circle cx="32" cy="42" r="5" fill="#7a4a00"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/></svg>'
};

// ---------- Estado ----------
const st = {
  tab: 'new', summary: null, mine: [], partner: null, offer: [], request: [], source: 'mine', filter: 'all',
  focus: null, parentId: null, busy: false, note: '', noteError: false, lists: {}, blocked: [], codeDraft: '',
  // mode: 'direct' = oferta a un surfista · 'public' = publicación en Trades públicos.
  // listing: publicación que se está negociando (la oferta irá enlazada a ella).
  mode: 'direct', listing: null, catalog: [], listings: [], publicMine: false, publicFilter: 'all'
};
const say = (text, error = false) => { st.note = text || ''; st.noteError = error; };
const itemOf = id => ITEMS.get(id);
const slotOf = id => parseItemId(id)?.slot || 'hat';
function art(id) {
  const p = parseItemId(id);
  if (!p) return '';
  if (p.slot === 'character') return previewSvg(p.index, 0);
  if (p.slot === 'board') return `<img src="${escapeHtml(boardSkins[p.index]?.file || '')}" alt="" loading="lazy">`;
  // Las alas son una hoja de 4×2 fotogramas: se muestra el primero, como en La tiendita.
  if (p.slot === 'wing') return `<span class="trade-wing" style="background-image:url('/assets/images/wings/${escapeHtml(wingFiles[p.index] || '')}')"></span>`;
  return ICON.hat;
}
const rarityOf = id => st.rarity?.get(id) || 'common';
const itemName = id => itemOf(id)?.name || id;

// Cantidad de ofertas recibidas en el menú y en la pestaña.
function paintBadge() {
  const n = account.authenticated ? st.summary?.received || 0 : 0;
  const badge = $('home-trade-badge');
  badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n);
}
async function loadSummary() {
  if (!account.authenticated) { st.summary = null; paintBadge(); return; }
  try { st.summary = await trade.summary(); } catch { st.summary = null; }
  paintBadge();
}

// ---------- Cabecera y pestañas ----------
function renderHeader() {
  const box = $('trade-mycode');
  const code = st.summary?.code || account.tradeCode;
  box.innerHTML = account.authenticated && code
    ? `<span class="trade-mycode-label">Tu código de surfista</span><button type="button" class="trade-code-chip" id="trade-copy-code" title="Copiar código">${escapeHtml(code)}${ICON.copy}</button>`
    : '';
  $('trade-copy-code')?.addEventListener('click', e => { navigator.clipboard?.writeText(code); e.currentTarget.classList.add('is-copied'); });
  const tabs = $('trade-tabs');
  tabs.hidden = !account.authenticated;
  tabs.innerHTML = TABS.map(([id, label]) => {
    const n = id === 'received' ? st.summary?.received || 0 : id === 'public' ? st.summary?.publicCount || 0 : 0;
    return `<button type="button" class="trade-tab${st.tab === id ? ' is-active' : ''}" data-tab="${id}" aria-pressed="${st.tab === id}">${ICON[id]}<span>${label}</span>${n ? `<b class="trade-count${id === 'public' ? ' is-info' : ''}">${n > 99 ? '99+' : n}</b>` : ''}</button>`;
  }).join('');
  tabs.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => openTab(b.dataset.tab));
}

// ---------- Sin sesión: acceso con Google o Discord ----------
function renderGate() {
  const box = $('trade-gate'), off = p => account.loaded && !account.providers[p];
  box.innerHTML = `
    <div class="trade-gate-card">
      <div class="trade-gate-icon">${ICON.lock}</div>
      <h3>Solo para surfistas registrados</h3>
      <p>Para intercambiar items necesitas una cuenta: así tus items y tus trades quedan guardados y protegidos.</p>
      <div class="trade-gate-actions">
        ${['google', 'discord'].map(p => `<button type="button" class="auth-btn auth-${p}${off(p) ? ' is-unconfigured' : ''}" data-login="${p}">${$('login-' + p).innerHTML}</button>`).join('')}
      </div>
      <p class="trade-note" id="trade-gate-note" role="status"></p>
    </div>`;
  box.querySelectorAll('[data-login]').forEach(b => b.onclick = () => {
    const p = b.dataset.login;
    if (off(p)) { $('trade-gate-note').textContent = `El acceso con ${providerName(p)} todavía no está configurado en este servidor.`; return; }
    login(p);
  });
}

// ---------- Nuevo trade: columna de items ----------
function sourceItems() {
  if (st.source === 'catalog') {
    const owned = new Set(st.mine.map(i => i.itemId));
    return st.catalog.filter(i => i.tradeable && !owned.has(i.id)).map(i => ({itemId: i.id, tradeable: true, equipped: false, owner: 'catalog'}));
  }
  if (st.source === 'partner') return (st.partner?.items || []).map(id => ({itemId: id, tradeable: true, equipped: false, owner: 'partner'}));
  return st.mine.filter(i => i.tradeable).map(i => ({...i, owner: 'mine'}));
}
function renderItems() {
  const src = $('trade-source');
  src.innerHTML = `<button type="button" class="${st.source === 'mine' ? 'is-active' : ''}" data-source="mine">Tus items</button>` + (st.mode === 'public'
    ? `<button type="button" class="${st.source === 'catalog' ? 'is-active' : ''}" data-source="catalog">Lo que buscas</button>`
    : `<button type="button" class="${st.source === 'partner' ? 'is-active' : ''}" data-source="partner" ${st.partner ? '' : 'disabled title="Busca primero a un surfista por su código"'}>${st.partner ? 'Items de ' + escapeHtml(st.partner.nickname) : 'Sus items'}</button>`);
  src.querySelectorAll('[data-source]').forEach(b => b.onclick = () => { st.source = b.dataset.source; renderItems(); });
  const filters = $('trade-filters');
  filters.innerHTML = FILTERS.map(([id, label]) => `<button type="button" class="${st.filter === id ? 'is-active' : ''}" data-filter="${id}">${ICON[id]}${label}</button>`).join('');
  filters.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { st.filter = b.dataset.filter; renderItems(); });

  const list = sourceItems().filter(i => st.filter === 'all' || slotOf(i.itemId) === st.filter);
  const chosen = new Set(st.source === 'mine' ? st.offer : st.request);
  const catalogTag = st.source === 'catalog' ? '<span class="trade-card-tag">BUSCAR</span>' : '';
  const mineOwned = new Set(st.mine.map(i => i.itemId));
  const grid = $('trade-grid');
  if (!list.length) {
    grid.innerHTML = `<div class="trade-empty">${st.source === 'catalog' ? 'Ya tienes todos los items de este tipo.' : st.source === 'partner'
      ? (st.filter === 'hat' ? 'Los hats llegarán pronto a Surf Club.' : `${escapeHtml(st.partner?.nickname || 'Este surfista')} no tiene items intercambiables${st.filter === 'all' ? '' : ' de este tipo'}.`)
      : (st.filter === 'hat' ? 'Los hats llegarán pronto a Surf Club.' : `Aún no tienes items intercambiables${st.filter === 'all' ? '' : ' de este tipo'}.<small>Los gratuitos (Classic, Ola Tropical, Angel Wings) no se intercambian. Consigue items en La tiendita o en un trade.</small><button type="button" data-open-shop>Ir a La tiendita</button>`)}</div>`;
    grid.querySelector('[data-open-shop]')?.addEventListener('click', () => { dialog.close(); $('shop-btn').click(); });
    return;
  }
  grid.innerHTML = list.map(i => {
    const id = i.itemId, blocked = i.owner === 'partner' && mineOwned.has(id);
    return `<button type="button" class="trade-card rarity-${rarityOf(id)}${chosen.has(id) ? ' is-selected' : ''}${blocked ? ' is-blocked' : ''}${st.focus === id ? ' is-focus' : ''}" data-item="${id}" ${blocked ? 'title="Ya lo tienes"' : ''}>
      ${chosen.has(id) ? `<span class="trade-card-check">${ICON.check}</span>` : ''}${i.equipped ? '<span class="trade-card-tag">EN USO</span>' : ''}${blocked ? '<span class="trade-card-tag">YA LO TIENES</span>' : ''}${chosen.has(id) ? '' : catalogTag}
      <span class="trade-card-art">${art(id)}</span><strong>${escapeHtml(itemName(id))}</strong><small>${SLOT_NAMES[slotOf(id)]}</small></button>`;
  }).join('');
  grid.querySelectorAll('[data-item]').forEach(b => b.onclick = () => toggle(b.dataset.item, st.source));
}
function toggle(id, source) {
  const side = source === 'mine' ? st.offer : st.request, max = st.summary?.limits?.maxItemsPerSide || 4;
  st.focus = id;
  if (source !== 'mine' && st.mine.some(i => i.itemId === id)) { say('Ya tienes ese item.', true); return renderNew(); }
  const at = side.indexOf(id);
  if (at >= 0) side.splice(at, 1);
  else if (side.length >= max) say(`Máximo ${max} items por lado.`, true);
  else { side.push(id); say(''); }
  renderNew();
}

// ---------- Nuevo trade: columna central ----------
function sideHtml(kind) {
  const list = kind === 'offer' ? st.offer : st.request, max = st.summary?.limits?.maxItemsPerSide || 4;
  const cards = list.map(id => `<div class="trade-slot rarity-${rarityOf(id)}${st.focus === id ? ' is-focus' : ''}" data-focus="${id}">
      <button type="button" class="trade-slot-remove" data-remove="${kind}:${id}" aria-label="Quitar ${escapeHtml(itemName(id))}">×</button>
      <span class="trade-card-art">${art(id)}</span><strong>${escapeHtml(itemName(id))}</strong><small>${SLOT_NAMES[slotOf(id)]}</small></div>`).join('');
  const optional = list.length || (kind === 'request' && st.mode === 'public');
  const add = list.length < max ? `<button type="button" class="trade-slot is-add" data-add="${kind}" ${kind === 'request' && st.mode === 'direct' && !st.partner ? 'disabled' : ''}>${ICON.plus}<span>Agregar item<small>${optional ? '(opcional)' : ''}</small></span></button>` : '';
  const n = list.length;
  return `<div class="trade-side"><h4>${kind === 'offer' ? 'Ofreces' : st.mode === 'public' ? 'Buscas' : 'Recibes'}</h4><small>${n} item${n === 1 ? '' : 's'} seleccionado${n === 1 ? '' : 's'}</small><div class="trade-slots">${cards}${add}</div></div>`;
}
function renderBuilder() {
  const box = $('trade-builder'), s = st.summary, pub = st.mode === 'public', fixed = st.parentId || st.listing;
  const partner = st.partner
    ? `<div class="trade-partner"><img src="${escapeHtml(st.partner.avatarUrl || DEFAULT_AVATAR)}" alt="" referrerpolicy="no-referrer"><span><b>${escapeHtml(st.partner.nickname)}</b><small>${escapeHtml(st.partner.code)}</small></span>
        ${fixed ? '' : '<button type="button" id="trade-partner-change">Cambiar</button>'}</div>`
    : `<form class="trade-find" id="trade-find"><label for="trade-code-input">¿Con quién quieres hacer el trade?</label>
        <div><input id="trade-code-input" placeholder="Código de surfista · SURF-XXXXX" maxlength="16" autocomplete="off" spellcheck="false" value="${escapeHtml(st.codeDraft)}"><button type="submit">Buscar</button></div></form>`;
  const notEligible = s && !s.eligible;
  const ready = !st.busy && !notEligible && st.offer.length && (pub || (st.partner && st.request.length));
  const title = st.parentId ? 'Contraoferta' : st.listing ? 'Negociar publicación' : pub ? 'Publicar trade' : 'Nuevo trade';
  const sub = st.parentId ? `Cambia lo que quieras y envíala: la oferta original de ${escapeHtml(st.partner?.nickname || '')} se cerrará.`
    : st.listing ? `Haz tu oferta a ${escapeHtml(st.partner?.nickname || '')} por su publicación. Puedes cambiar lo que pides y lo que das.`
    : pub ? 'Elige lo que ofreces y, si quieres, lo que buscas. Aparecerá en Trades públicos para todos.'
    : 'Selecciona los items que ofrecerás y lo que recibirás.';
  const sendText = st.busy ? 'Enviando...' : st.parentId ? 'Enviar contraoferta' : pub ? 'Publicar trade' : 'Enviar oferta';
  const hint = pub ? 'Nada cambia de dueño hasta que aceptes una de las ofertas que te lleguen.'
    : st.partner ? `${st.partner.nickname} recibirá tu oferta de trade.` : 'Pide su código de surfista al otro jugador (lo ve en su Perfil o aquí arriba).';
  box.innerHTML = `
    ${fixed ? '' : `<div class="trade-mode" role="group" aria-label="Tipo de trade">
      <button type="button" data-mode="direct" class="${pub ? '' : 'is-active'}">${ICON.new}A un surfista</button>
      <button type="button" data-mode="public" class="${pub ? 'is-active' : ''}">${ICON.public}Publicar en el tablón</button></div>`}
    <h3 class="trade-panel-title">${title}</h3>
    <p class="trade-panel-sub">${sub}</p>
    ${fixed ? `<button type="button" class="trade-link" id="trade-discard-counter">${st.parentId ? 'Descartar contraoferta' : 'Descartar negociación'}</button>` : ''}
    ${pub ? '' : partner}
    ${notEligible ? `<p class="trade-warning">${escapeHtml(s.reason === 'account_too_new' ? `Tu cuenta es muy nueva: podrás hacer trades a partir del ${new Date(s.readyAt).toLocaleString()}.` : message(s.reason))}</p>` : ''}
    <div class="trade-sides">${sideHtml('offer')}<span class="trade-swap" aria-hidden="true">${ICON.swap}</span>${sideHtml('request')}</div>
    <button type="button" class="trade-send" id="trade-send" ${ready ? '' : 'disabled'}>${pub ? ICON.public : ICON.plane}${sendText}</button>
    <p class="trade-note${st.noteError ? ' is-error' : ''}" role="status">${escapeHtml(st.note || hint)}</p>`;
  box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    if (st.mode === b.dataset.mode) return;
    Object.assign(st, {mode: b.dataset.mode, request: [], source: 'mine'});
    say(''); renderNew();
  });
  $('trade-find')?.addEventListener('submit', e => { e.preventDefault(); findPartner($('trade-code-input').value); });
  $('trade-code-input')?.addEventListener('input', e => { st.codeDraft = e.target.value; });
  $('trade-partner-change')?.addEventListener('click', () => { st.partner = null; st.request = []; st.source = 'mine'; say(''); renderNew(); });
  $('trade-discard-counter')?.addEventListener('click', resetBuilder);
  box.querySelectorAll('[data-remove]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const [kind, id] = b.dataset.remove.split(/:(.+)/);
    const list = kind === 'offer' ? st.offer : st.request;
    list.splice(list.indexOf(id), 1); renderNew();
  });
  box.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { st.source = b.dataset.add === 'offer' ? 'mine' : st.mode === 'public' ? 'catalog' : 'partner'; renderItems(); $('trade-grid').scrollTop = 0; });
  box.querySelectorAll('[data-focus]').forEach(b => b.onclick = () => { st.focus = b.dataset.focus; renderDetail(); renderItems(); box.querySelectorAll('.trade-slot').forEach(x => x.classList.toggle('is-focus', x.dataset.focus === st.focus)); });
  $('trade-send').onclick = send;
}
async function findPartner(value) {
  const code = String(value || '').trim();
  if (!code) return;
  st.busy = true; say('Buscando...'); renderBuilder();
  try {
    st.partner = await trade.user(code);
    st.codeDraft = ''; st.request = []; st.source = 'partner';
    say(st.partner.blocked ? 'Hay un bloqueo entre vosotros: no podéis hacer trades.' : '', st.partner.blocked);
  } catch (e) { say(message(e.code), true); }
  st.busy = false; renderNew();
}

// ---------- Nuevo trade: vista del item y resumen ----------
function lookWith(id) {
  const base = {character: profile.character | 0, board: profile.board | 0, wing: profile.wing | 0, hat: profile.hat | 0};
  const p = id && parseItemId(id);
  return p && p.slot !== 'hat' ? {...base, [p.slot]: p.index} : base;
}
function renderDetail() {
  const id = st.focus, item = id && itemOf(id), info = $('trade-detail-info');
  info.innerHTML = item
    ? `<div class="trade-detail-name"><h4>${escapeHtml(item.name)}</h4><span class="trade-rarity rarity-${rarityOf(id)}">${RARITY_NAMES[rarityOf(id)]}</span></div>
       <span class="trade-detail-slot">${ICON[item.category]}${SLOT_NAMES[item.category]}</span><p>${escapeHtml(item.description)}</p>`
    : '<p class="trade-detail-empty">Toca un item para verlo en 3D.</p>';
  if (dialog.open && st.tab === 'new') preview.update(lookWith(id));
  const row = (label, list) => `<div class="trade-summary-row"><span class="trade-summary-thumbs">${list.slice(0, 2).map(i => `<span class="trade-card-art">${art(i)}</span>`).join('') || '<span class="trade-card-art is-empty"></span>'}</span>
      <span><small>${label}:</small><b>${list.length ? escapeHtml(list.map(itemName).join(', ')) : '—'}</b></span></div>`;
  $('trade-summary').innerHTML = `<h4>Resumen del trade</h4>${row('Ofreces', st.offer)}${row(st.mode === 'public' ? 'Buscas' : 'Recibes', st.request)}`;
}
function renderNew() { renderItems(); renderBuilder(); renderDetail(); }
function resetBuilder() {
  Object.assign(st, {partner: null, offer: [], request: [], source: 'mine', parentId: null, listing: null, focus: null, codeDraft: ''});
  say(''); renderNew();
}

// ---------- Confirmación (dentro del modal) ----------
function confirmBox({title, give, get, text, ok, labels = ['Entregas', 'Recibes']}) {
  const box = $('trade-confirm');
  const col = (label, list) => `<div class="trade-confirm-col"><small>${label}</small>${list.map(id => `<div class="trade-confirm-item rarity-${rarityOf(id)}"><span class="trade-card-art">${art(id)}</span><b>${escapeHtml(itemName(id))}</b></div>`).join('')}</div>`;
  box.innerHTML = `<div class="trade-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="trade-confirm-title">
      <h3 id="trade-confirm-title">${escapeHtml(title)}</h3>
      ${give.length || get.length ? `<div class="trade-confirm-cols">${col(labels[0], give)}<span class="trade-swap">${ICON.swap}</span>${col(labels[1], get)}</div>` : ''}
      <p>${escapeHtml(text)}</p>
      <div class="trade-confirm-actions"><button type="button" data-answer="no">Volver</button><button type="button" class="trade-send" data-answer="yes">${escapeHtml(ok)}</button></div>
    </div>`;
  box.hidden = false;
  box.querySelector('[data-answer="yes"]').focus();
  return new Promise(resolve => box.querySelectorAll('[data-answer]').forEach(b => b.onclick = () => { box.hidden = true; box.innerHTML = ''; resolve(b.dataset.answer === 'yes'); }));
}
const GIVE_WARNING = 'Los items que entregas dejarán de ser tuyos. Si llevas alguno puesto, volverás al gratuito.';

async function send() {
  if (st.busy) return;
  if (st.mode === 'public') return publishListing();
  if (!st.partner) return;
  const ok = await confirmBox({title: `¿Enviar ${st.parentId ? 'la contraoferta' : 'la oferta'} a ${st.partner.nickname}?`, give: st.offer, get: st.request,
    text: 'Nada cambia de dueño hasta que la otra persona la acepte. Puedes cancelarla desde "Ofertas enviadas".', ok: 'Enviar oferta'});
  if (!ok) return;
  st.busy = true; renderBuilder();
  try {
    await trade.create({toCode: st.partner.code, offer: st.offer, request: st.request, parentId: st.parentId, listingId: st.listing?.id || null});
    const who = st.partner.nickname;
    Object.assign(st, {offer: [], request: [], parentId: null, listing: null, focus: null});
    say(`Oferta enviada a ${who}. La verás en "Ofertas enviadas".`);
    await loadSummary();
  } catch (e) { say(e.detail?.itemId ? `${message(e.code)} (${itemName(e.detail.itemId)})` : message(e.code), true); }
  st.busy = false; renderHeader(); renderNew();
}
async function publishListing() {
  const ok = await confirmBox({title: '¿Publicar en Trades públicos?', give: st.offer, get: st.request, labels: ['Ofreces', st.request.length ? 'Buscas' : 'Aceptas ofertas'],
    text: 'Cualquier surfista podrá verla y enviarte una oferta. Nada cambia de dueño hasta que aceptes una. Puedes retirarla cuando quieras.', ok: 'Publicar'});
  if (!ok) return;
  st.busy = true; renderBuilder();
  try {
    await trade.publish({offer: st.offer, want: st.request});
    Object.assign(st, {offer: [], request: [], focus: null, source: 'mine', busy: false, publicMine: true, listings: []});
    // Se lleva al jugador a sus publicaciones para que vea que ya está en el tablón.
    openTab('public');
    say('¡Publicado! Lo verán todos en Trades públicos y las ofertas te llegarán a "Ofertas recibidas".');
    return;
  } catch (e) {
    if (e.code === 'listing_exists') {   // ya estaba publicada: se enseña en vez de solo dar el error
      Object.assign(st, {busy: false, publicMine: true, listings: []});
      openTab('public');
      say(message(e.code), true);
      return;
    }
    say(e.detail?.itemId ? `${message(e.code)} (${itemName(e.detail.itemId)})` : message(e.code), true);
  }
  st.busy = false; renderNew();
}

// ---------- Trades públicos (tablón) ----------
function listingCard(l) {
  const thumbs = list => list.map(id => `<span class="trade-offer-item rarity-${rarityOf(id)}" title="${escapeHtml(itemName(id))}"><span class="trade-card-art">${art(id)}</span><b>${escapeHtml(itemName(id))}</b></span>`).join('');
  const hint = l.mine ? `${l.offers} oferta${l.offers === 1 ? '' : 's'} recibida${l.offers === 1 ? '' : 's'}` : l.youHaveWanted ? 'Tienes lo que busca' : '';
  return `<article class="trade-offer trade-listing" data-listing="${escapeHtml(l.id)}">
      <header><img src="${escapeHtml(l.owner.avatarUrl || DEFAULT_AVATAR)}" alt="" referrerpolicy="no-referrer"><span class="trade-offer-who"><b>${escapeHtml(l.mine ? 'Tu publicación' : l.owner.nickname)}</b><small>${escapeHtml(l.owner.code || '')}</small></span>
        ${hint ? `<span class="trade-listing-hint${l.youHaveWanted ? ' is-good' : ''}">${hint}</span>` : ''}<span class="trade-expire">${timeLeft(l.expiresAt)}</span></header>
      <div class="trade-offer-body">
        <div><small>Ofrece</small><div class="trade-offer-items">${thumbs(l.give)}</div></div>
        <span class="trade-swap">${ICON.swap}</span>
        <div><small>Busca</small><div class="trade-offer-items">${l.want.length ? thumbs(l.want) : '<span class="trade-listing-open">Acepta ofertas</span>'}</div></div>
      </div>
      <footer>${l.mine ? '<button type="button" data-listing-act="withdraw">Retirar publicación</button>' : '<button type="button" class="trade-send" data-listing-act="negotiate">Negociar</button>'}</footer>
    </article>`;
}
async function renderPublic() {
  const box = $('trade-list');
  const bar = () => `<div class="trade-public-bar">
      <div class="trade-source" role="group"><button type="button" data-public-mine="0" class="${st.publicMine ? '' : 'is-active'}">Todas</button><button type="button" data-public-mine="1" class="${st.publicMine ? 'is-active' : ''}">Mis publicaciones</button></div>
      <div class="trade-filters">${FILTERS.filter(([id]) => id !== 'hat').map(([id, label]) => `<button type="button" class="${st.publicFilter === id ? 'is-active' : ''}" data-public-filter="${id}">${ICON[id]}${label}</button>`).join('')}</div>
      <button type="button" class="trade-send trade-publish-btn" data-publish>${ICON.public}Publicar trade</button>
    </div>`;
  if (!st.listings.length) box.innerHTML = bar() + '<p class="trade-empty">Cargando...</p>';
  const mine = st.publicMine;
  try { st.listings = (await trade.listings(mine)).listings; } catch (e) { box.innerHTML = bar() + `<p class="trade-empty">${escapeHtml(message(e.code))}</p>`; return wirePublic(); }
  if (st.tab !== 'public' || st.publicMine !== mine) return;
  const list = st.listings.filter(l => st.publicFilter === 'all' || l.give.some(id => slotOf(id) === st.publicFilter));
  const empty = mine ? 'No tienes publicaciones abiertas. Publica los items que quieras cambiar y los verán todos los surfistas.'
    : st.publicFilter === 'all' ? 'Aún no hay trades publicados. ¡Sé el primero en publicar uno!' : 'No hay publicaciones con items de este tipo.';
  box.innerHTML = bar() + `<p class="trade-note${st.noteError ? ' is-error' : ''}" role="status">${escapeHtml(st.note)}</p>` +
    (list.length ? `<div class="trade-listings">${list.map(listingCard).join('')}</div>` : `<p class="trade-empty">${empty}</p>`);
  wirePublic();
}
function wirePublic() {
  const box = $('trade-list');
  box.querySelectorAll('[data-public-mine]').forEach(b => b.onclick = () => { st.publicMine = b.dataset.publicMine === '1'; st.listings = []; say(''); renderPublic(); });
  box.querySelectorAll('[data-public-filter]').forEach(b => b.onclick = () => { st.publicFilter = b.dataset.publicFilter; renderPublic(); });
  box.querySelector('[data-publish]')?.addEventListener('click', () => { resetBuilder(); st.mode = 'public'; openTab('new'); });
  box.querySelectorAll('[data-listing-act]').forEach(b => b.onclick = () => listingAct(b.closest('[data-listing]').dataset.listing, b.dataset.listingAct));
}
async function listingAct(id, action) {
  const l = st.listings.find(x => x.id === id);
  if (!l || st.busy) return;
  if (action === 'withdraw') {
    if (!await confirmBox({title: '¿Retirar esta publicación?', give: l.give, get: l.want, labels: ['Ofreces', 'Buscas'], text: 'Dejará de verse en Trades públicos. Las ofertas que ya te hayan enviado siguen en "Ofertas recibidas".', ok: 'Retirar'})) return;
    try { await trade.withdrawListing(l.id); say('Publicación retirada.'); } catch (e) { say(message(e.code), true); }
    return renderPublic();
  }
  // Negociar: el constructor se abre con lo publicado como "Recibes" y, en "Ofreces", lo que
  // busca y ya tienes. Se puede cambiar todo antes de enviar.
  try { st.partner = await trade.user(l.owner.code); } catch (e) { say(message(e.code), true); return renderPublic(); }
  const owned = new Set(st.mine.map(i => i.itemId));
  Object.assign(st, {mode: 'direct', parentId: null, listing: l, request: [...l.give], offer: l.want.filter(i => owned.has(i)), source: 'mine', focus: l.give[0]});
  say('');
  openTab('new');
}

// ---------- Ofertas recibidas, enviadas e historial ----------
function timeLeft(ms) {
  const left = ms - Date.now();
  if (left <= 0) return 'caducada';
  const h = Math.floor(left / 3600_000);
  return h >= 24 ? `caduca en ${Math.floor(h / 24)} d ${h % 24} h` : h >= 1 ? `caduca en ${h} h` : `caduca en ${Math.max(1, Math.round(left / 60_000))} min`;
}
function offerCard(o) {
  const thumbs = list => list.map(id => `<span class="trade-offer-item rarity-${rarityOf(id)}" title="${escapeHtml(itemName(id))}"><span class="trade-card-art">${art(id)}</span><b>${escapeHtml(itemName(id))}</b></span>`).join('');
  const received = o.direction === 'received';
  const actions = st.tab === 'received'
    ? `<button type="button" class="trade-send" data-act="accept">Aceptar</button><button type="button" data-act="counter">Contraofertar</button><button type="button" data-act="decline">Rechazar</button><button type="button" class="trade-link" data-act="block">Bloquear</button>`
    : st.tab === 'sent' ? '<button type="button" data-act="cancel">Cancelar oferta</button>' : '';
  const when = st.tab === 'history' ? `<span class="trade-status status-${o.status.toLowerCase()}">${STATUS_NAMES[o.status] || o.status}</span><time>${escapeHtml(String(o.completedAt || o.updatedAt || o.createdAt).slice(0, 10))}</time>`
    : `<span class="trade-expire">${timeLeft(o.expiresAt)}</span>`;
  return `<article class="trade-offer" data-offer="${escapeHtml(o.id)}">
      <header><img src="${escapeHtml(o.partner.avatarUrl || DEFAULT_AVATAR)}" alt="" referrerpolicy="no-referrer"><span class="trade-offer-who"><b>${escapeHtml(o.partner.nickname)}</b><small>${escapeHtml(o.partner.code || '')}${o.parentId ? ' · contraoferta' : ''}${o.listingId ? (received ? ' · por tu publicación' : ' · por su publicación') : ''}${st.tab === 'history' ? (received ? ' · te la envió' : ' · la enviaste') : ''}</small></span>${when}</header>
      <div class="trade-offer-body">
        <div><small>${received ? 'Te da' : 'Ofreces'}</small><div class="trade-offer-items">${thumbs(received ? o.get : o.give)}</div></div>
        <span class="trade-swap">${ICON.swap}</span>
        <div><small>${received ? 'Te pide' : 'Pides'}</small><div class="trade-offer-items">${thumbs(received ? o.give : o.get)}</div></div>
      </div>
      ${actions ? `<footer>${actions}</footer>` : ''}
    </article>`;
}
async function renderList() {
  const box = $('trade-list'), tab = st.tab;
  box.innerHTML = '<p class="trade-empty">Cargando...</p>';
  try {
    const [{offers}, blocked] = await Promise.all([trade.offers(tab), tab === 'history' ? trade.blocked() : Promise.resolve(null)]);
    if (st.tab !== tab) return;
    st.lists[tab] = offers;
    if (blocked) st.blocked = blocked.blocked;
  } catch (e) { box.innerHTML = `<p class="trade-empty">${escapeHtml(message(e.code))}</p>`; return; }
  const offers = st.lists[tab];
  const empty = {received: 'No tienes ofertas pendientes. Comparte tu código de surfista para recibir alguna.', sent: 'No tienes ofertas enviadas abiertas.', history: 'Aún no hay trades en tu historial.'}[tab];
  box.innerHTML = `<p class="trade-note${st.noteError ? ' is-error' : ''}" role="status">${escapeHtml(st.note)}</p>
    ${offers.length ? offers.map(offerCard).join('') : `<p class="trade-empty">${empty}</p>`}
    ${tab === 'history' && st.blocked.length ? `<section class="trade-blocked"><h4>Surfistas bloqueados</h4>${st.blocked.map(b => `<div><span><b>${escapeHtml(b.nickname)}</b> <small>${escapeHtml(b.code || '')}</small></span><button type="button" data-unblock="${escapeHtml(b.code || '')}">Desbloquear</button></div>`).join('')}</section>` : ''}`;
  box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.closest('[data-offer]').dataset.offer, b.dataset.act));
  box.querySelectorAll('[data-unblock]').forEach(b => b.onclick = async () => {
    try { await trade.unblock(b.dataset.unblock); say('Surfista desbloqueado.'); } catch (e) { say(message(e.code), true); }
    renderList();
  });
}
async function act(id, action) {
  const o = (st.lists[st.tab] || []).find(x => x.id === id);
  if (!o || st.busy) return;
  if (action === 'counter') {
    // La contraoferta parte de la oferta recibida, con los lados ya colocados desde tu punto de vista.
    try { st.partner = await trade.user(o.partner.code); } catch (e) { say(message(e.code), true); return renderList(); }
    Object.assign(st, {parentId: o.id, offer: [...o.give], request: [...o.get], source: 'mine', focus: o.get[0] || null});
    say('');
    return openTab('new');
  }
  if (action === 'accept' && !await confirmBox({title: `¿Aceptar el trade con ${o.partner.nickname}?`, give: o.give, get: o.get, text: GIVE_WARNING, ok: 'Aceptar trade'})) return;
  if (action === 'block' && !await confirmBox({title: `¿Bloquear a ${o.partner.nickname}?`, give: [], get: [], text: 'No podrá enviarte más ofertas y se cancelarán las pendientes entre vosotros. Puedes desbloquearlo desde el Historial.', ok: 'Bloquear'})) return;
  if (action === 'cancel' && !await confirmBox({title: '¿Cancelar esta oferta?', give: o.give, get: o.get, text: 'La otra persona ya no podrá aceptarla.', ok: 'Cancelar oferta'})) return;
  st.busy = true;
  try {
    if (action === 'accept') { await trade.accept(o.id, o.contentHash); say(`¡Trade completado con ${o.partner.nickname}! Ya tienes: ${o.get.map(itemName).join(', ')}.`); }
    if (action === 'decline') { await trade.decline(o.id); say('Oferta rechazada.'); }
    if (action === 'cancel') { await trade.cancel(o.id); say('Oferta cancelada.'); }
    if (action === 'block') { await trade.block(o.partner.code); say(`${o.partner.nickname} está bloqueado.`); }
  } catch (e) { say(e.detail?.itemId ? `${message(e.code)} (${itemName(e.detail.itemId)})` : message(e.code), true); }
  st.busy = false;
  await Promise.all([loadSummary(), loadMine()]);
  renderHeader(); renderList();
}

// ---------- Navegación ----------
async function loadMine() {
  try { st.mine = (await trade.inventory()).items; } catch { st.mine = []; }
}
async function loadRarity() {
  if (st.rarity) return;
  try { const {items} = await catalog(); st.catalog = items; st.rarity = new Map(items.map(i => [i.id, i.rarity])); } catch {}
}
function openTab(tab) {
  if (st.tab !== tab) say('');
  st.tab = tab;
  const isNew = tab === 'new';
  $('trade-new').hidden = !isNew;
  $('trade-list').hidden = isNew;
  renderHeader();
  if (isNew) { renderNew(); preview.open(lookWith(st.focus)); }
  else { preview.close(); if (tab === 'public') renderPublic(); else renderList(); }
}
// El modal se abre ya con su tamaño final y la pestaña pintada con lo que hay en memoria; los
// datos del servidor llegan después y solo rellenan (antes se abría vacío y "crecía").
async function open() {
  const signed = account.authenticated;
  dialog.classList.toggle('is-guest', !signed);
  $('trade-gate').hidden = signed;
  $('trade-confirm').hidden = true;
  if (!signed) {
    $('trade-new').hidden = true; $('trade-list').hidden = true;
    renderHeader(); renderGate();
    if (!dialog.open) dialog.showModal();
    preview.close();
    return;
  }
  if (!dialog.open) dialog.showModal();
  openTab(st.tab);
  await Promise.all([loadSummary(), loadMine(), loadRarity()]);
  if (!dialog.open || !account.authenticated) return;
  openTab(st.tab);
}

$('home-trade').onclick = open;
dialog.querySelector('.trade-close').onclick = () => dialog.close();
dialog.addEventListener('close', () => { preview.close(); $('trade-confirm').hidden = true; });
dialog.addEventListener('cancel', e => { if (!$('trade-confirm').hidden) { e.preventDefault(); $('trade-confirm').querySelector('[data-answer="no"]').click(); } });
// Sesión iniciada o cerrada con el Trade abierto; y el aviso de ofertas del menú.
let wasSigned = null;
document.addEventListener('surf:account', () => {
  if (wasSigned !== account.authenticated) { wasSigned = account.authenticated; loadSummary(); if (dialog.open) open(); }
});
document.addEventListener('surf:menu', loadSummary);

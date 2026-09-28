// Panel administrativo de Surf Salvaje. Solo interfaz: cada dato y cada acción pasan por
// /admin/api/*, que exige la sesión de administrador (cookie HttpOnly) y el token CSRF.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = n => Math.round(Number(n) || 0).toLocaleString('es-ES');
const date = s => s ? String(s).replace('T', ' ').slice(0, 16) : '—';
const COIN = {NORMAL_COIN: 'Normales', GOLD_COIN: 'Oro'};
const TYPES = {RACE_REWARD: 'Recompensa de carrera', ITEM_PURCHASE: 'Compra', GOLD_EXCHANGE: 'Conversión', GOLD_CREDIT: 'Oro acreditado', GOLD_REFUND: 'Reembolso', ADMIN_ADJUSTMENT: 'Ajuste admin'};
const STATUS = {OPEN: 'Abierta', COMPLETED: 'Completado', DECLINED: 'Rechazado', CANCELED: 'Cancelado', EXPIRED: 'Caducado', INVALID: 'No válido', COUNTERED: 'Contraofertado', REVERTED: 'Revertido'};
const RARITY = {common: 'Común', rare: 'Raro', epic: 'Épico', legendary: 'Legendario'};
const CATEGORY = {character: 'Personajes', board: 'Tablas', wing: 'Wings', hat: 'Hats'};
const ERRORS = {
  invalid_credentials: 'Usuario o contraseña incorrectos.', too_many_attempts: 'Demasiados intentos. Espera 15 minutos.',
  admin_login_required: 'La sesión caducó. Vuelve a entrar.', csrf_failed: 'Sesión no válida. Recarga la página.',
  reason_required: 'Escribe un motivo.', invalid_amount: 'Cantidad no válida.', insufficient_funds: 'El saldo no puede quedar negativo.',
  already_owned: 'Ya tiene ese item.', not_owned: 'No tiene ese item.', item_is_free: 'Ese item es gratuito para todos.',
  items_changed: 'Los items ya cambiaron de dueño: no se puede revertir.', offer_not_completed: 'Ese trade no está completado.',
  invalid_price: 'Precio no válido.', default_item_free: 'El item de serie de cada ranura siempre es gratis.',
  invalid_image: 'La imagen debe ser PNG, WebP o JPG.', image_too_large: 'La imagen supera 4 MB.', name_required: 'Pon un nombre.',
  invalid_packages: 'Revisa los paquetes: id (a-z, 0-9, _), cantidad > 0 y precio vacío o > 0.', invalid_products: 'Revisa los productos de oro.',
  invalid_rewards: 'Revisa las recompensas (números enteros ≥ 0).', rate_limited: 'Demasiadas peticiones. Espera un momento.', payload_too_large: 'Archivo demasiado grande.'
};
const msg = e => ERRORS[e.code] || e.code || 'Error';
let csrf = null, currentView = 'dashboard', catalogCache = null;

async function api(path, body) {
  const options = {credentials: 'same-origin', headers: {Accept: 'application/json'}};
  if (body !== undefined) Object.assign(options, {method: 'POST', body: JSON.stringify(body), headers: {...options.headers, 'Content-Type': 'application/json', 'X-Admin-CSRF': csrf || ''}});
  const response = await fetch('/admin/api/' + path, options);
  if (response.status === 413) throw Object.assign(Error('payload_too_large'), {code: 'payload_too_large'});
  const json = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== 'login') { showLogin(); }
  if (!response.ok) throw Object.assign(Error(json.error || 'server_error'), {code: json.error || 'server_error', detail: json.detail});
  return json;
}
function toast(text, error = false) {
  const el = $('toast'); el.textContent = text; el.classList.toggle('is-error', error); el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3500);
}

// ---------- Sesión ----------
function showLogin() { $('app').hidden = true; $('login-view').hidden = false; $('drawer').open && $('drawer').close(); $('login-user').focus(); }
function showApp(username) { $('login-view').hidden = true; $('app').hidden = false; $('admin-name').textContent = username; go(currentView); }
$('login-form').onsubmit = async e => {
  e.preventDefault(); $('login-error').textContent = ''; $('login-submit').disabled = true;
  try { const r = await api('login', {username: $('login-user').value.trim(), password: $('login-pass').value}); csrf = r.csrf; $('login-pass').value = ''; showApp(r.username); }
  catch (error) { $('login-error').textContent = msg(error); }
  finally { $('login-submit').disabled = false; }
};
$('logout').onclick = async () => { try { await api('logout', {}); } catch {} csrf = null; showLogin(); };
document.querySelectorAll('#nav [data-view]').forEach(b => b.onclick = () => go(b.dataset.view));

const VIEWS = {dashboard: ['Resumen', dashboard], users: ['Usuarios', usersView], purchases: ['Compras', purchasesView], transactions: ['Movimientos', transactionsView],
  trades: ['Trades', tradesView], catalog: ['Tienda', catalogView], economy: ['Monedas', economyView], audit: ['Registro de acciones', auditView]};
async function go(view) {
  currentView = view;
  document.querySelectorAll('#nav [data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
  $('view-title').textContent = VIEWS[view][0];
  $('view').innerHTML = '<p class="muted">Cargando...</p>';
  try { await VIEWS[view][1]($('view')); } catch (error) { if (error.code !== 'admin_login_required') $('view').innerHTML = `<p class="form-error">${esc(msg(error))}</p>`; }
}
const table = (heads, rows, empty = 'Sin datos todavía.') => rows.length
  ? `<div class="table-wrap"><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
  : `<p class="muted">${empty}</p>`;
const userLink = (id, nick) => `<button class="link" data-user="${esc(id)}">${esc(nick)}</button>`;
function wireUserLinks(root) { root.querySelectorAll('[data-user]').forEach(b => b.onclick = () => openUser(b.dataset.user)); }
async function items() { if (!catalogCache) catalogCache = (await api('catalog')).items; return catalogCache; }
const itemName = async id => (await items()).find(i => i.id === id)?.name || id;

// ---------- Resumen ----------
async function dashboard(root) {
  const s = await api('stats');
  const names = new Map((await items()).map(i => [i.id, i.name]));
  const card = (label, value, sub = '') => `<div class="stat"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  root.innerHTML = `<div class="stats">
      ${card('Usuarios', fmt(s.users), `+${fmt(s.usersToday)} hoy`)}
      ${card('Compras', fmt(s.purchases), `${fmt(s.purchasesToday)} hoy · ${fmt(s.spent)} Normales gastadas`)}
      ${card('Tablas Normales en circulación', fmt(s.circulation.NORMAL_COIN))}
      ${card('Tablas de Oro en circulación', fmt(s.circulation.GOLD_COIN))}
      ${card('Recompensas de carrera hoy', fmt(s.rewardsToday))}
      ${card('Trades completados', fmt(s.tradesCompleted), `${fmt(s.offersOpen)} ofertas abiertas · ${fmt(s.listingsOpen)} públicos`)}
      ${card('Items en inventarios', fmt(s.itemsOwned))}
    </div>
    <div class="two-col">
      <section class="panel"><h3>Últimas compras</h3>${table(['Fecha', 'Usuario', 'Item', 'Precio'], s.recentPurchases.map(p => `<tr><td>${date(p.createdAt)}</td><td>${userLink(p.userId, p.nickname)}</td><td>${esc(p.itemName || p.itemId)}</td><td>${fmt(p.price)}</td></tr>`))}</section>
      <section class="panel"><h3>Últimos trades</h3>${table(['Fecha', 'De', 'Para', 'Estado'], s.recentTrades.map(t => `<tr><td>${date(t.createdAt)}</td><td>${userLink(t.fromId, t.fromNick)}</td><td>${userLink(t.toId, t.toNick)}</td><td><span class="tag s-${t.status.toLowerCase()}">${STATUS[t.status] || t.status}</span></td></tr>`))}</section>
    </div>`;
  void names;
  wireUserLinks(root);
}

// ---------- Usuarios ----------
async function usersView(root, q = '') {
  root.innerHTML = `<form class="toolbar" id="user-search"><input id="user-q" placeholder="Buscar por nick, código SURF-XXXXX o ID" value="${esc(q)}"><button class="btn">Buscar</button></form><div id="user-list"><p class="muted">Cargando...</p></div>`;
  $('user-search').onsubmit = e => { e.preventDefault(); usersView(root, $('user-q').value.trim()); };
  const {users} = await api('users?q=' + encodeURIComponent(q));
  $('user-list').innerHTML = table(['Nick', 'Código', 'Accesos', 'Normales', 'Oro', 'Items', 'Alta'], users.map(u =>
    `<tr><td>${userLink(u.id, u.nickname)}</td><td>${esc(u.code || '—')}</td><td>${esc(u.providers.join(', ') || '—')}</td><td>${fmt(u.normal)}</td><td>${fmt(u.gold)}</td><td>${fmt(u.items)}</td><td>${date(u.createdAt)}</td></tr>`), 'No hay usuarios con esa búsqueda.');
  wireUserLinks(root);
}
async function openUser(id) {
  const drawer = $('drawer'), body = $('drawer-body');
  body.innerHTML = '<p class="muted">Cargando...</p>';
  if (!drawer.open) drawer.showModal();
  let d;
  try { d = await api('user?id=' + encodeURIComponent(id)); } catch (error) { body.innerHTML = `<p class="form-error">${esc(msg(error))}</p>`; return; }
  const all = await items(), names = new Map(all.map(i => [i.id, i.name]));
  const owned = new Set(d.inventory.map(i => i.itemId));
  const givable = all.filter(i => i.price > 0 && !owned.has(i.id));
  body.innerHTML = `
    <header class="drawer-head"><div><span class="kicker">USUARIO</span><h3>${esc(d.user.nickname)}</h3><small>${esc(d.code || '')} · ${esc(d.user.id)} · alta ${date(d.user.createdAt)}</small></div><button class="close" id="drawer-close" aria-label="Cerrar">×</button></header>
    <div class="chips">${d.identities.map(i => `<span class="chip">${esc(i.provider)} · ${esc(i.displayName || '')} · último acceso ${date(i.lastLoginAt)}</span>`).join('') || '<span class="chip">Sin accesos</span>'}</div>
    <div class="stats small">${Object.entries(d.wallet).map(([c, v]) => `<div class="stat"><span>${COIN[c]}</span><b>${fmt(v)}</b></div>`).join('')}</div>
    <section class="panel"><h3>Ajustar monedas</h3>
      <form class="form-row" id="grant-form"><select id="grant-currency"><option value="NORMAL_COIN">Tablas Normales</option><option value="GOLD_COIN">Tablas de Oro</option></select>
      <input id="grant-amount" type="number" step="1" placeholder="Cantidad (negativa para quitar)" required><input id="grant-reason" placeholder="Motivo (obligatorio)" required maxlength="200"><button class="btn gold">Aplicar</button></form></section>
    <section class="panel"><h3>Inventario</h3>
      ${d.inventory.length ? `<div class="chips">${d.inventory.map(i => `<span class="chip">${esc(names.get(i.itemId) || i.itemId)} <small>${esc(i.source)}</small><button class="x" data-remove="${esc(i.itemId)}" title="Quitar">×</button></span>`).join('')}</div>` : '<p class="muted">Sin items (los gratuitos no cuentan).</p>'}
      <form class="form-row" id="give-form"><select id="give-item">${givable.map(i => `<option value="${esc(i.id)}">${esc(CATEGORY[i.category])} · ${esc(i.name)}</option>`).join('')}</select><input id="give-reason" placeholder="Motivo (obligatorio)" required maxlength="120"><button class="btn">Entregar item</button></form></section>
    <section class="panel"><h3>Movimientos</h3>${table(['Fecha', 'Tipo', 'Moneda', 'Cantidad', 'Saldo', 'Detalle'], d.transactions.map(t => `<tr><td>${date(t.createdAt)}</td><td>${esc(TYPES[t.type] || t.type)}</td><td>${COIN[t.currency]}</td><td class="${t.amount > 0 ? 'plus' : 'minus'}">${t.amount > 0 ? '+' : ''}${fmt(t.amount)}</td><td>${fmt(t.balanceAfter)}</td><td>${esc(t.description || '')}</td></tr>`))}</section>
    <section class="panel"><h3>Trades</h3>${tradeTable(d.trades, names)}</section>`;
  $('drawer-close').onclick = () => drawer.close();
  $('grant-form').onsubmit = async e => {
    e.preventDefault();
    try { await api('user/grant', {userId: d.user.id, currency: $('grant-currency').value, amount: Number($('grant-amount').value), reason: $('grant-reason').value}); toast('Saldo actualizado.'); openUser(id); }
    catch (error) { toast(msg(error), true); }
  };
  $('give-form').onsubmit = async e => {
    e.preventDefault();
    try { await api('user/give-item', {userId: d.user.id, itemId: $('give-item').value, reason: $('give-reason').value}); toast('Item entregado.'); openUser(id); }
    catch (error) { toast(msg(error), true); }
  };
  body.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
    const reason = prompt(`Motivo para quitar ${names.get(b.dataset.remove) || b.dataset.remove}:`);
    if (!reason) return;
    try { await api('user/remove-item', {userId: d.user.id, itemId: b.dataset.remove, reason}); toast('Item quitado.'); openUser(id); }
    catch (error) { toast(msg(error), true); }
  });
  wireRevert(body, () => openUser(id));
  wireUserLinks(body);
}
$('drawer').addEventListener('click', e => { if (e.target === $('drawer')) $('drawer').close(); });

// ---------- Compras y movimientos ----------
async function purchasesView(root) {
  const {purchases} = await api('purchases?limit=200');
  root.innerHTML = table(['Fecha', 'Usuario', 'Item', 'Precio (Normales)'], purchases.map(p => `<tr><td>${date(p.createdAt)}</td><td>${userLink(p.userId, p.nickname)}</td><td>${esc(p.itemName || p.itemId)}</td><td>${fmt(p.price)}</td></tr>`), 'Aún no hay compras.');
  wireUserLinks(root);
}
async function transactionsView(root, type = '') {
  const {transactions} = await api('transactions?limit=200&type=' + type);
  root.innerHTML = `<div class="toolbar"><select id="tx-type"><option value="">Todos los tipos</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${v}</option>`).join('')}</select></div>` +
    table(['Fecha', 'Usuario', 'Tipo', 'Moneda', 'Cantidad', 'Saldo', 'Detalle'], transactions.map(t => `<tr><td>${date(t.createdAt)}</td><td>${userLink(t.userId, t.nickname)}</td><td>${esc(TYPES[t.type] || t.type)}</td><td>${COIN[t.currency]}</td><td class="${t.amount > 0 ? 'plus' : 'minus'}">${t.amount > 0 ? '+' : ''}${fmt(t.amount)}</td><td>${fmt(t.balanceAfter)}</td><td>${esc(t.description || '')}</td></tr>`), 'Sin movimientos.');
  $('tx-type').onchange = e => transactionsView(root, e.target.value);
  wireUserLinks(root);
}

// ---------- Trades ----------
function tradeTable(list, names) {
  const its = ids => ids.map(i => esc(names.get(i) || i)).join(', ') || '—';
  return table(['Fecha', 'De', 'Entrega', 'Para', 'Entrega', 'Estado', ''], list.map(t => `<tr><td>${date(t.createdAt)}</td><td>${userLink(t.fromId, t.fromNick)}</td><td>${its(t.give)}</td><td>${userLink(t.toId, t.toNick)}</td><td>${its(t.get)}</td>
    <td><span class="tag s-${t.status.toLowerCase()}">${STATUS[t.status] || t.status}</span></td><td>${t.status === 'COMPLETED' ? `<button class="btn small danger" data-revert="${esc(t.id)}">Revertir</button>` : ''}</td></tr>`), 'Sin trades.');
}
function wireRevert(root, after) {
  root.querySelectorAll('[data-revert]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Revertir este trade? Los items vuelven a sus dueños anteriores (solo si nadie los ha vuelto a cambiar).')) return;
    try { await api('trade/revert', {tradeId: b.dataset.revert}); toast('Trade revertido.'); after(); } catch (error) { toast(msg(error), true); }
  });
}
async function tradesView(root, status = '') {
  const [{trades}, all] = await Promise.all([api('trades?limit=200&status=' + status), items()]);
  const names = new Map(all.map(i => [i.id, i.name]));
  root.innerHTML = `<div class="toolbar"><select id="tr-status"><option value="">Todos los estados</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>` + tradeTable(trades, names);
  $('tr-status').onchange = e => tradesView(root, e.target.value);
  wireRevert(root, () => tradesView(root, status));
  wireUserLinks(root);
}

// ---------- Tienda ----------
const thumb = i => i.category === 'wing' ? `<span class="thumb wing" style="background-image:url('${esc(i.asset)}')"></span>`
  : i.asset ? `<img class="thumb" src="${esc(i.asset)}" alt="">` : `<span class="thumb empty">${i.category === 'character' ? '🧍' : '∅'}</span>`;
const UPLOAD_HELP = {
  board: 'Imagen de la tabla vista desde arriba, en vertical (punta arriba), con fondo transparente. PNG o WebP, hasta 4 MB. Recomendado 512×1536.',
  wing: 'Hoja de animación de 8 fotogramas: 4 columnas × 2 filas, fondo transparente (como las wings actuales). PNG o WebP, hasta 4 MB. Recomendado 2048×1024.',
  hat: 'Imagen frontal del hat, cuadrada y con fondo transparente. Se coloca sobre la cabeza del surfer. PNG o WebP, hasta 4 MB. Recomendado 512×512.'
};
async function catalogView(root, category = 'board') {
  catalogCache = null;
  const all = await items(), list = all.filter(i => i.category === category);
  root.innerHTML = `<div class="toolbar tabs">${Object.entries(CATEGORY).map(([k, v]) => `<button class="btn ${k === category ? 'gold' : 'ghost'}" data-cat="${k}">${v}</button>`).join('')}</div>
    ${category !== 'character' ? `<section class="panel upload"><h3>Añadir ${CATEGORY[category].toLowerCase().replace(/s$/, '')}</h3><p class="muted">${UPLOAD_HELP[category]} Se añade al final de la lista: los items existentes no cambian.</p>
      <form id="upload-form" class="upload-grid">
        <label>Nombre<input id="up-name" required maxlength="40" placeholder="${category === 'wing' ? 'Ej.: Galaxy (se muestra “Galaxy Wings”)' : 'Nombre'}"></label>
        <label>Precio (Tablas Normales)<input id="up-price" type="number" min="0" step="1" value="600" required></label>
        <label>Rareza<select id="up-rarity">${Object.entries(RARITY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        ${category === 'board' ? '<label>Color del borde<input id="up-color" type="color" value="#27cbd3"></label><label>Ancho (0.6–1)<input id="up-width" type="number" min="0.6" max="1" step="0.01" value="0.84"></label>' : ''}
        <label class="wide">Descripción<input id="up-desc" maxlength="200" placeholder="Una frase para La tiendita"></label>
        <label class="wide file">Imagen<input id="up-file" type="file" accept="image/png,image/webp,image/jpeg" required><span id="up-preview" class="preview"></span></label>
        <button class="btn gold" id="up-submit">Subir y añadir a La tiendita</button>
      </form></section>` : '<p class="muted">Los personajes son colores del stickman: se editan aquí, pero no se pueden subir nuevos.</p>'}
    <div class="items">${list.map(i => `<form class="item" data-item="${esc(i.id)}">
        <div class="item-head">${thumb(i)}<div><b>${esc(i.name)}</b><small>${esc(i.id)}${i.custom ? ' · subido' : ''} · ${fmt(i.owners)} dueños</small></div></div>
        <label>Nombre<input name="name" value="${esc(i.name.replace(/ Wings$/, ''))}" maxlength="40"></label>
        <label>Descripción<input name="description" value="${esc(i.description || '')}" maxlength="200"></label>
        <div class="form-row"><label>Precio<input name="price" type="number" min="0" step="1" value="${i.price}" ${i.id.endsWith(':0') ? 'disabled title="El item de serie siempre es gratis"' : ''}></label>
        <label>Rareza<select name="rarity">${Object.entries(RARITY).map(([k, v]) => `<option value="${k}" ${k === i.rarity ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
        <label class="check"><input name="forSale" type="checkbox" ${i.forSale ? 'checked' : ''}> A la venta en La tiendita</label>
        <button class="btn small">Guardar</button>
      </form>`).join('')}</div>`;
  root.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => catalogView(root, b.dataset.cat));
  root.querySelectorAll('form.item').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    const data = {itemId: f.dataset.item, name: f.name.value, description: f.description.value, rarity: f.rarity.value, forSale: f.forSale.checked};
    if (!f.price.disabled) data.price = Number(f.price.value);
    try { await api('catalog/item', data); toast('Item guardado. Los jugadores lo verán al recargar.'); catalogCache = null; } catch (error) { toast(msg(error), true); }
  });
  const form = $('upload-form');
  if (!form) return;
  $('up-file').onchange = () => {
    const file = $('up-file').files[0];
    $('up-preview').innerHTML = file ? `<img src="${URL.createObjectURL(file)}" alt="" class="${category === 'wing' ? 'sheet' : ''}"><small>${esc(file.name)} · ${fmt(file.size / 1024)} KB</small>` : '';
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const file = $('up-file').files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) return toast(ERRORS.image_too_large, true);
    $('up-submit').disabled = true;
    try {
      const image = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
      const body = {category, name: $('up-name').value, description: $('up-desc').value, price: Number($('up-price').value), rarity: $('up-rarity').value, image};
      if (category === 'board') Object.assign(body, {color: $('up-color').value, width: Number($('up-width').value)});
      const {item} = await api('catalog/upload', body);
      toast(`Añadido ${item.name} (${item.id}). Ya está en La tiendita para quien recargue el juego.`);
      catalogView(root, category);
    } catch (error) { toast(msg(error), true); }
    finally { $('up-submit') && ($('up-submit').disabled = false); }
  };
}

// ---------- Monedas ----------
async function economyView(root) {
  const e = await api('economy');
  const packRow = p => `<tr><td><input name="id" value="${esc(p.id)}" maxlength="32"></td><td><input name="name" value="${esc(p.name)}" maxlength="40"></td><td><input name="normalAmount" type="number" min="1" value="${p.normalAmount}"></td><td><input name="goldPrice" type="number" min="1" value="${p.goldPrice ?? ''}" placeholder="sin precio = inactivo"></td><td><button type="button" class="btn small ghost" data-del>Quitar</button></td></tr>`;
  const prodRow = p => `<tr><td><input name="id" value="${esc(p.id)}" maxlength="32"></td><td><input name="name" value="${esc(p.name)}" maxlength="40"></td><td><input name="goldAmount" type="number" min="1" value="${p.goldAmount}"></td><td><input name="priceMinor" type="number" min="1" value="${p.priceMinor ?? ''}" placeholder="céntimos"></td><td><input name="currency" value="${esc(p.currency || 'EUR')}" maxlength="3"></td><td><button type="button" class="btn small ghost" data-del>Quitar</button></td></tr>`;
  const r = e.rewards || {};
  root.innerHTML = `
    <section class="panel"><h3>Paquetes Tablas de Oro → Tablas Normales</h3><p class="muted">Lo que ven los jugadores en La tiendita → Monedas. Sin precio en oro, el paquete queda inactivo.</p>
      <table class="edit" id="packs"><thead><tr><th>ID</th><th>Nombre</th><th>Tablas Normales</th><th>Precio en Oro</th><th></th></tr></thead><tbody>${(e.exchangePackages || []).map(packRow).join('')}</tbody></table>
      <button class="btn small ghost" id="add-pack">+ Añadir paquete</button></section>
    <section class="panel"><h3>Productos de Tablas de Oro (dinero real)</h3><p class="muted">Precio en céntimos (199 = 1,99 €). La compra real sigue desactivada hasta integrar un proveedor de pago.</p>
      <table class="edit" id="prods"><thead><tr><th>ID</th><th>Nombre</th><th>Tablas de Oro</th><th>Precio (céntimos)</th><th>Moneda</th><th></th></tr></thead><tbody>${(e.goldProducts || []).map(prodRow).join('')}</tbody></table>
      <button class="btn small ghost" id="add-prod">+ Añadir producto</button></section>
    <section class="panel"><h3>Recompensas de carrera (Tablas Normales)</h3>
      <div class="upload-grid"><label class="check"><input id="rw-enabled" type="checkbox" ${r.enabled ? 'checked' : ''}> Activadas</label>
      <label>Por terminar<input id="rw-finish" type="number" min="0" value="${r.finish ?? 0}"></label>
      <label>Bonus por puesto (1º, 2º, 3º...)<input id="rw-bonus" value="${esc((r.placeBonus || []).join(', '))}"></label>
      <label>Mínimo de humanos<input id="rw-min" type="number" min="1" value="${r.minHumans ?? 2}"></label>
      <label>Tope diario por cuenta<input id="rw-cap" type="number" min="0" value="${r.dailyCap ?? ''}" placeholder="sin tope"></label></div></section>
    <button class="btn gold" id="save-economy">Guardar monedas</button>`;
  const wireDel = () => root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => b.closest('tr').remove());
  $('add-pack').onclick = () => { $('packs').tBodies[0].insertAdjacentHTML('beforeend', packRow({id: 'normal_' + Date.now().toString(36).slice(-4), name: 'Paquete', normalAmount: 1000, goldPrice: null})); wireDel(); };
  $('add-prod').onclick = () => { $('prods').tBodies[0].insertAdjacentHTML('beforeend', prodRow({id: 'gold_' + Date.now().toString(36).slice(-4), name: 'Oro', goldAmount: 100, priceMinor: null, currency: 'EUR'})); wireDel(); };
  wireDel();
  const intOrNull = v => v === '' ? null : Number(v);
  $('save-economy').onclick = async () => {
    const rows = id => [...$(id).tBodies[0].rows].map(tr => Object.fromEntries([...tr.querySelectorAll('input')].map(i => [i.name, i.value.trim()])));
    const body = {
      exchangePackages: rows('packs').map(p => ({id: p.id, name: p.name, normalAmount: Number(p.normalAmount), goldPrice: intOrNull(p.goldPrice)})),
      goldProducts: rows('prods').map(p => ({id: p.id, name: p.name, goldAmount: Number(p.goldAmount), priceMinor: intOrNull(p.priceMinor), currency: p.currency.toUpperCase() || 'EUR'})),
      rewards: {enabled: $('rw-enabled').checked, finish: Number($('rw-finish').value), placeBonus: $('rw-bonus').value.split(',').map(v => v.trim()).filter(Boolean).map(Number), minHumans: Number($('rw-min').value), dailyCap: intOrNull($('rw-cap').value)}
    };
    try { await api('economy', body); toast('Monedas guardadas.'); } catch (error) { toast(msg(error), true); }
  };
}

// ---------- Registro ----------
const ACTIONS = {login: 'Entrada', login_failed: 'Intento fallido', grant: 'Ajuste de monedas', give_item: 'Entregó item', remove_item: 'Quitó item', trade_revert: 'Revirtió trade', item_update: 'Editó item', item_upload: 'Subió item', economy_update: 'Editó monedas'};
async function auditView(root) {
  const {audit} = await api('audit?limit=200');
  root.innerHTML = table(['Fecha', 'Administrador', 'Acción', 'Sobre', 'Detalle'], audit.map(a => `<tr><td>${date(a.createdAt)}</td><td>${esc(a.username || '—')}</td><td>${esc(ACTIONS[a.action] || a.action)}</td><td>${esc(a.target || '')}</td><td class="detail">${esc(a.detail || '')}</td></tr>`), 'Sin acciones registradas.');
}

// ---------- Inicio ----------
api('me').then(r => { csrf = r.csrf; showApp(r.username); }).catch(showLogin);

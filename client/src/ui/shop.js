import {previewSvg} from '../characters/stick-avatar.js';
import {boardSkins} from '../shared/board-cosmetics.js';
import {createShopPreview} from './shop-preview.js';
import * as accountApi from '../account/account.js';
import {account,COIN_ICONS,COIN_NAMES,formatCoins,message} from '../account/account.js';

import {characters,boards,wings,wingFiles,descriptions} from '../shared/catalog.js';
export {characters,boards,wings,wingFiles};

const key='surf.profile.v1';
export const profile={nick:'',character:0,board:0,wing:0};
try{
  const saved=JSON.parse(localStorage.getItem(key)||'{}');
  profile.nick=typeof saved.nick==='string'?saved.nick.slice(0,16):'';
  for(const field of ['character','board','wing']){
    const limit=field==='wing'?wings.length:field==='board'?boards.length:characters.length;
    if(Number.isInteger(saved[field])&&saved[field]>=0&&saved[field]<limit)profile[field]=saved[field];
  }
}catch{}
export function saveProfile(){try{localStorage.setItem(key,JSON.stringify(profile));}catch{}}
const nick=document.getElementById('nickname');nick.value=profile.nick;
nick.addEventListener('input',()=>{profile.nick=nick.value.trim().slice(0,16);saveProfile();});

const dialog=document.getElementById('shop-dialog'),grid=document.getElementById('shop-grid');
const preview=createShopPreview(document.getElementById('shop-preview-canvas'));
const detailName=document.getElementById('shop-detail-name');
const detailRarity=document.getElementById('shop-detail-rarity');
const detailDescription=document.getElementById('shop-detail-description');
const detailEquip=document.getElementById('shop-detail-equip');

// Estado del servidor para la tienda: precio, propiedad y saldo. Sin servidor de cuentas todo
// lo del catálogo actual sigue siendo gratis, como antes (price 0).
let serverItems=new Map(),busy=false,note='';
const coinsIcon=c=>`<img src="${COIN_ICONS[c]}" alt="${COIN_NAMES[c]}">`;
async function loadCatalog(){
  try{const {items}=await accountApi.catalog();serverItems=new Map(items.map(i=>[i.id,i]));}catch{serverItems=new Map();}
}
const slotOf=()=>category==='wings'?'wing':category;
function itemState(slot,id){
  const info=serverItems.get(slot+':'+id)||{price:0,free:true,owned:true};
  const equipped=profile[slot]===id;
  const usable=info.free||info.owned;
  const canAfford=account.authenticated&&account.wallet.NORMAL_COIN>=info.price;
  // COMPRAR / EQUIPAR / EQUIPADO / SALDO INSUFICIENTE (o iniciar sesión para comprar).
  const action=equipped?'equipped':usable?'equip':!account.authenticated?'login':canAfford?'buy':'poor';
  return {...info,equipped,usable,action};
}
const RARITY_NAMES={common:'COMÚN',rare:'RARO',epic:'ÉPICO',legendary:'LEGENDARIO'};
const ACTION_TEXT={equipped:'✓ EQUIPADO',equip:'EQUIPAR',buy:'COMPRAR',poor:'SALDO INSUFICIENTE',login:'INICIA SESIÓN'};
function renderWallet(){
  const box=document.getElementById('shop-wallet');if(!box)return;
  if(!account.authenticated){box.innerHTML='<button type="button" class="shop-login" id="shop-login">Inicia sesión para comprar y guardar tu equipo</button>';box.querySelector('#shop-login').onclick=()=>{dialog.close();document.getElementById('nickname').focus();document.getElementById('auth-divider')?.scrollIntoView({block:'center'});};return;}
  box.innerHTML=['NORMAL_COIN','GOLD_COIN'].map(c=>`<span class="coin-chip${c==='GOLD_COIN'?' gold':''}" title="${COIN_NAMES[c]}">${coinsIcon(c)}<b>${formatCoins(account.wallet[c])}</b></span>`).join('');
}
async function act(slot,id){
  if(busy)return;
  const st=itemState(slot,id);note='';
  if(st.action==='login'){note='Inicia sesión con Google o Discord para comprar artículos.';return render();}
  if(st.action==='poor'){category='coins';note='Te faltan Tablas Normales: consíguelas con Tablas de Oro.';return render();}
  busy=true;render();
  try{
    if(st.action==='buy'){await accountApi.purchase(slot+':'+id);await loadCatalog();note=`¡${itemName(slot,id)} ya es tuyo!`;}
    else if(st.action==='equip'){
      if(account.authenticated)await accountApi.equip(slot+':'+id);
      else{profile[slot]=id;saveProfile();document.dispatchEvent(new CustomEvent('surf:appearance'));}
      selected[slot]=id;preview.update(selected);
    }
  }catch(e){note=message(e.code);if(e.code==='insufficient_funds'||e.code==='already_owned')await loadCatalog();}
  finally{busy=false;render();}
}
function itemName(slot,id){return slot==='wing'?`${wings[id]} Wings`:slot==='board'?boards[id]:characters[id];}
async function renderCoins(){
  detailName.textContent='Conseguir monedas';detailRarity.textContent='MONEDERO';
  detailDescription.textContent='Las Tablas de Oro se cambian por Tablas Normales. En La tiendita todo se compra con Tablas Normales.';
  detailEquip.textContent='TABLAS NORMALES';detailEquip.disabled=true;
  const panel=document.createElement('div');panel.className='coins-panel';
  panel.innerHTML=`<h3>TABLAS DE ORO → TABLAS NORMALES</h3><p>${account.authenticated?'Elige un paquete. El cambio se hace en el servidor y queda en tu historial.':'Inicia sesión con Google o Discord para usar tu monedero.'}</p><div id="coin-packs">Cargando paquetes...</div>
    <h3>CONSEGUIR TABLAS DE ORO</h3><p id="gold-status">Cargando...</p><div id="gold-products"></div>`;
  grid.append(panel);
  try{
    const {packages:list}=await accountApi.packages();
    panel.querySelector('#coin-packs').innerHTML='';
    for(const pack of list){
      const row=document.createElement('div');row.className='coin-pack';
      const price=pack.goldPrice?`${coinsIcon('GOLD_COIN')} ${formatCoins(pack.goldPrice)} Tablas de Oro`:'Precio por definir';
      const enough=account.authenticated&&pack.active&&account.wallet.GOLD_COIN>=pack.goldPrice;
      row.innerHTML=`${coinsIcon('NORMAL_COIN')}<div><strong>${pack.name.toUpperCase()}</strong><small>${formatCoins(pack.normalAmount)} Tablas Normales · <span class="coin-inline">${price}</span></small></div>`;
      const button=document.createElement('button');button.type='button';
      button.textContent=!pack.active?'PRÓXIMAMENTE':!account.authenticated?'INICIA SESIÓN':enough?'CAMBIAR':'SALDO INSUFICIENTE';
      button.disabled=!pack.active||!account.authenticated||!enough||busy;
      // Un requestId por clic: si el usuario pulsa dos veces o recarga, el servidor no repite el cambio.
      button.onclick=async()=>{if(busy)return;busy=true;button.disabled=true;
        try{const r=await accountApi.exchange(pack.id);note=`+${formatCoins(r.normalReceived??pack.normalAmount)} Tablas Normales`;}catch(e){note=message(e.code);}
        finally{busy=false;render();}};
      row.append(button);panel.querySelector('#coin-packs').append(row);
    }
    if(!list.length)panel.querySelector('#coin-packs').textContent='No hay paquetes configurados.';
  }catch{panel.querySelector('#coin-packs').textContent='No se pudo conectar con el servidor de cuentas.';}
  try{
    const {enabled,products}=await accountApi.goldProducts();
    panel.querySelector('#gold-status').textContent=enabled?'Pago seguro con el proveedor configurado.':'La compra de Tablas de Oro con dinero real todavía no está disponible: se activará cuando el pago esté integrado y verificado.';
    panel.querySelector('#gold-products').innerHTML=products.map(p=>`<div class="coin-pack gold">${coinsIcon('GOLD_COIN')}<div><strong>${p.name.toUpperCase()}</strong><small>${formatCoins(p.goldAmount)} Tablas de Oro</small></div><button type="button" disabled>PRÓXIMAMENTE</button></div>`).join('');
  }catch{panel.querySelector('#gold-status').textContent='';}
}
let category='character',opener,selected={character:profile.character,board:profile.board,wing:profile.wing};
const categoryField=slotOf;
function render(){
  const scroll=grid.scrollTop;
  grid.replaceChildren();
  renderWallet();
  const noteEl=document.getElementById('shop-note');if(noteEl)noteEl.textContent=note;
  document.querySelectorAll('#shop-dialog [data-category]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.category===category)));
  if(category==='coins'){renderCoins();return;}
  if(category==='hats'){
    const p=document.createElement('p');p.className='coming-soon';
    p.innerHTML='<strong>Sombreros · Muy pronto</strong><br>El espacio ya está preparado para añadir hats sin cambiar la tienda.';
    grid.append(p);
    detailName.textContent='Hats · Pronto';detailRarity.textContent='PRÓXIMAMENTE';
    detailDescription.textContent='Gorras y sombreros de playa llegarán a Surf Club.';
    detailEquip.textContent='PRONTO';detailEquip.disabled=true;detailEquip.className='';return;
  }
  const prop=categoryField(),list=prop==='wing'?wings:prop==='board'?boards:characters,chosen=selected[prop];
  list.forEach((name,id)=>{
    const st=itemState(prop,id);
    const card=document.createElement('div');
    card.className=`shop-item${chosen===id?' is-selected':''}${st.equipped?' is-equipped':''}${st.usable?'':' is-locked'}`;
    const select=document.createElement('button');select.type='button';select.className='shop-item-select';
    select.setAttribute('aria-label',`Ver ${itemName(prop,id)} en el personaje`);
    select.setAttribute('aria-pressed',String(chosen===id));
    const art=document.createElement('span');art.className='shop-item-art';
    if(prop==='wing'){
      art.classList.add('wing-preview');
      art.style.backgroundImage=`url('/assets/images/wings/${wingFiles[id]}')`;
    }else if(prop==='board'){
      const image=document.createElement('img');image.src=boardSkins[id].file;image.alt='';art.append(image);
    }else art.innerHTML=previewSvg(id,id);
    const title=document.createElement('strong');title.textContent=itemName(prop,id);
    const state=document.createElement('small');
    if(st.equipped)state.textContent='EQUIPADO';
    else if(st.free)state.textContent='GRATIS';
    else if(st.owned)state.textContent='EN TU INVENTARIO';
    else{state.className='shop-price';state.innerHTML=`${coinsIcon('NORMAL_COIN')}${formatCoins(st.price)}`;}
    select.append(art,title,state);
    select.onclick=()=>{selected[prop]=id;preview.update(selected);note='';render();};
    const action=document.createElement('button');action.type='button';
    action.className=`shop-item-equip${st.action==='buy'||st.action==='login'?' is-buy':st.action==='poor'?' is-poor':''}`;
    action.textContent=ACTION_TEXT[st.action];action.disabled=st.equipped||busy;
    action.setAttribute('aria-label',`${ACTION_TEXT[st.action]} ${itemName(prop,id)}`);
    action.onclick=()=>act(prop,id);
    card.append(select,action);grid.append(card);
  });
  grid.scrollTop=scroll;
  const st=itemState(prop,chosen);
  detailName.textContent=itemName(prop,chosen);
  detailRarity.textContent=(RARITY_NAMES[st.rarity]||'COMÚN')+(st.free?' · GRATIS':` · ${formatCoins(st.price)} TABLAS NORMALES`);
  detailDescription.textContent=descriptions[prop][chosen];
  detailEquip.textContent=st.action==='buy'?`COMPRAR · ${formatCoins(st.price)}`:ACTION_TEXT[st.action];
  detailEquip.className=st.action==='buy'||st.action==='login'?'is-buy':st.action==='poor'?'is-poor':'';
  detailEquip.disabled=st.equipped||busy;
}
detailEquip.onclick=()=>{if(category!=='hats'&&category!=='coins')act(categoryField(),selected[categoryField()]);};
document.getElementById('shop-btn').onclick=async()=>{
  opener=document.activeElement;note='';
  selected={character:profile.character,board:profile.board,wing:profile.wing};
  category='character';dialog.showModal();render();preview.open(selected);
  await loadCatalog();if(dialog.open)render();
};
document.getElementById('shop-close').onclick=()=>dialog.close();
dialog.addEventListener('close',()=>{preview.close();opener?.focus();});
document.querySelectorAll('#shop-dialog [data-category]').forEach(button=>button.onclick=()=>{category=button.dataset.category;note='';grid.scrollTop=0;render();});
document.addEventListener('surf:account',()=>{if(dialog.open)loadCatalog().then(render);});
document.getElementById('menu-btn')?.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('surf:menu')));

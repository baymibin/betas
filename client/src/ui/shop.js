import '../core/catalog-remote.js';   // primero: items subidos desde el panel (ver ese módulo)
import {previewSvg} from '../characters/stick-avatar.js';
import {boardSkins} from '../shared/board-cosmetics.js';
import {createShopPreview} from './shop-preview.js';
import * as accountApi from '../account/account.js';
import {account,COIN_ICONS,COIN_NAMES,formatCoins,message} from '../account/account.js';

import {characters,boards,wings,wingFiles,hats,hatUrl,wingUrl,descriptions} from '../shared/catalog.js';
export {characters,boards,wings,wingFiles,hats};

const key='surf.profile.v1';
export const profile={nick:'',character:0,board:0,wing:0,hat:0};
try{
  const saved=JSON.parse(localStorage.getItem(key)||'{}');
  profile.nick=typeof saved.nick==='string'?saved.nick.slice(0,16):'';
  for(const field of ['character','board','wing','hat']){
    const limit=field==='wing'?wings.length:field==='board'?boards.length:field==='hat'?hats.length:characters.length;
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
const slotOf=()=>category==='wings'?'wing':category==='hats'?'hat':category;
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
function itemName(slot,id){return slot==='wing'?`${wings[id]} Wings`:slot==='board'?boards[id]:slot==='hat'?hats[id]:characters[id];}
// Pestaña Monedas (como la referencia): dos vistas con tres paquetes cada una.
//  - Comprar Tablas de Oro con PayPal: el servidor crea la orden con SU precio y devuelve la URL
//    de PayPal; el oro solo se acredita cuando el servidor confirma el cobro con PayPal.
//  - Tablas de Oro → Tablas Normales: el cambio de siempre (/api/coins/exchange).
const PACK_ART=['/assets/images/currency/coins-small.svg','/assets/images/currency/coins-medium.svg','/assets/images/currency/coins-large.svg'];
const PACK_BADGES=[['popular','👑','POPULAR'],['value','🔥','MEJOR VALOR'],['max','💎','MÁXIMO']];
const PAYPAL_MARK='<svg class="pp-mark" viewBox="0 0 24 28" aria-hidden="true"><path fill="#003087" d="M7.3 26.6H2.6a.6.6 0 0 1-.6-.7L5.3 2.2A1 1 0 0 1 6.3 1.4h7.9c4.5 0 6.8 2.3 6.2 6.1-.8 5.2-4.2 7.4-8.8 7.4H9.2a1 1 0 0 0-1 .8z"/><path fill="#0079c1" d="M21.3 8c-.8 5-4.1 7.6-8.9 7.6h-2a1 1 0 0 0-1 .8l-1.3 8.4-.3 1.8h3.6a.9.9 0 0 0 .9-.7l.8-5.1a.9.9 0 0 1 .9-.7h.6c3.9 0 6.9-1.6 7.8-6.1.4-2.1.1-3.7-.9-4.8z"/></svg>';
let coinsView='buy';
const moneyText=p=>p.price?`${p.currency==='USD'?'$':''}${p.price} ${p.currency}`:'Precio por definir';
function coinRow(i,{name,amount,price,button}){
  const [cls,icon,label]=PACK_BADGES[i]||PACK_BADGES[2];
  const row=document.createElement('div');row.className='coin-pack';
  row.innerHTML=`<span class="coin-art"><img src="${PACK_ART[Math.min(i,2)]}" alt=""></span>
    <div class="coin-text"><strong>${name.toUpperCase()}</strong><em class="coin-badge ${cls}"><i aria-hidden="true">${icon}</i>${label}</em><small>${amount}</small><small class="coin-price">${price}</small></div>`;
  row.append(button);return row;
}
async function renderCoins(){
  detailName.textContent='Monedas';detailRarity.textContent='MONEDERO';
  detailDescription.textContent='Las Tablas de Oro se compran con PayPal y se cambian por Tablas Normales. En La tiendita todo se compra con Tablas Normales.';
  detailEquip.textContent='TABLAS NORMALES';detailEquip.disabled=true;
  const panel=document.createElement('div');panel.className='coins-panel';
  const buy=coinsView==='buy';
  panel.innerHTML=`<div class="coins-switch" role="tablist">
      <button type="button" role="tab" data-view="buy" aria-selected="${buy}">${coinsIcon('GOLD_COIN')}Comprar Tablas de Oro</button>
      <button type="button" role="tab" data-view="exchange" aria-selected="${!buy}">${coinsIcon('NORMAL_COIN')}Oro → Normales</button></div>
    <div class="coins-box"><h3>${buy?'TABLAS DE ORO <span>·</span> PAYPAL':'TABLAS DE ORO <span>⟶</span> TABLAS NORMALES'}</h3>
      <p>${!account.authenticated?'Inicia sesión con Google o Discord para usar tu monedero.':buy?'Elige un paquete y paga con PayPal de forma segura.':'Elige un paquete. El cambio se hace en el servidor y queda en tu historial.'}</p>
      <div class="coin-list">Cargando paquetes...</div></div>
    <div class="coins-info"><i aria-hidden="true">i</i><div><strong></strong><p></p></div></div>`;
  panel.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{coinsView=b.dataset.view;note='';render();});
  grid.append(panel);
  const list=panel.querySelector('.coin-list'),info=panel.querySelector('.coins-info');
  const setInfo=(title,text)=>{info.querySelector('strong').textContent=title;info.querySelector('p').innerHTML=text;};
  if(buy){
    setInfo('CONSEGUIR TABLAS DE ORO','Cargando...');
    try{
      const {enabled,products}=await accountApi.goldProducts();
      list.replaceChildren(...products.map((p,i)=>{
        const button=document.createElement('button');button.type='button';button.className='paypal-btn';
        const state=!enabled||!p.available?'PRÓXIMAMENTE':!account.authenticated?'INICIA SESIÓN':busy?'CONECTANDO…':'PAGO SEGURO';
        button.innerHTML=`<span class="pp-line">${PAYPAL_MARK}<span>Comprar con</span><b><i>Pay</i>Pal</b></span><small>${state}</small>`;
        button.disabled=!enabled||!p.available||!account.authenticated||busy;
        button.onclick=async()=>{if(busy)return;busy=true;note='';render();
          try{const r=await accountApi.checkout(p.id);location.href=r.approveUrl;return;}   // a PayPal; al volver, el servidor confirma el cobro
          catch(e){note=message(e.code);busy=false;render();}};
        return coinRow(i,{name:p.name,amount:`${formatCoins(p.goldAmount)} Tablas de Oro`,price:moneyText(p),button});
      }));
      if(!products.length)list.textContent='No hay paquetes configurados.';
      setInfo('CONSEGUIR TABLAS DE ORO',enabled
        ?`Pagas en <b>PayPal</b> (cuenta o tarjeta) y vuelves al juego. El oro llega cuando PayPal confirma el cobro; luego cámbialo en «Oro → Normales».${account.payments?.sandbox?' <em>Modo de prueba: sin dinero real.</em>':''}`
        :'La compra de Tablas de Oro con dinero real todavía no está disponible. Se activará cuando el pago con <b>PayPal</b> esté habilitado.');
    }catch{list.textContent='No se pudo conectar con el servidor de cuentas.';setInfo('CONSEGUIR TABLAS DE ORO','Sin conexión con el servidor.');}
    return;
  }
  setInfo('CÓMO FUNCIONA','Compra Tablas de Oro con <b>PayPal</b> en «Comprar Tablas de Oro» y cámbialas aquí por Tablas Normales para comprar en La tiendita.');
  try{
    const {packages:packs}=await accountApi.packages();
    list.replaceChildren(...packs.map((pack,i)=>{
      const enough=account.authenticated&&pack.active&&account.wallet.GOLD_COIN>=pack.goldPrice;
      const button=document.createElement('button');button.type='button';button.className='exchange-btn';
      button.innerHTML=`<span>${!pack.active?'PRÓXIMAMENTE':!account.authenticated?'INICIA SESIÓN':enough?'CAMBIAR':'SALDO INSUFICIENTE'}</span>${pack.goldPrice?`<small>${coinsIcon('GOLD_COIN')} ${formatCoins(pack.goldPrice)} DE ORO</small>`:''}`;
      button.disabled=!pack.active||!account.authenticated||!enough||busy;
      // Un requestId por clic: si el usuario pulsa dos veces o recarga, el servidor no repite el cambio.
      button.onclick=async()=>{if(busy)return;busy=true;button.disabled=true;
        try{const r=await accountApi.exchange(pack.id);note=`+${formatCoins(r.normalReceived??pack.normalAmount)} Tablas Normales`;}catch(e){note=message(e.code);}
        finally{busy=false;render();}};
      return coinRow(i,{name:pack.name,amount:`${formatCoins(pack.normalAmount)} Tablas Normales`,price:pack.goldPrice?`<span class="coin-inline">${coinsIcon('GOLD_COIN')} ${formatCoins(pack.goldPrice)} Tablas de Oro</span>`:'Precio por definir',button});
    }));
    list.querySelectorAll('.coin-art img').forEach(img=>img.src=COIN_ICONS.NORMAL_COIN);
    if(!packs.length)list.textContent='No hay paquetes configurados.';
  }catch{list.textContent='No se pudo conectar con el servidor de cuentas.';}
}
let category='character',opener,selected={character:profile.character,board:profile.board,wing:profile.wing,hat:profile.hat|0};
const categoryField=slotOf;
function render(){
  const scroll=grid.scrollTop;
  grid.replaceChildren();
  renderWallet();
  const noteEl=document.getElementById('shop-note');if(noteEl)noteEl.textContent=note;
  document.querySelectorAll('#shop-dialog [data-category]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.category===category)));
  if(category==='coins'){renderCoins();return;}
  const prop=categoryField(),list=prop==='wing'?wings:prop==='board'?boards:prop==='hat'?hats:characters,chosen=selected[prop]|0;
  list.forEach((name,id)=>{
    const st=itemState(prop,id);
    if(st.forSale===false&&!st.owned&&!st.free)return;   // retirado de la venta desde el panel (quien lo tiene lo conserva)
    const card=document.createElement('div');
    card.className=`shop-item${chosen===id?' is-selected':''}${st.equipped?' is-equipped':''}${st.usable?'':' is-locked'}`;
    const select=document.createElement('button');select.type='button';select.className='shop-item-select';
    select.setAttribute('aria-label',`Ver ${itemName(prop,id)} en el personaje`);
    select.setAttribute('aria-pressed',String(chosen===id));
    const art=document.createElement('span');art.className='shop-item-art';
    if(prop==='wing'){
      art.classList.add('wing-preview');
      art.style.backgroundImage=`url('${wingUrl(id)}')`;
    }else if(prop==='hat'){
      if(hatUrl(id)){const image=document.createElement('img');image.src=hatUrl(id);image.alt='';art.append(image);}
      else art.innerHTML='<span class="shop-no-hat" aria-hidden="true">∅</span>';
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
  // Hats: "Sin hat" (gratis) más los que se suban desde el panel administrativo.
  if(prop==='hat'&&hats.length<2){const p=document.createElement('p');p.className='shop-empty-note';p.textContent='Aún no hay más hats: cuando se añadan aparecerán aquí.';grid.append(p);}
  grid.scrollTop=scroll;
  const st=itemState(prop,chosen);
  detailName.textContent=itemName(prop,chosen);
  detailRarity.textContent=(RARITY_NAMES[st.rarity]||'COMÚN')+(st.free?' · GRATIS':` · ${formatCoins(st.price)} TABLAS NORMALES`);
  detailDescription.textContent=descriptions[prop][chosen];
  detailEquip.textContent=st.action==='buy'?`COMPRAR · ${formatCoins(st.price)}`:ACTION_TEXT[st.action];
  detailEquip.className=st.action==='buy'||st.action==='login'?'is-buy':st.action==='poor'?'is-poor':'';
  detailEquip.disabled=st.equipped||busy;
}
detailEquip.onclick=()=>{if(category!=='coins')act(categoryField(),selected[categoryField()]|0);};
async function openShop(startCategory='character',startNote=''){
  opener=document.activeElement;note=startNote;
  selected={character:profile.character,board:profile.board,wing:profile.wing,hat:profile.hat|0};
  category=startCategory;if(startCategory==='coins')coinsView='buy';
  dialog.showModal();render();preview.open(selected);
  await loadCatalog();if(dialog.open)render();
}
document.getElementById('shop-btn').onclick=()=>openShop();
// Vuelta de PayPal (?pago=estado&orden=id): se abre Monedas con el resultado que decidió el
// servidor. Aquí no se acredita nada; solo se muestra el estado real de la orden.
const PAY_RESULT={credited:'¡Pago completado! Tus Tablas de Oro ya están en tu monedero.',paid:'Pago recibido: las Tablas de Oro se están acreditando.',
  pending:'PayPal está revisando el pago. Las Tablas de Oro llegarán en cuanto lo confirme.',canceled:'Pago cancelado. No se te ha cobrado nada.',
  failed:'PayPal no aprobó el pago. No se te ha cobrado nada.'};
{
  const params=new URLSearchParams(location.search),result=params.get('pago'),order=params.get('orden');
  if(result){
    params.delete('pago');params.delete('orden');
    history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);
    let text=PAY_RESULT[result]||'No se pudo confirmar el pago. Si PayPal te cobró, el oro llegará solo en unos minutos; si no, escríbenos con el número de orden '+(order||'')+'.';
    setTimeout(async()=>{   // tras cargar todos los módulos (shop.js y account.js se importan entre sí)
      await accountApi.refresh();
      if(result==='credited'&&order)try{const r=await accountApi.orderStatus(order);text=`¡Pago completado! +${formatCoins(r.goldAmount)} Tablas de Oro en tu monedero.`;}catch{}
      openShop('coins',text);
    },0);
  }
}
document.getElementById('shop-close').onclick=()=>dialog.close();
dialog.addEventListener('close',()=>{preview.close();opener?.focus();});
document.querySelectorAll('#shop-dialog [data-category]').forEach(button=>button.onclick=()=>{category=button.dataset.category;note='';grid.scrollTop=0;render();});
document.addEventListener('surf:account',()=>{if(dialog.open)loadCatalog().then(render);});
document.getElementById('menu-btn')?.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('surf:menu')));

import {previewSvg} from '../characters/stick-avatar.js';
import {boardSkins} from '../shared/board-cosmetics.js';
import {createShopPreview} from './shop-preview.js';

export const characters=['Classic','Mint','Sunny','Lilac','Coral'];
export const boards=boardSkins.map(skin=>skin.name);
export const wings=['Angel','Aqua','Fire','Crystal','Nature','Bat Demon','Crimson Butterfly','Dark Demon','Mechanical Demon'];
export const wingFiles=['angel_wings.webp','aqua_wings.webp','fire_wings.webp','crystal_wings.webp','nature_wings.webp','bat_demon_wings.webp','crimson_butterfly_wings.webp','dark_demon_wings.webp','mechanical_demon_wings.webp'];

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
const descriptions={
  character:['El clásico de Surf Club. Siempre listo para la próxima ola.','Frescura turquesa para destacar en cada carrera.','Energía de atardecer sobre el mar.','Un toque lila para surfear con estilo.','El color cálido del arrecife coralino.'],
  board:['La primera ola: veloz, luminosa y tropical.','Una tabla oscura con carácter gótico.','El espíritu del dragón acompaña cada salto.','Arte anime que convierte cada ola en una escena.','Un diseño de cine para momentos épicos.','Estilo de bloques para construir tu propia ruta.'],
  wing:['Alas celestiales de luz suave.','Un brillo acuático detrás de cada giro.','Fuego tropical para vuelos memorables.','Cristales violetas de energía pura.','Hojas ligeras impulsadas por el viento.','Silueta de murciélago en rojo profundo.','Mariposa carmesí de fuego.','Plumas oscuras con bordes de llama.','Tecnología biónica para el aire.']
};
let category='character',opener,selected={character:profile.character,board:profile.board,wing:profile.wing};
const categoryField=()=>category==='wings'?'wing':category;
const itemList=()=>category==='character'?characters:category==='board'?boards:wings;
function itemName(id){return category==='wings'?`${wings[id]} Wings`:itemList()[id];}
function equip(id=selected[categoryField()]){
  if(category==='hats')return;
  profile[categoryField()]=id;
  selected[categoryField()]=id;
  preview.update(selected);
  saveProfile();
  document.dispatchEvent(new CustomEvent('surf:appearance'));
  render();
}
function render(){
  const scroll=grid.scrollTop;
  grid.replaceChildren();
  document.querySelectorAll('#shop-dialog [data-category]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.category===category)));
  if(category==='hats'){
    const p=document.createElement('p');p.className='coming-soon';
    p.innerHTML='<strong>Sombreros · Muy pronto</strong><br>El espacio ya está preparado para añadir hats sin cambiar la tienda.';
    grid.append(p);
    detailName.textContent='Hats · Pronto';detailRarity.textContent='PRÓXIMAMENTE';
    detailDescription.textContent='Gorras y sombreros de playa llegarán a Surf Club.';
    detailEquip.textContent='PRONTO';detailEquip.disabled=true;return;
  }
  const prop=categoryField(),list=itemList(),chosen=selected[prop];
  list.forEach((name,id)=>{
    const card=document.createElement('div');
    card.className=`shop-item${chosen===id?' is-selected':''}${profile[prop]===id?' is-equipped':''}`;
    const select=document.createElement('button');select.type='button';select.className='shop-item-select';
    select.setAttribute('aria-label',`Ver ${itemName(id)} en el personaje`);
    select.setAttribute('aria-pressed',String(chosen===id));
    const art=document.createElement('span');art.className='shop-item-art';
    if(category==='wings'){
      art.classList.add('wing-preview');
      art.style.backgroundImage=`url('/assets/images/wings/${wingFiles[id]}')`;
    }else if(category==='board'){
      const image=document.createElement('img');image.src=boardSkins[id].file;image.alt='';art.append(image);
    }else art.innerHTML=previewSvg(id,id);
    const title=document.createElement('strong');title.textContent=itemName(id);
    const state=document.createElement('small');state.textContent=profile[prop]===id?'EQUIPADO':'GRATIS';
    select.append(art,title,state);
    select.onclick=()=>{selected[prop]=id;preview.update(selected);render();};
    const action=document.createElement('button');action.type='button';action.className='shop-item-equip';
    action.textContent=profile[prop]===id?'✓ EQUIPADO':'EQUIPAR';action.disabled=profile[prop]===id;
    action.setAttribute('aria-label',`Equipar ${itemName(id)}`);
    action.onclick=()=>equip(id);
    card.append(select,action);grid.append(card);
  });
  grid.scrollTop=scroll;
  detailName.textContent=itemName(chosen);
  detailRarity.textContent='COMÚN';
  detailDescription.textContent=descriptions[prop][chosen];
  detailEquip.textContent=profile[prop]===chosen?'✓ EQUIPADO':'✓ EQUIPAR';
  detailEquip.disabled=profile[prop]===chosen;
}
detailEquip.onclick=()=>equip();
document.getElementById('shop-btn').onclick=()=>{
  opener=document.activeElement;
  selected={character:profile.character,board:profile.board,wing:profile.wing};
  category='character';dialog.showModal();render();preview.open(selected);
};
document.getElementById('shop-close').onclick=()=>dialog.close();
dialog.addEventListener('close',()=>{preview.close();opener?.focus();});
document.querySelectorAll('#shop-dialog [data-category]').forEach(button=>button.onclick=()=>{category=button.dataset.category;grid.scrollTop=0;render();});
document.getElementById('menu-btn')?.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('surf:menu')));

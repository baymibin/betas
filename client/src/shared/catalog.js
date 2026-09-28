// Catálogo cosmético compartido por el cliente (tienda, salas, perfil) y el servidor (base de
// datos de La tiendita). El índice de cada lista es el que usan Babylon.js y el protocolo:
// no reordenar ni borrar entradas, solo añadir al final.
//
// Además del catálogo base (este archivo), el panel administrativo puede subir tablas, wings y
// hats nuevos: se guardan en la base de datos (custom_items) y se AÑADEN al final de estas
// listas con applyCustomItems(), en el servidor al arrancar y en el navegador al cargar.
import {boardSkins} from './board-cosmetics.js';

export const characters=['Classic','Mint','Sunny','Lilac','Coral'];
export const boards=boardSkins.map(skin=>skin.name);
export const wings=['Angel','Aqua','Fire','Crystal','Nature','Bat Demon','Crimson Butterfly','Dark Demon','Mechanical Demon'];
// Nombre de archivo en /assets/images/wings/ (catálogo base) o URL absoluta (/uploads/...).
export const wingFiles=['angel_wings.webp','aqua_wings.webp','fire_wings.webp','crystal_wings.webp','nature_wings.webp','bat_demon_wings.webp','crimson_butterfly_wings.webp','dark_demon_wings.webp','mechanical_demon_wings.webp'];
export const hats=['Sin hat'];
export const hatFiles=[null];   // imagen frontal del hat (PNG/WebP con transparencia); 0 = sin hat
export const descriptions={
  character:['El clásico de Surf Club. Siempre listo para la próxima ola.','Frescura turquesa para destacar en cada carrera.','Energía de atardecer sobre el mar.','Un toque lila para surfear con estilo.','El color cálido del arrecife coralino.'],
  board:['La primera ola: veloz, luminosa y tropical.','Una tabla oscura con carácter gótico.','El espíritu del dragón acompaña cada salto.','Arte anime que convierte cada ola en una escena.','Un diseño de cine para momentos épicos.','Estilo de bloques para construir tu propia ruta.'],
  wing:['Alas celestiales de luz suave.','Un brillo acuático detrás de cada giro.','Fuego tropical para vuelos memorables.','Cristales violetas de energía pura.','Hojas ligeras impulsadas por el viento.','Silueta de murciélago en rojo profundo.','Mariposa carmesí de fuego.','Plumas oscuras con bordes de llama.','Tecnología biónica para el aire.'],
  hat:['Sin sombrero.']
};
export const wingUrl=index=>{const f=wingFiles[index]||wingFiles[0];return f.startsWith('/')?f:'/assets/images/wings/'+f;};
export const hatUrl=index=>hatFiles[index]||null;

// Ranuras de equipamiento y artículos del catálogo con su id estable ("wing:2").
export const SLOTS=['character','board','wing','hat'];
export const itemId=(slot,index)=>slot+':'+index;
export function parseItemId(id){
  const m=/^(character|board|wing|hat):(\d{1,3})$/.exec(String(id));
  if(!m)return null;
  const slot=m[1],index=Number(m[2]);
  return index<slotSize(slot)?{slot,index}:null;
}
export function slotSize(slot){return {character:characters.length,board:boardSkins.length,wing:wingFiles.length,hat:hats.length}[slot]||0;}
export function catalogItems(){
  const names={character:characters,board:boards,wing:wings.map(n=>n+' Wings'),hat:hats};
  const assets={character:()=>null,board:i=>boardSkins[i].file,wing:i=>wingUrl(i),hat:i=>hatUrl(i)};
  return SLOTS.flatMap(slot=>names[slot].map((name,index)=>({id:itemId(slot,index),category:slot,index,name,description:descriptions[slot][index]||'',asset:assets[slot](index)})));
}

// Añade al final los items subidos desde el panel (en orden de índice). Un item cuyo índice no
// sea exactamente el siguiente libre se ignora: así nunca se reordena ni se pisa el catálogo.
// Devuelve cuántos se añadieron. Seguro de llamar varias veces con la misma lista.
const CUSTOM_SLOTS=['board','wing','hat'];
export function applyCustomItems(items=[]){
  let added=0;
  const sorted=[...items].filter(i=>CUSTOM_SLOTS.includes(i?.category)).sort((a,b)=>a.assetIndex-b.assetIndex);
  for(const item of sorted){
    const index=Number(item.assetIndex),name=String(item.name||'').slice(0,40)||'Item',file=String(item.file||'');
    if(!file.startsWith('/uploads/')||index!==slotSize(item.category))continue;
    if(item.category==='board'){boardSkins.push({name,file,fullFile:item.fullFile||file,color:/^#[0-9a-f]{6}$/i.test(item.color||'')?item.color:'#27cbd3',width:Math.min(1,Math.max(.6,Number(item.width)||.84)),custom:true});boards.push(name);}
    if(item.category==='wing'){wings.push(name);wingFiles.push(file);}
    if(item.category==='hat'){hats.push(name);hatFiles.push(file);}
    descriptions[item.category].push(String(item.description||'').slice(0,200));
    added++;
  }
  return added;
}
// Nombres y descripciones cambiados desde el panel ([{id:'wing:3', name, description}]). En las
// wings el nombre va sin el sufijo " Wings" (se añade al mostrarlo).
export function applyItemTexts(texts=[]){
  const lists={character:characters,board:boards,wing:wings,hat:hats};
  for(const t of texts){
    const p=parseItemId(t?.id);if(!p)continue;
    if(t.name){const name=String(t.name).slice(0,40);lists[p.slot][p.index]=name;if(p.slot==='board')boardSkins[p.index].name=name;}
    if(t.description)descriptions[p.slot][p.index]=String(t.description).slice(0,200);
  }
}

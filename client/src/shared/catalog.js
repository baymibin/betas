// Catálogo cosmético compartido por el cliente (tienda, salas, perfil) y el servidor (base de
// datos de La tiendita). El índice de cada lista es el que usan Babylon.js y el protocolo:
// no reordenar ni borrar entradas, solo añadir al final.
import {boardSkins, WING_COUNT, HAT_COUNT} from './board-cosmetics.js';

export const characters=['Classic','Mint','Sunny','Lilac','Coral'];
export const boards=boardSkins.map(skin=>skin.name);
export const wings=['Angel','Aqua','Fire','Crystal','Nature','Bat Demon','Crimson Butterfly','Dark Demon','Mechanical Demon'];
export const wingFiles=['angel_wings.webp','aqua_wings.webp','fire_wings.webp','crystal_wings.webp','nature_wings.webp','bat_demon_wings.webp','crimson_butterfly_wings.webp','dark_demon_wings.webp','mechanical_demon_wings.webp'];
export const hats=['Sin hat'];
export const descriptions={
  character:['El clásico de Surf Club. Siempre listo para la próxima ola.','Frescura turquesa para destacar en cada carrera.','Energía de atardecer sobre el mar.','Un toque lila para surfear con estilo.','El color cálido del arrecife coralino.'],
  board:['La primera ola: veloz, luminosa y tropical.','Una tabla oscura con carácter gótico.','El espíritu del dragón acompaña cada salto.','Arte anime que convierte cada ola en una escena.','Un diseño de cine para momentos épicos.','Estilo de bloques para construir tu propia ruta.'],
  wing:['Alas celestiales de luz suave.','Un brillo acuático detrás de cada giro.','Fuego tropical para vuelos memorables.','Cristales violetas de energía pura.','Hojas ligeras impulsadas por el viento.','Silueta de murciélago en rojo profundo.','Mariposa carmesí de fuego.','Plumas oscuras con bordes de llama.','Tecnología biónica para el aire.'],
  hat:['Sin sombrero. Los hats llegarán pronto a Surf Club.']
};

// Ranuras de equipamiento y artículos del catálogo con su id estable ("wing:2").
export const SLOTS=['character','board','wing','hat'];
export const itemId=(slot,index)=>slot+':'+index;
export function parseItemId(id){
  const m=/^(character|board|wing|hat):(\d{1,3})$/.exec(String(id));
  if(!m)return null;
  const slot=m[1],index=Number(m[2]);
  return index<slotSize(slot)?{slot,index}:null;
}
export function slotSize(slot){return {character:characters.length,board:boardSkins.length,wing:WING_COUNT,hat:HAT_COUNT}[slot]||0;}
export function catalogItems(){
  const names={character:characters,board:boards,wing:wings.map(n=>n+' Wings'),hat:hats};
  const assets={character:()=>null,board:i=>boardSkins[i].file,wing:i=>'/assets/images/wings/'+wingFiles[i],hat:()=>null};
  return SLOTS.flatMap(slot=>names[slot].map((name,index)=>({id:itemId(slot,index),category:slot,index,name,description:descriptions[slot][index]||'',asset:assets[slot](index)})));
}

export const MAPS=[
 {id:0,name:'Bahia Coral',difficulty:1,kind:'tropical',sand:'#f7d7a0',water:'#238f9c',sky:'#b3dbe0',leaf:'#c6dfba'},
 {id:1,name:'Costa Esmeralda',difficulty:2,kind:'lagoon',sand:'#e0d7a5',water:'#247b69',sky:'#b5d4c7',leaf:'#91c89b'},
 {id:2,name:'Islas del Sol',difficulty:3,kind:'sunset',sand:'#e7bc8a',water:'#526f95',sky:'#eab2a1',leaf:'#d0b397'},
 {id:3,name:'Playa de Dunas',difficulty:4,kind:'desert',sand:'#e5b979',water:'#3e9dba',sky:'#e5cfaf',leaf:'#d7be89'},
 {id:4,name:'Costa Volcanica',difficulty:5,kind:'volcanic',sand:'#8c8585',water:'#456778',sky:'#a7a5b6',leaf:'#9caaa0'},
 {id:5,name:'Bahia Polar',difficulty:6,kind:'ice',sand:'#e2eff4',water:'#558cac',sky:'#c6dbea',leaf:'#e0eff0'},
 {id:6,name:'Manglar Salvaje',difficulty:7,kind:'mangrove',sand:'#b3bb8a',water:'#547c72',sky:'#b9c9b3',leaf:'#829e73'},
 {id:7,name:'Archipielago Lunar',difficulty:8,kind:'night',sand:'#b6a8c9',water:'#39446d',sky:'#707ca2',leaf:'#a5a0ce'}
];

// Disponibilidad de circuitos: ÚNICA fuente de verdad (cliente y servidor).
// Para habilitar otro circuito, añade su id real (el de MAPS) a esta lista.
export const ENABLED_MAP_IDS = Object.freeze([0]); // 0 = Bahia Coral
export function isMapEnabled(id) { return ENABLED_MAP_IDS.includes(Number(id)); }

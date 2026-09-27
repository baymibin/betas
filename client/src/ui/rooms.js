import {MAPS, ENABLED_MAP_IDS, isMapEnabled} from '../shared/maps.js';
import {read,readRoomList} from '../shared/protocol.js';
import {characterColors, borderColor, previewSvg} from '../characters/stick-avatar.js';
import {boardSkins} from '../shared/board-cosmetics.js';
import {wingFiles, profile as userProfile} from './shop.js';

const MAP_ITEMS = [
  {
    id: 0,
    name: 'Bahia Coral',
    diffNum: 1,
    diff: '1/8',
    thumb: '/assets/images/maps/thumbnail_1.png',
    banner: '/assets/images/maps/background_1.png',
    note: 'Aguas cristalinas y arrecifes desafiantes.'
  },
  {
    id: 4,
    name: 'Costa Volcanica',
    diffNum: 5,
    diff: '5/8',
    thumb: '/assets/images/maps/thumbnail_2.png',
    banner: '/assets/images/maps/background_2.png',
    note: 'Circuito ardiente entre cráteres y lava.'
  },
  {
    id: 5,
    name: 'Bahia Polar',
    diffNum: 6,
    diff: '6/8',
    thumb: '/assets/images/maps/thumbnail_3.png',
    banner: '/assets/images/maps/background_3.png',
    note: 'Una aventura extrema entre témpanos de hielo.'
  },
  {
    id: 2,
    name: 'Islas del Sol',
    diffNum: 3,
    diff: '3/8',
    thumb: '/assets/images/maps/thumbnail_4.png',
    banner: '/assets/images/maps/background_4.png',
    note: 'Olas doradas bajo la puesta del sol.'
  },
  {
    id: 1,
    name: 'Costa Esmeralda',
    diffNum: 2,
    diff: '2/8',
    thumb: '/assets/images/maps/thumbnail_5.png',
    banner: '/assets/images/maps/background_5.png',
    note: 'Una escapada entre verdes lagunas y corales.'
  },
  {
    id: 3,
    name: 'Playa de Dunas',
    diffNum: 4,
    diff: '4/8',
    thumb: '/assets/images/maps/thumbnail_6.png',
    banner: '/assets/images/maps/background_6.png',
    note: 'Cavernas marinas, arcos de roca y arena dorada.'
  },
  {
    id: 6,
    name: 'Manglar Salvaje',
    diffNum: 7,
    diff: '7/8',
    thumb: '/assets/images/maps/thumbnail_7.png',
    banner: '/assets/images/maps/background_7.png',
    note: 'Furia de tormentas, relámpagos y olas gigantes.'
  },
  {
    id: 7,
    name: 'Archipielago Lunar',
    diffNum: 8,
    diff: '8/8',
    thumb: '/assets/images/maps/thumbnail_8.png',
    banner: '/assets/images/maps/background_8.png',
    note: 'Exuberantes cascadas y canales místicos.'
  }
];

function getMapItem(mapId) {
  const item = MAP_ITEMS.find(m => m.id === mapId);
  if (item) return item;
  const m = MAPS[mapId] || MAPS[0];
  return {
    id: m.id,
    name: m.name,
    diffNum: m.difficulty,
    diff: `${m.difficulty}/8`,
    thumb: `/assets/images/maps/thumbnail_${(m.id % 8) + 1}.png`,
    banner: `/assets/images/maps/background_${(m.id % 8) + 1}.png`,
    note: 'Circuito de carreras sobre las olas.'
  };
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

/* ==========================================================================
   SALA DE ESPERA — preview de jugador exclusivo del lobby.
   No se usa en gameplay (el personaje de carrera sigue en stick-avatar.js).
   ========================================================================== */

function mixHex(hex, target, amount) {
  const a = hex.replace('#', '').match(/../g).map(v => parseInt(v, 16));
  const b = target.replace('#', '').match(/../g).map(v => parseInt(v, 16));
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('');
}

function lobbyPalette(hex) {
  const base = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#f6faf8';
  const ambient = '#0a2a3a';
  return {
    spec: '#ffffff',
    light: mixHex(base, '#ffffff', 0.55),
    mid: mixHex(base, '#ffffff', 0.18),
    base,
    shadow: mixHex(base, ambient, 0.42),
    deep: mixHex(base, ambient, 0.72)
  };
}

let lobbyRigSeq = 0;

// Capsule 3D (tubo redondeado) entre dos puntos, con sombreado cilíndrico
// orientado siempre hacia una luz superior izquierda.
function lobbyCapsule(uid, x1, y1, x2, y2, w) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const theta = Math.atan2(-dx, dy);
  const lightLeft = (Math.cos(theta) * -0.6 + Math.sin(theta) * -0.8) > 0 ? 'lr' : 'rl';
  const deg = (theta * 180 / Math.PI).toFixed(2);
  return `<g transform="translate(${x1} ${y1}) rotate(${deg})">
      <rect x="${-w / 2}" y="${-w / 2}" width="${w}" height="${(len + w).toFixed(2)}" rx="${w / 2}" fill="url(#${uid}-${lightLeft})"/>
    </g>`;
}

function renderLobbyStickmanSvg(skinHex) {
  const c = lobbyPalette(skinHex);
  const uid = `lob${++lobbyRigSeq}`;
  // Coordenadas del rig: 120 x 150 (1 unidad = 1px de la IMAGEN B).
  const cx = 60;
  const shoulder = { x: cx, y: 66 };
  const hip = { x: cx, y: 101 };
  return `
    <svg class="wp-lobby-stick" viewBox="0 0 120 150" aria-hidden="true">
      <defs>
        <linearGradient id="${uid}-rl" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="${c.light}"/>
          <stop offset="0.22" stop-color="${c.spec}" stop-opacity="0.95"/>
          <stop offset="0.42" stop-color="${c.mid}"/>
          <stop offset="0.72" stop-color="${c.base}"/>
          <stop offset="1" stop-color="${c.shadow}"/>
        </linearGradient>
        <linearGradient id="${uid}-lr" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stop-color="${c.light}"/>
          <stop offset="0.22" stop-color="${c.spec}" stop-opacity="0.95"/>
          <stop offset="0.42" stop-color="${c.mid}"/>
          <stop offset="0.72" stop-color="${c.base}"/>
          <stop offset="1" stop-color="${c.shadow}"/>
        </linearGradient>
        <radialGradient id="${uid}-head" cx="0.4" cy="0.34" r="0.72" fx="0.33" fy="0.24">
          <stop offset="0" stop-color="${c.spec}"/>
          <stop offset="0.16" stop-color="${c.light}"/>
          <stop offset="0.48" stop-color="${c.mid}"/>
          <stop offset="0.8" stop-color="${c.base}"/>
          <stop offset="1" stop-color="${c.shadow}"/>
        </radialGradient>
        <radialGradient id="${uid}-rim" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.78" stop-color="${c.deep}" stop-opacity="0"/>
          <stop offset="1" stop-color="${c.deep}" stop-opacity="0.55"/>
        </radialGradient>
        <radialGradient id="${uid}-glint" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${uid}-ao" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="${c.deep}" stop-opacity="0.75"/>
          <stop offset="1" stop-color="${c.deep}" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <!-- Piernas (quedan recortadas por el panel inferior, como en la referencia) -->
      ${lobbyCapsule(uid, hip.x - 2, hip.y, 49, 147, 8.6)}
      ${lobbyCapsule(uid, hip.x + 2, hip.y, 71, 147, 8.6)}

      <!-- Torso -->
      ${lobbyCapsule(uid, cx, 60, cx, hip.y + 2, 10)}

      <!-- Brazos abiertos hacia abajo -->
      ${lobbyCapsule(uid, shoulder.x - 1, shoulder.y, 21, 98, 8)}
      ${lobbyCapsule(uid, shoulder.x + 1, shoulder.y, 99, 98, 8)}

      <!-- Oclusión bajo la cabeza -->
      <ellipse cx="${cx}" cy="64.5" rx="10" ry="4.2" fill="url(#${uid}-ao)"/>

      <!-- Cabeza esférica -->
      <circle cx="${cx}" cy="44" r="19.5" fill="url(#${uid}-head)"/>
      <circle cx="${cx}" cy="44" r="19.5" fill="url(#${uid}-rim)"/>
      <ellipse cx="53.5" cy="35" rx="6" ry="4.2" fill="url(#${uid}-glint)" transform="rotate(-28 53.5 35)"/>
    </svg>
  `;
}

function renderLobbyAvatar({ skinHex, wingFile, boardSkin, isHost }) {
  const wingUrl = `/assets/images/wings/${wingFile}`;
  const boardSrc = boardSkin.file || boardSkin.fullFile;
  return `
    <div class="wp-lobby-rig" aria-hidden="true">
      <div class="wp-lobby-wings">
        <span class="wp-lobby-wing left" style="background-image:url('${wingUrl}')"></span>
        <span class="wp-lobby-wing right" style="background-image:url('${wingUrl}')"></span>
      </div>
      ${renderLobbyStickmanSvg(skinHex)}
    </div>
    <img class="wp-lobby-board" src="${boardSrc}" alt="${escapeHtml(boardSkin.name)}" draggable="false">
  `;
}

function renderEmptySlotSvg() {
  // Silueta en coordenadas reales de la tarjeta de referencia (263 x 130).
  return `
    <svg class="wp-empty-figure" viewBox="0 0 263 130" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
      <g fill="none" stroke="#d3f3fa" stroke-opacity="0.85" stroke-width="1.55" stroke-dasharray="4.6 2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="128" cy="43" r="15"/>
        <path d="M123.5 58.3 C119.5 59.3 115.5 61 114.5 65 L106 86.5 L99.5 112.5
                 C98.2 118.5 106 120.5 107.4 115.2 L113.5 91 L117.5 81
                 L118.5 96 L113.5 124 C113 128.5 119 129.5 120 125.5 L126.5 101.5 L130 101.5
                 L132.5 125.5 C133.5 129.5 139.5 129 139 124.5 L139 97 L140.5 80
                 L141.5 70 C140.5 62.5 137 59.5 132.5 58.3"/>
        <path d="M141.5 70 L150 88"/>
      </g>
      <circle cx="149" cy="101" r="19" fill="#03384f" stroke="#a6f0f6" stroke-width="2"/>
      <path d="M149 92.5 V109.5 M140.5 101 H157.5" stroke="#dcfdff" stroke-width="3.4" stroke-linecap="round"/>
    </svg>
    <span class="wp-empty-text">Espacio disponible</span>
  `;
}

const WAIT_TITLE_WAVE = `<svg class="wp-title-wave" viewBox="0 0 40 40" aria-hidden="true">
  <defs>
    <linearGradient id="wpWaveBody" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#6fe2ff"/><stop offset="0.55" stop-color="#1c9df0"/><stop offset="1" stop-color="#0a5fc4"/>
    </linearGradient>
  </defs>
  <path d="M3 34 C6 22 12 9 24 6.5 C31.5 5 37.5 9.5 37 16 C36.6 21.5 30.5 24 27 21 C24.6 19 25.6 15 29 15.5 C27.8 12.5 22.5 12 19.5 16 C15.5 21.5 17 30 22 34.5 C24 36.3 26.5 37 29 37 H6 C4.2 37 2.8 35.8 3 34 Z" fill="url(#wpWaveBody)"/>
  <path d="M19.5 16 C22.5 12 27.8 12.5 29 15.5 C25.6 15 24.6 19 27 21 C24 20.5 21.5 17.8 19.5 16 Z" fill="#ffffff" opacity="0.95"/>
  <path d="M6 30 C8.5 21 13.5 12.5 22 9.5" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" opacity="0.75"/>
  <path d="M26 36.6 C31 37 35.5 35 38 31.5" fill="none" stroke="#bff3ff" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const WAIT_ICONS = {
  clipboard: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 2h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V3a1 1 0 0 1 1-1zm0 2v2h6V4H9zm-1 7v1.8h8V11H8zm0 4v1.8h6V15H8z"/></svg>',
  checkeredFlag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M6 4h14v10H6z" fill="#ffffff" stroke="currentColor" stroke-width="1.4"/><path d="M6 4h3.5v2.5H6zM13 4h3.5v2.5H13zM9.5 6.5H13V9H9.5zM16.5 6.5H20V9h-3.5zM6 9h3.5v2.5H6zM13 9h3.5v2.5H13zM9.5 11.5H13V14H9.5zM16.5 11.5H20V14h-3.5z" fill="currentColor"/></svg>'
};

const CP_PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c-4.2 0-7.4 3.2-7.4 7.3 0 5.4 6.3 11.6 6.6 11.9.4.4 1.1.4 1.5 0 .3-.3 6.6-6.5 6.6-11.9 0-4.1-3.2-7.3-7.3-7.3zm0 10.2a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" fill="currentColor"/></svg>';

// Iconos de etiqueta por circuito (id real del mapa).
const CIRCUIT_ICONS = {
  0: '<svg viewBox="0 0 24 24"><path d="M12 2.5c-3.9 0-6.9 3-6.9 6.8 0 5 5.9 10.8 6.2 11.1.4.4 1 .4 1.4 0 .3-.3 6.2-6.1 6.2-11.1 0-3.8-3-6.8-6.9-6.8zm0 9.4a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4z" fill="currentColor"/></svg>',
  4: '<svg viewBox="0 0 24 24"><path d="M1.8 21 8.6 9.2h2.1l1.3-1.6 1.3 1.6h2.1L22.2 21z" fill="currentColor"/><path d="M10.4 7.2 12 4.6l1.6 2.6M12 4.6V2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  5: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 3.8 12 6l2.5-2.2M9.5 20.2 12 18l2.5 2.2"/></svg>',
  2: '<svg viewBox="0 0 24 24"><path d="M11.2 21.5c.3-4.3.1-8.1-.9-11.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10.4 9.8C8.6 6.6 5.3 6 3 7.4c2.6-.2 4.3.7 5.4 2.4M10.4 9.8c.9-3.4 3.8-5 6.6-4.3-2.4.6-3.7 2-4.2 4M10.4 9.8c3.4-.9 6.6.5 7.6 3.3-1.9-1.5-4-1.9-5.9-1.4M10.4 9.8c-3 .3-5 2.6-5 5.5 1-2.2 2.8-3.4 4.8-3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 21.5h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  1: '<svg viewBox="0 0 24 24"><path d="M5 19c0-8 5.5-13.5 15-14-.6 9.4-6 15-14 15" fill="currentColor"/><path d="M4 20.5c3-4.5 6.3-7.8 10-10" stroke="#06384b" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
  3: '<svg viewBox="0 0 24 24"><circle cx="16.5" cy="7.5" r="3.6" fill="currentColor"/><path d="M1.5 20.5c2.8-4.6 6.4-6.4 9.8-5 2.8 1.2 5.6 1.1 11.2-1.6v6.6z" fill="currentColor"/></svg>',
  6: '<svg viewBox="0 0 24 24"><path d="M13.5 2.5 5.5 13.5h5.2l-1.7 8 8.5-11.4h-5.3z" fill="currentColor"/></svg>',
  7: '<svg viewBox="0 0 24 24"><path d="M15.5 3.2A8.8 8.8 0 1 0 20.8 16 7.4 7.4 0 0 1 15.5 3.2z" fill="currentColor"/></svg>'
};

// Iconos de Buscar salas.
const SB_ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/></svg>',
  plusCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5a4.3 4.3 0 0 0-4.3 4.3c0 3 4.3 7.2 4.3 7.2s4.3-4.2 4.3-7.2A4.3 4.3 0 0 0 12 2.5zm0 5.9a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2z"/><path d="M3 15.5c3-1.4 5.2-1.2 7.5 0s4.6 1.3 7.5 0l3-1.2v5.2c-3 1.4-5.2 1.3-7.5 0s-4.6-1.3-7.5 0L3 20.7z" opacity=".75"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="7.5" r="3.5"/><path d="M2.5 19.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6z"/><circle cx="17" cy="8.5" r="2.7" opacity=".7"/><path d="M16.5 13.2c3 .2 5 2.3 5 5.3h-4.4c0-2-.3-3.7-.6-5.3z" opacity=".7"/></svg>',
  sort: '<svg class="sb-sort-icon" viewBox="0 0 12 16" fill="currentColor"><path d="M6 1 2 6h8zM6 15l4-5H2z"/></svg>',
  crown: '<svg class="sb-crown" viewBox="0 0 24 24" fill="#ffd34d"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
  ticket: '<svg class="sb-ticket" viewBox="0 0 64 48" aria-hidden="true"><defs><linearGradient id="sbTk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7ff5ee"/><stop offset="1" stop-color="#16a7c4"/></linearGradient></defs><g transform="rotate(-10 32 24)"><path d="M6 10h52v9a5 5 0 0 0 0 10v9H6v-9a5 5 0 0 0 0-10z" fill="url(#sbTk)" stroke="#dcfffb" stroke-width="2"/><path d="M42 12v24" stroke="#0b5a6e" stroke-width="2" stroke-dasharray="3 3"/><rect x="13" y="18" width="22" height="4" rx="2" fill="#0b5a6e"/><rect x="13" y="26" width="15" height="4" rx="2" fill="#0b5a6e" opacity=".7"/></g></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  palm: '<svg class="sb-palm" viewBox="0 0 40 40" aria-hidden="true"><path d="M19 38c1.2-7 1.3-13 .3-19" stroke="#5ce8f0" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M19.5 18c-3.5-5-9.5-5.5-13-2.5 4-.3 7 .9 9.3 3.3M19.5 18c1.5-5.8 7-8 11.6-6.4-4 .8-6.3 2.9-7.6 5.8M19.5 18c5.5-1.4 10.8 1 12.2 5.2-2.8-2.3-6.1-2.9-9.4-2.2M19.5 18c-5 .6-8.2 4.4-8.1 9.1 1.5-3.6 4.3-5.6 7.5-6" stroke="#5ce8f0" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M8 38h24" stroke="#5ce8f0" stroke-width="2.4" stroke-linecap="round"/></svg>',
  loading: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#36dae5" stroke-width="2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></path></svg>'
};

const ICONS = {
  waveTitle: '<img class="mp-title-wave" src="/assets/images/menu/custom_ui/createWaveIcon.png" alt="" aria-hidden="true">',
  waveButton: '<svg class="mp-btn-wave" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 4.5C7 4.5 3.5 8 3.5 12c0 2.5 1.2 4.8 3.1 6.2C6 16.5 6 15 6.5 13.8c1-2.5 3.2-4.3 6-4.3 1.8 0 3.4.7 4.5 1.8-1.2-.6-2.5-.9-4-.9-2.8 0-5 2-5 4.8 0 1.3.5 2.5 1.3 3.4 2.8-.2 5-2 6-4.6.9-2.3 0-5-2.3-6.2-.7-.4-1.5-.5-2-.5z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="22" height="22" fill="#36dae5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>',
  lock: '<svg class="mp-access-icon" viewBox="0 0 20 20" width="15" height="15" fill="#36dae5"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg>',
  unlock: '<svg class="mp-access-icon open" viewBox="0 0 20 20" width="15" height="15" fill="#34d399"><path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.9-0.8.9.9 0 001.8-.4A5 5 0 0010 2z"/></svg>',
  search: '<svg class="mp-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#36dae5" stroke-width="2.5"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M5 11h14v2H5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  emptyWave: '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#36dae5" stroke-width="1.6"><path d="M2 17c4 5 7-2 10 0s6 4 10 0M3 13c3-7 8-10 13-7-5-1-7 4-3 7 2 2 4 2 7 1"/></svg>',
  people: '<svg viewBox="0 0 24 24" width="20" height="20" fill="#36dae5"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>',
  wrench: '<svg viewBox="0 0 24 24" width="20" height="20" fill="#36dae5"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.6C.5 7 .9 10 2.9 12c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.3z"/></svg>',
  key: '<svg viewBox="0 0 24 24" width="20" height="20" fill="#36dae5"><path d="M7 14A5 5 0 1 1 12 9c0 .54-.08 1.07-.25 1.56L18 17v3h-3v-2h-2v-2h-1.56A4.97 4.97 0 0 1 7 14zm0-3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>',
  crown: '<svg viewBox="0 0 24 24" width="14" height="14" fill="#1b1c1e"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  flag: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-6z"/></svg>'
};

export function createRoomUI(net, profile, onRace) {
  const root = document.createElement('dialog');
  root.id = 'rooms-browser';
  document.body.append(root);

  if (!document.querySelector('link[data-multiplayer-style]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = '/styles/multiplayer.css';
    style.dataset.multiplayerStyle = '';
    document.head.append(style);
  }

  let socket, timer, busy = false, began = false, roster = [], mode = 'browse', signature = '';
  let selectedMapId = 0, selectedCapacity = 8, selectedPrivate = false;
  let selectedBotsOn = false, selectedBots = 3;   // bots opcionales: solo si el anfitrión los activa
  let pendingBots = 0;                             // bots pedidos al crear (para avisar si el servidor no los admite)

  function stop() {
    clearInterval(timer);
    const ws = socket;
    socket = null;
    ws?.close();
  }

  function close() {
    stop();
    net.close();
    root.close();
  }

  root.addEventListener('cancel', close);

  function shell(title) {
    signature = '';
    root.classList.add('mp-menu');
    root.classList.remove('wp-waiting-mode');
    root.setAttribute('aria-label', title);
    const subtitle = mode === 'browse'
      ? 'Encuentra salas públicas o únete con un código de sala.'
      : 'Configura tu circuito y crea tu sala de espera.';
    root.innerHTML = `
      <div class="mp-shell">
        <header class="mp-header">
          <div>
            <span class="mp-kicker">${mode === 'browse' ? '' : '🌴 '}SURF SALVAJE · MULTIJUGADOR</span>
            <h2><span>${title}</span> <span class="mp-title-wave" aria-hidden="true">🌊</span></h2>
            <p class="mp-subtitle">${subtitle}</p>
          </div>
          <button aria-label="Cerrar salas" class="room-close" type="button">×</button>
        </header>
        <nav class="mp-tabs-bar" aria-label="Multijugador">
          <button id="tab-browse" type="button"><span class="mp-tab-icon" aria-hidden="true">${SB_ICONS.search}</span>Buscar salas</button>
          <button id="tab-create" type="button"><span class="mp-tab-icon" aria-hidden="true">${SB_ICONS.plusCircle}</span>Crear partida</button>
        </nav>
        <div id="room-content"></div>
        <p id="room-error" role="alert"></p>
      </div>
    `;

    root.querySelector('.room-close').onclick = close;
    root.querySelector('#tab-browse').onclick = () => form('browse');
    root.querySelector('#tab-create').onclick = () => form('create');
  }

  function form(view = mode) {
    stop();
    net.close();
    roster = [];
    mode = view;
    shell(view === 'browse' ? 'Buscar salas' : 'Crear partida');
    root.dataset.view = view;
    root.classList.toggle('mp-create-mode', view === 'create');
    root.classList.toggle('mp-browse-mode', view === 'browse');

    const activeTab = root.querySelector('#tab-' + view);
    if (activeTab) {
      activeTab.classList.add('active');
      activeTab.setAttribute('aria-current', 'page');
    }

    const content = root.querySelector('#room-content');

    if (view === 'create') {
      // Nunca queda seleccionado un circuito bloqueado (maps.js decide la disponibilidad).
      if (!isMapEnabled(selectedMapId)) selectedMapId = ENABLED_MAP_IDS[0];
      const PAGE_SIZE = 4;
      const pageCount = Math.ceil(MAP_ITEMS.length / PAGE_SIZE);
      const selectedIndex = Math.max(0, MAP_ITEMS.findIndex(m => m.id === selectedMapId));
      let currentPage = Math.floor(selectedIndex / PAGE_SIZE);

      content.innerHTML = `
        <div class="room-create-layout cp-layout">
          <!-- MAPA: 4 circuitos grandes por página (8 en total) -->
          <div class="mp-interactive-map-area cp-map">
            <div class="cp-pages" id="cp-pages">
              ${Array.from({ length: pageCount }, (_, page) => `
                <div class="cp-page" data-page="${page}" ${page === currentPage ? '' : 'hidden'}>
                  ${MAP_ITEMS.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).map((item, slot) => `
                    <button type="button" class="mp-island-card cp-island slot-${slot} ${item.id === selectedMapId ? 'active' : ''} ${isMapEnabled(item.id) ? '' : 'is-locked'}" data-map-id="${item.id}" aria-pressed="${item.id === selectedMapId}" ${isMapEnabled(item.id) ? `aria-label="Seleccionar ${escapeHtml(item.name)}, dificultad ${item.diff}"` : `aria-disabled="true" aria-label="${escapeHtml(item.name)}: próximamente"`}>
                      <img src="${item.thumb}" alt="" class="cp-island-img" draggable="false">
                      ${isMapEnabled(item.id) ? '' : `<span class="cp-lock" aria-hidden="true">${SB_ICONS.lock}<b>PRÓXIMAMENTE</b></span>`}
                      <span class="cp-island-label">
                        <span class="cp-island-icon">${CIRCUIT_ICONS[item.id] || CIRCUIT_ICONS[0]}</span>
                        <span class="cp-island-text">
                          <span class="cp-island-name">${escapeHtml(item.name)}</span>
                          <span class="cp-island-diff">${item.diff}</span>
                        </span>
                      </span>
                    </button>
                  `).join('')}
                </div>
              `).join('')}
            </div>
            <div class="cp-toast" id="cp-toast" role="status" aria-live="polite"></div>
            <div class="cp-pager" role="group" aria-label="Páginas de circuitos">
              <button type="button" class="cp-pager-btn" id="cp-prev" aria-label="Circuitos anteriores">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <span class="cp-pager-dots">
                ${Array.from({ length: pageCount }, (_, page) => `<button type="button" class="cp-dot" data-page="${page}" aria-label="Página ${page + 1}"></button>`).join('')}
              </span>
              <button type="button" class="cp-pager-btn" id="cp-next" aria-label="Más circuitos">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </div>

          <!-- PANEL DE CONFIGURACIÓN -->
          <div class="mp-config-card cp-config">
            <div class="mp-banner-wrap cp-banner">
              <img id="mp-preview-banner" src="${getMapItem(selectedMapId).banner}" alt="Vista previa del circuito" draggable="false">
            </div>

            <div class="mp-circuit-header cp-circuit">
              <div class="cp-pin">${CP_PIN}</div>
              <div class="mp-circuit-text">
                <h3 id="mp-circuit-name">${escapeHtml(getMapItem(selectedMapId).name)}</h3>
                <p id="mp-circuit-desc">${escapeHtml(getMapItem(selectedMapId).note)}</p>
              </div>
            </div>

            <div class="mp-field-group cp-diff">
              <span class="mp-field-label">Dificultad</span>
              <div class="cp-diff-row">
                <div class="mp-difficulty-bar" id="mp-diff-bar"></div>
                <span class="mp-diff-value" id="mp-diff-text">${getMapItem(selectedMapId).diff}</span>
              </div>
            </div>

            <div class="mp-field-group cp-capacity">
              <span class="mp-field-label">Máximo de jugadores</span>
              <div class="mp-stepper">
                <button type="button" class="mp-step-btn minus" id="step-minus" aria-label="Menos jugadores">${ICONS.minus}</button>
                <div class="mp-stepper-display" id="capacity-display" aria-live="polite">${selectedCapacity} jugadores</div>
                <button type="button" class="mp-step-btn plus" id="step-plus" aria-label="Más jugadores">${ICONS.plus}</button>
              </div>
            </div>

            <div class="cp-toggles">
              <div class="mp-toggle-row cp-private">
                <label for="room-private-toggle" class="mp-toggle-label">Privada <span class="mp-muted">(opcional)</span></label>
                <label class="mp-switch">
                  <input type="checkbox" id="room-private-toggle" ${selectedPrivate ? 'checked' : ''}>
                  <span class="mp-slider"></span>
                </label>
              </div>
              <div class="mp-toggle-row cp-private cp-bots-row">
                <label for="room-bots-toggle" class="mp-toggle-label">Bots <span class="cp-ia-tag">IA</span></label>
                <label class="mp-switch">
                  <input type="checkbox" id="room-bots-toggle" ${selectedBotsOn ? 'checked' : ''} aria-describedby="bots-desc">
                  <span class="mp-slider"></span>
                </label>
              </div>
            </div>
            <div class="cp-bots-line">
              <p class="cp-bots-desc" id="bots-desc" ${selectedBotsOn ? 'hidden' : ''}>Añade surfistas controlados por IA para completar la carrera.</p>
              <div class="mp-stepper cp-bots-stepper" id="bots-stepper" ${selectedBotsOn ? '' : 'hidden'}>
                <button type="button" class="mp-step-btn minus" id="bots-minus" aria-label="Menos bots">${ICONS.minus}</button>
                <div class="mp-stepper-display" id="bots-display" aria-live="polite">${selectedBots} bots</div>
                <button type="button" class="mp-step-btn plus" id="bots-plus" aria-label="Más bots">${ICONS.plus}</button>
              </div>
            </div>

            <div class="mp-field-group cp-code">
              <label class="mp-field-label" for="create-room-code">Código de sala (6 números)</label>
              <!-- El servidor asigna el código real al crear la sala; aquí no existe todavía. -->
              <input type="text" id="create-room-code" class="cp-code-input" maxlength="6" inputmode="numeric" placeholder="Se asigna al crear la sala" value="" readonly aria-readonly="true" tabindex="-1">
            </div>

            <button type="button" id="create-now" class="mp-btn-action-primary cp-create-btn">
              ${ICONS.waveButton}
              <span>Crear sala de espera</span>
            </button>
          </div>
        </div>
      `;

      const showPage = page => {
        currentPage = (page + pageCount) % pageCount;
        root.querySelectorAll('.cp-page').forEach(el => { el.hidden = Number(el.dataset.page) !== currentPage; });
        root.querySelectorAll('.cp-dot').forEach(el => {
          const on = Number(el.dataset.page) === currentPage;
          el.classList.toggle('active', on);
          el.setAttribute('aria-current', on ? 'true' : 'false');
        });
      };
      root.querySelector('#cp-prev').onclick = () => showPage(currentPage - 1);
      root.querySelector('#cp-next').onclick = () => showPage(currentPage + 1);
      root.querySelectorAll('.cp-dot').forEach(dot => { dot.onclick = () => showPage(Number(dot.dataset.page)); });
      showPage(currentPage);

      const updateConfigCard = () => {
        const item = getMapItem(selectedMapId);
        root.querySelector('#mp-preview-banner').src = item.banner;
        root.querySelector('#mp-circuit-name').textContent = item.name;
        root.querySelector('#mp-circuit-desc').textContent = item.note;
        root.querySelector('#mp-diff-text').textContent = item.diff;

        // 8 segments difficulty bar
        const diffBar = root.querySelector('#mp-diff-bar');
        diffBar.innerHTML = '';
        for (let i = 1; i <= 8; i++) {
          const seg = document.createElement('span');
          seg.className = 'mp-diff-segment' + (i <= item.diffNum ? ' filled' : '');
          diffBar.append(seg);
        }

        // Stepper
        root.querySelector('#capacity-display').textContent = `${selectedCapacity} jugadores`;
        // Bots: nunca más que las plazas libres (capacidad − anfitrión).
        selectedBots = Math.max(1, Math.min(selectedBots, selectedCapacity - 1));
        root.querySelector('#bots-display').textContent = `${selectedBots} ${selectedBots === 1 ? 'bot' : 'bots'}`;
        root.querySelector('#bots-stepper').hidden = !selectedBotsOn;
        root.querySelector('#bots-desc').hidden = selectedBotsOn;
      };

      // Island selection clicks
      root.querySelectorAll('.mp-island-card').forEach(btn => {
        btn.onclick = () => {
          if (!isMapEnabled(Number(btn.dataset.mapId))) {
            // Bloqueado: no cambia la selección, solo avisa.
            const toast = root.querySelector('#cp-toast');
            toast.textContent = 'Próximamente disponible 🌊';
            toast.classList.remove('show'); void toast.offsetWidth; toast.classList.add('show');
            return;
          }
          root.querySelectorAll('.mp-island-card').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-pressed', 'false');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-pressed', 'true');
          selectedMapId = Number(btn.dataset.mapId);
          updateConfigCard();
        };
      });

      // Stepper handlers
      root.querySelector('#step-minus').onclick = () => {
        if (selectedCapacity > 2) {
          selectedCapacity--;
          updateConfigCard();
        }
      };

      root.querySelector('#step-plus').onclick = () => {
        if (selectedCapacity < 8) {
          selectedCapacity++;
          updateConfigCard();
        }
      };

      // Bots toggle + cantidad
      const botsToggle = root.querySelector('#room-bots-toggle');
      botsToggle.onchange = () => { selectedBotsOn = botsToggle.checked; updateConfigCard(); };
      root.querySelector('#bots-minus').onclick = () => { if (selectedBots > 1) { selectedBots--; updateConfigCard(); } };
      root.querySelector('#bots-plus').onclick = () => { if (selectedBots < selectedCapacity - 1) { selectedBots++; updateConfigCard(); } };

      // Private toggle
      const privToggle = root.querySelector('#room-private-toggle');
      privToggle.onchange = () => {
        selectedPrivate = privToggle.checked;
      };

      // Create room button
      root.querySelector('#create-now').onclick = () => {
        if (!isMapEnabled(selectedMapId)) {
          error('Este circuito estará disponible próximamente.');
          return;
        }
        connect({
          mode: 1,
          mapId: selectedMapId,
          capacity: selectedCapacity,
          bots: selectedBotsOn ? Math.min(selectedBots, selectedCapacity - 1) : 0
        });
      };

      updateConfigCard();
      return;
    }

    // VIEW: BUSCAR SALAS — lista real del lobby (sin salas ficticias).
    const featured = getMapItem(selectedMapId);
    const statusOf = r => !isMapEnabled(r.mapId) ? 'locked' : r.started ? 'racing' : (r.count >= r.capacity ? 'full' : 'open');
    const STATUS_LABEL = { open: 'Abierta', full: 'Llena', racing: 'En partida', locked: 'Próximamente' };
    let lastList = null, selectedCode = null, pingMs = null, pingSentAt = 0;
    const filters = { q: '', map: 'all', players: 'any', status: 'all' };
    const sort = { key: null, dir: 1 };

    content.innerHTML = `
      <div class="sb-layout">
        <section class="sb-panel" aria-label="Salas disponibles">
          <div class="sb-filters">
            <label class="sb-search">
              ${SB_ICONS.search}
              <input id="sb-q" type="search" placeholder="Buscar por nombre o anfitrión..." autocomplete="off" aria-label="Buscar por nombre o anfitrión">
            </label>
            <label class="sb-select">
              ${SB_ICONS.map}
              <select id="sb-map" aria-label="Filtrar por mapa">
                <option value="all">Todos los mapas</option>
                ${MAP_ITEMS.map(m => `<option value="${m.id}">${escapeHtml(m.name)}${isMapEnabled(m.id) ? '' : ' · próximamente'}</option>`).join('')}
              </select>
            </label>
            <label class="sb-select">
              ${SB_ICONS.people}
              <select id="sb-players" aria-label="Filtrar por jugadores">
                <option value="any">Cualquier número</option>
                <option value="free">Con plazas libres</option>
                <option value="few">1 a 3 jugadores</option>
                <option value="many">4 a 8 jugadores</option>
              </select>
            </label>
            <div class="sb-chips" role="group" aria-label="Filtrar por estado">
              <button type="button" class="sb-chip active" data-status="all">Todos</button>
              <button type="button" class="sb-chip" data-status="open"><i class="dot open"></i>Abiertas</button>
              <button type="button" class="sb-chip" data-status="full"><i class="dot full"></i>Llenas</button>
              <button type="button" class="sb-chip" data-status="racing"><i class="dot racing"></i>En partida</button>
            </div>
          </div>

          <div class="sb-head" role="row">
            <button type="button" class="sb-sort" data-sort="code">Sala / Anfitrión ${SB_ICONS.sort}</button>
            <button type="button" class="sb-sort" data-sort="map">Mapa ${SB_ICONS.sort}</button>
            <button type="button" class="sb-sort" data-sort="count">Jugadores ${SB_ICONS.sort}</button>
            <button type="button" class="sb-sort" data-sort="status">Estado ${SB_ICONS.sort}</button>
            <span>Acceso</span>
            <span class="sb-sr">Unirse</span>
            <span class="sb-head-ping">Ping</span>
          </div>

          <div class="sb-list" id="server-rows" role="list">
            <div class="sb-empty">${SB_ICONS.loading}<strong>Buscando salas…</strong></div>
          </div>
        </section>

        <div class="sb-codebar">
          <div class="sb-code-copy">
            ${SB_ICONS.ticket}
            <div>
              <strong>Entrar con código</strong>
              <span>Únete directamente a una sala con un código de 6 números.</span>
            </div>
          </div>
          <input id="join-code" maxlength="6" inputmode="numeric" pattern="[0-9]{6}" autocomplete="off" placeholder="6 números" aria-label="Código de sala de 6 números">
          <button id="join-now" type="button" class="sb-enter">Entrar ${SB_ICONS.arrow}</button>
          <img class="sb-deco-wave" src="/assets/images/menu/menu-wave.png" alt="" aria-hidden="true">
          <img class="sb-deco-leaves" src="/assets/images/environment/tropical-foliage.png" alt="" aria-hidden="true">
        </div>
      </div>
    `;

    // Banner tropical + mapa destacado (circuito seleccionado actualmente en Crear partida).
    const header = root.querySelector('.mp-header');
    header.insertAdjacentHTML('beforeend', `
      <div class="sb-hero" aria-hidden="true">
        <img class="sb-hero-island" src="${featured.thumb}" alt="">
      </div>
      <div class="sb-featured">
        ${SB_ICONS.palm}
        <div>
          <small>Mapa destacado</small>
          <strong>${escapeHtml(featured.name)}</strong>
          <span>${escapeHtml(featured.note)}</span>
        </div>
      </div>
    `);

    const pingBars = ms => {
      const level = ms == null ? 0 : ms < 60 ? 4 : ms < 100 ? 3 : ms < 160 ? 2 : 1;
      return `<span class="sb-ping ${ms == null ? 'unknown' : ''}" title="${ms == null ? 'Midiendo latencia con el servidor…' : 'Latencia con el servidor'}">
        <span class="sb-bars">${[1, 2, 3, 4].map(b => `<i class="${b <= level ? 'on' : ''}"></i>`).join('')}</span>
        <b>${ms == null ? '—' : ms + ' ms'}</b>
      </span>`;
    };

    const matches = r => {
      const item = getMapItem(r.mapId);
      const q = filters.q.trim().toLowerCase();
      if (q && !(`sala ${r.code}`.includes(q) || String(r.host || '').toLowerCase().includes(q) || item.name.toLowerCase().includes(q))) return false;
      if (filters.map !== 'all' && r.mapId !== Number(filters.map)) return false;
      if (filters.players === 'free' && (r.started || r.count >= r.capacity)) return false;
      if (filters.players === 'few' && !(r.count >= 1 && r.count <= 3)) return false;
      if (filters.players === 'many' && !(r.count >= 4)) return false;
      if (filters.status !== 'all' && statusOf(r) !== filters.status) return false;
      return true;
    };

    const sortValue = (r, key) => key === 'map' ? getMapItem(r.mapId).name
      : key === 'count' ? r.count
      : key === 'status' ? ['open', 'full', 'racing', 'locked'].indexOf(statusOf(r))
      : r.code;

    const renderRows = (roomsList) => {
      if (roomsList) lastList = roomsList;
      const list = root.querySelector('#server-rows');
      if (!list || !lastList) return;

      if (!lastList.length) {
        list.innerHTML = `
          <div class="sb-empty">
            ${ICONS.emptyWave}
            <strong>No hay salas disponibles</strong>
            <p>Crea una partida o inténtalo nuevamente en unos segundos.</p>
            <button type="button" class="sb-empty-btn" id="mp-create-first">${SB_ICONS.plus}Crear partida</button>
          </div>`;
        root.querySelector('#mp-create-first')?.addEventListener('click', () => form('create'));
        return;
      }

      let rows = lastList.filter(matches);
      if (sort.key) rows = rows.slice().sort((a, b) => {
        const x = sortValue(a, sort.key), y = sortValue(b, sort.key);
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });

      if (!rows.length) {
        list.innerHTML = `
          <div class="sb-empty">
            ${SB_ICONS.search}
            <strong>Ninguna sala coincide con los filtros</strong>
            <p>Hay ${lastList.length} ${lastList.length === 1 ? 'sala activa' : 'salas activas'}. Ajusta la búsqueda o los filtros.</p>
            <button type="button" class="sb-empty-btn" id="sb-clear">Limpiar filtros</button>
          </div>`;
        root.querySelector('#sb-clear')?.addEventListener('click', resetFilters);
        return;
      }

      list.replaceChildren(...rows.map(r => {
        const item = getMapItem(r.mapId);
        const status = statusOf(r);
        const joinable = status === 'open' && !busy;
        const row = document.createElement('div');
        row.className = 'sb-row' + (r.code === selectedCode ? ' selected' : '');
        row.setAttribute('role', 'listitem');
        row.innerHTML = `
          <div class="sb-room">
            <span class="sb-thumb"><img src="${item.banner}" alt="" loading="lazy"></span>
            <span class="sb-room-text">
              <strong>Sala ${escapeHtml(r.code)}</strong>
              <small>${SB_ICONS.crown}${escapeHtml(r.host || 'Surfer')}</small>
            </span>
          </div>
          <div class="sb-map">
            <span class="sb-map-thumb"><img src="${item.thumb}" alt="" loading="lazy"></span>
            <span class="sb-map-text"><strong>${escapeHtml(item.name)}</strong><small>Carrera · ${item.diff}</small></span>
          </div>
          <div class="sb-players">
            ${SB_ICONS.people}
            <span><strong>${r.count + (r.bots || 0)} / ${r.capacity}</strong>${r.bots ? ` <small class="sb-bots">${r.bots} IA</small>` : ''}
              <span class="sb-dots">${Array.from({ length: r.capacity }, (_, i) => `<i class="${i < r.count ? 'on' : i < r.count + (r.bots || 0) ? 'on bot' : ''}"></i>`).join('')}</span>
            </span>
          </div>
          <div><span class="sb-badge ${status}"><i></i>${STATUS_LABEL[status]}</span></div>
          <div class="sb-access">${r.private ? SB_ICONS.lock + 'Privada' : SB_ICONS.globe + 'Pública'}</div>
          <div><button type="button" class="sb-join" ${joinable ? '' : 'disabled'} aria-label="Unirse a la sala ${escapeHtml(r.code)} de ${escapeHtml(r.host || 'Surfer')}">${status === 'open' ? 'Unirse' : STATUS_LABEL[status]}</button></div>
          <div class="sb-ping-cell">${pingBars(pingMs)}</div>
        `;
        row.onclick = () => {
          selectedCode = r.code;
          list.querySelectorAll('.sb-row.selected').forEach(el => el.classList.remove('selected'));
          row.classList.add('selected');
        };
        row.querySelector('.sb-join').onclick = e => {
          e.stopPropagation();
          connect({ mode: 2, code: r.code });
        };
        return row;
      }));
    };

    function resetFilters() {
      filters.q = ''; filters.map = 'all'; filters.players = 'any'; filters.status = 'all';
      root.querySelector('#sb-q').value = '';
      root.querySelector('#sb-map').value = 'all';
      root.querySelector('#sb-players').value = 'any';
      root.querySelectorAll('.sb-chip').forEach(c => c.classList.toggle('active', c.dataset.status === 'all'));
      renderRows();
    }

    root.querySelector('#sb-q').oninput = e => { filters.q = e.target.value; renderRows(); };
    root.querySelector('#sb-map').onchange = e => { filters.map = e.target.value; renderRows(); };
    root.querySelector('#sb-players').onchange = e => { filters.players = e.target.value; renderRows(); };
    root.querySelectorAll('.sb-chip').forEach(chip => {
      chip.onclick = () => {
        filters.status = chip.dataset.status;
        root.querySelectorAll('.sb-chip').forEach(c => c.classList.toggle('active', c === chip));
        renderRows();
      };
    });
    root.querySelectorAll('.sb-sort').forEach(btn => {
      btn.onclick = () => {
        sort.dir = sort.key === btn.dataset.sort ? -sort.dir : 1;
        sort.key = btn.dataset.sort;
        root.querySelectorAll('.sb-sort').forEach(b => b.removeAttribute('aria-sort'));
        btn.setAttribute('aria-sort', sort.dir > 0 ? 'ascending' : 'descending');
        renderRows();
      };
    });

    root.querySelector('#join-now').onclick = () => {
      const code = root.querySelector('#join-code').value.trim();
      if (!/^\d{6}$/.test(code)) {
        error('Escribe un código de 6 números.');
        return;
      }
      connect({ mode: 2, code });
    };

    root.querySelector('#join-code').oninput = e => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
      error('');
    };

    root.querySelector('#join-code').onkeydown = e => {
      if (e.key === 'Enter') root.querySelector('#join-now').click();
    };

    const ws = socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/lobby`);
    ws.binaryType = 'arraybuffer';
    // Latencia real: el servidor responde a cada mensaje del lobby con el listado,
    // así que medimos el tiempo de ida y vuelta del keepalive existente.
    const probe = () => {
      if (ws.readyState !== 1) return;
      pingSentAt = performance.now();
      ws.send(new ArrayBuffer(0));
    };
    ws.onopen = () => {
      timer = setInterval(probe, 25000);
    };

    ws.onmessage = ({ data }) => {
      if (socket !== ws) return;
      if (pingSentAt) {
        const rtt = Math.round(performance.now() - pingSentAt);
        pingMs = pingMs == null ? rtt : Math.min(rtt, Math.round(pingMs * 0.5 + rtt * 0.5));
        pingSentAt = 0;
      } else if (pingMs == null) {
        setTimeout(probe, 50);
      }
      try {
        const list = readRoomList(read(data));
        renderRows(list);
      } catch {
        error('No se pudo leer el listado. Abre Buscar salas para reintentar.');
      }
    };
  }

  function error(text) {
    const el = root.querySelector('#room-error');
    if (el) el.textContent = text;
  }

  async function connect(options) {
    if (busy) return;
    busy = true;
    stop();
    root.querySelectorAll('button').forEach(b => b.disabled = true);
    pendingBots = options.bots | 0;
    try {
      await net.connect(profile, options);
      render(net.room, roster);
    } catch (e) {
      form(mode);
      error(e.message);
    } finally {
      busy = false;
    }
  }

  function render(room, list) {
    if (!room || !root.open) return;
    if (list && list.length) roster = list;
    if (room.started) {
      if (!began && net.player) {
        began = true;
        root.close();
        onRace();
      }
      return;
    }

    const selfId = net.id;
    // Humanos primero (anfitrión en el slot 1) y después los bots, en el orden del servidor.
    let activeRoster = roster.slice().sort((a, b) => (a.bot | 0) - (b.bot | 0) || (b.id === room.hostId) - (a.id === room.hostId));
    if (!activeRoster.length && selfId !== undefined) {
      activeRoster = [{
        id: selfId,
        nick: profile.nick || 'Surfer',
        character: profile.character || 0,
        board: profile.board || 0,
        wing: profile.wing || 0
      }];
    }

    const next = JSON.stringify([
      room.code,
      room.mapId,
      room.capacity,
      room.hostId,
      activeRoster.map(p => [p.id, p.nick, p.character, p.board, p.wing, p.bot | 0]),
      !!net.supportsBots
    ]);
    if (signature === next) return;
    signature = next;

    root.classList.add('mp-menu');
    root.classList.remove('mp-create-mode', 'mp-browse-mode');
    root.classList.add('wp-waiting-mode');
    root.setAttribute('aria-label', 'Sala de espera');
    const mapItem = getMapItem(room.mapId);
    const host = room.hostId === selfId;
    const capacity = room.capacity || 8;
    const emptyCount = Math.max(0, capacity - activeRoster.length);
    const botCount = activeRoster.filter(p => p.bot).length;
    const botMax = Math.max(0, capacity - (activeRoster.length - botCount));   // plazas que no ocupan humanos

    root.innerHTML = `
      <div class="mp-shell wp-waiting-shell">
        <header class="mp-header wp-wait-header">
          <div class="wp-wait-titles">
            <span class="wp-wait-kicker">PREPARADOS PARA SURFEAR</span>
            <h2 class="wp-wait-title"><span>Sala de espera</span> ${WAIT_TITLE_WAVE}</h2>
          </div>
          <button aria-label="Salir de la sala" class="room-close" type="button">×</button>
        </header>

        <!-- BARRA DEL CIRCUITO -->
        <div class="wp-circuit-bar">
          <div class="wp-circuit-meta">
            <div class="wp-circuit-pin">${ICONS.pin}</div>
            <div class="wp-circuit-text">
              <h3 class="wp-circuit-name">${escapeHtml(mapItem.name)}</h3>
              <p class="wp-circuit-sub">${escapeHtml(mapItem.note)}</p>
            </div>
          </div>

          <div class="wp-circuit-metrics">
            <div class="wp-circuit-metric-item">
              <div class="wp-metric-icon">${ICONS.people}</div>
              <div class="wp-metric-info">
                <strong class="wp-metric-val">${activeRoster.length}/${capacity}</strong>
                <small class="wp-metric-lbl">Jugadores</small>
              </div>
            </div>

            <div class="wp-circuit-metric-item">
              <div class="wp-metric-icon">${ICONS.key}</div>
              <div class="wp-metric-info">
                <strong class="wp-metric-val">${room.code}</strong>
                <small class="wp-metric-lbl">Código de sala</small>
              </div>
            </div>
          </div>

          <div class="wp-circuit-banner-wrap">
            <img src="${mapItem.banner}" alt="${escapeHtml(mapItem.name)}" draggable="false">
          </div>
        </div>

        <!-- GRID DE 8 SLOTS -->
        <div class="wp-players-grid">
          ${activeRoster.map(p => {
            const isPlayerHost = p.id === room.hostId;
            const isSelf = p.id === selfId;
            const isBot = !!p.bot;
            // Equipamiento real de cada jugador: el propio sale del perfil local; el de los
            // demás llega del servidor en cada SNAPSHOT (skin, tabla, wings). Nada inventado.
            const look = isSelf ? profile : p;
            const charIdx = Number.isInteger(look.character) && look.character >= 0 && look.character < characterColors.length ? look.character : 0;
            const skinHex = characterColors[charIdx] || characterColors[0];
            const boardIdx = Number.isInteger(look.board) && look.board >= 0 && look.board < boardSkins.length ? look.board : 0;
            const boardSkin = boardSkins[boardIdx] || boardSkins[0];
            const wingIdx = Number.isInteger(look.wing) && look.wing >= 0 && look.wing < wingFiles.length ? look.wing : 0;
            const wingFile = wingFiles[wingIdx] || wingFiles[0];

            return `
              <div class="wp-player-card ${isPlayerHost ? 'is-host' : 'is-guest'}${isBot ? ' is-bot' : ''}">
                <div class="wp-avatar-stage">
                  <div class="wp-stage-bg" aria-hidden="true"></div>
                  ${renderLobbyAvatar({ skinHex, wingFile, boardSkin, isHost: isPlayerHost })}
                  ${isPlayerHost
                    ? `<div class="wp-crown-badge" title="Anfitrión">${ICONS.crown}</div><div class="wp-host-badge-float">Anfitrión</div>`
                    : isBot ? `<div class="wp-bot-badge" title="Surfista controlado por IA">IA</div>`
                    : `<div class="wp-card-dots" aria-hidden="true"><span></span><span></span><span></span></div>`}
                </div>
                <div class="wp-card-info">
                  <strong class="wp-player-nick">${escapeHtml(p.nick || 'Surfer')}</strong>
                  <div class="wp-status-row ${isPlayerHost || isBot ? 'ready' : 'waiting'}">
                    <span class="wp-status-dot ${isPlayerHost || isBot ? 'ready' : 'waiting'}"></span>
                    <span>${isBot ? 'BOT · LISTO' : isPlayerHost ? 'Listo' : 'Esperando'}</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}

          ${Array.from({ length: emptyCount }).map(() => `
            <div class="wp-empty-card">
              ${renderEmptySlotSvg()}
            </div>
          `).join('')}
        </div>

        <!-- BOTTOM ACTION BAR -->
        <div class="wp-bottom-bar">
          <div class="wp-bottom-left">
            <button type="button" class="wp-btn-copy-code" id="btn-copy-code" aria-label="Copiar código de sala">
              ${ICONS.link}
              <span>Copiar código</span>
            </button>
            <div class="wp-code-badge" id="badge-room-code" role="button" tabindex="0" title="Copiar código ${room.code}">
              <span class="wp-code-num">${room.code}</span>
              ${WAIT_ICONS.clipboard}
            </div>
          </div>

          ${host && net.supportsBots ? `
          <div class="wp-bots-ctl" role="group" aria-label="Bots de la sala">
            <span class="wp-bots-label">Bots <small>IA</small></span>
            <button type="button" class="wp-bots-btn" id="wp-bots-minus" aria-label="Quitar un bot" ${botCount === 0 ? 'disabled' : ''}>${ICONS.minus}</button>
            <strong class="wp-bots-count" aria-live="polite">${botCount}</strong>
            <button type="button" class="wp-bots-btn" id="wp-bots-plus" aria-label="Añadir un bot" ${botCount >= botMax ? 'disabled' : ''}>${ICONS.plus}</button>
          </div>` : ''}
          <p id="waiting-help" class="wp-waiting-help">
            ${host && !net.supportsBots && room.botTarget === 0 && pendingBots ? 'Reinicia el servidor para usar bots.' : 'Esperando a que el anfitrión inicie la salida.'}
          </p>

          <button class="wp-btn-launch-race" id="launch-race" ${host ? '' : 'hidden'}>
            <span class="wp-flag-icon">${WAIT_ICONS.checkeredFlag}</span>
            <span>Iniciar carrera</span>
          </button>
        </div>
      </div>
    `;

    root.querySelector('.room-close').onclick = () => form('browse');

    const copyCodeHandler = () => {
      navigator.clipboard?.writeText(room.code).catch(() => {});
      const label = root.querySelector('#btn-copy-code span');
      if (label) {
        const orig = label.textContent;
        label.textContent = '¡Copiado!';
        setTimeout(() => { label.textContent = orig; }, 1800);
      }
    };
    root.querySelector('#btn-copy-code')?.addEventListener('click', copyCodeHandler);
    root.querySelector('#badge-room-code')?.addEventListener('click', copyCodeHandler);

    // Solo el anfitrión cambia los bots; el servidor valida y lo sincroniza con todos.
    root.querySelector('#wp-bots-minus')?.addEventListener('click', () => net.setBots(botCount - 1));
    root.querySelector('#wp-bots-plus')?.addEventListener('click', () => net.setBots(botCount + 1));

    const launchBtn = root.querySelector('#launch-race');
    if (launchBtn) {
      launchBtn.onclick = () => net.startRoom();
    }
  }

  net.onRoom = render;

  return {
    open(view = 'browse') {
      stop();
      net.close();
      began = false;
      busy = false;
      roster = [];
      if (!root.open) root.showModal();
      form(view);
    }
  };
}

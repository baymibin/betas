// Surf Salvaje · idiomas. Inglés por defecto; español es el idioma en que está escrito el código.
//
// Cómo funciona: la interfaz se escribe en español (HTML y JS) y este módulo traduce al inglés lo
// que aparece en pantalla, también lo que el juego escribe después (tienda, salas, trade, HUD),
// gracias a un MutationObserver. Traduce texto y los atributos placeholder, title y aria-label.
// Se guarda el texto original de cada nodo para volver al español sin recargar.
//  - Claves de una palabra: solo si son el texto completo del nodo (no se tocan los nicks).
//  - Claves de varias palabras: también dentro de textos más largos (frases con datos).
//  - Los elementos con translate="no" (o dentro de uno) no se traducen: nicks, códigos, etc.
import {EN, EN_WORDS, EN_PATTERNS} from './i18n-en.js';

const KEY = 'surf.lang';
export const LANGS = [{id: 'en', name: 'English', flag: 'us'}, {id: 'es', name: 'Español', flag: 'es'}];
let lang = 'en';
try { const saved = localStorage.getItem(KEY); if (saved === 'es' || saved === 'en') lang = saved; } catch {}
export const currentLang = () => lang;

// ¡ y ¿ no existen en inglés: se quitan antes de buscar (las claves se normalizan igual).
const strip = s => s.replace(/[¡¿]/g, '');
const single = new Map(), multi = new Map();
for (const [es, en] of Object.entries(EN)) {
  const k = strip(es).trim();
  if (!k) continue;
  (/\s/.test(k) ? multi : single).set(k, en);
}
for (const [es, en] of Object.entries(EN_WORDS)) multi.set(es, en);
// Textos en mayúsculas generados con toUpperCase() (p. ej. "PAQUETE PEQUEÑO"): misma traducción en mayúsculas.
const upper = new Map();
for (const [k, v] of [...single, ...multi]) { const K = k.toUpperCase(); if (K !== k && !single.has(K) && !multi.has(K)) upper.set(K, v.toUpperCase()); }
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Frases de varias palabras, de la más larga a la más corta, sin cortar palabras.
const phraseRe = new RegExp('(?<![\\p{L}\\p{N}])(?:' + [...multi.keys()].sort((a, b) => b.length - a.length).map(escape).join('|') + ')(?![\\p{L}\\p{N}])', 'gu');
const cache = new Map();

// Traduce un texto al idioma actual (útil también para textos que no pasan por el DOM, p. ej.
// los que se dibujan en una textura 3D).
export function t(text) {
  if (lang === 'es' || text == null) return text;
  const s = String(text);
  if (!/\p{L}/u.test(s)) return s;
  const hit = cache.get(s);
  if (hit !== undefined) return hit;
  const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
  let core = strip(s.slice(lead.length, s.length - trail.length)).replace(/\s+/g, ' ');
  let out = single.get(core) ?? multi.get(core) ?? (core === core.toUpperCase() ? upper.get(core) : undefined);
  if (out === undefined) {
    out = core;
    for (const [re, fn] of EN_PATTERNS) out = out.replace(re, fn);
    out = out.replace(phraseRe, m => multi.get(m));
    // Una palabra suelta tras aplicar patrones (p. ej. "Jugar " + icono) también se busca entera.
    out = single.get(out) ?? out;
  }
  const result = lead + out + trail;
  if (cache.size > 4000) cache.clear();
  cache.set(s, result);
  return result;
}

const ATTRS = ['placeholder', 'title', 'aria-label'];
const source = new WeakMap();    // nodo de texto -> {src, shown}
const attrSource = new WeakMap(); // elemento -> {atributo: {src, shown}}
const skip = el => !!el?.closest?.('script,style,textarea,[translate="no"],[contenteditable="true"]');

function translateText(node) {
  const value = node.nodeValue;
  if (!value || !value.trim()) return;
  if (skip(node.parentElement)) return;
  let rec = source.get(node);
  if (!rec || rec.shown !== value) rec = {src: value};   // el juego escribió un texto nuevo
  const next = lang === 'es' ? rec.src : t(rec.src);
  rec.shown = next;
  source.set(node, rec);
  if (next !== value) node.nodeValue = next;
}
function translateAttrs(el) {
  if (skip(el)) return;
  let recs = attrSource.get(el);
  for (const name of ATTRS) {
    const value = el.getAttribute(name);
    if (value == null || !value.trim()) continue;
    recs ||= {};
    let rec = recs[name];
    if (!rec || rec.shown !== value) rec = recs[name] = {src: value};
    const next = lang === 'es' ? rec.src : t(rec.src);
    rec.shown = next;
    if (next !== value) el.setAttribute(name, next);
  }
  if (recs) attrSource.set(el, recs);
}
function translateTree(root) {
  if (root.nodeType === 3) return translateText(root);
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1) translateAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) n.nodeType === 3 ? translateText(n) : translateAttrs(n);
}

const titles = {es: 'Surf Salvaje', en: 'Surf Salvaje'};
function applyDocument() {
  document.documentElement.lang = lang;
  document.title = titles[lang] || document.title;
  for (const b of document.querySelectorAll('[data-lang]')) {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    b.classList.toggle('is-active', b.dataset.lang === lang);
  }
}

export function setLang(next) {
  if (!LANGS.some(l => l.id === next) || next === lang) return;
  lang = next;
  cache.clear();
  try { localStorage.setItem(KEY, lang); } catch {}
  applyDocument();
  translateTree(document.body);
  document.dispatchEvent(new CustomEvent('surf:lang', {detail: lang}));
}

// Traduce lo que ya hay y todo lo que se añada o cambie después.
translateTree(document.body);
applyDocument();
new MutationObserver(records => {
  for (const r of records) {
    if (r.type === 'characterData') translateText(r.target);
    else if (r.type === 'attributes') translateAttrs(r.target);
    else for (const n of r.addedNodes) translateTree(n);
  }
}).observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS});

// Banderas (junto a "MULTIJUGADOR · HASTA 8 SURFISTAS"): cambian el idioma al instante.
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-lang]');
  if (b) { e.preventDefault(); setLang(b.dataset.lang); }
});
document.documentElement.classList.remove('i18n-pending');

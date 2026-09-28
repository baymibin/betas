// Items subidos desde el panel administrativo (tablas, wings y hats nuevos) y textos editados.
// Se añaden al final del catálogo compartido ANTES de que la tienda lea el perfil guardado,
// por eso este módulo usa top-level await y lo importan shop.js y game.js en primer lugar.
// Sin servidor de cuentas (o si tarda) el juego sigue con el catálogo base.
import {applyCustomItems, applyItemTexts} from '../shared/catalog.js';

try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  const response = await fetch('/api/catalog/custom', {signal: controller.signal, headers: {Accept: 'application/json'}});
  clearTimeout(timer);
  if (response.ok) {
    const data = await response.json();
    applyCustomItems(data.items || []);
    applyItemTexts(data.texts || []);
  }
} catch {}

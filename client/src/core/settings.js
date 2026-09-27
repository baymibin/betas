const key = 'surf.settings.v1';
// Volúmenes en % (0-100). volume = general; music/ambience/sfx = por categoría.
// Volumen efectivo de una categoría = general × categoría (se aplica una sola vez).
export const settings = { sound: true, volume: 100, music: 70, ambience: 80, sfx: 90, effects: true, quality: 'auto' };
export const VOLUME_FIELDS = ['volume', 'music', 'ambience', 'sfx'];

try {
  const saved = JSON.parse(localStorage.getItem(key) || '{}');
  for (const k of ['sound', 'effects']) {
    if (typeof saved[k] === 'boolean') settings[k] = saved[k];
  }
  for (const k of VOLUME_FIELDS) {
    if (Number.isFinite(saved[k])) settings[k] = Math.max(0, Math.min(100, Math.round(saved[k])));
  }
  if (['auto', 'high', 'low'].includes(saved.quality)) {
    settings.quality = saved.quality;
  }
} catch {}

export function saveSettings() {
  try {
    localStorage.setItem(key, JSON.stringify(settings));
  } catch {}
}

// Ganancia 0..1 de una categoría ('music' | 'ambience' | 'sfx').
export function categoryGain(category) {
  if (!settings.sound) return 0;
  return (settings.volume / 100) * ((settings[category] ?? 100) / 100);
}

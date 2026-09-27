import {settings, categoryGain} from '../core/settings.js';

// Buses de audio: MUSIC (música de fondo), AMBIENCE (océano, gaviotas y demás ambiente)
// y SFX (saltos, rampas, cajas sorpresa, poderes, impactos e interfaz). Cada uno usa
// categoryGain() = general × categoría, así el volumen general nunca se aplica dos veces.
const BASE = {music: 0.55, ocean: 0.40, seagulls: 0.28};

let audioCtx = null;
const soundBuffers = new Map();
const soundUrls = {
  whoosh: '/assets/audio/effects/whoosh_1.mp3',
  impact: '/assets/audio/effects/impact_1.mp3',
  jump: '/assets/audio/effects/whoosh_1.mp3',
  ramp: '/assets/audio/effects/whoosh_1.mp3'
};
const fallbackSounds = new Map();

// HTML5 Audio elements for looping streams (music and ambient)
let bgmAudio = null;
let oceanAudio = null;
let seagullsAudio = null;
let userInteracted = false;
let isMatchActive = false;

function getContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Preload SFX buffers via Web Audio for instant zero-latency playback
async function loadSoundBuffer(name, url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const arrayBuf = await res.arrayBuffer();
    const ctx = getContext();
    if (ctx) {
      const decoded = await ctx.decodeAudioData(arrayBuf);
      soundBuffers.set(name, decoded);
    }
  } catch (err) {
    console.warn(`[audio] Failed to load buffer for ${name}:`, err);
  }
}

function initStreams() {
  if (bgmAudio) return;

  bgmAudio = new Audio('/assets/audio/music/background_1.mp3');
  bgmAudio.loop = true;
  window.__bgm = bgmAudio;

  oceanAudio = new Audio('/assets/audio/ambience/ocean_1.mp3');
  oceanAudio.loop = true;

  seagullsAudio = new Audio('/assets/audio/ambience/seagulls_1.mp3');
  seagullsAudio.loop = true;

  // Jump and ramp reuse the whoosh buffer; decode each file once.
  for (const name of ['whoosh', 'impact']) {
    const url = soundUrls[name];
    loadSoundBuffer(name, url);
    const fallback = new Audio(url);
    fallback.preload = 'auto';
    fallbackSounds.set(name, fallback);
  }

  // Immediately start playing background music upon entering the game
  const musicVol = categoryGain('music');
  if (bgmAudio) {
    bgmAudio.volume = musicVol * BASE.music;
    if (musicVol > 0) {
      bgmAudio.play().catch(() => {
        // Autoplay may be deferred until user interacts with the page
      });
    }
  }
}

// Initialize streams immediately upon script load
initStreams();

export function updateAudioVolumes() {
  const musicVol = categoryGain('music');
  const ambienceVol = categoryGain('ambience');

  // Música: en 0 % se pausa; al volver a subir el volumen continúa (no se detiene para siempre).
  if (bgmAudio) {
    bgmAudio.volume = musicVol * BASE.music;
    if (musicVol > 0 && bgmAudio.paused) {
      bgmAudio.play().catch(() => {});
    } else if (musicVol === 0 && !bgmAudio.paused) {
      bgmAudio.pause();
    }
  }

  for (const [stream, base] of [[oceanAudio, BASE.ocean], [seagullsAudio, BASE.seagulls]]) {
    if (!stream) continue;
    stream.volume = ambienceVol * base;
    if (ambienceVol > 0 && isMatchActive && userInteracted && stream.paused) {
      stream.play().catch(() => {});
    } else if ((ambienceVol === 0 || !isMatchActive) && !stream.paused) {
      stream.pause();
    }
  }
}

export function playSound(kind = 'click') {
  const masterVol = categoryGain('sfx');
  if (masterVol <= 0) return;
  if (!userInteracted) initOnGesture();

  const ctx = getContext();

  // 1. Play high-fidelity decoded MP3 SFX if available
  const sfxKey = kind === 'jump' || kind === 'whoosh' ? 'whoosh' :
                 kind === 'impact' ? 'impact' :
                 kind === 'ramp' ? 'whoosh' : null;

  if (sfxKey && ctx && soundBuffers.has(sfxKey)) {
    try {
      const buffer = soundBuffers.get(sfxKey);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = masterVol * (sfxKey === 'impact' ? 1.0 : 0.85);
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      // Skip dead silence lead-in for crisp instant reaction
      const startOffset = sfxKey === 'impact' ? 0.27 : sfxKey === 'whoosh' ? 0.12 : 0;
      source.start(0, startOffset);
      return;
    } catch {}
  }

  // Reuse the preloaded fallback instead of allocating Audio on a pickup.
  if (sfxKey && fallbackSounds.has(sfxKey)) {
    try {
      const sfx = fallbackSounds.get(sfxKey);
      sfx.volume = masterVol * (sfxKey === 'impact' ? 1.0 : 0.85);
      if (sfxKey === 'impact') sfx.currentTime = 0.27;
      sfx.play().catch(() => {});
      return;
    } catch {}
  }

  // Subtle synthesized UI click
  if (ctx) {
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(kind === 'jump' ? 320 : kind === 'ramp' ? 220 : 600, t);
      osc.frequency.exponentialRampToValueAtTime(kind === 'click' ? 420 : 880, t + 0.12);
      gain.gain.setValueAtTime(masterVol * 0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    } catch {}
  }
}

export function startMatchAudio() {
  isMatchActive = true;
  initOnGesture();
  if (bgmAudio) {
    try {
      bgmAudio.currentTime = 0;
    } catch {}
    if (categoryGain('music') > 0) {
      bgmAudio.play().catch(() => {});
    }
  }
  updateAudioVolumes();
}

export function stopMatchAudio() {
  isMatchActive = false;
  if (oceanAudio) oceanAudio.pause();
  if (seagullsAudio) seagullsAudio.pause();
  updateAudioVolumes();
}

export function initOnGesture() {
  userInteracted = true;
  getContext();
  initStreams();
  updateAudioVolumes();
}

// User gesture listeners to unlock browser Web Audio & HTML5 Audio autoplay
['click', 'keydown', 'touchstart', 'mousedown', 'pointerdown'].forEach(evt => {
  window.addEventListener(evt, initOnGesture, {passive: true});
});

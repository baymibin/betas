import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { profilePacket, roomRequest } from '../../client/src/shared/protocol.js';

const BRAVE_PATH = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const TEMP_PROFILE = 'C:\\Users\\kazaf\\AppData\\Local\\Temp\\brave_capture_profile_mp';
const TARGET_URL = 'http://localhost:3000/?hq=1';
const OUT_DIR = 'C:\\APLICATIVO\\SURF\\servidor\\artifacts\\screenshots';
mkdirSync(OUT_DIR, { recursive: true });

console.log('Launching Brave for Multiplayer UI capture...');
const browser = spawn(BRAVE_PATH, [
  '--remote-debugging-port=9222',
  `--user-data-dir=${TEMP_PROFILE}`,
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--use-gl=angle',
  '--window-size=1440,900',
  '--headless=new',
  TARGET_URL
], { stdio: 'ignore' });

async function run() {
  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const res = await fetch('http://127.0.0.1:9222/json/list');
        if (res.ok) {
          targets = await res.json();
          if (targets && targets.length > 0) break;
        }
      } catch {}
    }

    if (!targets || !targets.length) throw new Error('Could not connect to Brave CDP');

    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let id = 1;
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const msgId = ++id;
        const handler = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === msgId) {
            ws.removeEventListener('message', handler);
            resolve(data.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('Waiting for game page to load...');
    await new Promise(r => setTimeout(r, 3000));

    // 1. Open Shop Modal (Imagen A reference)
    console.log('Opening "La tiendita" modal (Imagen A reference)...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const loading = document.getElementById('loading');
        if (loading) loading.classList.add('gone');
        const shopBtn = document.getElementById('shop-btn');
        if (shopBtn) shopBtn.click();
      })()`
    });

    await new Promise(r => setTimeout(r, 1500));

    console.log('Capturing "La tiendita" modal...');
    const shotShop = await send('Page.captureScreenshot', { format: 'png' });
    if (shotShop && shotShop.data) {
      writeFileSync(`${OUT_DIR}\\modal_tienda_ref.png`, shotShop.data, 'base64');
      console.log('Saved modal_tienda_ref.png');
    }

    // Close shop
    await send('Runtime.evaluate', {
      expression: `(() => {
        const shopClose = document.getElementById('shop-close');
        if (shopClose) shopClose.click();
      })()`
    });

    await new Promise(r => setTimeout(r, 600));

    // 2. Open Multiplayer - Crear partida
    console.log('Opening "Crear partida" modal...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const startBtn = document.getElementById('start-btn');
        if (startBtn) startBtn.click();
      })()`
    });

    await new Promise(r => setTimeout(r, 1200));

    console.log('Capturing "Crear partida" modal...');
    const shotCreate = await send('Page.captureScreenshot', { format: 'png' });
    if (shotCreate && shotCreate.data) {
      writeFileSync(`${OUT_DIR}\\modal_crear_partida.png`, shotCreate.data, 'base64');
      console.log('Saved modal_crear_partida.png');
    }

    // 3. Switch to Buscar salas (empty state verification)
    console.log('Switching to "Buscar salas" tab...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tabBrowse = document.getElementById('tab-browse');
        if (tabBrowse) tabBrowse.click();
      })()`
    });

    await new Promise(r => setTimeout(r, 1200));

    console.log('Capturing "Buscar salas" modal...');
    const shotBrowse = await send('Page.captureScreenshot', { format: 'png' });
    if (shotBrowse && shotBrowse.data) {
      writeFileSync(`${OUT_DIR}\\modal_buscar_salas.png`, shotBrowse.data, 'base64');
      console.log('Saved modal_buscar_salas.png');
    }

    // 4. Switch back to Crear partida and select Costa Volcanica
    console.log('Switching back to Crear partida and selecting Costa Volcanica...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tabCreate = document.getElementById('tab-create');
        if (tabCreate) tabCreate.click();
        setTimeout(() => {
          const btn = document.querySelector('.mp-island-card[data-map-id="4"]');
          if (btn) btn.click();
        }, 200);
      })()`
    });

    await new Promise(r => setTimeout(r, 1200));

    console.log('Capturing "Crear partida" with Costa Volcanica selected...');
    const shotVolcano = await send('Page.captureScreenshot', { format: 'png' });
    if (shotVolcano && shotVolcano.data) {
      writeFileSync(`${OUT_DIR}\\modal_crear_partida_volcano.png`, shotVolcano.data, 'base64');
      console.log('Saved modal_crear_partida_volcano.png');
    }

    // 5. Select Bahia Coral, set profile 'kazaf', and create waiting room
    console.log('Setting profile "kazaf", selecting Bahia Coral, and creating waiting room...');
    await send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `(async () => {
        try {
          localStorage.setItem('surf.profile.v1', JSON.stringify({ nick: 'kazaf', character: 4, board: 3, wing: 6 }));
          const shop = await import('/src/ui/shop.js');
          if (shop && shop.profile) {
            shop.profile.character = 4;
            shop.profile.board = 3;
            shop.profile.wing = 6;
            shop.profile.nick = 'kazaf';
          }
        } catch {}
        const nickInput = document.getElementById('nickname');
        if (nickInput) {
          nickInput.value = 'kazaf';
          nickInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const card0 = document.querySelector('.mp-island-card[data-map-id="0"]');
        if (card0) card0.click();
        const createBtn = document.getElementById('create-now');
        if (createBtn) createBtn.click();
      })()`
    });

    await new Promise(r => setTimeout(r, 1600));

    // Get room code from waiting room
    const roomCodeResult = await send('Runtime.evaluate', {
      expression: `(() => {
        const badge = document.querySelector('.wp-code-num');
        return badge ? badge.textContent.trim() : '';
      })()`
    });
    const createdCode = roomCodeResult?.result?.value;
    console.log('Room created with code:', createdCode);

    // If room code found, connect second client '23'
    let wsP2 = null;
    if (createdCode) {
      console.log('Connecting second player "23" to room:', createdCode);
      wsP2 = new WebSocket('ws://127.0.0.1:3000/play');
      wsP2.binaryType = 'arraybuffer';
      await new Promise(resolve => {
        wsP2.onopen = () => {
          wsP2.send(profilePacket({ nick: '23', character: 1, board: 0 }));
          wsP2.send(roomRequest(2, 0, createdCode, 8));
          resolve();
        };
      });
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('Capturing "Sala de espera" modal (Imagen B)...');
    const shotWaiting = await send('Page.captureScreenshot', { format: 'png' });
    if (shotWaiting && shotWaiting.data) {
      writeFileSync(`${OUT_DIR}\\modal_sala_espera.png`, shotWaiting.data, 'base64');
      console.log('Saved modal_sala_espera.png');
    }

    // Capture occupied slots high-precision clip
    const rect = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(() => {
        const grid = document.querySelector('.wp-players-grid');
        if (!grid) return null;
        const cards = grid.querySelectorAll('.wp-player-card');
        if (!cards.length) return null;
        const r1 = cards[0].getBoundingClientRect();
        const rLast = cards[cards.length - 1].getBoundingClientRect();
        return {
          x: Math.floor(Math.min(r1.left, rLast.left) - 8),
          y: Math.floor(Math.min(r1.top, rLast.top) - 8),
          width: Math.ceil(Math.max(r1.right, rLast.right) - Math.min(r1.left, rLast.left) + 16),
          height: Math.ceil(Math.max(r1.bottom, rLast.bottom) - Math.min(r1.top, rLast.top) + 16),
          scale: 1
        };
      })()`
    });
    if (rect?.result?.value) {
      const shotSlots = await send('Page.captureScreenshot', { format: 'png', clip: rect.result.value });
      if (shotSlots && shotSlots.data) {
        writeFileSync(`${OUT_DIR}\\modal_occupied_slots.png`, shotSlots.data, 'base64');
        console.log('Saved modal_occupied_slots.png');
      }
    }

    if (wsP2) wsP2.close();
    ws.close();
  } catch (err) {
    console.error('Capture error:', err);
  } finally {
    browser.kill();
  }
}

run();

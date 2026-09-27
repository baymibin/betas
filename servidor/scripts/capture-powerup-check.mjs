import {fileURLToPath} from 'node:url';
const screenshotDirectory = fileURLToPath(new URL('../artifacts/screenshots/', import.meta.url));
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';

const BRAVE_PATH = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const TEMP_PROFILE = 'C:\\Users\\kazaf\\AppData\\Local\\Temp\\brave_capture_profile_power';
const TARGET_URL = 'http://localhost:3000/?map=0&hq=1';
const OUTPUT_FILE = screenshotDirectory + 'power_5_red_trap_verified.png';

console.log('Launching Brave to verify Power-Up 5 (Red Trap Box) and Box Pickup constraint...');
const browser = spawn(BRAVE_PATH, [
  '--remote-debugging-port=9222',
  `--user-data-dir=${TEMP_PROFILE}`,
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--use-gl=angle',
  '--window-size=1280,720',
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

    if (!targets || !targets.length) {
      throw new Error('Failed to connect to Brave DevTools');
    }

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

    await new Promise(r => setTimeout(r, 2000));

    // Start practice mode
    await send('Runtime.evaluate', {
      expression: `
        document.getElementById('loading')?.classList.add('gone');
        document.getElementById('overlay')?.classList.add('hidden');
        document.getElementById('practice-btn')?.click();
      `
    });

    await new Promise(r => setTimeout(r, 4000));

    // Evaluate state and trigger powerup 5
    const evalRes = await send('Runtime.evaluate', {
      expression: `
        (() => {
          if (window.__surfDebug) {
            const p = window.__surfDebug.getPlayer();
            const w = window.__surfDebug.getWorld();
            p.heldItem = 5;
            // Spawn a red trap box 6 units ahead of the player so it's clearly visible in front of board
            w.entities.push({
              id: 999,
              kind: 5,
              owner: 99,
              target: 0,
              x: p.x + 1.4,
              z: p.z - 6,
              y: 0.9,
              ttl: 300
            });
            return { pZ: p.z, heldItem: p.heldItem, entityCount: w.entities.length };
          }
          return null;
        })()
      `,
      returnByValue: true
    });
    console.log('HUD and Entity Injection:', evalRes);

    await new Promise(r => setTimeout(r, 1000));

    console.log('Capturing screenshot...');
    const result = await send('Page.captureScreenshot', { format: 'png' });
    if (result && result.data) {
      writeFileSync(OUTPUT_FILE, result.data, 'base64');
      console.log('Screenshot saved to:', OUTPUT_FILE);
    }

    ws.close();
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    browser.kill();
  }
}

run();

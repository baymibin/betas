import {fileURLToPath} from 'node:url';
const screenshotDirectory = fileURLToPath(new URL('../artifacts/screenshots/', import.meta.url));
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';

const mapId = process.argv[2] || '0';
const outputName = process.argv[3] || 'bahia_coral_action.png';
const waitMs = Number(process.argv[4]) || 5500;

const BRAVE_PATH = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const TEMP_PROFILE = 'C:\\Users\\kazaf\\AppData\\Local\\Temp\\brave_capture_profile';
const TARGET_URL = `http://localhost:3000/?map=${mapId}&hq=1`;
const OUTPUT_FILE = screenshotDirectory + outputName;

console.log(`Launching Brave with remote debugging for Map ${mapId}...`);
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
    console.log('Connected to target:', pageTarget.url);

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

    console.log('Enabling Page & Runtime...');
    await send('Page.enable');
    await send('Runtime.enable');

    await new Promise(r => setTimeout(r, 2000));

    console.log(`Triggering solo practice race on map ${mapId}...`);
    await send('Runtime.evaluate', {
      expression: `
        document.getElementById('loading')?.classList.add('gone');
        document.getElementById('overlay')?.classList.add('hidden');
        document.getElementById('practice-btn')?.click();
      `
    });

    console.log(`Waiting ${waitMs} ms for racing action...`);
    await new Promise(r => setTimeout(r, waitMs));

    console.log('Capturing in-game action screenshot...');
    const result = await send('Page.captureScreenshot', { format: 'png' });
    if (result && result.data) {
      writeFileSync(OUTPUT_FILE, result.data, 'base64');
      console.log('Action screenshot successfully saved to:', OUTPUT_FILE);
    } else {
      console.error('No screenshot data returned', result);
    }

    ws.close();
  } catch (err) {
    console.error('Capture error:', err);
  } finally {
    browser.kill();
  }
}

run();

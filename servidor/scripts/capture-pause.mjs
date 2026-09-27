import {fileURLToPath} from 'node:url';
const screenshotDirectory = fileURLToPath(new URL('../artifacts/screenshots/', import.meta.url));
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';

const BRAVE_PATH = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const TEMP_PROFILE = 'C:\\Users\\kazaf\\AppData\\Local\\Temp\\brave_pause_profile';
const TARGET_URL = 'http://localhost:3000/?map=0&hq=1';
const OUTPUT_FILE = screenshotDirectory + 'pause_modal.png';

const browser = spawn(BRAVE_PATH, [
  '--remote-debugging-port=9223',
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
        const res = await fetch('http://127.0.0.1:9223/json/list');
        if (res.ok) {
          targets = await res.json();
          if (targets && targets.length > 0) break;
        }
      } catch {}
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

    // Start practice game
    await send('Runtime.evaluate', {
      expression: `
        document.getElementById('loading')?.classList.add('gone');
        document.getElementById('overlay')?.classList.add('hidden');
        document.getElementById('practice-btn')?.click();
      `
    });

    await new Promise(r => setTimeout(r, 2000));

    // Dispatch Escape keydown
    await send('Runtime.evaluate', {
      expression: `
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      `
    });

    await new Promise(r => setTimeout(r, 600));

    // Capture screenshot of pause modal
    const result = await send('Page.captureScreenshot', { format: 'png' });
    if (result && result.data) {
      writeFileSync(OUTPUT_FILE, result.data, 'base64');
      console.log('Pause modal screenshot saved to:', OUTPUT_FILE);
    }

    ws.close();
  } catch (err) {
    console.error('Pause capture error:', err);
  } finally {
    browser.kill();
  }
}

run();

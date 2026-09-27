import {fileURLToPath} from 'node:url';
const screenshotDirectory = fileURLToPath(new URL('../artifacts/screenshots/', import.meta.url));
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';

const BRAVE_PATH = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const TEMP_PROFILE = 'C:\\Users\\kazaf\\AppData\\Local\\Temp\\brave_wings_profile';
const TARGET_URL = 'http://localhost:3000/?hq=1';
const ARTIFACT_DIR = screenshotDirectory;

console.log('Launching Brave for Wings visual verification...');
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

    await new Promise(r => setTimeout(r, 2500));

    console.log('1. Opening Shop Dialog and selecting Wings tab...');
    await send('Runtime.evaluate', {
      expression: `
        document.getElementById('loading')?.classList.add('gone');
        document.getElementById('shop-btn')?.click();
        const wingTab = document.querySelector('[data-category="wings"]');
        if (wingTab) wingTab.click();
      `
    });

    await new Promise(r => setTimeout(r, 1500));

    console.log('2. Equipping Crimson Butterfly Wings (index 6)...');
    await send('Runtime.evaluate', {
      expression: `
        const items = document.querySelectorAll('.shop-item');
        if (items.length >= 7) {
          items[6].click(); // Crimson Butterfly Wings
        }
      `
    });

    await new Promise(r => setTimeout(r, 600));

    console.log('3. Capturing Shop Wings dialog screenshot with 9 items...');
    const shopResult = await send('Page.captureScreenshot', { format: 'png' });
    if (shopResult && shopResult.data) {
      writeFileSync(`${ARTIFACT_DIR}\\wings_shop_verified.png`, shopResult.data, 'base64');
      console.log('Shop Wings screenshot successfully saved!');
    }

    console.log('4. Closing shop dialog...');
    await send('Runtime.evaluate', {
      expression: `document.getElementById('shop-close')?.click();`
    });

    await new Promise(r => setTimeout(r, 1000));

    console.log('4. Entering Practice mode to see wings in action...');
    await send('Runtime.evaluate', {
      expression: `
        document.getElementById('overlay')?.classList.add('hidden');
        document.getElementById('practice-btn')?.click();
      `
    });

    console.log('Waiting 5.5s for surfer in action...');
    await new Promise(r => setTimeout(r, 5500));

    console.log('5. Capturing in-game action screenshot with Wings...');
    const actionResult = await send('Page.captureScreenshot', { format: 'png' });
    if (actionResult && actionResult.data) {
      writeFileSync(`${ARTIFACT_DIR}\\wings_action_verified.png`, actionResult.data, 'base64');
      console.log('Gameplay Wings screenshot successfully saved!');
    }

    ws.close();
  } catch (err) {
    console.error('Verification error:', err);
  } finally {
    browser.kill();
  }
}

run();

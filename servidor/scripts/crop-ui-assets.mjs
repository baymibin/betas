import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const BRAVE_PATH = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const TEMP_PROFILE = 'C:\\Users\\kazaf\\AppData\\Local\\Temp\\brave_capture_profile';
const REF_IMAGE = 'C:\\Users\\kazaf\\.gemini\\antigravity\\brain\\bf658e52-b539-43d9-a10f-026507151758\\.user_uploaded\\media_1790359503539.png';

const server = http.createServer((req, res) => {
  if (req.url === '/ref.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(fs.readFileSync(REF_IMAGE));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><body><img id="ref" src="/ref.png"><canvas id="c"></canvas></body></html>`);
});

server.listen(4821, async () => {
  const browser = spawn(BRAVE_PATH, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_PROFILE}`,
    '--headless=new',
    'http://127.0.0.1:4821'
  ], { stdio: 'ignore' });

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
    await new Promise(r => setTimeout(r, 1000));

    await send('Runtime.evaluate', {
      expression: `new Promise(resolve => {
        const img = document.getElementById('ref');
        if (img.complete) return resolve();
        img.onload = () => resolve();
      })`,
      awaitPromise: true
    });

    // In modal_create_target (offset in full image: x: 14, y: 34)
    // Modal width is ~486, height is ~310.
    // Let's locate the 4 islands inside the left interactive map area:
    // Left map area is roughly: x: 26 to 286, y: 88 to 326.
    // 1. Bahia Coral:
    // Island art: x: 50, y: 105, w: 105, h: 90
    // 2. Isla volcanica:
    // Island art: x: 180, y: 110, w: 105, h: 90
    // 3. Aguas heladas:
    // Island art: x: 45, y: 205, w: 105, h: 95
    // 4. Atardecer:
    // Island art: x: 175, y: 205, w: 110, h: 95
    // 5. Right preview banner:
    // Banner: x: 322, y: 78, w: 156, h: 56
    // 6. 3D Wave icon:
    // Wave icon in header: x: 185, y: 55, w: 32, h: 26
    // In browse list, the 4 thumbnails:
    // row 1 thumbnail: x: 555, y: 153, w: 38, h: 28
    // row 2 thumbnail: x: 555, y: 191, w: 38, h: 28
    // row 3 thumbnail: x: 555, y: 228, w: 38, h: 28
    // row 4 thumbnail: x: 555, y: 265, w: 38, h: 28

    const evalRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const img = document.getElementById('ref');
        function crop(x, y, w, h) {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
          return c.toDataURL('image/png').split(',')[1];
        }

        return {
          waveIcon: crop(190, 58, 30, 24),
          bannerCoral: crop(322, 78, 156, 56),
          islandCoral: crop(52, 110, 110, 85),
          islandVolcano: crop(180, 112, 105, 85),
          islandIce: crop(48, 210, 110, 92),
          islandSunset: crop(175, 210, 115, 92),
          mapBackground: crop(35, 95, 260, 225),
          thumbCoral: crop(555, 153, 38, 28),
          thumbVolcano: crop(555, 191, 38, 28),
          thumbIce: crop(555, 228, 38, 28),
          thumbSunset: crop(555, 265, 38, 28)
        };
      })()`,
      returnByValue: true
    });

    const res = evalRes.result.value;
    const dir = 'C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\custom_ui';
    fs.mkdirSync(dir, { recursive: true });

    for (const [key, base64] of Object.entries(res)) {
      fs.writeFileSync(`${dir}\\${key}.png`, Buffer.from(base64, 'base64'));
    }
    console.log('Saved all cropped assets to', dir);

    ws.close();
  } catch (e) {
    console.error('Error:', e);
  } finally {
    browser.kill();
    server.close();
  }
});

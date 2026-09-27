import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';

const BRAVE_PATH = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const TEMP_PROFILE = 'C:\\Users\\kazaf\\AppData\\Local\\Temp\\brave_capture_profile';

const server = http.createServer((req, res) => {
  if (req.url === '/create.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(fs.readFileSync('C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\ref_crops\\modal_create_target.png'));
    return;
  }
  if (req.url === '/browse.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(fs.readFileSync('C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\ref_crops\\modal_browse_target.png'));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><body><img id="create" src="/create.png"><img id="browse" src="/browse.png"></body></html>`);
});

server.listen(4822, async () => {
  const browser = spawn(BRAVE_PATH, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_PROFILE}`,
    '--headless=new',
    'http://127.0.0.1:4822'
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
    await new Promise(resolve => ws.onopen = resolve);

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

    const evalRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const browse = document.getElementById('browse');
        const create = document.getElementById('create');

        function crop(img, x, y, w, h) {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
          return c.toDataURL('image/png').split(',')[1];
        }

        // Browse modal is 486 x 310.
        // Let's find rows in browse:
        // Row 1 (Surferos Latam): thumb at x: 33, y: 119, w: 35, h: 26
        // Row 2 (Ola Extrema): thumb at x: 33, y: 156, w: 35, h: 26
        // Row 3 (Frozen Waves): thumb at x: 33, y: 194, w: 35, h: 26
        // Row 4 (Sunset Riders): thumb at x: 33, y: 231, w: 35, h: 26
        // Wave icon in title: x: 147, y: 32, w: 26, h: 20

        // In create modal (486 x 310):
        // Interactive map area on the left:
        // x: 18, y: 70, w: 282, h: 226
        // Right preview card:
        // x: 304, y: 44, w: 164, h: 252
        // Preview banner inside card:
        // x: 311, y: 49, w: 150, h: 54

        return {
          browseRow1: crop(browse, 33, 119, 35, 26),
          browseRow2: crop(browse, 33, 156, 35, 26),
          browseRow3: crop(browse, 33, 194, 35, 26),
          browseRow4: crop(browse, 33, 231, 35, 26),
          createWaveIcon: crop(create, 175, 27, 28, 22),
          createMapArea: crop(create, 18, 70, 282, 226),
          createRightCard: crop(create, 304, 44, 164, 252),
          previewBannerCoral: crop(create, 311, 49, 150, 54),
          // Island 1 (Bahia Coral):
          island1: crop(create, 34, 76, 112, 100),
          // Island 2 (Isla volcanica):
          island2: crop(create, 168, 88, 92, 92),
          // Island 3 (Aguas heladas):
          island3: crop(create, 32, 184, 102, 98),
          // Island 4 (Atardecer):
          island4: crop(create, 162, 186, 104, 96),
        };
      })()`,
      returnByValue: true
    });

    const res = evalRes.result.value;
    const dir = 'C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\custom_ui';
    for (const [key, base64] of Object.entries(res)) {
      fs.writeFileSync(`${dir}\\${key}.png`, Buffer.from(base64, 'base64'));
    }
    console.log('Saved corrected crops to', dir);
    ws.close();
  } catch(e) {
    console.error(e);
  } finally {
    browser.kill();
    server.close();
  }
});

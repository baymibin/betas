import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const BRAVE_PATH = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const TEMP_PROFILE = 'C:\\Users\\kazaf\\AppData\\Local\\Temp\\brave_capture_profile';

const server = http.createServer((req, res) => {
  if (req.url === '/browse.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(fs.readFileSync('C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\ref_crops\\modal_browse_target.png'));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><body><img id="browse" src="/browse.png"></body></html>`);
});

server.listen(4823, async () => {
  const browser = spawn(BRAVE_PATH, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_PROFILE}`,
    '--headless=new',
    'http://127.0.0.1:4823'
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
        const img = document.getElementById('browse');
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);

        function crop(x, y, w, h) {
          const c2 = document.createElement('canvas');
          c2.width = w;
          c2.height = h;
          const ctx2 = c2.getContext('2d');
          ctx2.drawImage(img, x, y, w, h, 0, 0, w, h);
          return c2.toDataURL('image/png').split(',')[1];
        }

        // In browse (486 x 310):
        // Header is ~0 to 70
        // Table head is ~70 to 105
        // Row 1: y ~110 to 146 -> thumbnail is at x: 33, y: 110, w: 35, h: 26
        // Row 2: y ~148 to 184 -> thumbnail is at x: 33, y: 148, w: 35, h: 26
        // Row 3: y ~185 to 221 -> thumbnail is at x: 33, y: 185, w: 35, h: 26
        // Row 4: y ~222 to 258 -> thumbnail is at x: 33, y: 222, w: 35, h: 26

        return {
          r1: crop(33, 110, 35, 26),
          r2: crop(33, 147, 35, 26),
          r3: crop(33, 185, 35, 26),
          r4: crop(33, 222, 35, 26)
        };
      })()`,
      returnByValue: true
    });

    const res = evalRes.result.value;
    const dir = 'C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\custom_ui';
    fs.writeFileSync(`${dir}\\thumb_bahia_coral.png`, Buffer.from(res.r1, 'base64'));
    fs.writeFileSync(`${dir}\\thumb_isla_volcanica.png`, Buffer.from(res.r2, 'base64'));
    fs.writeFileSync(`${dir}\\thumb_aguas_heladas.png`, Buffer.from(res.r3, 'base64'));
    fs.writeFileSync(`${dir}\\thumb_atardecer.png`, Buffer.from(res.r4, 'base64'));
    console.log('Saved exact thumbs!');
    ws.close();
  } catch(e) {
    console.error(e);
  } finally {
    browser.kill();
    server.close();
  }
});

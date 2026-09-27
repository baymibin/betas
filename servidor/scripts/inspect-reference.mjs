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
  res.end(`<!DOCTYPE html>
<html>
<head><title>Reference Inspect</title></head>
<body>
<img id="ref" src="/ref.png">
<canvas id="c"></canvas>
</body>
</html>`);
});

server.listen(4820, async () => {
  console.log('Server running on http://127.0.0.1:4820');

  const browser = spawn(BRAVE_PATH, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_PROFILE}`,
    '--enable-webgl',
    '--headless=new',
    'http://127.0.0.1:4820'
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

    // Wait until image is loaded
    await send('Runtime.evaluate', {
      expression: `new Promise((resolve) => {
        const img = document.getElementById('ref');
        if (img.complete) return resolve();
        img.onload = () => resolve();
      })`,
      awaitPromise: true
    });

    console.log('Image loaded in browser!');

    // Let's analyze the image dimensions and key crop regions
    const evalRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const img = document.getElementById('ref');
        const c = document.getElementById('c');
        const ctx = c.getContext('2d');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);

        function cropBase64(x, y, w, h) {
          const c2 = document.createElement('canvas');
          c2.width = w;
          c2.height = h;
          const ctx2 = c2.getContext('2d');
          ctx2.drawImage(img, x, y, w, h, 0, 0, w, h);
          return c2.toDataURL('image/png').split(',')[1];
        }

        // Entire Left modal:
        // In the image (1024x354), title "3. CREAR PARTIDA - OPCION 2 (MAPA INTERACTIVO)" is at the top
        // Let's crop modal left: roughly x: 12, y: 32, w: 490, h: 312
        // Let's crop modal right: roughly x: 520, y: 32, w: 490, h: 312
        return {
          width: img.naturalWidth,
          height: img.naturalHeight,
          modalLeft: cropBase64(14, 34, 486, 310),
          modalRight: cropBase64(524, 34, 486, 310)
        };
      })()`,
      returnByValue: true
    });

    const result = evalRes.result.value;
    console.log('Result dimensions:', result.width, 'x', result.height);

    fs.mkdirSync('C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\ref_crops', { recursive: true });
    fs.writeFileSync('C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\ref_crops\\modal_create_target.png', Buffer.from(result.modalLeft, 'base64'));
    fs.writeFileSync('C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\ref_crops\\modal_browse_target.png', Buffer.from(result.modalRight, 'base64'));
    console.log('Saved modal_create_target.png and modal_browse_target.png');

    ws.close();
  } catch (err) {
    console.error('Error:', err);
  } finally {
    browser.kill();
    server.close();
  }
});

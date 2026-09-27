import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const BRAVE_PATH = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const TEMP_PROFILE = 'C:\\Users\\kazaf\\AppData\\Local\\Temp\\brave_capture_profile';

const server = http.createServer((req, res) => {
  if (req.url === '/create.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(fs.readFileSync('C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\ref_crops\\modal_create_target.png'));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><body><img id="create" src="/create.png"><canvas id="c"></canvas></body></html>`);
});

server.listen(4825, async () => {
  const browser = spawn(BRAVE_PATH, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_PROFILE}`,
    '--headless=new',
    'http://127.0.0.1:4825'
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
        const create = document.getElementById('create');
        const c = document.getElementById('c');
        c.width = 24;
        c.height = 18;
        const ctx = c.getContext('2d');
        // Crop the wave icon on the yellow button in modal_create_target
        ctx.drawImage(create, 335, 281, 18, 14, 0, 0, 24, 18);
        return c.toDataURL('image/png').split(',')[1];
      })()`,
      returnByValue: true
    });

    const res = evalRes.result.value;
    fs.writeFileSync('C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\custom_ui\\buttonWaveIcon.png', Buffer.from(res, 'base64'));
    console.log('Saved buttonWaveIcon.png');
    ws.close();
  } catch(e) {
    console.error(e);
  } finally {
    browser.kill();
    server.close();
  }
});

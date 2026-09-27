import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const BRAVE_PATH = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const TEMP_PROFILE = 'C:\\Users\\kazaf\\AppData\\Local\\Temp\\brave_capture_profile';

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/img/')) {
    const file = req.url.replace('/img/', '');
    const path = `C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\custom_ui\\${file}`;
    if (fs.existsSync(path)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(fs.readFileSync(path));
      return;
    }
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><body>
    <img id="coral" src="/img/previewBannerCoral.png">
    <img id="volc" src="/img/thumb_isla_volcanica.png">
    <img id="ice" src="/img/thumb_aguas_heladas.png">
    <img id="sunset" src="/img/thumb_atardecer.png">
    <canvas id="c"></canvas>
  </body></html>`);
});

server.listen(4824, async () => {
  const browser = spawn(BRAVE_PATH, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${TEMP_PROFILE}`,
    '--headless=new',
    'http://127.0.0.1:4824'
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
        function makeBanner(srcImg, gradStart, gradEnd) {
          const c = document.createElement('canvas');
          c.width = 320;
          c.height = 116;
          const ctx = c.getContext('2d');
          
          // Background gradient
          const g = ctx.createLinearGradient(0, 0, 320, 116);
          g.addColorStop(0, gradStart);
          g.addColorStop(1, gradEnd);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 320, 116);

          // Draw image stretched / covered
          ctx.save();
          // Draw subtle vignette
          ctx.drawImage(srcImg, 0, 0, 320, 116);
          ctx.restore();

          return c.toDataURL('image/png').split(',')[1];
        }

        const coral = document.getElementById('coral');
        const volc = document.getElementById('volc');
        const ice = document.getElementById('ice');
        const sunset = document.getElementById('sunset');

        return {
          banner_0: makeBanner(coral, '#0c7080', '#022b3c'),
          banner_4: makeBanner(volc, '#5c1d0c', '#1f0802'),
          banner_5: makeBanner(ice, '#0c5270', '#02182b'),
          banner_2: makeBanner(sunset, '#703c0c', '#2b1002'),
        };
      })()`,
      returnByValue: true
    });

    const res = evalRes.result.value;
    const dir = 'C:\\APLICATIVO\\SURF\\client\\assets\\images\\menu\\custom_ui';
    fs.writeFileSync(`${dir}\\banner_0.png`, Buffer.from(res.banner_0, 'base64'));
    fs.writeFileSync(`${dir}\\banner_4.png`, Buffer.from(res.banner_4, 'base64'));
    fs.writeFileSync(`${dir}\\banner_5.png`, Buffer.from(res.banner_5, 'base64'));
    fs.writeFileSync(`${dir}\\banner_2.png`, Buffer.from(res.banner_2, 'base64'));
    console.log('Saved 4 circuit banners!');

    ws.close();
  } catch(e) {
    console.error(e);
  } finally {
    browser.kill();
    server.close();
  }
});

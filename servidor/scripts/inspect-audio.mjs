import {spawn} from 'node:child_process';

const p = spawn('C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', [
  '--remote-debugging-port=9223',
  '--user-data-dir=C:\\Users\\kazaf\\AppData\\Local\\Temp\\brave_audio_test',
  '--headless=new',
  'http://localhost:3000'
]);

setTimeout(async () => {
  try {
    const res = await fetch('http://127.0.0.1:9223/json/list');
    const list = await res.json();
    const ws = new WebSocket(list[0].webSocketDebuggerUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          awaitPromise: true,
          returnByValue: true,
          expression: `
            (async () => {
              const ctx = new AudioContext();
              const [res1, res2] = await Promise.all([fetch('/assets/audio/effects/impact_1.mp3'), fetch('/assets/audio/effects/whoosh_1.mp3')]);
              const buf1 = await ctx.decodeAudioData(await res1.arrayBuffer());
              const buf2 = await ctx.decodeAudioData(await res2.arrayBuffer());
              function findSound(buf) {
                const chan = buf.getChannelData(0);
                for (let i = 0; i < chan.length; i++) {
                  if (Math.abs(chan[i]) > 0.05) return i / buf.sampleRate;
                }
                return -1;
              }
              return {
                impact: { duration: buf1.duration, firstSound: findSound(buf1) },
                whoosh: { duration: buf2.duration, firstSound: findSound(buf2) }
              };
            })()
          `
        }
      }));
    };
    ws.onmessage = (e) => {
      console.log('Audio analysis:', JSON.stringify(JSON.parse(e.data).result.result.value, null, 2));
      ws.close();
      p.kill();
      process.exit(0);
    };
  } catch (e) {
    console.error(e);
    p.kill();
    process.exit(1);
  }
}, 1500);

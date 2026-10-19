// Render a page exactly like the shop TV (960×540 CSS px, 2× pixels) with
// headless Chrome over the DevTools protocol, wait for live data, screenshot,
// and run the "nothing cut off / nothing overlapping" check.
//   node --experimental-websocket scripts/tv-snapshot.mjs <url> <out.png> [waitMs] [keys]
//   e.g. url = http://localhost:3000/tv?tv=TOKEN&preview=1&slide=preview-calendar&type=calendar, keys = space (pause)
//   Costs Firestore reads like any page load — use sparingly.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, out, waitMs = '15000', keys = ''] = process.argv.slice(2);
const port = 9333;
const dir = process.env.TEMP + '\\fabtrack-tvshot-profile';
mkdirSync(dir, { recursive: true });
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  '--hide-scrollbars', '--window-size=960,540', 'about:blank',
], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 50 && !targets.length; i++) {
  await sleep(200);
  try { targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(t => t.type === 'page'); } catch { }
}
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const waiting = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 2, mobile: false });
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(Number(waitMs));
for (const k of keys.split(',').filter(Boolean)) {   // e.g. "space" to pause slides
  const key = k === 'space' ? ' ' : k;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: k === 'space' ? 'Space' : k });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: k === 'space' ? 'Space' : k });
  await sleep(1500);
}
const check = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
  const main = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string' && d.className.includes('flex-1 min-h-0 overflow-hidden transition-opacity'));
  if (!main) return { note: 'no slide area' };
  const cur = document.querySelector('button[aria-current="true"]');
  const cut = [];
  for (const el of main.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'hidden') && el.scrollHeight > el.clientHeight + 3 && el.clientHeight > 40 && !String(el.className).includes('absolute inset-0 overflow-y-auto'))
      cut.push([String(el.className).slice(0, 40), el.clientHeight, el.scrollHeight]);
  }
  const blocks = [...main.querySelectorAll('p, h2, h3, span, li')].filter(e => e.textContent.trim() && e.getBoundingClientRect().height > 0);
  const overlaps = [];
  for (let i = 0; i < blocks.length && overlaps.length < 6; i++) for (let j = i + 1; j < blocks.length; j++) {
    const A = blocks[i], B = blocks[j]; if (A.contains(B) || B.contains(A)) continue;
    const a = A.getBoundingClientRect(), b = B.getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 4 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 4) { overlaps.push([A.textContent.trim().slice(0, 18), B.textContent.trim().slice(0, 18)]); if (overlaps.length >= 6) break; }
  }
  return { slide: cur ? cur.textContent.trim() : '?', cut, overlaps };
})()` });
console.log(JSON.stringify(check.result?.result?.value));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('saved', out);
ws.close(); chrome.kill();
process.exit(0);

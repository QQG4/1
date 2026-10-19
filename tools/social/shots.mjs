// Скриншоты нашего сайта для роликов «Разбор»: headless Chrome через DevTools-протокол, без пакетов (WebSocket встроен в node).
// Запуск: node tools/social/shots.mjs <shots.json> [имя…]
// shots.json: {"out": "папка", "shots": [{"name": "…", "url": "#/test/kaztest-b1-01/reading",
//   "steps": [{"eval": "js"}, {"click": "css"}, {"go": "#/…"}, {"answer": "reading"}, {"wait": 500}], "scroll": "css", "spot": ["css", …], "dump": "js"}]}
// Телефон 540×960 при плотности 2 → картинка 1080×1920, как кадр ролика. Сайт — свежая сборка docs/ на своём порту,
// прогресс в каждом снимке начинается с нуля (новый профиль Chrome). «spot» — подсветка: золотая рамка и затемнение
// вокруг, рисуется прямо в странице, поэтому всегда точно по элементу. «dump» печатает результат js (для разведки).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8797, DBG = 9327;
const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const only = process.argv.slice(3);
const outDir = resolve(dirname(process.argv[2]), spec.out || '.');
mkdirSync(outDir, { recursive: true });
// «answer»: отвечает как живой человек — верно 7 вопросов из 10 (или right из 10) (детерминированно), вариант ищется по тексту из данных теста
const ANSWER = `((sec, K) => { window.confirm = () => true; const t = KZ.tests.find(x => x.id === location.hash.split('/')[2]);
   const qs = t.sections.find(s => s.type === sec); const all = qs.questions || (qs.parts||[]).flatMap(p => p.questions);
   document.querySelectorAll('#app .q').forEach((el, i) => { const q = all[i]; if (!q) return; const labs = [...el.querySelectorAll('label.opt')];
     const want = (i % 10 < K) ? q.options[q.answer] : q.options[(q.answer + 1) % q.options.length];
     const lab = labs.find(l => l.textContent.trim().endsWith(String(want).trim())) || labs[0]; lab.querySelector('input').click(); }); return 1 })`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn('python3', ['serve.py'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DBG, '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'shots-')),
  '--no-first-run', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 50; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); const p = l.find(t => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; } catch {}
    await sleep(200);
  }
  throw new Error('Chrome не поднялся');
}

let ws, seq = 0; const pending = new Map();
function cdp(method, params = {}) {
  const id = ++seq; ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('js: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
const SPOT = `(sels => { const st = document.createElement('style'); st.textContent =
  '.qt-spot{outline:6px solid #e9c46a!important;outline-offset:4px;border-radius:10px;box-shadow:0 0 0 9999px rgba(10,30,40,.55)!important;position:relative;z-index:9999}';
  document.head.appendChild(st); for (const s of sels) { const e = document.querySelector(s); if (!e) throw new Error('нет элемента ' + s); e.classList.add('qt-spot'); } })`;

try {
  ws = new WebSocket(await target());
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 540, height: 960, deviceScaleFactor: 2, mobile: true });
  // светлая тема: на телефоне читается лучше тёмной, которую headless Chrome выбирает сам
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: spec.theme || 'light' }] });
  for (const s of spec.shots) {
    if (only.length && !only.includes(s.name)) continue;
    await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }); await sleep(800);
    await js(`localStorage.clear(); localStorage.setItem('kz-trainer:lang', ${JSON.stringify(s.lang || 'ru')}); true`);
    await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/?v=${Date.now()}${s.url || ''}` }); await sleep(1200);
    for (const st of s.steps || []) {
      if (st.eval) await js(st.eval);
      if (st.type) await js(`(() => { const t = document.querySelector(${JSON.stringify(st.into || 'textarea.essay')}); t.value = ${JSON.stringify(st.type)}; t.dispatchEvent(new Event('input', {bubbles: true})); return 1 })()`);
      if (st.go) await js(`location.hash = ${JSON.stringify(st.go)}; 1`);
      if (st.answer) await js(`${ANSWER}(${JSON.stringify(st.answer)}, ${st.right ?? 7})`);   // right: сколько из 10 верно
      if (st.click) await js(`(() => { const e = document.querySelector(${JSON.stringify(st.click)}); if (!e) throw new Error('нет элемента ${st.click.replace(/'/g, '')}'); e.click(); return 1 })()`);
      await sleep(st.wait ?? 400);
    }
    if (s.dump) { console.log(s.name + ':', JSON.stringify(await js(s.dump), null, 1)); continue; }
    if (s.scroll) await js(`document.querySelector(${JSON.stringify(s.scroll)}).scrollIntoView({block: ${JSON.stringify(s.block || 'start')}}); window.scrollBy(0, ${s.offset || -20}); 1`);
    // плавающая кнопка «Сообщить об ошибке» в ролике лишняя
    await js(`(() => { const st = document.createElement('style'); st.textContent = '.fb{display:none!important}'; document.head.appendChild(st); return 1 })()`);
    if (s.spot) await js(`${SPOT}(${JSON.stringify(s.spot)}); 1`);
    await sleep(300);
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, s.name + '.png'), Buffer.from(data, 'base64'));
    console.log(join(outDir, s.name + '.png'));
  }
} finally {
  try { ws?.close(); } catch {}
  chrome.kill(); server.kill();
}

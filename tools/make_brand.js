#!/usr/bin/env node
/* Картинки бренда: docs/og.png (1200×630), docs/favicon.svg, docs/apple-touch-icon.png, docs/telegram-avatar.png (512×512, Telegram обрезает в круг).
   Рисует headless Chrome шрифтами сайта. Нужен puppeteer-core (NODE_PATH=<папка с node_modules> node tools/make_brand.js) и Chrome. */
const p = require('puppeteer-core'), fs = require('fs'), path = require('path'), os = require('os');
const root = path.resolve(__dirname, '..'), docs = path.join(root, 'docs');
const NAVY = '#34497a', TONE = '#40578d', SUN = '#f0d48a', PAPER = '#f7f8fa';
const H = 'M50 92V60C50 36 60 12 79 12c13 0 20 12 15 23-5 10-20 9-22-1-1-8 8-12 13-6M50 60C50 36 40 12 21 12 8 12 1 24 6 35c5 10 20 9 22-1 1-8-8-12-13-6M50 74c7 2 16 1 20-6 3-6-3-11-8-8M50 74c-7 2-16 1-20-6-3-6 3-11 8-8M36 92h28';
const mark = (color, sw = 7.5) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="${H}"/></svg>`;
const fonts = 'file://' + path.join(root, 'src/design/fonts/fonts.css');
const tile = "url(\"data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200' fill='none' stroke='#3f5689' stroke-width='6' stroke-linecap='round' stroke-linejoin='round'><path transform='translate(10 10) scale(.8)' d='${H}'/><path transform='translate(110 110) scale(.8)' d='${H}'/></svg>`) + "\")";
const page = (body, w, h) => `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${fonts}"><style>*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}body{background:${NAVY} ${tile};background-size:${Math.round(w / 8)}px;color:${PAPER};position:relative}</style>${body}`;
const icon = (s) => page(`<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${mark(SUN).replace('<svg ', `<svg width="${Math.round(s * .62)}" height="${Math.round(s * .62)}" `)}</div>`, s, s);
const og = page(`<div style="position:absolute;right:-30px;top:40px;width:560px;height:560px">${mark(TONE)}</div>
 <div style="position:absolute;left:80px;top:96px;right:80px;font-family:Geologica">
 <div style="font-weight:800;font-size:112px;line-height:1.1;letter-spacing:.012em">Qazaq Trainer</div>
 <div style="font-weight:700;font-size:44px;line-height:1.2;margin-top:34px;letter-spacing:.012em">Пробные ҚАЗТЕСТ и Qazaq Resmi Test</div>
 <div style="font-weight:800;font-size:40px;color:${SUN};margin-top:22px">Бесплатно. Без регистрации.</div></div>
 <div style="position:absolute;left:0;right:0;bottom:0;height:56px;background:${SUN}"></div>`, 1200, 630);
(async () => {
  const b = await p.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  const shot = async (html, w, h, file, scale = 1) => {
    const t = path.join(os.tmpdir(), 'qt-brand-' + path.basename(file) + '.html'); fs.writeFileSync(t, html);
    const g = await b.newPage(); await g.setViewport({ width: w, height: h, deviceScaleFactor: scale });
    await g.goto('file://' + t, { waitUntil: 'networkidle0' }); await g.evaluate(() => document.fonts.ready);
    await g.screenshot({ path: file }); await g.close(); fs.unlinkSync(t);
  };
  await shot(og, 1200, 630, path.join(docs, 'og.png'));
  await shot(icon(512), 512, 512, path.join(docs, 'telegram-avatar.png'));
  await shot(icon(180), 180, 180, path.join(docs, 'apple-touch-icon.png'));
  fs.writeFileSync(path.join(docs, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${NAVY}"/><g fill="none" stroke="${SUN}" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(9 9) scale(.46)"><path d="${H}"/></g></svg>`);
  if (process.argv[2]) await shot(icon(512), 512, 512, process.argv[2], 2);   // для соцсетей: квадрат 1024×1024
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

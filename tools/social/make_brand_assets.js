#!/usr/bin/env node
/* Ассеты кадров роликов из контуров tools/make_brand.js: фон 1080×1920 (синий с едва заметным узором қошқар мүйіз)
   и знак в жёлтом и синем. Рисует headless Chrome. Запускать при смене контуров. */
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const src = fs.readFileSync(path.join(__dirname, '../make_brand.js'), 'utf8');
const pick = (name) => { const m = src.match(new RegExp('const ' + name + ' = (.*);\\n')); if (!m) throw new Error(name); return m[1]; };
const H = eval(pick('H')), NAVY = '#34497a', SUN = '#f0d48a';
const mark = (color, sw = 7.5) => eval('(' + src.match(/const mark = (\(color[\s\S]*?`);\n/)[1] + ')')(color, sw);
const tile = eval(pick('tile'));
const out = path.join(__dirname, 'brand'), chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
function shot(html, w, h, file, transparent) {
  const t = path.join(os.tmpdir(), 'qt-' + file + '.html'); fs.writeFileSync(t, '<!doctype html><meta charset=utf-8><style>html,body{margin:0;width:' + w + 'px;height:' + h + 'px;overflow:hidden;background:' + (transparent ? 'transparent' : NAVY) + '}</style>' + html);
  execFileSync(chrome, ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=' + w + ',' + h, '--screenshot=' + path.join(out, file), ...(transparent ? ['--default-background-color=00000000'] : []), 'file://' + t], { stdio: 'ignore' });
}
shot('<div style="position:absolute;inset:0;background-image:' + tile + ';background-size:' + (process.argv[2] || 260) + 'px"></div>', 1080, 1920, 'bg.png');
shot(mark(SUN).replace('<svg ', '<svg width="480" height="480" '), 480, 480, 'mark-sun.png', true);
shot(mark(NAVY).replace('<svg ', '<svg width="480" height="480" '), 480, 480, 'mark-navy.png', true);
console.log('готово', fs.readdirSync(out));

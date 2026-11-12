/* Облегчённые описания тестов для публичной главной (12.11.2026).
   Главная весила 3,3 МБ, потому что несла тексты всех тестов. Теперь в неё идёт только каркас каждого теста: всё, что нужно
   главной, странице экзамена, странице теста и «Моему прогрессу» (id, уровень, название, summary, типы разделов, минуты,
   число заданий, баллы). Тексты, вопросы и варианты ответов браузер берёт из docs/tests/<id>.js, когда открывают раздел
   (KZ.loadTests в app.js). Каркас помечен _lite: true.
   Запуск: node tools/dump_lite.js → JS в stdout (его вызывает build.py; без node сборка вшивает тесты целиком, как раньше). */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'src', 'data', 'tests');
// строки внутри разделов, которые нужны вне самого раздела; остальные строки заменяются пустыми, структура и числа остаются
const KEEP = new Set(['type', 'kind', 'id', 'title', 'title_kk', 'label', 'label_kk', 'tag', 'scene']);
const CUT = new Set(['intro', 'intro_kk']);   // страница теста показывает первые 140 знаков вступления

function lite(v, key) {
  if (typeof v === 'string') return KEEP.has(key) ? v : CUT.has(key) ? v.slice(0, 141) : '';
  if (Array.isArray(v)) return v.map(x => lite(x, key));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = lite(v[k], k); return o; }
  return typeof v === 'function' ? undefined : v;
}

const out = [];
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js')).sort()) {
  const KZ = { tests: [] };
  vm.runInNewContext(fs.readFileSync(path.join(dir, f), 'utf8'), { KZ });
  if (KZ.tests.length !== 1 || KZ.tests[0].id !== f.slice(0, -3)) throw new Error(f + ': в файле должен быть один тест с id, равным имени файла');
  const t = KZ.tests[0], o = {};
  for (const k of Object.keys(t)) o[k] = k === 'sections' ? lite(t.sections, k) : t[k];
  o._lite = true;
  out.push('KZ.tests.push(' + JSON.stringify(o) + ');');
}
process.stdout.write(out.join('\n') + '\n');

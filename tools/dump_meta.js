/* Выгружает метаданные экзаменов, уровней и мок-тестов в JSON для build.py.
   Нужен только для генерации посадочных страниц (docs/ru/..., docs/kk/...): build.py
   кладёт результат в tools/pages-meta.json и умеет собираться из этого файла,
   если node на машине нет. Запуск: node tools/dump_meta.js > tools/pages-meta.json

   Файлы данных писались для браузера: exams.js делает window.KZ = window.KZ || {},
   тесты — KZ.tests.push({...}). Поэтому песочница подсовывает сама себя в роли window. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = path.join(__dirname, '..', 'src', 'data');
const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
const run = (p) => vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: p });

run(path.join(src, 'exams.js'));
for (const f of fs.readdirSync(path.join(src, 'tests')).filter((f) => f.endsWith('.js')).sort())
  run(path.join(src, 'tests', f));

const KZ = ctx.KZ;
const pick = (o, keys) => keys.reduce((a, k) => (o && o[k] != null ? ((a[k] = o[k]), a) : a), {});

const out = {
  levelOrder: KZ.levelOrder,
  levels: Object.fromEntries(Object.entries(KZ.levels).map(([k, v]) =>
    [k, pick(v, ['name', 'name_kk', 'units', 'units_kk', 'cefr', 'cefr_kk', 'focus', 'focus_kk'])])),
  exams: Object.fromEntries(Object.entries(KZ.exams).map(([k, v]) => [k, Object.assign(
    pick(v, ['id', 'name', 'short', 'kicker', 'tagline', 'tagline_kk', 'verified', 'examLevels', 'totalMinutes']),
    { sections: (v.sections || []).map((s) => pick(s, ['type', 'num', 'title', 'kk', 'minutes', 'tasks', 'tasks_kk', 'desc', 'desc_kk'])) })])),
  // Вопросы для «задания дня» в Telegram: только те, что понятны без текста и аудио —
  // лексика QRT и лексико-грамматические задания ҚАЗТЕСТ. Ограничения викторины Telegram:
  // вопрос до 300 знаков, вариант до 100, пояснение до 200.
  quiz: KZ.tests
    .filter((t) => t.status !== 'draft')
    .flatMap((t) => (t.sections || []).flatMap((s) => (s.questions || [])
      .filter((q) => (s.type === 'lexis' || (s.type === 'reading' && q.tag)) &&
        Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 10 &&
        (q.text || '').length <= 280 && q.options.every((o) => String(o).length <= 100) &&
        !/мәтін/i.test(q.text || ''))
      .map((q) => ({
        exam: t.exam, level: t.level, test: t.id, qid: q.id,
        text: q.text, options: q.options, answer: q.answer,
        explain: String(q.explain_kk || q.explain || '').slice(0, 180),
      })))),
  tests: KZ.tests
    .filter((t) => t.status !== 'draft' && (t.sections || []).length)
    .map((t) => pick(t, ['id', 'exam', 'level', 'title', 'title_kk', 'summary', 'summary_kk'])),
};
process.stdout.write(JSON.stringify(out, null, 1));

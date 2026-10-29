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
    pick(v, ['id', 'name', 'short', 'kicker', 'tagline', 'tagline_kk', 'verified', 'examLevels', 'totalMinutes',
             'totalTasks', 'verifiedNote', 'certificateNote', 'certificateNote_kk', 'scoring', 'unverified', 'sources',
             'sittingNote', 'scale']),
    { sections: (v.sections || []).map((s) => pick(s, ['type', 'num', 'title', 'kk', 'minutes', 'tasks', 'tasks_kk', 'desc', 'desc_kk'])) })])),
/* Задания для Telegram: четыре набора под три поста в день (чтение утром, грамматика или лексика днём,
     аудирование вечером). Ограничения Telegram: вопрос викторины до 300 знаков, вариант до 100, пояснение до 200,
     обычное сообщение до 4096. Поэтому вопросы и варианты фильтруются по длине, а текст чтения обрезается. */
  quiz: (() => {
    const ok = (q) => Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 10 &&
      (q.text || '').length <= 260 && q.options.every((o) => String(o).length <= 100);
    const base = (t, s, q) => ({ exam: t.exam, level: t.level, test: t.id, qid: q.id, text: q.text,
      options: q.options, answer: q.answer, explain: String(q.explain_kk || q.explain || '').slice(0, 180) });
    const out = { lexis: [], grammar: [], reading: [], listening: [] };
    for (const t of KZ.tests.filter((t) => t.status !== 'draft')) {
      for (const s of t.sections || []) {
        for (const q of s.questions || []) {
          if (!ok(q)) continue;
          // лексика и грамматика понятны сами по себе, без текста и аудио
          if (s.type === 'lexis' && !/мәтін/i.test(q.text || '')) out.lexis.push(base(t, s, q));
          else if (s.type === 'reading' && q.tag && !/мәтін/i.test(q.text || '')) out.grammar.push(base(t, s, q));
          // к вопросу на понимание прикладываем сам текст, к вопросу аудирования — mp3 с сайта
          else if (s.type === 'reading' && !q.tag && s.passage && q.kind !== 'tf') {
            // В Telegram длинный текст отпугивает, поэтому берём один абзац — тот, откуда взят ответ.
            // Пояснение к вопросу почти всегда цитирует нужное место в «ёлочках», по этой цитате абзац и находится.
            // Если цитаты нет, подходит только короткий текст целиком; остальные вопросы в набор не попадают.
            const paras = s.passage.paragraphs || [], whole = paras.join('\n\n');
            let body = '', excerpt = false;
            for (const qu of String(q.explain_kk || q.explain || '').match(/«[^»]{15,}»/g) || []) {
              const core = qu.replace(/[«»]/g, '').split('...')[0].split('…')[0].trim().slice(0, 40);
              if (core.length < 15) continue;
              const hit = paras.find((p) => p.includes(core));
              if (hit && hit.length <= 700) { body = hit; excerpt = true; break; }
            }
            if (!body && whole.length <= 800) body = whole;
            if (body) out.reading.push(Object.assign(base(t, s, q), { title: s.passage.title, body, excerpt }));
          } else if (s.type === 'listening' && s.script && q.kind !== 'tf') {
            out.listening.push(Object.assign(base(t, s, q), { title: s.script.title, audio: 'audio/' + t.id + '.mp3' }));
          }
        }
      }
    }
    return out;
  })(),
/* Образцы для страницы «Образцы заданий» (ru/obrazcy-zadaniy/): по одному вопросу на «экзамен × уровень» из первого
     готового варианта. Берём то, что понятно без текста и аудио: лексико-грамматическое задание ҚАЗТЕСТ и лексику QRT. */
  samples: (() => {
    const out = {};
    const tests = KZ.tests.filter((t) => t.status !== 'draft' && !t.block).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const t of tests) {
      const key = t.exam + '-' + t.level;
      if (out[key]) continue;
      for (const s of t.sections || []) {
        const q = (s.questions || []).find((q) => Array.isArray(q.options) && q.explain && !/мәтін/i.test(q.text || '') &&
          ((s.type === 'reading' && q.tag) || s.type === 'lexis'));
        if (q) { out[key] = Object.assign({ test: t.id, section: s.type }, pick(q, ['id', 'text', 'options', 'answer', 'explain'])); break; }
      }
    }
    return out;
  })(),
/* Критерии письма и говорения ҚАЗТЕСТ для страницы ru/kaztest/kriterii/: они официальные (PDF НЦТ) и одинаковы во всех
     вариантах, поэтому берём первый готовый тест; same — сколько вариантов дают тот же набор критериев (проверка в build.py). */
  criteria: (() => {
    const kt = KZ.tests.filter((t) => t.exam === 'kaztest' && t.status !== 'draft' && !t.block).sort((a, b) => (a.id < b.id ? -1 : 1));
    const take = (t) => {
      const w = (t.sections || []).find((s) => s.type === 'writing'), sp = (t.sections || []).find((s) => s.type === 'speaking');
      if (!w || !sp) return null;
      const crit = (c) => (c || []).map((x) => pick(x, ['name', 'max', 'top']));
      return {
        writing: (w.tasks || []).map((x) => Object.assign(pick(x, ['kind', 'points', 'minutes', 'minWords']), { criteria: crit(x.criteria) })),
        speaking: Object.assign(pick(sp, ['prepMinutes', 'answerMinutes']), { criteria: crit(sp.criteria),
          tasks: (sp.tasks || []).map((x) => pick(x, ['kind', 'points', 'minutes'])) }),
      };
    };
    const all = kt.map((t) => Object.assign({ from: t.id }, take(t))).filter((c) => c.writing);
    if (!all.length) return null;
    const names = (c) => JSON.stringify([c.writing.map((x) => x.criteria.map((y) => y.name + y.max)), c.speaking.criteria.map((y) => y.name + y.max)]);
    // описание высшего балла в вариантах местами сокращено — показываем самое полное
    const size = (c) => JSON.stringify(c).length, best = all.reduce((a, c) => (size(c) > size(a) ? c : a));
    return Object.assign(best, { same: all.filter((c) => names(c) === names(best)).length, of: all.length });
  })(),
  tests: KZ.tests
    .filter((t) => t.status !== 'draft' && (t.sections || []).length)
    .map((t) => pick(t, ['id', 'exam', 'level', 'block', 'title', 'title_kk', 'summary', 'summary_kk'])),
};
process.stdout.write(JSON.stringify(out, null, 1));

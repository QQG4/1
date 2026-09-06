/* ============================================================
   Курс по уровню (сейчас A1): темы → слова / грамматика / тексты / тест.
   Данные: KZ.courses.<LEVEL> (src/data/course/*.js, собираются из базы
   скриптом база/scripts/build_app_data.py). Подключается после app.js
   через KZ.registerRoute / KZ.util.
   ============================================================ */
(function () {
  'use strict';
  var T = KZ.T, LK = KZ.LK;
  var U = KZ.util, esc = U.esc;

  /* ---------- markdown-мини: таблицы, жирный, абзацы ---------- */
  function md(src) {
    var lines = String(src || '').split('\n'), out = [], i = 0;
    function inline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\\_/g, '_'); }
    while (i < lines.length) {
      var ln = lines[i];
      if (/^\s*\|/.test(ln)) {
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          var cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
          if (!cells.every(function (c) { return /^:?-{2,}:?$/.test(c) || c === ''; })) rows.push(cells);
          i++;
        }
        if (rows.length) out.push('<div class="tablewrap"><table class="gt">' + rows.map(function (r, ri) { return '<tr>' + r.map(function (c) { return '<' + (ri === 0 ? 'th' : 'td') + '>' + inline(c) + '</' + (ri === 0 ? 'th' : 'td') + '>'; }).join('') + '</tr>'; }).join('') + '</table></div>');
        continue;
      }
      if (ln.trim() === '') { i++; continue; }
      out.push('<p>' + inline(ln.trim()) + '</p>'); i++;
    }
    return out.join('');
  }

  /* ---------- прогресс курса ---------- */
  function cp(level, topicId) {
    var st = U.state();
    st.course = st.course || {}; st.course[level] = st.course[level] || {};
    if (!topicId) return st.course[level];
    return st.course[level][topicId] || (st.course[level][topicId] = { words: {}, quizBest: null, gramBest: null, textsDone: {}, testBest: null });
  }
  function topicProgress(level, tp) {
    var p = cp(level, tp.id);
    var known = 0; tp.words.forEach(function (w) { if (p.words[w.l] === 1) known++; });
    var parts = [];
    parts.push(tp.words.length ? known / tp.words.length : 1);
    if (tp.grammar.length) parts.push(p.gramBest == null ? 0 : p.gramBest);
    if (tp.texts.length) parts.push(Object.keys(p.textsDone).length / tp.texts.length);
    parts.push(p.testBest == null ? 0 : p.testBest);
    var pct = Math.round(100 * parts.reduce(function (a, b) { return a + b; }, 0) / parts.length);
    return { known: known, pct: pct, done: p.testBest != null && p.testBest >= 0.7 };
  }
  function courseProgress(course) {
    var tot = 0, known = 0, done = 0;
    course.topics.forEach(function (tp) { var r = topicProgress(course.level, tp); tot += tp.words.length; known += r.known; if (r.done) done++; });
    return { known: known, total: tot, done: done, topics: course.topics.length };
  }
  KZ.courseProgress = courseProgress;

  /* ---------- вьюхи ---------- */
  function viewCourse(course) {
    var pr = courseProgress(course);
    var rows = course.topics.map(function (tp) {
      var r = topicProgress(course.level, tp);
      return '<a class="level-row" href="#/course/' + course.level + '/' + tp.id + '"><span class="lvl">' + tp.order + '</span><span><div class="nm">' + esc(tp.kk) + ' <span class="muted small">· ' + esc(tp.ru) + '</span></div><div class="dsc">' + tp.words.length + ' ' + T('слов') + ' · ' + tp.grammar.length + ' ' + T('грам.') + ' ' + (tp.grammar.length === 1 ? T('тема') : T('темы')) + ' · ' + tp.texts.length + ' ' + (tp.texts.length === 1 ? T('текст') : T('текста(ов)')) + (tp.lessons.length ? ' · ' + T('уроки') + ' ' + tp.lessons.map(function (l) { return l.section + '.' + l.lesson; }).join(', ') : '') + '</div></span><span class="st"><span class="badge ' + (r.done ? 'ok' : r.pct ? 'warn' : 'muted') + '">' + (r.done ? T('пройдена') : r.pct + ' %') + '</span></span></a>';
    }).join('');
    return U.topbar([{ label: T('Хаб'), href: '#/' }, { label: course.title }], '<span class="badge level">' + course.level + '</span>') +
      '<div class="kicker">' + esc(course.kk) + ' · ' + esc(course.ru) + '</div><h1>' + esc(course.title) + ': ' + course.topics.length + ' ' + T('тем по официальной программе') + '</h1>' +
      '<p class="lede">' + T('Слова —') + ' ' + pr.total + ' ' + T('(выучено') + ' ' + pr.known + '), ' + T('грамматика —') + ' ' + course.stats.grammar + ' ' + T('тем, тексты —') + ' ' + course.stats.texts + '. ' + T('Каждая тема: карточки слов, правило с таблицей окончаний и заданиями, тексты с вопросами, итоговый тест. Тема считается пройденной при 70 % в итоговом тесте.') + '</p>' +
      '<div class="notice info"><b class="t">' + T('Источники') + '</b><p>' + esc(course.note) + '</p><ul class="srclist">' + course.sources.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="levels">' + rows + '</div>' +
      (course.maqal && course.maqal.length ? '<section class="mt"><h2>Мақал-мәтелдер уровня</h2><p class="sub">Из лексического минимума ҰТО. Пригодятся в письме и говорении: критерий «сөздік қор» прямо даёт балл за пословицы.</p><div class="block"><ul class="prompt-list">' + course.maqal.map(function (m) { return '<li><span><b>' + esc(m.l) + '</b>' + (m.ru ? '<br><span class="muted small">' + esc(m.ru) + '</span>' : '') + '</span></li>'; }).join('') + '</ul></div></section>' : '');
  }

  function tabs(course, tp, cur) {
    var ts = [['words', 'Сөздер · ' + tp.words.length], ['grammar', T('Грамматика') + ' · ' + tp.grammar.length], ['texts', 'Мәтіндер · ' + tp.texts.length], ['test', T('Тест')]];
    return '<nav class="ctabs">' + ts.map(function (t) { return '<a class="' + (t[0] === cur ? 'on' : '') + '" href="#/course/' + course.level + '/' + tp.id + '/' + t[0] + '">' + t[1] + '</a>'; }).join('') + '</nav>';
  }
  function viewTopic(course, tp, tab) {
    var r = topicProgress(course.level, tp);
    var head = U.topbar([{ label: T('Хаб'), href: '#/' }, { label: course.title, href: '#/course/' + course.level }, { label: tp.kk }], '<span class="badge level">' + course.level + '</span><span class="badge ' + (r.done ? 'ok' : 'muted') + '">' + (r.done ? T('пройдена') : r.pct + ' %') + '</span>') +
      '<div class="kicker">' + T('Тема') + ' ' + tp.order + ' · ' + esc(tp.ru) + '</div><h1>' + esc(tp.kk) + '</h1>' +
      (tp.lessons.length ? '<p class="lede">' + tp.lessons.map(function (l) { return '<b>' + l.section + '.' + l.lesson + ' ' + esc(l.title) + '</b>' + (l.phrases.length ? ' — «' + esc(l.phrases[0]) + '»' : '') + (l.grammar.length ? ' <span class="muted">(' + esc(l.grammar.join('; ')) + ')</span>' : ''); }).join('<br>') + '</p>' : '') +
      tabs(course, tp, tab);
    var body = ({ words: viewWords, grammar: viewGrammar, texts: viewTexts, test: viewTest })[tab](course, tp);
    return head + body;
  }

  /* --- слова: карточки + квиз --- */
  function viewWords(course, tp) {
    var p = cp(course.level, tp.id), run = KZ.run();
    if (run.mode === 'quiz') return viewQuiz(course, tp, run);
    var filter = run.filter || 'all';
    var list = tp.words.filter(function (w) { return filter === 'all' || (filter === 'new' ? p.words[w.l] !== 1 : p.words[w.l] === 1); });
    var known = tp.words.filter(function (w) { return p.words[w.l] === 1; }).length;
    if (!tp.words.length) return '<div class="block"><p class="muted">' + T('Слов по этой теме в базе пока нет (словарь учебника для этого раздела ещё не извлечён).') + '</p></div>';
    var cards = list.map(function (w, i) {
      var open = run.open === w.l;
      return '<div class="wcard' + (open ? ' open' : '') + (p.words[w.l] === 1 ? ' known' : '') + '" tabindex="0" role="button" data-act="c-flip" data-w="' + esc(w.l) + '">' +
        '<div class="wf"><span class="lemma">' + esc(w.l) + '</span><span class="badge muted">' + esc(w.p) + '</span></div>' +
        (open ? '<div class="wb"><div class="tr">' + esc(w.ru) + (w.en ? ' <span class="muted">· ' + esc(w.en) + '</span>' : '') + '</div>' + (w.d ? '<div class="small muted">' + esc(w.d) + '</div>' : '') + (w.ex ? '<div class="ex">' + esc(w.ex) + '</div>' : '') +
          '<div class="row mt"><button class="btn small" data-act="c-know" data-w="' + esc(w.l) + '">' + T('Знаю') + '</button><button class="btn ghost small" data-act="c-learn" data-w="' + esc(w.l) + '">' + T('Ещё учу') + '</button><button class="btn ghost small" data-act="c-say" data-w="' + esc(w.l) + '">▶</button></div></div>' : '') + '</div>';
    }).join('');
    return '<div class="block"><div class="row spread"><div class="row"><span class="badge ok">' + T('выучено') + ' ' + known + ' / ' + tp.words.length + '</span>' +
      ['all', 'new', 'known'].map(function (f) { return '<button class="cb' + (filter === f ? ' on' : '') + '" data-act="c-filter" data-f="' + f + '">' + ({ all: T('все'), new: T('учу'), known: T('знаю') })[f] + '</button>'; }).join('') + '</div>' +
      (tp.words.length >= 4 ? '<button class="btn" data-act="c-quiz">' + T('Проверить себя · 10 слов') + '</button>' : '') + '</div>' +
      '<p class="small muted mt">' + T('Нажмите на слово, чтобы открыть перевод, толкование и пример. Кнопка ▶ озвучивает слово, если в браузере есть казахский голос.') + (p.quizBest != null ? ' ' + T('Лучший результат квиза:') + ' ' + Math.round(p.quizBest * 100) + ' %.' : '') + '</p>' +
      '<div class="wgrid">' + (cards || '<p class="muted">' + T('В этом фильтре слов нет.') + '</p>') + '</div></div>';
  }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function makeVocabQuiz(tp, p, n) {
    var pool = tp.words.filter(function (w) { return w.ru; });
    var unknown = pool.filter(function (w) { return p.words[w.l] !== 1; });
    var pick = shuffle(unknown.length >= n ? unknown : pool).slice(0, n);
    return pick.map(function (w, i) {
      var dir = i % 2 === 0 ? 'kk-ru' : 'ru-kk';
      var same = pool.filter(function (x) { return x.l !== w.l && x.p === w.p; });
      var ds = shuffle(same.length >= 3 ? same : pool.filter(function (x) { return x.l !== w.l; })).slice(0, 3);
      var opts = shuffle([w].concat(ds));
      return { id: 'v' + i, stem: dir === 'kk-ru' ? '«' + w.l + '» сөзінің аудармасын таңдаңыз.' : '«' + w.ru + '» сөзінің қазақша баламасын таңдаңыз.',
        options: opts.map(function (o) { return dir === 'kk-ru' ? o.ru : o.l; }), answer: opts.indexOf(w), explain: w.l + ' — ' + w.ru + (w.ex ? ' · ' + w.ex : ''), w: w.l };
    });
  }
  function viewQuiz(course, tp, run) {
    var qs = run.quiz;
    var locked = run.phase === 'review';
    var body = '<div class="block"><span class="setlabel">' + T('Квиз') + ' · ' + qs.length + ' ' + T('слов') + '</span>' + U.renderQuestions({ questions: qs }, run.answers, locked);
    if (!locked) body += '<div class="actions"><button class="btn" data-act="c-quiz-submit">' + T('Зафиксировать ответы') + '</button><button class="btn ghost" data-act="c-quiz-exit">' + T('Отмена') + '</button></div>';
    else { var sc = run.score; body += '<div class="score-card mt"><div class="score-big">' + sc + '<small>/' + qs.length + '</small></div><div><b>' + (sc / qs.length >= 0.8 ? T('Отлично.') : sc / qs.length >= 0.5 ? T('Половина есть, повторите слова из фильтра «учу».') : T('Вернитесь к карточкам.')) + '</b><div class="m">' + T('Верные ответы отмечены как «знаю», неверные — как «учу».') + '</div></div></div><div class="actions"><button class="btn" data-act="c-quiz">' + T('Ещё 10 слов') + '</button><button class="btn ghost" data-act="c-quiz-exit">' + T('К карточкам') + '</button></div>'; }
    return body + '</div>';
  }

  /* --- грамматика: правила + задания --- */
  function viewGrammar(course, tp) {
    var p = cp(course.level, tp.id), run = KZ.run();
    if (!tp.grammar.length) return '<div class="block"><p class="muted">' + T('В этой теме учебник не вводит новой грамматики.') + '</p></div>';
    var cards = tp.grammar.map(function (g, gi) {
      var open = run.openG == null ? gi === 0 : run.openG === gi;
      return '<div class="block"><div class="row spread" tabindex="0" role="button" data-act="c-gopen" data-g="' + gi + '" style="cursor:pointer"><h3 style="margin:0">' + esc(g.name) + '</h3><span class="badge muted">' + T('урок') + ' ' + esc(g.lesson) + ' · ' + esc(g.lesson_title || '') + '</span></div>' +
        (open ? '<div class="rule mt">' + md(g.rule) + '</div>' + (g.tasks.length ? '<p class="small muted mt">' + g.tasks.length + ' ' + T('заданий к этому правилу — в блоке ниже.') + '</p>' : '') : '') + '</div>';
    }).join('');
    var all = []; tp.grammar.forEach(function (g) { g.tasks.forEach(function (t, i) { all.push(Object.assign({ id: 'g' + all.length, text: t.stem, gname: g.name }, t)); }); });
    var quiz = '';
    if (all.length) {
      var locked = run.gphase === 'review';
      quiz = '<div class="block"><span class="setlabel">' + T('Задания') + ' · ' + all.length + '</span><p class="small muted">' + T('Сгенерированы по таблицам окончаний учебника и ещё не вычитаны носителем: если ответ кажется спорным, отметьте его себе для проверки.') + (p.gramBest != null ? ' ' + T('Лучший результат:') + ' ' + Math.round(p.gramBest * 100) + ' %.' : '') + '</p>' +
        U.renderQuestions({ questions: all }, run.ganswers || {}, locked) +
        (locked ? '<div class="score-card mt"><div class="score-big">' + run.gscore + '<small>/' + all.length + '</small></div><div><b>' + T('Результат сохранён.') + '</b></div></div><div class="actions"><button class="btn ghost" data-act="c-gram-retry">' + T('Пройти заново') + '</button></div>' :
          '<div class="actions"><button class="btn" data-act="c-gram-submit">' + T('Зафиксировать ответы') + '</button><span class="hint" id="submit-msg"></span></div>') + '</div>';
    }
    return cards + quiz;
  }

  /* --- тексты --- */
  function viewTexts(course, tp) {
    var p = cp(course.level, tp.id), run = KZ.run();
    if (!tp.texts.length) return '<div class="block"><p class="muted">' + T('Текстов по этой теме в базе пока нет.') + '</p></div>';
    return tp.texts.map(function (t, ti) {
      var open = run.openT == null ? ti === 0 : run.openT === ti;
      var done = p.textsDone[t.id];
      var qs = t.questions.map(function (q, qi) { return Object.assign({ id: t.id + '-q' + qi, text: q.stem }, q); });
      var locked = run.tphase && run.tphase[t.id] === 'review';
      return '<div class="block"><div class="row spread" tabindex="0" role="button" data-act="c-topen" data-t="' + ti + '" style="cursor:pointer"><h3 style="margin:0">' + esc(t.title) + ' <span class="muted small">· ' + esc(t.genre) + ' · ' + t.words + ' ' + T('слов') + '</span></h3>' + (done ? '<span class="badge ok">' + T('прочитан') + '</span>' : '<span class="badge muted">' + (t.use.indexOf('listening') >= 0 ? T('аудио-скрипт') : T('чтение')) + '</span>') + '</div>' +
        (open ? '<div class="script mt">' + esc(t.text) + '</div><div class="row mt"><button class="btn ghost small" data-act="c-say-text" data-t="' + ti + '">▶ ' + T('Озвучить') + '</button><span class="hint" id="tts-msg"></span><span class="small muted">' + T('источник:') + ' ' + esc(t.src) + '</span></div>' +
          (qs.length ? '<div class="mt"><span class="setlabel">' + T('Вопросы') + ' · ' + qs.length + '</span><p class="small muted">' + T('Вопросы сгенерированы по тексту и не вычитаны носителем.') + '</p>' + U.renderQuestions({ questions: qs }, (run.tanswers || {})[t.id] || {}, locked) +
            (locked ? '<div class="actions"><span class="badge ok">' + T('верно') + ' ' + run.tscore[t.id] + ' / ' + qs.length + '</span></div>' : '<div class="actions"><button class="btn" data-act="c-text-submit" data-tid="' + esc(t.id) + '">' + T('Зафиксировать ответы') + '</button></div>') + '</div>' :
            (!done ? '<div class="actions"><button class="btn secondary small" data-act="c-text-done" data-tid="' + esc(t.id) + '">' + T('Прочитал(а)') + '</button></div>' : '')) : '') + '</div>';
    }).join('');
  }

  /* --- итоговый тест темы --- */
  function makeTopicTest(tp, p) {
    var qs = tp.words.length >= 4 ? makeVocabQuiz(tp, p, 7) : [];
    var g = []; tp.grammar.forEach(function (x) { x.tasks.forEach(function (t) { g.push(t); }); });
    shuffle(g).slice(0, 5).forEach(function (t, i) { qs.push(Object.assign({ id: 'tg' + i, text: t.stem }, t)); });
    var r = []; tp.texts.forEach(function (t) { t.questions.forEach(function (q) { r.push(Object.assign({}, q, { textId: t.id })); }); });
    shuffle(r).slice(0, 3).forEach(function (q, i) { var tx = tp.texts.filter(function (t) { return t.id === q.textId; })[0]; qs.push(Object.assign({ id: 'tr' + i, text: q.stem, ctx: tx ? tx.text : null }, q)); });
    return qs.map(function (q) { if (!q.text) q.text = q.stem; return q; });
  }
  function viewTest(course, tp) {
    var p = cp(course.level, tp.id), run = KZ.run();
    var avail = (tp.words.length >= 4 ? 1 : 0) + (tp.grammar.some(function (g) { return g.tasks.length; }) ? 1 : 0) + (tp.texts.some(function (t) { return t.questions.length; }) ? 1 : 0);
    if (!avail) return '<div class="block"><h3>' + T('Итоговый тест темы') + '</h3><p class="muted">' + T('Для этой темы пока нет ни слов, ни заданий — тест собрать не из чего.') + '</p></div>';
    if (!run.test) {
      return '<div class="block"><h3>' + T('Итоговый тест темы') + '</h3><p>' + T('До 15 вопросов: слова темы, окончания из грамматики урока и вопросы к текстам. Порог «тема пройдена» — 70 %.') + (p.testBest != null ? ' ' + T('Лучший результат:') + ' <b>' + Math.round(p.testBest * 100) + ' %</b>.' : '') + '</p><div class="actions"><button class="btn" data-act="c-test-start">' + T('Начать тест') + '</button></div></div>';
    }
    var locked = run.testPhase === 'review';
    var html = '';
    run.test.forEach(function (q, i) {
      if (q.ctx && (i === 0 || run.test[i - 1].ctx !== q.ctx)) html += '<div class="script small">' + esc(q.ctx) + '</div>';
      html += U.renderQuestions({ questions: [q] }, run.testAnswers || {}, locked, i + 1);
    });
    return '<div class="block"><span class="setlabel">' + T('Тест') + ' · ' + run.test.length + ' ' + T('вопросов') + '</span>' + html +
      (locked ? '<div class="score-card mt"><div class="score-big">' + run.testScore + '<small>/' + run.test.length + '</small></div><div><b>' + (run.testScore / run.test.length >= 0.7 ? T('Тема пройдена.') : T('Ниже 70 % — повторите слова и правило, затем ещё раз.')) + '</b></div></div><div class="actions"><button class="btn" data-act="c-test-start">' + T('Ещё раз') + '</button><a class="btn ghost" href="#/course/' + course.level + '">' + T('К списку тем') + '</a></div>' :
        '<div class="actions"><button class="btn" data-act="c-test-submit">' + T('Зафиксировать ответы') + '</button></div>') + '</div>';
  }

  /* ---------- маршрут и события ---------- */
  KZ.registerRoute(function (p) {
    if (p[0] !== 'course' || !KZ.courses || !KZ.courses[p[1]]) return null;
    var course = KZ.courses[p[1]];
    if (!p[2]) return viewCourse(course);
    var tp = course.topics.filter(function (t) { return t.id === p[2]; })[0];
    if (!tp) return viewCourse(course);
    var tab = ['words', 'grammar', 'texts', 'test'].indexOf(p[3]) >= 0 ? p[3] : 'words';
    var run = KZ.run(); if (run.key !== p[1] + '/' + p[2]) { KZ.resetRun({ key: p[1] + '/' + p[2] }); }
    return viewTopic(course, tp, tab);
  });

  function score(qs, answers) { var s = 0; qs.forEach(function (q) { if (answers[q.id] === q.answer) s++; }); return s; }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act^="c-"]'); if (!b) return;
    var act = b.getAttribute('data-act'), run = KZ.run();
    var parts = location.hash.replace(/^#\/?/, '').split('/'); var course = KZ.courses && KZ.courses[parts[1]]; if (!course) return;
    var tp = course.topics.filter(function (t) { return t.id === parts[2]; })[0]; if (!tp) return;
    var p = cp(course.level, tp.id);
    var stop = true;
    if (act === 'c-flip') { if (e.target.closest('button')) return; run.open = run.open === b.getAttribute('data-w') ? null : b.getAttribute('data-w'); }
    else if (act === 'c-know') { p.words[b.getAttribute('data-w')] = 1; U.save(); }
    else if (act === 'c-learn') { p.words[b.getAttribute('data-w')] = 0; U.save(); }
    else if (act === 'c-say') { KZ.speak(b.getAttribute('data-w')); stop = false; }
    else if (act === 'c-say-text') { var t = tp.texts[+b.getAttribute('data-t')]; if (!KZ.speak(t.text)) { var m = document.getElementById('tts-msg'); if (m) m.textContent = T('Казахский голос не найден (есть в Microsoft Edge).'); } stop = false; }
    else if (act === 'c-filter') { run.filter = b.getAttribute('data-f'); }
    else if (act === 'c-quiz') { run.mode = 'quiz'; run.quiz = makeVocabQuiz(tp, p, 10); run.answers = {}; run.phase = 'run'; }
    else if (act === 'c-quiz-exit') { run.mode = null; }
    else if (act === 'c-quiz-submit') { run.score = score(run.quiz, run.answers); run.quiz.forEach(function (q) { p.words[q.w] = run.answers[q.id] === q.answer ? 1 : 0; }); p.quizBest = Math.max(p.quizBest || 0, run.score / run.quiz.length); U.save(); run.phase = 'review'; }
    else if (act === 'c-gopen') { run.openG = +b.getAttribute('data-g'); }
    else if (act === 'c-gram-submit') { var all = []; tp.grammar.forEach(function (g) { g.tasks.forEach(function (t) { all.push(Object.assign({ id: 'g' + all.length }, t)); }); }); run.gscore = score(all, run.ganswers || {}); p.gramBest = Math.max(p.gramBest || 0, run.gscore / all.length); U.save(); run.gphase = 'review'; }
    else if (act === 'c-gram-retry') { run.ganswers = {}; run.gphase = null; }
    else if (act === 'c-topen') { run.openT = +b.getAttribute('data-t'); }
    else if (act === 'c-text-done') { p.textsDone[b.getAttribute('data-tid')] = 1; U.save(); }
    else if (act === 'c-text-submit') { var tid = b.getAttribute('data-tid'), tx = tp.texts.filter(function (x) { return x.id === tid; })[0]; var qs = tx.questions.map(function (q, qi) { return Object.assign({ id: tid + '-q' + qi }, q); }); run.tphase = run.tphase || {}; run.tscore = run.tscore || {}; run.tscore[tid] = score(qs, (run.tanswers || {})[tid] || {}); run.tphase[tid] = 'review'; p.textsDone[tid] = 1; U.save(); }
    else if (act === 'c-test-start') { run.test = makeTopicTest(tp, p); run.testAnswers = {}; run.testPhase = 'run'; }
    else if (act === 'c-test-submit') { run.testScore = score(run.test, run.testAnswers); p.testBest = Math.max(p.testBest || 0, run.testScore / run.test.length); U.save(); run.testPhase = 'review'; }
    else stop = false;
    if (stop) { e.stopPropagation(); KZ.route(); }
  }, true);

  document.addEventListener('change', function (e) {
    var el = e.target; if (el.type !== 'radio' || !el.closest('.opts')) return;
    var parts = location.hash.replace(/^#\/?/, '').split('/'); if (parts[0] !== 'course') return;
    var run = KZ.run(), tab = parts[3] || 'words';
    if (run.mode === 'quiz') { run.answers = run.answers || {}; run.answers[el.name] = +el.value; }
    else if (tab === 'grammar') { run.ganswers = run.ganswers || {}; run.ganswers[el.name] = +el.value; }
    else if (tab === 'texts') { var tid = el.name.replace(/-q\d+$/, ''); run.tanswers = run.tanswers || {}; run.tanswers[tid] = run.tanswers[tid] || {}; run.tanswers[tid][el.name] = +el.value; }
    else if (tab === 'test') { run.testAnswers = run.testAnswers || {}; run.testAnswers[el.name] = +el.value; }
    var ul = el.closest('.opts'); Array.prototype.forEach.call(ul.querySelectorAll('.opt'), function (o) { o.classList.remove('selected'); }); el.closest('.opt').classList.add('selected');
    e.stopPropagation();
  }, true);
})();

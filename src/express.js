/* ============================================================
   Экспресс-тест «Узнать уровень за 10 минут» (29.10.2026): #/express/<exam>, отдельно для ҚАЗТЕСТ и QazResmiTest.
   Зачем: полные тесты длинные, письмо и говорение бросают в 28–34 % случаев; короткий тест даёт ориентир и ведёт
   в полный тест найденного уровня.
   Лесенка: старт с A2, по 4 вопроса на ступень. 3–4 верных — ступень выше, 2 — уровень этой ступени, 0–1 — стоп
   (уровень — прошлая ступень; если провалена первая же A2, проверяем A1). Ступени — examLevels экзамена.
   Вопросы — только из вариантов 04–05 того же экзамена и уровня (их почти не проходят), новых казахских текстов нет:
   лексико-грамматические задания и лексика понятны без текста, к вопросу на понимание показывается один абзац —
   тот, который цитирует пояснение (как в «задании дня» в Telegram, tools/dump_meta.js). В конце — одна запись
   аудирования найденного уровня, если вопросов было не больше 17 (всего не больше 20). На уровень она не влияет.
   Результат — в обычном прогрессе: state.express[exam] = {level, at, ok, n, seconds, steps, listen}. Пороги KZ.strict
   здесь не используются и не показываются. Подключается после app.js через KZ.registerRoute / KZ.util.
   ============================================================ */
(function () {
  'use strict';
  var T = KZ.T, LK = KZ.LK, U = KZ.util, esc = U.esc;
  var STEP = 4, MAX_Q = 20, LISTEN_MIN = 3;
  var X = null;   // текущее прохождение: {exam, phase: intro|step|listen|result, lv, items, answers, steps, listen, t0, ...}
  var clockIv = null;

  function ladder(exam) { return KZ.exams[exam].examLevels || KZ.levelOrder; }
  function variants(exam, lv) { return KZ.tests.filter(function (t) { return t.exam === exam && t.level === lv && !t.block && t.status !== 'draft' && /-0[45]$/.test(t.id); }); }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  /* абзац, где лежит ответ: пояснение цитирует его в «ёлочках»; короткий текст (до 800 знаков) можно показать целиком */
  function excerpt(s, q) {
    var paras = s.passage.paragraphs || [], quotes = String(q.explain_kk || q.explain || '').match(/«[^»]{15,}»/g) || [];
    for (var i = 0; i < quotes.length; i++) {
      var core = quotes[i].replace(/[«»]/g, '').split('...')[0].split('…')[0].trim().slice(0, 40);
      if (core.length < 15) continue;
      for (var j = 0; j < paras.length; j++) if (paras[j].indexOf(core) >= 0 && paras[j].length <= 700) return { paras: [paras[j]], part: true };
    }
    var whole = paras.join('\n\n');
    return whole.length <= 800 ? { paras: paras, part: false } : null;
  }
  /* задания уровня: gram — понятны сами по себе, read — вопрос к абзацу, au — записи аудирования */
  function pools(exam, lv) {
    var gram = [], read = [], au = [];
    variants(exam, lv).forEach(function (t) {
      t.sections.forEach(function (s) {
        (s.questions || []).forEach(function (q) {
          if (q.kind === 'tf' || /мәтін/i.test(q.text || '') && !(s.passage && excerpt(s, q) && !excerpt(s, q).part)) return;   // «по тексту» — только если текст виден целиком
          if (s.type === 'lexis' || (s.type === 'reading' && q.tag)) gram.push({ t: t, s: s, q: q });
          else if (s.type === 'reading' && s.passage) { var ex = excerpt(s, q); if (ex) read.push({ t: t, s: s, q: q, paras: ex.paras }); }
        });
        if (s.type === 'listening' && s.script && s.questions && KZ.audio && KZ.audio[t.id]) au.push({ t: t, s: s });
      });
    });
    return { gram: gram, read: read, au: au };
  }
  /* ступень: два вопроса к абзацам (из разных абзацев) и два лексико-грамматических; чего не хватает — добираем другим */
  function stepItems(exam, lv) {
    var p = pools(exam, lv), read = [], seen = {};
    shuffle(p.read).forEach(function (x) { var k = x.paras.join('').slice(0, 60); if (read.length < 2 && !seen[k]) { seen[k] = 1; read.push(x); } });
    var gram = shuffle(p.gram).slice(0, STEP - read.length);
    if (gram.length + read.length < STEP) read = read.concat(shuffle(p.read).filter(function (x) { return read.indexOf(x) < 0; }).slice(0, STEP - gram.length - read.length));
    return gram.concat(read);
  }
  function asked() { return X.steps.reduce(function (a, s) { return a + s.tot; }, 0); }
  function elapsedS() { return Math.round((Date.now() - X.t0) / 1000); }
  function prevLevel(lv) { var L = ladder(X.exam), i = L.indexOf(lv); return i > 0 ? L[i - 1] : null; }
  function nextLevel(lv) { var L = ladder(X.exam), i = L.indexOf(lv); return i >= 0 && i < L.length - 1 ? L[i + 1] : null; }

  function begin(exam) {
    var L = ladder(exam);
    X = { exam: exam, phase: 'step', lv: L.indexOf('A2') >= 0 ? 'A2' : L[0], steps: [], answers: {}, t0: Date.now(), n: 0 };
    X.items = stepItems(exam, X.lv);
    KZ.track('express-start', { exam: exam });
  }
  /* ответы ступени → следующая ступень, аудирование или итог */
  function finishStep() {
    var ok = X.items.filter(function (it) { return X.answers[it.key] === it.q.answer; }).length;
    X.steps.push({ lv: X.lv, ok: ok, tot: X.items.length, items: X.items, answers: X.answers });
    var passed = X.steps.filter(function (s) { return s.ok >= 3; }).map(function (s) { return s.lv; });
    var top = passed.length ? passed[passed.length - 1] : null, next = null;
    if (ok >= 3) { next = X.steps.some(function (s) { return s.lv === nextLevel(X.lv); }) ? null : nextLevel(X.lv); if (!next) X.level = X.lv; }
    else if (ok === 2) X.level = X.lv;
    else if (top) X.level = top;
    else if (prevLevel(X.lv) && X.steps.length === 1) next = prevLevel(X.lv);   // первая же ступень не далась — проверяем уровень ниже
    else X.level = '';   // ниже A1
    if (next && asked() + STEP <= MAX_Q) { X.lv = next; X.items = stepItems(X.exam, next); X.answers = {}; return; }
    if (next) X.level = X.lv;
    var room = Math.min(5, MAX_Q - asked()), au = shuffle(pools(X.exam, X.level || ladder(X.exam)[0]).au)[0];
    if (au && room >= LISTEN_MIN) { X.phase = 'listen'; X.au = au; X.auQs = au.s.questions.slice(0, room); X.answers = {}; return; }
    done();
  }
  function done() {
    if (X.phase === 'listen') X.listen = { lv: X.au.t.level, ok: X.auQs.filter(function (q) { return X.answers['l' + q.id] === q.answer; }).length, tot: X.auQs.length, test: X.au.t.id, answers: X.answers };
    X.phase = 'result'; X.seconds = elapsedS();
    var ok = X.steps.reduce(function (a, s) { return a + s.ok; }, 0) + (X.listen ? X.listen.ok : 0), n = asked() + (X.listen ? X.listen.tot : 0);
    var st = U.state(); st.express = st.express && typeof st.express === 'object' ? st.express : {};
    st.express[X.exam] = { level: X.level, at: Date.now(), ok: ok, n: n, seconds: X.seconds,
      steps: X.steps.map(function (s) { return [s.lv, s.ok, s.tot]; }), listen: X.listen ? [X.listen.lv, X.listen.ok, X.listen.tot] : null };
    U.save();
    KZ.track('express-done', { exam: X.exam, level: X.level || '<A1', pct: n ? Math.round(100 * ok / n) : null, seconds: X.seconds,
      why: X.steps.map(function (s) { return s.lv + ' ' + s.ok + '/' + s.tot; }).join(' · ') + (X.listen ? ' · L ' + X.listen.ok + '/' + X.listen.tot : '') });
  }

  /* ---------- вид ---------- */
  function examName(exam) { return KZ.exams[exam].name; }
  function fullTest(exam, lv) { var ts = U.testsFor(exam, lv); return U.firstOpen(U.readyOnly(ts)) || ts[0] || null; }
  function clock() { return '<span id="x-clock" class="clock">' + U.mmss(elapsedS()) + '</span>'; }
  function startClock() {
    if (clockIv) clearInterval(clockIv);
    clockIv = setInterval(function () { var el = document.getElementById('x-clock'); if (!el || !X || X.phase === 'result') { clearInterval(clockIv); clockIv = null; return; } el.textContent = U.mmss(elapsedS()); }, 1000);
  }
  function head(exam, extra) {
    return U.topbar([{ label: T('Хаб'), href: '#/' }, { label: KZ.exams[exam].short, href: '#/exam/' + exam }, { label: T('Экспресс-тест') }], extra || '');
  }
  function lastResult(exam) {
    var r = (U.state().express || {})[exam]; if (!r || r.level == null) return '';
    return '<p class="small muted">' + T('Прошлый результат:') + ' <b>' + esc(r.level || T('ниже A1')) + '</b> · ' + new Date(r.at).toLocaleDateString('ru-RU') + '</p>';
  }
  function viewIntro(exam) {
    var other = KZ.examOrder.filter(function (e) { return e !== exam; })[0], L = ladder(exam);
    return head(exam) + '<div class="kicker">' + esc(KZ.exams[exam].kicker) + ' · ' + T('Экспресс-тест') + '</div>' +
      '<h1>' + T('Узнать уровень за 10 минут') + ' · ' + esc(examName(exam)) + '</h1>' +
      '<p class="lede">' + T('Около 10 минут и 16–20 вопросов: лексика, грамматика, короткие тексты и в конце одна запись аудирования. Начинаем с A2: справились — вопросы становятся сложнее, нет — тест заканчивается раньше. Письма и говорения нет.') + '</p>' +
      '<div class="block"><div class="row"><span class="badge level">' + L[0] + '–' + L[L.length - 1] + '</span> <span class="badge muted">' + T('16–20 вопросов · ~10 минут') + '</span></div>' +
      '<p class="small muted mt">' + T('Это быстрая оценка, а не экзамен: точнее уровень покажет полный тест.') + '</p>' + lastResult(exam) +
      '<div class="actions"><button class="btn" data-act="x-start" data-exam="' + exam + '">' + T('Начать') + '</button>' +
      (other ? '<a class="btn ghost" href="#/express/' + other + '">' + T('Экспресс-тест') + ' ' + esc(examName(other)) + '</a>' : '') + '</div></div>';
  }
  function itemHtml(it, num, locked, answers) {
    var q = locked ? it.q : Object.assign({}, it.q, { id: it.key });
    var a = {}; a[q.id] = answers[it.key];
    return '<div class="block">' + (it.paras ? '<div class="passage-title">Мәтін · ' + esc(it.s.passage.title) + '</div><div class="passage" lang="kk">' + it.paras.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>' : '') +
      U.renderQuestions({ questions: [q] }, a, locked, num, locked ? { test: it.t.id, section: it.s.type } : null) + '</div>';
  }
  function viewStep() {
    var from = asked() + 1;
    X.items.forEach(function (it, i) { it.key = 'x' + X.steps.length + '-' + i; });
    return head(X.exam, '<span class="badge level">' + X.lv + '</span>' + clock()) +
      '<div class="kicker">' + T('Экспресс-тест') + ' · ' + esc(examName(X.exam)) + '</div>' +
      '<h1>' + T('Ступень') + ' ' + (X.steps.length + 1) + ' · ' + X.lv + '</h1>' +
      '<p class="lede">' + T('Вопросы') + ' ' + from + '–' + (from + X.items.length - 1) + '. ' + T('Это быстрая оценка, а не экзамен: точнее уровень покажет полный тест.') + '</p>' +
      X.items.map(function (it, i) { return itemHtml(it, from + i, false, X.answers); }).join('') +
      '<div class="actions"><button class="btn" data-act="x-next">' + T('Дальше') + '</button><span class="hint" id="x-msg" role="status" aria-live="polite"></span></div>';
  }
  function viewListen() {
    var au = KZ.audio[X.au.t.id], from = asked() + 1, kk = KZ.lang === 'kk';
    var qs = X.auQs.map(function (q) { return Object.assign({}, q, { id: 'l' + q.id }); });
    return head(X.exam, '<span class="badge level">' + X.au.t.level + '</span>' + clock()) +
      '<div class="kicker">' + T('Экспресс-тест') + ' · ' + esc(examName(X.exam)) + '</div>' +
      '<h1>' + LK(KZ.sectionTypes.listening, 'label') + ' · ' + X.au.t.level + '</h1>' +
      '<p class="lede">' + (kk ? 'Соңғы қадам: ' + X.au.t.level + ' деңгейіндегі бір тыңдалым жазбасы, ' + qs.length + ' сұрақ. Жазбаны бірнеше рет тыңдауға болады.'
                              : 'Последний шаг: одна запись аудирования уровня ' + X.au.t.level + ', ' + qs.length + ' ' + KZ.plural(qs.length, 'вопрос', 'вопроса', 'вопросов') + '. Запись можно слушать несколько раз.') + '</p>' +
      '<div class="block player"><span class="setlabel">' + T('Аудио') + ' · ' + esc(X.au.s.script.title) + '</span><audio controls preload="none" src="' + esc(au.src) + '" style="width:100%"></audio></div>' +
      '<div class="block">' + U.renderQuestions({ questions: qs }, X.answers, false, null, { offset: from - 1 }) + '</div>' +
      '<div class="actions"><button class="btn" data-act="x-next">' + T('Дальше') + '</button><button class="btn ghost" data-act="x-skip">' + T('Пропустить') + '</button><span class="hint" id="x-msg" role="status" aria-live="polite"></span></div>';
  }
  function viewResult() {
    var kk = KZ.lang === 'kk', lv = X.level, start = lv || ladder(X.exam)[0], full = fullTest(X.exam, start);
    var n = asked() + (X.listen ? X.listen.tot : 0);
    var big = lv ? '<div class="score-big">' + lv + '</div>' : '<div class="score-big">&lt;A1</div>';
    var msg = lv ? T('Ваш примерный уровень:') + ' ' + lv : T('Похоже, пока ниже A1. Начните с уровня A1.');
    var rows = X.steps.map(function (s) { return '<li>' + T('Ступень') + ' ' + s.lv + ': ' + s.ok + '/' + s.tot + ' ' + (s.ok >= 3 ? '✓' : s.ok <= 1 ? '✗' : '·') + '</li>'; }).join('') +
      (X.listen ? '<li>' + LK(KZ.sectionTypes.listening, 'label') + ' ' + X.listen.lv + ': ' + X.listen.ok + '/' + X.listen.tot + '</li>' : '');
    var auNote = X.listen && X.listen.ok * 2 < X.listen.tot ? '<p class="small">' + T('Аудирование далось труднее остального — в полном тесте обратите на него внимание.') + '</p>' : '';
    var exN = examName(X.exam);
    var share = lv && KZ.site && KZ.site.siteUrl && KZ.site.build !== 'inline'
      ? '<button class="btn ghost" data-share="image" data-exam="' + esc(exN) + '" data-level="' + lv + '" data-head="' + esc(exN) + '" data-big="' + lv + '" data-label="' + esc(T('Примерный уровень')) + '" data-foot="' + esc(T('Экспресс-тест')) + '"' +
        ' data-share-text="' + esc(kk ? exN + ' экспресс-тесті, Qazaq Trainer: болжамды деңгей ' + lv + '. Тегін, тіркеусіз:' : 'Экспресс-тест ' + exN + ' на Qazaq Trainer: примерный уровень ' + lv + '. Бесплатно и без регистрации:') + '"' +
        ' data-share-url="' + esc(KZ.site.siteUrl + '?utm_source=share&utm_medium=image#/express/' + X.exam) + '">' + T('Картинка для сторис') + '</button>' : '';
    var review = X.steps.map(function (s) {
      var from = 0; X.steps.slice(0, X.steps.indexOf(s)).forEach(function (p) { from += p.tot; });
      return s.items.map(function (it, i) { return itemHtml(it, from + i + 1, true, s.answers); }).join('');
    }).join('') + (X.listen ? '<div class="block"><span class="setlabel">' + LK(KZ.sectionTypes.listening, 'label') + ' · ' + esc(X.au.s.script.title) + '</span><div class="script" lang="kk">' + esc(X.au.s.script.text) + '</div></div>' +
      '<div class="block">' + U.renderQuestions({ questions: X.auQs }, Object.keys(X.listen.answers).reduce(function (a, k) { a[k.slice(1)] = X.listen.answers[k]; return a; }, {}), true, null, { test: X.au.t.id, section: 'listening', offset: asked() }) + '</div>' : '');
    return head(X.exam, lv ? '<span class="badge level">' + lv + '</span>' : '') +
      '<div class="kicker">' + T('Экспресс-тест') + ' · ' + esc(exN) + '</div><h1>' + msg + '</h1>' +
      '<div class="score-card">' + big + '<div><b>' + T('Это быстрая оценка, а не экзамен: точнее уровень покажет полный тест.') + '</b><div class="m">' + n + ' ' + KZ.plural(n, T('вопрос'), T('вопроса'), T('вопросов')) + ' · ' + U.mmss(X.seconds) + '</div></div></div>' +
      '<div class="notice info"><ul>' + rows + '</ul>' + auNote + '</div>' +
      '<div class="actions">' + (full ? '<a class="btn" href="#/test/' + full.id + '">' + (kk ? start + ' деңгейіндегі толық тестті тапсыру' : 'Пройти полный тест ' + start) + '</a>' : '') + share +
      '<button class="btn ghost" data-act="x-again">' + T('Пройти заново') + '</button></div>' +
      '<details class="mt"><summary>' + T('Разбор ответов') + '</summary>' + review + '</details>';
  }

  /* карточка на хабе и подсказка на странице экзамена (вызываются из app.js) */
  KZ.expressCard = function (where, exam) {
    if (where === 'exam') {
      var r = (U.state().express || {})[exam];
      return '<div class="notice info"><b class="t">' + T('Экспресс-тест') + '</b><p>' + T('Не знаете, с какого уровня начать? Короткий тест подскажет: 16–20 вопросов, около 10 минут.') + '</p>' +
        (r && r.level != null ? '<p class="small">' + T('Прошлый результат:') + ' <b>' + esc(r.level || T('ниже A1')) + '</b></p>' : '') +
        '<p class="row"><a class="btn small" href="#/express/' + exam + '">' + T('Узнать уровень за 10 минут') + '</a></p></div>';
    }
    return '<section><div class="kicker" style="margin-bottom:8px">' + T('Экспресс-тест') + '</div><h2>' + T('Узнать уровень за 10 минут') + '</h2>' +
      '<p class="sub">' + T('Короткий тест подскажет, с какого уровня начинать полный: лексика, грамматика, короткие тексты и одна запись аудирования, без письма и говорения.') + '</p><div class="grid2">' +
      KZ.examOrder.map(function (e) {
        var ex = KZ.exams[e], L = ladder(e), r = (U.state().express || {})[e];
        return '<a class="exam-card" href="#/express/' + e + '"><div class="row spread"><span class="badge exam">' + esc(ex.kicker) + '</span>' +
          (r && r.level != null ? '<span class="badge ok">' + T('Прошлый результат:') + ' ' + esc(r.level || T('ниже A1')) + '</span>' : '<span class="badge level">' + L[0] + '–' + L[L.length - 1] + '</span>') + '</div>' +
          '<div class="name">' + esc(ex.name) + '</div><p class="tag">' + T('16–20 вопросов · ~10 минут') + '</p></a>';
      }).join('') + '</div></section>';
  };

  KZ.registerRoute(function (p) {
    if (p[0] !== 'express' || !KZ.exams[p[1]]) return null;
    if (!X || X.exam !== p[1]) X = { exam: p[1], phase: 'intro' };
    var html = X.phase === 'step' ? viewStep() : X.phase === 'listen' ? viewListen() : X.phase === 'result' ? viewResult() : viewIntro(p[1]);
    if (X.phase === 'step' || X.phase === 'listen') setTimeout(startClock, 0);
    return html;
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act^="x-"]'); if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'x-start') begin(b.getAttribute('data-exam'));
    else if (act === 'x-again') { if (X) X = { exam: X.exam, phase: 'intro' }; }
    else if (act === 'x-skip') { if (X && X.phase === 'listen') { X.phase = 'skip'; done(); } }   // пропущенное аудирование в итог не входит
    else if (act === 'x-next' && X) {
      var keys = X.phase === 'listen' ? X.auQs.map(function (q) { return 'l' + q.id; }) : X.items.map(function (it) { return it.key; });
      var missing = keys.filter(function (k) { return X.answers[k] == null; }).length, msg = document.getElementById('x-msg');
      if (missing && !X.confirm) { X.confirm = true; if (msg) msg.textContent = T('Без ответа:') + ' ' + missing + '. ' + T('Нажмите ещё раз, чтобы зафиксировать как есть.'); return; }
      X.confirm = false;
      if (X.phase === 'listen') done(); else finishStep();
    } else return;
    e.stopPropagation(); KZ.route(); window.scrollTo(0, 0);
  }, true);
  document.addEventListener('change', function (e) {
    var el = e.target; if (!X || el.type !== 'radio' || !el.closest('.opts') || !/^#\/express\//.test(location.hash)) return;
    X.answers[el.name] = +el.value;
    var ul = el.closest('.opts'); Array.prototype.forEach.call(ul.querySelectorAll('.opt'), function (o) { o.classList.remove('selected'); }); el.closest('.opt').classList.add('selected');
    e.stopPropagation();
  }, true);

  KZ.route();   // первая отрисовка в app.js прошла до подключения этого файла: хаб без карточки, #/express/… — «не найдено»
})();

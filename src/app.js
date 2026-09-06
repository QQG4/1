/* ============================================================
   Qazaq Trainer — приложение (без фреймворков).
   Маршруты:  #/            хаб
              #/course/:level[/:topic/:tab]  курс по уровням (course.js)
              #/exam/:exam  экзамен: структура + уровни
              #/test/:id    мок-тест: разделы и результаты
              #/test/:id/:section  прохождение раздела
   Прогресс: localStorage 'kz-trainer:v1' + экспорт/импорт JSON.
   ============================================================ */
(function () {
  'use strict';
  var T = KZ.T, LK = KZ.LK;

  /* ---------------- store ---------------- */
  var STORE_KEY = 'kz-trainer:v1';
  function loadState() {
    try { var s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.tests) return s; } catch (e) {}
    return { version: 1, tests: {} };
  }
  function saveState() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  var state = loadState();

  function tp(testId) { return state.tests[testId] || (state.tests[testId] = { sections: {} }); }
  function sp(testId, type) { return tp(testId).sections[type] || null; }
  function setSection(testId, type, data) {
    var t = tp(testId);
    t.sections[type] = Object.assign({}, t.sections[type] || {}, data);
    t.updatedAt = Date.now();
    saveState();
  }
  function clearSection(testId, type) { var t = tp(testId); delete t.sections[type]; saveState(); }

  /* ---------------- настройки интерфейса: язык, размер текста, шрифт, подсказки, транскрипт ---------------- */
  var UI_KEY = 'kz-trainer:ui';
  var ui = { size: 'm', font: 'std', hints: false, transcript: false };
  try { var u0 = JSON.parse(localStorage.getItem(UI_KEY)); if (u0) Object.keys(ui).forEach(function (k) { if (u0[k] != null) ui[k] = u0[k]; }); } catch (e) {}
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) {} applyUi(); }
  function applyUi() { var h = document.documentElement; h.setAttribute('data-size', ui.size); h.setAttribute('data-font', ui.font); h.classList.toggle('hints', !!ui.hints); h.lang = KZ.lang; }
  applyUi();
  function uiPanel() {
    function seg(act, key, vals, labels) { return '<span class="seg" role="group">' + vals.map(function (v, i) { return '<button class="cb' + (ui[key] === v ? ' on' : '') + '" data-act="' + act + '" data-v="' + v + '" aria-pressed="' + (ui[key] === v) + '">' + labels[i] + '</button>'; }).join('') + '</span>'; }
    return '<div class="uipanel" id="ui-panel" hidden><div class="row"><span class="lbl">' + T('Язык интерфейса') + '</span><span class="seg">' + ['ru', 'kk'].map(function (l) { return '<button class="cb' + (KZ.lang === l ? ' on' : '') + '" data-act="lang" data-v="' + l + '" aria-pressed="' + (KZ.lang === l) + '">' + l.toUpperCase() + '</button>'; }).join('') + '</span></div>' +
      '<div class="row"><span class="lbl">' + T('Размер текста') + '</span>' + seg('ui-size', 'size', ['s', 'm', 'l', 'xl'], ['A−', 'A', 'A+', 'A++']) + '</div>' +
      '<div class="row"><span class="lbl">' + T('Шрифт') + '</span>' + seg('ui-font', 'font', ['std', 'dys'], [T('обычный'), T('для дислексии')]) + '</div>' +
      '<div class="row"><span class="lbl">' + T('Подсказки') + '</span>' + seg('ui-hints', 'hints', [false, true], [T('скрыты'), T('показаны')]) + '</div>' +
      '<div class="row"><span class="lbl">' + T('Транскрипт аудирования') + '</span>' + seg('ui-transcript', 'transcript', [false, true], [T('скрыт'), T('показан')]) + '<span class="hint">' + T('для слабослышащих: текст виден во время звучания') + '</span></div>' +
      '<p class="small muted">' + T('Содержание заданий всегда на казахском языке; переключается только интерфейс.') + ' ' + T('Казахская версия интерфейса ещё не вычитана носителем.') + '</p></div>';
  }
  function uiButtons() {
    return '<button class="btn ghost small" data-act="lang" data-v="' + (KZ.lang === 'ru' ? 'kk' : 'ru') + '" aria-label="' + T('Язык интерфейса') + '">' + (KZ.lang === 'ru' ? 'KK' : 'RU') + '</button>' +
      '<button class="btn ghost small" data-act="ui-panel" aria-expanded="false" aria-controls="ui-panel" title="' + T('Настройки') + '">⚙ <span class="sr">' + T('Настройки') + '</span></button>';
  }

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function letter(i) { return String.fromCharCode(65 + i); }
  function findTest(id) { for (var i = 0; i < KZ.tests.length; i++) if (KZ.tests[i].id === id) return KZ.tests[i]; return null; }
  function examSection(exam, type) { for (var i = 0; i < exam.sections.length; i++) if (exam.sections[i].type === type) return exam.sections[i]; return null; }
  function testsFor(examId, level) { return KZ.tests.filter(function (t) { return t.exam === examId && (!level || t.level === level); }); }
  function wordCount(s) { var m = (s || '').trim().match(/[^\s]+/g); return m ? m.length : 0; }
  function fmtDate(ts) { if (!ts) return ''; var d = new Date(ts); return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }

  /* Итог раздела для карточек: {label, cls} */
  function sectionResult(testId, sec) {
    var r = sp(testId, sec.type);
    if (!r || !r.status) return null;
    if (r.status === 'draft') return { label: T('черновик'), cls: 'mid', pct: null };
    var pct = r.total ? Math.round(100 * r.score / r.total) : null;
    var cls = pct == null ? 'good' : pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'bad';
    var lbl = r.kind === 'points' ? r.score + '/' + r.total + ' ' + T('баллов') : (sec.type === 'writing' || sec.type === 'speaking') ? T('чек-лист') + ' ' + r.score + '/' + r.total : r.score + '/' + r.total;
    return { label: lbl, cls: cls, pct: pct };
  }
  function testStatus(test) {
    if (test.status === 'draft') return { label: T('в разработке'), cls: 'muted' };
    var done = 0, any = false;
    test.sections.forEach(function (s) { var r = sp(test.id, s.type); if (r && r.status === 'done') done++; if (r) any = true; });
    if (done === test.sections.length) return { label: T('пройден'), cls: 'ok', done: done };
    if (any || done) return { label: done + '/' + test.sections.length + ' ' + T('разделов'), cls: 'warn', done: done };
    return { label: T('не начат'), cls: 'muted', done: 0 };
  }

  /* ---------------- timer ---------------- */
  var timer = { iv: null, start: 0, limit: 0, el: null, onTick: null };
  function stopTimer() { if (timer.iv) clearInterval(timer.iv); timer.iv = null; }
  function startTimer(limitSec, onTick) {
    stopTimer();
    timer.start = Date.now(); timer.limit = limitSec; timer.onTick = onTick;
    timer.iv = setInterval(tick, 500); tick();
  }
  function elapsed() { return timer.start ? (Date.now() - timer.start) / 1000 : 0; }
  function tick() {
    var el = document.getElementById('clock'); if (!el) return;
    var left = timer.limit - elapsed();
    el.textContent = left >= 0 ? mmss(left) : '−' + mmss(-left);
    el.className = 'clock' + (left < 0 ? ' over' : left < 60 ? ' warn' : '');
    if (timer.onTick) timer.onTick(elapsed());
  }

  /* ---------------- TTS ---------------- */
  function kkVoices() {
    if (!window.speechSynthesis) return [];
    return speechSynthesis.getVoices().filter(function (v) { return /^kk/i.test(v.lang) || /kazakh|қазақ/i.test(v.name); });
  }
  function kkVoice() {
    var vs = kkVoices(); if (!vs.length) return null;
    var pref = state.voice; for (var i = 0; i < vs.length; i++) if (vs[i].name === pref) return vs[i];
    for (var j = 0; j < vs.length; j++) if (/natural|neural|online/i.test(vs[j].name)) return vs[j];
    return vs[0];
  }
  var ttsUtter = null;
  function speak(text, onEnd) {
    var v = kkVoice(); if (!v) return false;
    speechSynthesis.cancel();
    // Кусками по абзацам/репликам — длинные фразы некоторые движки обрывают.
    var parts = text.split(/\n+/).filter(function (x) { return x.trim(); });
    var i = 0;
    function next() {
      if (i >= parts.length) { ttsUtter = null; if (onEnd) onEnd(true); return; }
      var u = new SpeechSynthesisUtterance(parts[i++]); u.voice = v; u.lang = v.lang || 'kk-KZ'; u.rate = 0.92;
      u.onend = next; u.onerror = function () { ttsUtter = null; if (onEnd) onEnd(false); };
      ttsUtter = u; speechSynthesis.speak(u);
    }
    next(); return true;
  }
  function stopSpeak() { if (window.speechSynthesis) speechSynthesis.cancel(); ttsUtter = null; }
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = function () { if (run && run.type === 'listening' && run.phase === 'run' && !run.playing) route(); };
  var isEdge = /Edg\//.test(navigator.userAgent);

  /* ---------------- router ---------------- */
  var run = null; // runtime state of the open section
  var qTimer = null; // per-question timer in speaking
  var tkTimer = null; // per-task timer in speaking (tasks)
  var extRoutes = [];
  KZ.registerRoute = function (fn) { extRoutes.push(fn); };
  var extRun = {};
  KZ.run = function () { return extRun; };
  KZ.resetRun = function (init) { extRun = init || {}; return extRun; };
  KZ.route = function () { route(); };
  KZ.speak = function (text) { return speak(text); };
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var p = h.split('/').filter(Boolean);
    var sameSection = run && p[0] === 'test' && p[1] === run.testId && p[2] === run.type;
    if (!sameSection) { stopTimer(); if (qTimer) clearInterval(qTimer); if (tkTimer) clearInterval(tkTimer); run = null; stopSpeak(); stopRec(); }
    var app = document.getElementById('app');
    var html;
    var extHtml = null;
    for (var ei = 0; ei < extRoutes.length && extHtml == null; ei++) extHtml = extRoutes[ei](p);
    if (extHtml != null) { run = null; html = extHtml; }
    else if (p[0] === 'sources') html = viewSources();
    else if (p[0] === 'exam' && KZ.exams[p[1]]) html = viewExam(KZ.exams[p[1]]);
    else if (p[0] === 'test' && findTest(p[1]) && !p[2]) html = viewTest(findTest(p[1]));
    else if (p[0] === 'test' && findTest(p[1]) && p[2]) html = viewSection(findTest(p[1]), p[2]);
    else html = viewHub();
    app.innerHTML = html;
    window.scrollTo(0, 0);
    if (run && run.afterRender) run.afterRender();
    fillRecSlots();
  }
  window.addEventListener('hashchange', route);

  function crumbs(items) {
    var out = [];
    items.forEach(function (it, i) {
      if (i) out.push('<span class="sep">/</span>');
      out.push(it.href ? '<a href="' + it.href + '">' + esc(it.label) + '</a>' : '<b>' + esc(it.label) + '</b>');
    });
    return '<div class="crumbs">' + out.join('') + '</div>';
  }
  function topbar(items, right) {
    return '<a class="skip" href="#main">' + T('К содержимому') + '</a><div class="topbar"><nav aria-label="' + T('Навигация') + '">' + crumbs(items) + '</nav><div class="row">' + (right || '') + uiButtons() + '</div></div>' + uiPanel() + '<div id="main"></div>';
  }

  /* ---------------- views: hub ---------------- */
  function viewHub() {
    var cards = KZ.examOrder.map(function (eid) {
      var ex = KZ.exams[eid];
      var rows = (ex.examLevels || KZ.levelOrder).map(function (lv) {
        var tests = testsFor(eid, lv);
        var t = tests[0];
        var st = t ? testStatus(t) : { label: T('нет теста'), cls: 'muted' };
        var href = t && t.status !== 'draft' ? '#/test/' + t.id : '#/exam/' + eid;
        // несколько вариантов уровня: чипы «1 · 2 · 3» со статусом каждого
        var chips = tests.length > 1 ? '<span class="variants">' + tests.map(function (x, i) { var sx = testStatus(x); return '<span class="vchip ' + sx.cls + '" role="link" tabindex="0" data-act="go" data-href="#/test/' + x.id + '" title="' + esc(LK(x, 'title')) + ' · ' + esc(sx.label) + '">' + (i + 1) + '</span>'; }).join('') + '</span>' : '';
        return '<a class="level-row' + (t && t.status === 'draft' ? ' draft' : '') + '" href="' + href + '">' +
          '<span class="lvl">' + lv + '</span>' +
          '<span><div class="nm">' + esc(LK(KZ.levels[lv], 'name')) + (tests.length > 1 ? ' <span class="muted small">· ' + tests.length + ' ' + T('варианта') + '</span>' : '') + '</div><div class="dsc">' + esc(t ? t.summary : '') + '</div></span>' +
          '<span class="st">' + chips + '<span class="badge ' + st.cls + '">' + st.label + '</span></span></a>';
      }).join('');
      return '<div class="exam-card-wrap"><a class="exam-card" href="#/exam/' + eid + '">' +
        '<div class="row spread"><span class="badge exam">' + esc(ex.kicker) + '</span>' +
        (ex.verified ? '<span class="badge ok">' + T('структура подтверждена') + '</span>' : '<span class="badge warn">' + T('структура не подтверждена') + '</span>') + '</div>' +
        '<div class="name">' + esc(ex.name) + '</div><p class="tag">' + esc(LK(ex, 'tagline')) + '</p></a>' +
        '<div class="levels" style="margin-top:10px">' + rows + '</div></div>';
    }).join('');

    return topbar([{ label: T('Хаб') }], '<button class="btn ghost small" data-act="io">' + T('Прогресс: экспорт / импорт') + '</button>') +
      '<div class="kicker">' + T('Qazaq trainer · тренажёр') + '</div>' +
      '<h1>' + T('Подготовка к государственным экзаменам по казахскому языку') + '</h1>' +
      '<p class="lede">' + T('Два экзамена, уровни от A1 до C2, по несколько вариантов мок-теста на каждый уровень. Результаты по разделам сохраняются в этом браузере; для переноса на другое устройство есть экспорт.') + '</p>' +
      '<div id="io-panel" hidden>' + ioPanel() + '</div>' +
      courseCards() +
      '<section><div class="kicker" style="margin-bottom:8px">' + T('Экзамены') + '</div><h2>' + T('Мок-тесты по уровням') + '</h2><p class="sub">' + T('Один полный тест на каждую пару «экзамен × уровень», формат и хронометраж — по официальным документам.') + '</p><div class="grid2">' + cards + '</div></section>' +
      '<section><div class="kicker" style="margin-bottom:8px">' + T('Шкала') + '</div><h2>' + T('Как отличаются уровни в тренажёре') + '</h2>' +
      '<p class="sub">Объём лексики — по методике ҚАЗТЕСТ (testcenter.kz). Остальное — рабочие критерии дифференциации заданий, а не официальные требования.</p>' +
      '<div class="ladder">' + KZ.levelOrder.map(function (lv) { var L = KZ.levels[lv]; return '<div class="rung"><div class="rung-level">' + lv + '</div><div class="rung-name">' + esc(LK(L, 'name')) + '</div><div class="rung-units">' + esc(LK(L, 'units')) + '</div><div class="rung-focus">' + esc(L.focus) + '</div></div>'; }).join('') + '</div></section>' +
      '<footer><p><a href="#/sources">' + T('Литература и источники') + '</a>' + (KZ.site && KZ.site.feedbackTelegram ? ' · <a href="https://t.me/' + esc(KZ.site.feedbackTelegram) + '" target="_blank" rel="noopener">' + T('Написать в Telegram') + '</a>' : '') + (KZ.site && KZ.site.siteUrl && location.protocol !== 'https:' && location.hostname !== 'localhost' ? ' · <a href="' + esc(KZ.site.siteUrl) + '" target="_blank" rel="noopener">' + T('Открыть сайт отдельной вкладкой') + '</a>' : '') + '</p>' + T('Форматы заданий везде — рабочая реконструкция по опубликованной структуре тестов, а не копия реального интерфейса. Подтверждённые и неподтверждённые факты помечены на странице каждого экзамена.') + '</footer>';
  }
  function courseCards() {
    if (!KZ.courses) return '';
    var keys = Object.keys(KZ.courses); if (!keys.length) return '';
    return '<section><div class="kicker" style="margin-bottom:8px">' + T('Курс') + '</div><h2>' + T('Учебная программа по уровням') + '</h2><p class="sub">' + T('Слова официального лексического минимума, грамматика и тексты типового учебника — по темам, с карточками, заданиями и итоговым тестом каждой темы.') + '</p><div class="grid2">' + keys.map(function (k) {
      var c = KZ.courses[k], pr = KZ.courseProgress ? KZ.courseProgress(c) : null;
      return '<a class="exam-card" href="#/course/' + k + '"><div class="row spread"><span class="badge level">' + k + '</span>' + (pr ? '<span class="badge ' + (pr.done ? 'ok' : 'muted') + '">' + pr.done + ' / ' + pr.topics + ' ' + T('тем') + '</span>' : '') + '</div><div class="name">' + esc(c.title) + ' · ' + esc(c.kk) + '</div><p class="tag">' + c.topics.length + ' ' + T('тем') + ' · ' + c.stats.words + ' ' + T('слов') + ' · ' + c.stats.grammar + ' ' + T('грамматических тем') + ' · ' + c.stats.texts + ' ' + T('текстов') + (pr && pr.known ? ' · ' + T('выучено') + ' ' + pr.known : '') + '</p></a>';
    }).join('') + '</div></section>';
  }
  function ioPanel() {
    return '<div class="block io"><h3>' + T('Экспорт и импорт прогресса') + '</h3>' +
      '<p class="small muted">' + T('Скопируйте JSON и сохраните где удобно; на другом устройстве вставьте его в поле и нажмите «Импортировать». Импорт заменяет текущий прогресс.') + '</p>' +
      '<textarea id="io-text">' + esc(JSON.stringify(state)) + '</textarea>' +
      '<div class="actions"><button class="btn small" data-act="io-copy">' + T('Скопировать') + '</button><button class="btn secondary small" data-act="io-import">' + T('Импортировать из поля') + '</button><button class="btn danger small" data-act="io-reset">' + T('Сбросить весь прогресс') + '</button><span class="hint" id="io-msg"></span></div></div>';
  }

  /* ---------------- views: exam ---------------- */
  function viewExam(ex) {
    var stages = ex.sections.map(function (s) {
      return '<div class="stage' + (s.hypothetical ? ' locked' : '') + '"><div class="stage-num">' + s.num + '</div><div><p class="stage-name">' + esc(KZ.lang === 'kk' ? s.kk : s.title) + ' <span class="muted small">' + esc(KZ.lang === 'kk' ? s.title : s.kk) + '</span>' + (s.hypothetical ? ' <span class="badge warn">' + T('гипотеза') + '</span>' : '') + '</p><p class="stage-desc">' + esc(LK(s, 'desc')) + '</p>' + tipsInline(s) + '</div>' +
        '<div class="stage-meta"><div class="stage-time">' + (s.minutes == null ? '—' : esc(s.minutes) + ' ' + T('мин')) + '</div><div class="stage-tasks">' + esc(LK(s, 'tasks')) + '</div></div></div>';
    }).join('');
    var levels = (ex.examLevels || KZ.levelOrder).map(function (lv) {
      var tests = testsFor(ex.id, lv);
      return tests.map(function (t) {
        var st = testStatus(t);
        var href = t.status === 'draft' ? '#/exam/' + ex.id : '#/test/' + t.id;
        return '<a class="level-row' + (t.status === 'draft' ? ' draft' : '') + '" href="' + href + '"><span class="lvl">' + lv + '</span><span><div class="nm">' + esc(LK(t, 'title')) + ' · ' + esc(LK(KZ.levels[lv], 'name')) + '</div><div class="dsc">' + esc(t.summary) + '</div></span><span class="st"><span class="badge ' + st.cls + '">' + st.label + '</span></span></a>';
      }).join('');
    }).join('');
    return topbar([{ label: T('Хаб'), href: '#/' }, { label: ex.short }]) +
      '<div class="kicker">' + esc(ex.kicker) + '</div><h1>' + esc(ex.name) + '</h1><p class="lede">' + esc(LK(ex, 'tagline')) + '</p>' +
      '<div class="notice ' + (ex.verified ? 'good' : '') + '"><b class="t">' + (ex.verified ? T('Подтверждено') : T('Не подтверждено')) + '</b><p>' + esc(ex.verifiedNote) + '</p></div>' +
      '<section><h2>' + T('Структура теста') + '</h2><p class="sub">' + (ex.verified ? T('По официальному описанию.') : T('Рабочая гипотеза по вторичным источникам — звёздочкой помечены цифры, требующие сверки.')) + '</p>' +
      '<div class="stages">' + stages + (ex.totalMinutes ? '<div class="stages-total"><span>' + T('Итого') + '</span><b>' + ex.totalMinutes + ' ' + T('минут') + ' · ' + ex.sections.length + ' ' + (ex.sections.length === 4 ? T('блока') : T('разделов')) + (ex.totalTasks ? ' · ' + ex.totalTasks + ' ' + T('задания') : '') + '</b></div>' : '') + '</div>' +
      (ex.mockNote ? '<p class="small muted mt">' + esc(ex.mockNote) + '</p>' : '') + '</section>' +
      (ex.scoring ? scoringTable(ex) : '') +
      '<section><h2>' + T('Что официально не опубликовано') + '</h2><div class="notice"><b class="t">' + T('Рабочая реконструкция') + '</b><ul>' + ex.unverified.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul></div></section>' +
      '<section><h2>' + T('Мок-тесты') + '</h2><div class="levels">' + levels + '</div></section>' +
      '<footer>' + T('Источники:') + '<ul class="srclist">' + ex.sources.map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a></li>'; }).join('') + '</ul></footer>';
  }

  /* ---------------- views: test ---------------- */
  function viewTest(t) {
    var ex = KZ.exams[t.exam];
    var st = testStatus(t);
    var stages = t.sections.map(function (s, i) {
      var es = examSection(ex, s.type) || {};
      var r = sectionResult(t.id, s);
      var meta = es.num || ('0' + (i + 1));
      return '<a class="stage" href="#/test/' + t.id + '/' + s.type + '"><div class="stage-num">' + meta + '</div><div><p class="stage-name">' + esc((KZ.lang === 'kk' && es.kk) || es.title || LK(KZ.sectionTypes[s.type], 'label')) + '</p><p class="stage-desc">' + esc(s.intro).slice(0, 140) + '…</p></div>' +
        '<div class="stage-meta"><div class="stage-time">' + s.minutes + ' ' + T('мин') + '</div><div class="stage-tasks">' + esc(LK(es, 'tasks') || '') + '</div>' +
        (r ? '<div class="stage-score ' + r.cls + '">' + esc(r.label) + '</div>' : '<div class="stage-score muted">' + T('не пройден') + '</div>') + '</div></a>';
    }).join('');
    var total = t.sections.reduce(function (a, s) { return a + (s.minutes || 0); }, 0);
    return topbar([{ label: T('Хаб'), href: '#/' }, { label: ex.short, href: '#/exam/' + ex.id }, { label: t.level + ' · ' + LK(t, 'title') }],
        '<span class="badge level">' + t.level + '</span><span class="badge ' + st.cls + '">' + st.label + '</span>') +
      '<div class="kicker">' + esc(ex.kicker) + ' · ' + T('уровень') + ' ' + t.level + '</div><h1>' + esc(LK(t, 'title')) + ' — ' + esc(LK(KZ.levels[t.level], 'name')) + '</h1>' +
      '<p class="lede">' + esc(t.summary) + ' ' + T('Разделы можно проходить по порядку, как на экзамене, или по одному. Ответы фиксируются один раз, после этого открывается разбор.') + '</p>' +
      '<div class="stages">' + stages + '<div class="stages-total"><span>' + T('Итого') + '</span><b>' + total + ' ' + T('минут') + ' · ' + t.sections.length + (t.sections.length === 4 ? ' ' + T('блока') : ' ' + T('разделов')) + '</b></div></div>' +
      '<div class="actions"><button class="btn danger small" data-act="reset-test" data-test="' + t.id + '">' + T('Сбросить результаты этого теста') + '</button>' +
      (tp(t.id).updatedAt ? '<span class="hint">' + T('последнее изменение:') + ' ' + fmtDate(tp(t.id).updatedAt) + '</span>' : '') + '</div>';
  }

  /* ---------------- views: section ---------------- */
  function viewSection(t, type) {
    var sec = null; t.sections.forEach(function (s) { if (s.type === type) sec = s; });
    if (!sec) return viewTest(t);
    var ex = KZ.exams[t.exam];
    var es = examSection(ex, type) || {};
    var saved = sp(t.id, type);
    if (!run || run.testId !== t.id || run.type !== type) {
      run = { testId: t.id, type: type, phase: saved && saved.status === 'done' ? 'review' : 'ready', answers: {}, sub: 'script' };
      if (saved && saved.status === 'draft') { run.phase = 'run'; run.resume = true; }
    }
    var head = topbar([{ label: T('Хаб'), href: '#/' }, { label: ex.short, href: '#/exam/' + ex.id }, { label: t.level + ' · ' + LK(t, 'title'), href: '#/test/' + t.id }, { label: (KZ.lang === 'kk' && es.kk) || es.title || type }],
      '<span class="badge level">' + t.level + '</span>' + sectionDots(t, type));
    var title = '<div class="kicker">' + T('Раздел') + ' ' + (es.num || '') + ' · ' + es.kk + '</div><h1>' + esc((KZ.lang === 'kk' && es.kk) || es.title || LK(KZ.sectionTypes[type], 'label')) + '</h1>' +
      '<p class="lede' + (run.phase === 'ready' ? '' : ' hintx') + '">' + esc(sec.intro) + '</p>';
    var body;
    if (run.phase === 'ready') body = viewReady(t, sec, es);
    else if (run.phase === 'review') body = viewReview(t, sec, es, saved);
    else body = ({ listening: runListening, lexis: runQuiz, reading: runQuiz, writing: runWriting, speaking: runSpeaking })[type](t, sec, es);
    return head + title + body;
  }
  function sectionDots(t, cur) {
    return '<span class="progress-dots">' + t.sections.map(function (s) { var r = sp(t.id, s.type); return '<i class="' + (r && r.status === 'done' ? 'done' : r ? 'part' : '') + (s.type === cur ? ' cur' : '') + '" title="' + esc(LK(KZ.sectionTypes[s.type], 'label')) + '"></i>'; }).join('') + '</span>';
  }
  function viewReady(t, sec, es) {
    var n = sec.questions ? sec.questions.length + ' ' + T('заданий') : sec.tasks ? sec.tasks.length + ' ' + T('задания') : sec.prompts ? sec.prompts.length + ' ' + T('темы на выбор') : sec.sets ? sec.sets.length + ' ' + T('комплекта × 3 вопроса') : '';
    var pts = sec.tasks ? sec.tasks.reduce(function (a, x) { return a + (x.points || 0); }, 0) : sec.pointsPerTask && sec.questions ? sec.questions.length * sec.pointsPerTask : 0;
    var tasks = sec.tasks ? '<ol class="prompt-list mt">' + sec.tasks.map(function (x) { return '<li><span><b>' + esc(x.title) + '</b><br><span class="small muted">' + (x.minutes ? '~' + x.minutes + ' ' + T('мин') + ' · ' : '') + x.points + ' ' + T('баллов') + (x.minWords ? ' · ' + T('от') + ' ' + x.minWords + ' ' + T('слов') : '') + (x.questions ? ' · ' + x.questions.length + ' ' + T('вопросов') : '') + '</span></span></li>'; }).join('') + '</ol>' : '';
    return '<div class="block"><div class="row spread"><div><span class="badge exam">' + sec.minutes + ' ' + T('мин') + '</span> <span class="badge muted">' + n + '</span>' + (pts ? ' <span class="badge muted">' + pts + ' ' + T('баллов') + '</span>' : '') + '</div></div>' + tasks +
      '<p class="small muted mt"><span class="badge warn">' + T('не вычитано') + '</span> ' + T('Задания написаны для этого тренажёра и ещё не проверены носителем языка.') + '</p>' +
      (sec.checkNote ? '<div class="notice mt" style="margin-bottom:0"><b class="t">' + T('Орфография') + '</b><p>' + esc(sec.checkNote) + '</p></div>' : '') +
      '<div class="actions"><button class="btn" data-act="start">' + T('Начать раздел — таймер') + ' ' + sec.minutes + ' ' + T('мин') + '</button><span class="hint">' + (KZ.exams[t.exam].verified ? T('Структура по официальным документам; конкретные тексты — тренировочные.') : T('Формат заданий — рабочая реконструкция.')) + '</span></div></div>' +
      tipsBlock(es);
  }
  function tipsInline(es) {
    if (!es.tips || !es.tips.length) return '';
    return '<p class="tip"><span class="tip-tag">' + T('по опыту сдававших') + '</span>' + esc(es.tips[0]) + (es.tips.length > 1 ? ' <span class="muted">(+' + (es.tips.length - 1) + ')</span>' : '') + '</p>';
  }
  function tipsBlock(es) {
    if (!es.tips || !es.tips.length) return '';
    return '<div class="notice info hintx"><b class="t">' + T('По опыту сдававших') + '</b><ul>' + es.tips.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul><p class="small muted" style="margin-top:8px">' + esc(KZ.tipsSource) + '</p></div>';
  }
  function scoringTable(ex) {
    var sc = ex.scoring;
    var head = '<tr><th>' + T('Блок') + '</th><th>' + T('Макс.') + '</th>' + sc.levels.map(function (l, i) { return '<th>' + l + '<br><span class="muted">' + sc.pct[i] + ' %</span></th>'; }).join('') + '</tr>';
    var rows = sc.blocks.map(function (b) { return '<tr><td>' + esc(b.title) + '</td><td>' + b.max + '</td>' + b.min.map(function (m) { return '<td>' + m + '</td>'; }).join('') + '</tr>'; }).join('');
    return '<section><h2>' + T('Баллы и пороги уровней') + '</h2><p class="sub">' + esc(sc.note) + '</p><div class="tablewrap"><table class="scoring"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
      (ex.certificateNote ? '<p class="small muted mt">' + esc(ex.certificateNote) + '</p>' : '') + '</section>';
  }
  function timerBar(sec, extra) {
    return '<div class="timerbar"><span class="lbl">' + esc(LK(KZ.sectionTypes[sec.type], 'label')) + ' · ' + T('лимит') + ' ' + sec.minutes + ' ' + T('мин') + '</span><div class="right">' + (extra || '') + '<span id="clock" class="clock">' + mmss(sec.minutes * 60) + '</span></div></div>';
  }

  /* --- вопросы с выбором (общие для listening / lexis / reading) --- */
  function renderQuestions(sec, answers, locked, startNum) {
    return sec.questions.map(function (q, i) {
      var num = startNum ? startNum : i + 1;
      var opts = q.kind === 'tf' ? ['Дұрыс', 'Бұрыс'] : q.options;
      var chosen = answers[q.id];
      var html = '<div class="q"><p class="q-text"><span class="qn">' + num + '.</span>' + (q.tag ? '<span class="badge muted qtag">' + esc(q.tag) + '</span>' : '') + '<span lang="kk">' + esc(q.text) + '</span>' +
        (locked ? (chosen === q.answer ? '<span class="verdict ok">✓ ' + T('верно') + '</span>' : '<span class="verdict no">✗ ' + T('неверно') + '</span>') : '') + '</p><ul class="opts" lang="kk">';
      opts.forEach(function (o, j) {
        var cls = 'opt';
        if (locked) { cls += ' locked'; if (j === q.answer) cls += ' correct'; else if (j === chosen) cls += ' wrong'; }
        else if (j === chosen) cls += ' selected';
        html += '<li><label class="' + cls + '"><input type="radio" name="' + q.id + '" value="' + j + '"' + (j === chosen ? ' checked' : '') + (locked ? ' disabled' : '') + '><span class="k">' + letter(j) + '</span><span>' + esc(o) + '</span></label></li>';
      });
      html += '</ul>';
      if (locked) html += '<div class="explain' + (chosen === q.answer ? '' : ' bad') + '"><b>' + letter(q.answer) + '.</b> ' + esc(q.explain) + '</div>';
      return html + '</div>';
    }).join('');
  }
  function runQuiz(t, sec, es) {
    var body = '';
    if (sec.passage) {
      body += '<div class="block"><div class="passage-title">Мәтін · ' + esc(sec.passage.title) + '</div><div class="passage">' + sec.passage.paragraphs.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div><p class="script-note">' + esc(sec.passage.note || '') + '</p></div>';
    }
    body += '<div class="block"><span class="setlabel">' + T('Задания') + '</span>' + renderQuestions(sec, run.answers, false) +
      '<div class="actions"><button class="btn" data-act="submit">' + T('Зафиксировать ответы') + '</button><span class="hint" id="submit-msg"></span></div></div>';
    run.afterRender = function () { startTimer(sec.minutes * 60); };
    return timerBar(sec) + body;
  }
  function runListening(t, sec, es) {
    var plays = sec.plays || (t.exam === 'kaztest' ? 2 : 1);
    if (run.playsUsed == null) run.playsUsed = 0;
    var voice = kkVoice(), left = plays - run.playsUsed;
    var head;
    var au = KZ.audio && KZ.audio[t.id];
    if (au) {
      head = '<div class="block player"><span class="setlabel">' + T('Аудио') + ' · ' + esc(sec.script.title) + '</span>' +
        '<div class="row"><button class="btn" data-act="au-play"' + (left <= 0 || run.playing ? ' disabled' : '') + '>▶ ' + (run.playing ? T('Звучит…') : T('Воспроизвести')) + '</button>' +
        '<button class="btn ghost small" data-act="au-pause" id="au-pause"' + (run.playing ? '' : ' hidden') + '>⏸ ' + T('Пауза') + '</button>' +
        '<span class="hint" id="tts-msg">' + (left > 0 ? T('прослушиваний осталось:') + ' ' + left + ' ' + T('из') + ' ' + plays : T('прослушивания исчерпаны — зафиксируйте ответы')) + ' · ' + mmss(au.seconds) + ' · ' + T('голоса') + ' ' + esc(au.voices) + '</span></div>' +
        '<div class="aubar" aria-hidden="true"><i id="aubar"></i></div><audio id="au" preload="auto" src="' + au.src + '"></audio>' + transcriptBlock(sec) +
        '<p class="small muted mt hintx">' + T('Текст скрыт, как на экзамене: читайте вопросы и отмечайте ответы по ходу звучания. Паузу поставить можно, перемотки нет; прослушивание засчитывается, когда запись дозвучала до конца.') + (plays > 1 ? ' В ҚАЗТЕСТ аудио звучит несколько раз, здесь — ' + plays + '.' : ' ' + T('В QRT видео идёт один раз.')) + '</p></div>';
    } else if (voice) {
      head = '<div class="block player"><span class="setlabel">' + T('Аудио') + ' · ' + esc(sec.script.title) + '</span>' +
        '<div class="row"><button class="btn" data-act="tts"' + (left <= 0 || run.playing ? ' disabled' : '') + '>▶ ' + (run.playing ? T('Звучит…') : T('Воспроизвести')) + '</button>' +
        (run.playing ? '<button class="btn ghost small" data-act="tts-pause">' + (window.speechSynthesis && speechSynthesis.paused ? '▶ ' + T('Продолжить') : '⏸ ' + T('Пауза')) + '</button><button class="btn ghost small" data-act="tts-stop">■ ' + T('Остановить') + '</button>' : '') +
        '<span class="hint" id="tts-msg">' + (left > 0 ? T('прослушиваний осталось:') + ' ' + left + ' ' + T('из') + ' ' + plays : T('прослушивания исчерпаны — зафиксируйте ответы')) + ' · ' + T('голос:') + ' ' + esc(voice.name) + '</span></div>' +
        transcriptBlock(sec) +
        (kkVoices().length > 1 ? '<div class="row mt small"><span class="muted">' + T('Голос:') + '</span>' + kkVoices().map(function (v) { return '<button class="cb' + (v === voice ? ' on' : '') + '" data-act="voice" data-name="' + esc(v.name) + '">' + esc(v.name.replace(/Microsoft |Online |\(Natural\)| - Kazakh.*$/g, '').trim()) + '</button>'; }).join('') + '</div>' : '') +
        '<p class="small muted mt hintx">' + T('Текст скрыт, как на экзамене. Читайте вопросы во время звучания и отмечайте ответы сразу.') + (plays > 1 ? ' В ҚАЗТЕСТ аудио звучит несколько раз, здесь — ' + plays + '.' : ' ' + T('В QRT видео идёт один раз.')) + '</p></div>';
    } else {
      head = '<div class="notice"><b class="t">' + T('Казахский голос не найден') + '</b><p>' + T('В этом браузере нет голоса для казахского языка, кнопка воспроизведения отключена. Бесплатно работает в') + ' <b>Microsoft Edge</b> ' + T('(голоса Aigul и Daulet, Windows и macOS): откройте эту же ссылку в Edge.') + (isEdge ? ' ' + T('Похоже, это Edge — подождите пару секунд, голоса подгружаются, или проверьте, что в системе включён «Kazakh» в языках речи.') : '') + '</p>' +
        '<p>' + T('Запасной режим без голоса: текст покажется на') + ' ' + (sec.script.readSeconds || 90) + ' ' + T('секунд, читайте его вслух в темпе диктора и отвечайте по ходу — это слабая замена, но лучше, чем запоминать текст целиком.') + '</p>' +
        '<div class="actions"><button class="btn secondary small" data-act="show-script"' + (left <= 0 || run.scriptVisible ? ' disabled' : '') + '>' + T('Показать текст на') + ' ' + (sec.script.readSeconds || 90) + ' ' + T('с') + '</button><span class="hint">' + T('показов осталось:') + ' ' + left + ' ' + T('из') + ' ' + plays + '</span></div></div>' +
        (run.scriptVisible ? '<div class="block"><span class="setlabel">' + T('Скрипт') + ' · <span id="script-left"></span></span><div class="script">' + esc(sec.script.text) + '</div></div>' : '');
    }
    var body = '<div class="block"><span class="setlabel">' + T('Задания') + '</span>' + renderQuestions(sec, run.answers, false) +
      '<div class="actions"><button class="btn" data-act="submit">' + T('Зафиксировать ответы') + '</button><span class="hint" id="submit-msg"></span></div></div>';
    run.afterRender = function () { if (!timer.iv) startTimer(sec.minutes * 60); else tick(); };
    return timerBar(sec) + head + body;
  }
  function transcriptBlock(sec) {
    return '<div class="row mt"><button class="btn ghost small" data-act="ui-transcript" data-v="' + (!ui.transcript) + '" aria-pressed="' + (!!ui.transcript) + '">' + (ui.transcript ? T('Скрыть транскрипт') : T('Показать транскрипт (для слабослышащих)')) + '</button></div>' +
      (ui.transcript ? '<div class="script" lang="kk" aria-live="off">' + esc(sec.script.text) + '</div>' : '');
  }
  function playAudio(t, sec, btn) {
    var plays = sec.plays || (t.exam === 'kaztest' ? 2 : 1);
    if (run.playsUsed >= plays || run.playing) return;
    var a = document.getElementById('au'); if (!a) return;
    run.playing = true; btn.disabled = true; btn.textContent = '▶ ' + T('Звучит…');
    var pb = document.getElementById('au-pause'); if (pb) { pb.hidden = false; pb.textContent = '⏸ ' + T('Пауза'); }
    a.currentTime = 0;
    a.ontimeupdate = function () { var bar = document.getElementById('aubar'); if (bar && a.duration) bar.style.width = (100 * a.currentTime / a.duration) + '%'; };
    var finished = false;
    function finish() { if (finished) return; finished = true; run.playing = false; run.playsUsed++; route(); }
    a.onended = finish;
    a.onpause = function () { if (!finished && a.duration && a.currentTime >= a.duration - 0.75) finish(); };
    a.onerror = function () { run.playing = false; var m = document.getElementById('tts-msg'); if (m) m.textContent = T('Не удалось воспроизвести аудио.'); btn.disabled = false; btn.textContent = '▶ ' + T('Воспроизвести'); };
    var pr = a.play(); if (pr && pr.catch) pr.catch(function (e) { run.playing = false; btn.disabled = false; btn.textContent = '▶ ' + T('Воспроизвести'); var m = document.getElementById('tts-msg'); if (m) m.textContent = T('Браузер заблокировал воспроизведение:') + ' ' + (e && e.name ? e.name : e); });
  }
  function playScript(t, sec) {
    var plays = sec.plays || (t.exam === 'kaztest' ? 2 : 1);
    if (run.playsUsed >= plays || run.playing) return;
    run.playing = true;
    var ok = speak(sec.script.text, function () { run.playing = false; run.playsUsed++; route(); });
    if (!ok) { run.playing = false; route(); return; }
    route();
  }
  function showScriptTimed(t, sec) {
    var plays = sec.plays || (t.exam === 'kaztest' ? 2 : 1);
    if (run.playsUsed >= plays || run.scriptVisible) return;
    run.scriptVisible = true; route();
    var secs = sec.script.readSeconds || 90, t0 = Date.now();
    var iv = setInterval(function () {
      var el = document.getElementById('script-left');
      var leftS = secs - (Date.now() - t0) / 1000;
      if (!el || !run || run.type !== 'listening') { clearInterval(iv); return; }
      if (leftS <= 0) { clearInterval(iv); run.scriptVisible = false; run.playsUsed++; route(); return; }
      el.textContent = T('скроется через') + ' ' + mmss(leftS);
    }, 500);
  }
  function submitQuiz(t, sec) {
    var missing = sec.questions.filter(function (q) { return run.answers[q.id] == null; }).length;
    var msg = document.getElementById('submit-msg');
    if (missing && !run.confirmSkip) { run.confirmSkip = true; if (msg) msg.textContent = T('Без ответа:') + ' ' + missing + '. ' + T('Нажмите ещё раз, чтобы зафиксировать как есть.'); return; }
    var score = 0; sec.questions.forEach(function (q) { if (run.answers[q.id] === q.answer) score++; });
    setSection(t.id, sec.type, { status: 'done', score: score, total: sec.questions.length, answers: run.answers, secondsUsed: Math.round(elapsed()), finishedAt: Date.now() });
    run.phase = 'review'; route();
  }

  /* --- письмо --- */
  function runWriting(t, sec, es) {
    if (sec.tasks) return runWritingTasks(t, sec, es);
    var saved = sp(t.id, 'writing') || {};
    if (run.promptId == null) run.promptId = saved.promptId || null;
    if (run.text == null) run.text = saved.text || '';
    if (run.checks == null) run.checks = saved.checks || [];
    var body = '';
    if (run.sub === 'script' && !run.promptId) {
      body = '<div class="block"><span class="setlabel">' + T('Выберите тему') + '</span><div class="prompt-pick">' + sec.prompts.map(function (p, i) { return '<label class="opt"><input type="radio" name="prompt" value="' + p.id + '"><span class="k">' + (i + 1) + '</span><span>' + esc(p.text) + '</span></label>'; }).join('') + '</div>' +
        '<p class="small muted mt">' + esc(sec.targetNote || '') + '</p><div class="actions"><button class="btn" data-act="pick-prompt">' + T('Начать писать') + '</button><span class="hint" id="submit-msg"></span></div></div>';
      run.afterRender = function () { if (!timer.iv) startTimer(sec.minutes * 60); else tick(); };
      return timerBar(sec) + body;
    }
    var prompt = sec.prompts.filter(function (p) { return p.id === run.promptId; })[0];
    if (run.sub !== 'check') {
      var acc = 0;
      var skel = sec.scaffold.map(function (s) { var from = acc; acc += s.minutes; return '<div class="skel" data-from="' + from * 60 + '" data-to="' + acc * 60 + '"><span class="tag">' + esc(s.label) + '<br>~' + s.minutes + ' ' + T('мин') + '</span><span><b>' + esc(s.label) + '.</b> <span class="hint hintx">' + esc(s.hint) + '</span></span></div>'; }).join('');
      body = '<div class="block"><span class="setlabel">' + T('Тема') + '</span><p style="font-size:16.5px;font-weight:600">' + esc(prompt.text) + '</p>' +
        '<div class="skeleton" id="skel">' + skel + '</div>' +
        '<div class="tags">' + sec.connectors.map(function (c) { return '<span class="tag-chip">' + esc(c) + '</span>'; }).join('') + '</div>' +
        '<textarea class="essay" id="essay" lang="kk" spellcheck="false" placeholder="Жазыңыз…">' + esc(run.text) + '</textarea><div class="wc" id="wc">' + wordCount(run.text) + ' ' + T('слов') + '</div>' +
        '<div class="actions"><button class="btn" data-act="finish-writing">' + T('Завершить и перейти к самопроверке') + '</button><span class="hint">' + T('Черновик сохраняется автоматически.') + '</span></div></div>';
      run.afterRender = function () {
        var startAt = run.secondsUsed || saved.secondsUsed || 0;
        if (!timer.iv) { startTimer(sec.minutes * 60, updateSkel); timer.start -= startAt * 1000; } else { timer.onTick = updateSkel; tick(); }
      };
      return timerBar(sec) + body;
    }
    body = '<div class="block"><span class="setlabel">' + T('Ваш текст') + '</span><p class="small muted">' + esc(prompt.text) + '</p><div class="essay-view">' + esc(run.text) + '</div><div class="wc">' + wordCount(run.text) + ' ' + T('слов') + ' · ' + mmss(run.secondsUsed || 0) + '</div></div>' +
      '<div class="block"><span class="setlabel">' + T('Самопроверка') + '</span><ul class="checklist">' + sec.checklist.map(function (c, i) { return '<li><label><input type="checkbox" data-check="' + i + '"' + (run.checks[i] ? ' checked' : '') + '><span>' + esc(c) + '</span></label></li>'; }).join('') + '</ul>' +
      '<div class="actions"><button class="btn" data-act="save-writing">' + T('Сохранить результат') + '</button><button class="btn ghost" data-act="back-writing">' + T('Вернуться к тексту') + '</button></div></div>';
    run.afterRender = null;
    return body;
  }
  function updateSkel(sec) {
    var e = elapsed();
    var items = document.querySelectorAll('#skel .skel');
    for (var i = 0; i < items.length; i++) {
      var from = +items[i].getAttribute('data-from'), to = +items[i].getAttribute('data-to');
      items[i].className = 'skel' + (e >= to ? ' past' : e >= from ? ' now' : '');
    }
  }

  /* --- интервью --- */
  function runSpeaking(t, sec, es) {
    if (sec.tasks) return runSpeakingTasks(t, sec, es);
    var saved = sp(t.id, 'speaking') || {};
    if (run.setId == null) run.setId = saved.setId || null;
    if (run.checks == null) run.checks = saved.checks || [];
    if (run.qdone == null) run.qdone = {};
    var body;
    if (!run.setId) {
      body = '<div class="block"><span class="setlabel">' + T('Выберите комплект') + '</span><div class="prompt-pick">' + sec.sets.map(function (s, i) { return '<label class="opt"><input type="radio" name="set" value="' + s.id + '"' + (i === 0 ? ' checked' : '') + '><span class="k">' + (i + 1) + '</span><span>' + esc(s.title) + (s.main ? ' <span class="badge level">' + T('основной') + '</span>' : '') + '</span></label>'; }).join('') + '</div>' +
        '<div class="actions"><button class="btn" data-act="pick-set">' + T('Начать интервью') + '</button></div></div>';
      run.afterRender = function () { if (!timer.iv) startTimer(sec.minutes * 60); else tick(); };
      return timerBar(sec) + body;
    }
    var set = sec.sets.filter(function (s) { return s.id === run.setId; })[0];
    var totalF = sec.answerFrame.reduce(function (a, f) { return a + f.seconds; }, 0);
    if (run.sub !== 'check') {
      var bar = '<div class="timebar">' + sec.answerFrame.map(function (f) { return '<span style="flex:' + f.seconds + '">~' + f.seconds + T('с') + '</span>'; }).join('') + '</div><div class="timebar-labels">' + sec.answerFrame.map(function (f) { return '<span>' + esc(f.label) + '</span>'; }).join('') + '</div>';
      body = micNotice() + '<div class="block"><span class="setlabel">' + esc(set.title) + '</span><p class="small muted">' + T('Каркас одного ответа (') + mmss(totalF) + '):</p>' + bar +
        '<div class="mt">' + set.questions.map(function (q, i) {
          return '<div class="sq' + (run.qdone[i] ? ' done' : '') + '" id="sq' + i + '"><p class="qt"><span class="qn">' + (i + 1) + '.</span>' + esc(q) + '</p><div class="row">' +
            (run.qdone[i] ? '<span class="badge ok">' + T('отвечен') + ' · ' + mmss(run.qdone[i]) + '</span>' :
              '<button class="btn secondary small" data-act="q-start" data-q="' + i + '">' + T('Старт таймера') + '</button><span class="clock" id="qclock' + i + '"></span><span class="phase" id="qphase' + i + '"></span>') + ' ' + recButton(set.id + '-' + i) + '</div></div>';
        }).join('') + '</div>' +
        '<div class="actions"><button class="btn" data-act="finish-speaking">' + T('Завершить интервью → самопроверка') + '</button><span class="hint">' + T('Записывайте ответы на телефон — переслушать на следующий день.') + '</span></div></div>';
      run.afterRender = function () { if (!timer.iv) startTimer(sec.minutes * 60); else tick(); };
      return timerBar(sec) + body;
    }
    body = '<div class="block"><span class="setlabel">' + esc(set.title) + '</span><ol class="prompt-list">' + set.questions.map(function (q, i) { return '<li><span>' + esc(q) + '<div class="row mt"><span class="rec-slot" data-rec-key="' + esc(recKey(set.id + '-' + i)) + '"></span></div></span></li>'; }).join('') + '</ol></div>' +
      '<div class="block"><span class="setlabel">' + T('Самопроверка') + '</span><ul class="checklist">' + sec.checklist.map(function (c, i) { return '<li><label><input type="checkbox" data-check="' + i + '"' + (run.checks[i] ? ' checked' : '') + '><span>' + esc(c) + '</span></label></li>'; }).join('') + '</ul>' +
      '<div class="actions"><button class="btn" data-act="save-speaking">' + T('Сохранить результат') + '</button></div></div>';
    run.afterRender = null;
    return body;
  }
  function startQuestionTimer(sec, i) {
    if (qTimer) clearInterval(qTimer);
    var frames = sec.answerFrame, total = frames.reduce(function (a, f) { return a + f.seconds; }, 0);
    var t0 = Date.now();
    var btn = document.querySelector('[data-act="q-start"][data-q="' + i + '"]');
    if (btn) { btn.textContent = T('Ответ завершён'); btn.setAttribute('data-act', 'q-stop'); }
    qTimer = setInterval(function () {
      var e = (Date.now() - t0) / 1000;
      var c = document.getElementById('qclock' + i), p = document.getElementById('qphase' + i);
      if (!c) { clearInterval(qTimer); return; }
      c.textContent = mmss(e); c.className = 'clock' + (e > total ? ' over' : '');
      var acc = 0, label = T('время вышло');
      for (var k = 0; k < frames.length; k++) { acc += frames[k].seconds; if (e < acc) { label = frames[k].label; break; } }
      p.textContent = '→ ' + label;
      run.qElapsed = e;
    }, 250);
  }


  /* ---------- многозадачные разделы (ҚАЗТЕСТ: письмо 2 задания, говорение 2 задания) ---------- */
  function taskTabs(sec, idx) {
    return '<div class="tasktabs">' + sec.tasks.map(function (x, i) { return '<span class="ttab' + (i === idx ? ' now' : i < idx ? ' past' : '') + '">' + (i + 1) + '. ' + esc(x.title.split(' · ')[1] || x.title) + '</span>'; }).join('') + '</div>';
  }
  function critScorer(taskId, criteria, values) {
    var max = 0, sum = 0;
    var rows = criteria.map(function (c, i) {
      max += c.max; if (values[i] != null) sum += values[i];
      var btns = ''; for (var v = 0; v <= c.max; v++) btns += '<button type="button" class="cb' + (values[i] === v ? ' on' : '') + '" data-act="crit" data-task="' + taskId + '" data-i="' + i + '" data-v="' + v + '">' + v + '</button>';
      return '<div class="crit-row"><div class="crit-name"><b>' + esc(c.name) + '</b><span>' + esc(c.top) + '</span></div><div class="crit-btns">' + btns + '</div></div>';
    }).join('');
    return '<div class="crit"><div class="crit-head">' + T('Самооценка по официальным критериям') + ' <span class="muted">' + T('(верхний дескриптор = максимум)') + '</span></div>' + rows + '<div class="crit-sum">' + T('Итого за задание:') + ' <b>' + sum + '</b> / ' + max + '</div></div>';
  }
  function critView(criteria, values) {
    var sum = 0, max = 0;
    var rows = criteria.map(function (c, i) { var v = values && values[i] != null ? values[i] : 0; sum += v; max += c.max; return '<div class="crit-row view"><div class="crit-name"><b>' + esc(c.name) + '</b></div><div class="crit-val">' + v + ' / ' + c.max + '</div></div>'; }).join('');
    return '<div class="crit">' + rows + '<div class="crit-sum">' + T('Итого:') + ' <b>' + sum + '</b> / ' + max + '</div></div>';
  }
  var SCENES = {
    park: '<rect width="640" height="340" fill="#d7e6ee"/><circle cx="560" cy="60" r="28" fill="#f2d47a"/>' +
      '<rect y="230" width="640" height="110" fill="#b7c48a"/><path d="M0 250 Q160 236 320 250 T640 250 V340 H0Z" fill="#a9b87a"/>' +
      '<rect x="0" y="292" width="640" height="22" fill="#d9cfb2"/>' +
      '<rect x="92" y="150" width="20" height="120" fill="#7a5230"/><circle cx="102" cy="120" r="52" fill="#d9902a"/><circle cx="70" cy="150" r="34" fill="#c8651f"/><circle cx="136" cy="152" r="34" fill="#e6b13a"/>' +
      '<rect x="500" y="170" width="16" height="100" fill="#7a5230"/><circle cx="508" cy="150" r="44" fill="#e0a23a"/><circle cx="480" cy="176" r="28" fill="#c8651f"/>' +
      '<ellipse cx="180" cy="200" rx="7" ry="4" fill="#d9902a" transform="rotate(-20 180 200)"/><ellipse cx="230" cy="120" rx="7" ry="4" fill="#c8651f" transform="rotate(30 230 120)"/><ellipse cx="420" cy="150" rx="7" ry="4" fill="#e6b13a" transform="rotate(-40 420 150)"/>' +
      '<rect x="236" y="206" width="170" height="10" rx="2" fill="#8b5a2b"/><rect x="236" y="232" width="170" height="12" rx="2" fill="#8b5a2b"/><rect x="244" y="244" width="8" height="34" fill="#5e3b1c"/><rect x="390" y="244" width="8" height="34" fill="#5e3b1c"/>' +
      '<circle cx="288" cy="192" r="15" fill="#f1c9a5"/><path d="M273 190 Q288 168 303 190 Z" fill="#dcdcdc"/><rect x="270" y="207" width="36" height="42" rx="8" fill="#7b5aa6"/><rect x="266" y="246" width="44" height="22" rx="4" fill="#5a3f82"/>' +
      '<circle cx="338" cy="203" r="12" fill="#f1c9a5"/><path d="M326 200 Q338 186 350 200 Z" fill="#3b2a1a"/><rect x="325" y="215" width="26" height="34" rx="7" fill="#3b7dd8"/><rect x="323" y="247" width="30" height="20" rx="4" fill="#2b4f8f"/>' +
      '<rect x="300" y="222" width="30" height="18" rx="2" fill="#fffaf0" stroke="#7a5230" stroke-width="2"/><line x1="315" y1="222" x2="315" y2="240" stroke="#7a5230" stroke-width="2"/>' +
      '<ellipse cx="446" cy="270" rx="30" ry="13" fill="#b98a5a"/><circle cx="478" cy="262" r="11" fill="#b98a5a"/><ellipse cx="486" cy="256" rx="5" ry="8" fill="#8f6a44"/><circle cx="481" cy="261" r="1.6" fill="#222"/><path d="M416 268 q-14 -10 -8 -18" stroke="#b98a5a" stroke-width="5" fill="none" stroke-linecap="round"/>' +
      '<circle cx="556" cy="214" r="8" fill="#f1c9a5"/><rect x="549" y="222" width="14" height="22" rx="4" fill="#d94f3d"/><rect x="549" y="243" width="14" height="14" fill="#333"/>' +
      '<circle cx="598" cy="218" r="8" fill="#f1c9a5"/><rect x="591" y="226" width="14" height="22" rx="4" fill="#3f8f5a"/><rect x="591" y="247" width="14" height="14" fill="#333"/>' +
      '<circle cx="577" cy="252" r="7" fill="#d94f3d"/><path d="M571 250 q6 -5 12 0" stroke="#fff" stroke-width="2" fill="none"/>',
    market: '<rect width="640" height="340" fill="#e9e2d2"/><rect y="250" width="640" height="90" fill="#c9bfa8"/>' +
      '<rect x="20" y="120" width="120" height="130" fill="#d8cdb6" stroke="#a89c84" stroke-width="2"/><rect x="40" y="150" width="30" height="40" fill="#8fb3c9"/><rect x="90" y="150" width="30" height="40" fill="#8fb3c9"/>' +
      '<rect x="500" y="130" width="120" height="120" fill="#d8cdb6" stroke="#a89c84" stroke-width="2"/><rect x="520" y="160" width="80" height="34" fill="#8fb3c9"/>' +
      '<path d="M150 110 H490 L470 140 H170 Z" fill="#c8453a"/><path d="M170 110 h40 l-8 30 h-40Z M250 110 h40 l-8 30 h-40Z M330 110 h40 l-8 30 h-40Z M410 110 h40 l-8 30 h-40Z" fill="#f4efe6"/>' +
      '<rect x="180" y="140" width="6" height="110" fill="#8b5a2b"/><rect x="454" y="140" width="6" height="110" fill="#8b5a2b"/>' +
      '<rect x="170" y="210" width="300" height="14" fill="#8b5a2b"/><rect x="176" y="224" width="288" height="40" fill="#a86f3c"/>' +
      '<rect x="190" y="186" width="70" height="26" fill="#c9a36a"/><circle cx="205" cy="186" r="8" fill="#d94f3d"/><circle cx="222" cy="184" r="8" fill="#d94f3d"/><circle cx="240" cy="186" r="8" fill="#d94f3d"/><circle cx="214" cy="176" r="8" fill="#e05a4a"/>' +
      '<rect x="270" y="186" width="70" height="26" fill="#c9a36a"/><circle cx="285" cy="186" r="8" fill="#f0a22c"/><circle cx="302" cy="184" r="8" fill="#f0a22c"/><circle cx="320" cy="186" r="8" fill="#f0a22c"/><circle cx="294" cy="176" r="8" fill="#f5b13f"/>' +
      '<rect x="350" y="186" width="70" height="26" fill="#c9a36a"/><ellipse cx="368" cy="186" rx="9" ry="6" fill="#6aa84f"/><ellipse cx="388" cy="184" rx="9" ry="6" fill="#6aa84f"/><ellipse cx="405" cy="187" rx="9" ry="6" fill="#5c9642"/>' +
      '<rect x="428" y="176" width="26" height="34" fill="#6d6d6d"/><rect x="433" y="180" width="16" height="10" fill="#cfe6d8"/>' +
      '<circle cx="320" cy="152" r="14" fill="#f1c9a5"/><path d="M304 150 Q320 130 336 150 Z" fill="#c8453a"/><rect x="302" y="166" width="36" height="34" rx="7" fill="#e8b74a"/>' +
      '<circle cx="120" cy="196" r="14" fill="#f1c9a5"/><path d="M107 194 Q120 176 133 194 Z" fill="#3b2a1a"/><rect x="104" y="210" width="32" height="46" rx="8" fill="#3b6ea5"/><rect x="104" y="255" width="32" height="30" fill="#4a4a4a"/><rect x="138" y="228" width="22" height="30" rx="3" fill="#8b5a2b"/><path d="M142 228 q7 -14 14 0" stroke="#8b5a2b" stroke-width="3" fill="none"/>' +
      '<circle cx="80" cy="226" r="10" fill="#f1c9a5"/><path d="M70 224 Q80 210 90 224 Z" fill="#3b2a1a"/><rect x="69" y="236" width="22" height="30" rx="6" fill="#d94f3d"/><rect x="69" y="265" width="22" height="18" fill="#4a4a4a"/><circle cx="96" cy="240" r="5" fill="#d94f3d"/>',
    office: '<rect width="640" height="340" fill="#eef1f4"/><rect x="380" y="30" width="230" height="140" fill="#cfe0ee" stroke="#b7c6d2" stroke-width="3"/>' +
      '<rect x="395" y="110" width="30" height="60" fill="#8fa3b5"/><rect x="430" y="80" width="40" height="90" fill="#7d93a6"/><rect x="478" y="100" width="26" height="70" fill="#8fa3b5"/><rect x="510" y="70" width="44" height="100" fill="#6f8699"/><rect x="560" y="120" width="34" height="50" fill="#8fa3b5"/>' +
      '<rect x="40" y="50" width="220" height="130" rx="4" fill="#1f2a36"/><rect x="50" y="60" width="200" height="110" fill="#ffffff"/>' +
      '<polyline points="65,150 100,135 135,140 170,110 205,100 240,75" fill="none" stroke="#0e6e86" stroke-width="4" stroke-linecap="round"/><line x1="65" y1="155" x2="240" y2="155" stroke="#bbb" stroke-width="2"/><line x1="65" y1="70" x2="65" y2="155" stroke="#bbb" stroke-width="2"/>' +
      '<rect x="140" y="180" width="20" height="24" fill="#4a5560"/><rect x="120" y="204" width="60" height="6" rx="2" fill="#4a5560"/>' +
      '<ellipse cx="400" cy="262" rx="190" ry="44" fill="#c9b08a"/><ellipse cx="400" cy="256" rx="190" ry="44" fill="#e0c9a1"/>' +
      '<circle cx="300" cy="180" r="15" fill="#f1c9a5"/><path d="M285 178 Q300 158 315 178 Z" fill="#3b2a1a"/><rect x="282" y="196" width="36" height="46" rx="8" fill="#2f5f8f"/><rect x="298" y="236" width="40" height="24" rx="3" fill="#333"/><rect x="300" y="238" width="36" height="16" fill="#9fc4de"/>' +
      '<circle cx="400" cy="172" r="15" fill="#f1c9a5"/><path d="M386 170 Q400 150 414 170 Z" fill="#6b3f2a"/><rect x="382" y="188" width="36" height="46" rx="8" fill="#7b5aa6"/><rect x="380" y="232" width="40" height="24" rx="3" fill="#333"/><rect x="382" y="234" width="36" height="16" fill="#9fc4de"/>' +
      '<circle cx="500" cy="180" r="15" fill="#f1c9a5"/><path d="M485 178 Q500 158 515 178 Z" fill="#1f1f1f"/><rect x="482" y="196" width="36" height="46" rx="8" fill="#3f8f5a"/><rect x="462" y="236" width="40" height="24" rx="3" fill="#333"/><rect x="464" y="238" width="36" height="16" fill="#9fc4de"/>' +
      '<circle cx="190" cy="215" r="15" fill="#f1c9a5"/><path d="M175 213 Q190 193 205 213 Z" fill="#3b2a1a"/><rect x="172" y="231" width="36" height="56" rx="8" fill="#c8453a"/><rect x="176" y="286" width="12" height="40" fill="#2a2a2a"/><rect x="192" y="286" width="12" height="40" fill="#2a2a2a"/><line x1="205" y1="240" x2="245" y2="200" stroke="#f1c9a5" stroke-width="7" stroke-linecap="round"/><line x1="245" y1="200" x2="256" y2="160" stroke="#555" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="0" y="300" width="640" height="40" fill="#d7d2c8"/>'
  };
  function pictureSvg(pic) {
    var scene = SCENES[pic.scene] || SCENES.park;
    var svg = '<svg viewBox="0 0 640 340" role="img" aria-label="' + esc(pic.alt) + '"><title>' + esc(pic.alt) + '</title>' + scene + '</svg>';
    return '<figure class="picture">' + svg + '<figcaption>' + esc(pic.note || '') + '</figcaption></figure>';
  }
  function taskSkeleton(task) {
    var acc = 0;
    return '<div class="skeleton" id="skel">' + (task.scaffold || []).map(function (st) { var from = acc; acc += st.minutes; return '<div class="skel" data-from="' + from * 60 + '" data-to="' + acc * 60 + '"><span class="tag">' + esc(st.label) + '<br>~' + st.minutes + ' ' + T('мин') + '</span><span><b>' + esc(st.label) + '.</b> <span class="hint hintx">' + esc(st.hint) + '</span></span></div>'; }).join('') + '</div>';
  }
  function taskElapsed() { return run.taskStart == null ? 0 : elapsed() - run.taskStart; }
  function updateTask(task) {
    var e = taskElapsed();
    var tc = document.getElementById('tclock');
    if (tc) { var left = task.minutes * 60 - e; tc.textContent = T('задание') + ' ' + (left >= 0 ? mmss(left) : '−' + mmss(-left)); tc.className = 'tclock' + (left < 0 ? ' over' : ''); }
    var items = document.querySelectorAll('#skel .skel');
    for (var i = 0; i < items.length; i++) { var from = +items[i].getAttribute('data-from'), to = +items[i].getAttribute('data-to'); items[i].className = 'skel' + (e >= to ? ' past' : e >= from ? ' now' : ''); }
  }
  function runWritingTasks(t, sec, es) {
    var saved = sp(t.id, 'writing') || {};
    if (run.texts == null) run.texts = saved.texts || {};
    if (run.crit == null) run.crit = saved.crit || {};
    if (run.taskIdx == null) run.taskIdx = saved.taskIdx || 0;
    if (run.taskSec == null) run.taskSec = saved.taskSec || {};
    var body;
    if (run.sub !== 'check') {
      var task = sec.tasks[run.taskIdx], last = run.taskIdx === sec.tasks.length - 1;
      var txt = run.texts[task.id] || '';
      body = '<div class="block">' + taskTabs(sec, run.taskIdx) +
        '<span class="setlabel">' + esc(task.title) + ' · ' + task.points + ' ' + T('баллов · ~') + task.minutes + ' ' + T('мин') + '</span>' +
        (task.picture ? pictureSvg(task.picture) : '') +
        '<p class="prompt-text">' + esc(task.prompt) + '</p>' + (task.targetNote ? '<p class="small muted">' + esc(task.targetNote) + '</p>' : '') +
        taskSkeleton(task) +
        (task.connectors ? '<div class="tags">' + task.connectors.map(function (c) { return '<span class="tag-chip">' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
        '<textarea class="essay" id="essay" data-task="' + task.id + '" lang="kk" spellcheck="false" placeholder="Жазыңыз…">' + esc(txt) + '</textarea><div class="wc" id="wc">' + wordCount(txt) + ' ' + T('слов · для максимума от') + ' ' + task.minWords + '</div>' +
        '<div class="actions"><button class="btn" data-act="next-task">' + (last ? T('Завершить письмо → самооценка') : T('Завершить задание →') + ' ' + esc(sec.tasks[run.taskIdx + 1].title)) + '</button><span class="hint">' + T('Черновик сохраняется автоматически.') + '</span></div></div>';
      run.afterRender = function () {
        var onTick = function () { updateTask(task); };
        if (!timer.iv) { startTimer(sec.minutes * 60, onTick); timer.start -= (saved.secondsUsed || 0) * 1000; } else timer.onTick = onTick;
        if (run.taskStart == null) run.taskStart = elapsed() - (run.taskSec[task.id] || 0);
        tick();
      };
      return timerBar(sec, '<span class="tclock" id="tclock"></span>') + body;
    }
    body = sec.tasks.map(function (task) {
      return '<div class="block"><span class="setlabel">' + esc(task.title) + ' · ' + task.points + ' ' + T('баллов') + '</span><p class="small muted">' + esc(task.prompt) + '</p><div class="essay-view">' + esc(run.texts[task.id] || '') + '</div><div class="wc">' + wordCount(run.texts[task.id]) + ' ' + T('слов') + ' · ' + mmss(run.taskSec[task.id] || 0) + '</div>' + critScorer(task.id, task.criteria, run.crit[task.id] || []) + '</div>';
    }).join('') + '<div class="actions"><button class="btn" data-act="save-tasks">' + T('Сохранить результат') + '</button><button class="btn ghost" data-act="back-tasks">' + T('Вернуться к тексту') + '</button></div>';
    run.afterRender = null;
    return body;
  }
  function speakTaskHtml(task) {
    if (task.questions) return '<ol class="prompt-list">' + task.questions.map(function (q) { return '<li><span><span class="badge level" style="margin-right:8px">' + q.level + '</span>' + esc(q.text) + '</span></li>'; }).join('') + '</ol>';
    return '<p class="prompt-text">' + esc(task.topic) + '</p><p class="small muted">Тірек сөздер:</p><div class="tags">' + task.keywords.map(function (k) { return '<span class="tag-chip">' + esc(k) + '</span>'; }).join('') + '</div>';
  }
  function runSpeakingTasks(t, sec, es) {
    var saved = sp(t.id, 'speaking') || {};
    if (run.crit == null) run.crit = saved.crit || {};
    if (run.tdone == null) run.tdone = {};
    if (run.sub === 'script') run.sub = 'prep';
    var body, clockLbl;
    if (run.sub === 'prep') {
      body = '<div class="block"><span class="setlabel">Дайындық · ' + sec.prepMinutes + ' ' + T('мин') + '</span><p class="small muted">' + T('Прочитайте оба задания и набросайте план: по одному тезису на вопрос и 3–4 опорных слова для темы. Бумагу на реальном тесте не дают — держите план в голове или на экране.') + '</p>' +
        sec.tasks.map(function (x) { return '<h3 class="mt">' + esc(x.title) + ' <span class="muted small">· ' + x.points + ' ' + T('баллов') + '</span></h3>' + speakTaskHtml(x); }).join('') +
        '<div class="actions"><button class="btn" data-act="prep-done">' + T('Подготовка окончена → отвечать (') + sec.answerMinutes + ' ' + T('мин)') + '</button></div></div>';
      clockLbl = T('подготовка');
    } else if (run.sub === 'answer') {
      body = micNotice() + '<div class="block"><span class="setlabel">' + T('Жауап беру') + ' · ' + sec.answerMinutes + ' ' + T('мин на оба задания') + '</span>' +
        sec.tasks.map(function (x, i) {
          return '<div class="sq" id="sq' + i + '"><h3>' + esc(x.title) + ' <span class="muted small">· ~' + x.minutes + ' ' + T('мин') + '</span></h3>' + speakTaskHtml(x) +
            '<div class="row mt">' + (run.tdone[x.id] != null ? '<span class="badge ok">' + T('отвечено') + ' · ' + mmss(run.tdone[x.id]) + '</span>' :
              '<button class="btn secondary small" data-act="task-start" data-task="' + x.id + '" data-min="' + x.minutes + '">' + T('Старт таймера') + '</button><span class="clock" id="tk-' + x.id + '"></span>') + ' ' + recButton(x.id) + '</div></div>';
        }).join('') +
        '<div class="actions"><button class="btn" data-act="finish-speaking-tasks">' + T('Завершить говорение → самооценка') + '</button><span class="hint">' + T('Запишите ответ на телефон, оценивать будете по записи.') + '</span></div></div>';
      clockLbl = T('ответ');
    } else {
      body = sec.tasks.map(function (x) { return '<div class="block"><span class="setlabel">' + esc(x.title) + ' · ' + x.points + ' ' + T('баллов') + '</span>' + speakTaskHtml(x) + '<div class="row mt"><span class="rec-slot" data-rec-key="' + esc(recKey(x.id)) + '"></span><span class="small muted">' + T('таймер:') + ' ' + mmss(run.tdone[x.id] || 0) + '</span></div>' + critScorer(x.id, sec.criteria, run.crit[x.id] || []) + '</div>'; }).join('') +
        '<div class="actions"><button class="btn" data-act="save-speaking-tasks">' + T('Сохранить результат') + '</button></div>';
      run.afterRender = null;
      return body;
    }
    run.afterRender = function () {
      var onTick = function () {
        var tc = document.getElementById('tclock'); if (!tc) return;
        var left = run.sub === 'prep' ? sec.prepMinutes * 60 - elapsed() : sec.answerMinutes * 60 - (elapsed() - (run.answerStart || 0));
        tc.textContent = clockLbl + ' ' + (left >= 0 ? mmss(left) : '−' + mmss(-left)); tc.className = 'tclock' + (left < 0 ? ' over' : '');
      };
      if (!timer.iv) startTimer(sec.minutes * 60, onTick); else timer.onTick = onTick;
      tick();
    };
    return timerBar(sec, '<span class="tclock" id="tclock"></span>') + body;
  }
  function startTaskTimer(taskId, minutes) {
    if (tkTimer) clearInterval(tkTimer);
    var t0 = Date.now();
    var btn = document.querySelector('[data-act="task-start"][data-task="' + taskId + '"]');
    if (btn) { btn.textContent = T('Ответ завершён'); btn.setAttribute('data-act', 'task-stop'); }
    tkTimer = setInterval(function () {
      var e = (Date.now() - t0) / 1000, c = document.getElementById('tk-' + taskId);
      if (!c) { clearInterval(tkTimer); return; }
      c.textContent = mmss(e); c.className = 'clock' + (e > minutes * 60 ? ' over' : '');
      run.tkElapsed = e;
    }, 250);
  }
  function tasksTotal(sec) { return sec.tasks.reduce(function (a, x) { return a + x.points; }, 0); }
  function critSum(obj) { var s = 0; Object.keys(obj || {}).forEach(function (k) { (obj[k] || []).forEach(function (v) { s += v || 0; }); }); return s; }


  /* ---------- запись ответов интервью: MediaRecorder + IndexedDB ---------- */
  var rec = { mr: null, chunks: [], key: null, stream: null, t0: 0, iv: null };
  function idb() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('no idb'));
      var r = indexedDB.open('kz-trainer', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('recs'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  function recPut(key, blob) { return idb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction('recs', 'readwrite'); tx.objectStore('recs').put({ blob: blob, at: Date.now() }, key); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }); }
  function recGet(key) { return idb().then(function (db) { return new Promise(function (res) { var q = db.transaction('recs').objectStore('recs').get(key); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }); }).catch(function () { return null; }); }
  function recDel(key) { return idb().then(function (db) { db.transaction('recs', 'readwrite').objectStore('recs').delete(key); }).catch(function () {}); }
  function recKey(qkey) { return run.testId + '/' + run.type + '/' + qkey; }
  function micBlocked() {
    // Только реальная невозможность записи. featurePolicy внутри iframe часто отвечает «нельзя», хотя браузер доступ даёт,
    // поэтому по нему кнопку не отключаем — пробуем getUserMedia и показываем причину отказа.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return 'unsupported';
    if (!window.isSecureContext) return 'insecure';
    return null;
  }
  function micHint() {
    try { if (document.featurePolicy && !document.featurePolicy.allowsFeature('microphone')) return T('если браузер откажет — откройте тренажёр отдельной вкладкой'); } catch (e) {}
    return '';
  }
  function micNotice() {
    var b = micBlocked(); if (!b) return '';
    var why = b === 'insecure' ? T('Страница открыта не по https, браузер не даёт доступ к микрофону.') : T('Этот браузер не поддерживает запись с микрофона.');
    return '<div class="notice"><b class="t">' + T('Запись с микрофона недоступна') + '</b><p>' + why + ' ' + T('Кнопки записи отключены. Записывайте ответ на диктофон телефона или откройте тренажёр как отдельный сайт (локальная версия или GitHub Pages) — там запись работает.') + '</p></div>';
  }
  function recButton(qkey) {
    var full = recKey(qkey);
    if (rec.key === full) return '<button class="btn danger small" data-act="rec-stop">■ ' + T('Остановить запись') + ' <span class="mono" id="rec-clock">0:00</span></button>';
    var blocked = micBlocked();
    return '<button class="btn secondary small" data-act="rec-start" data-key="' + esc(full) + '"' + (rec.key || blocked ? ' disabled' : '') + '>● ' + T('Записать ответ') + '</button><span class="rec-slot" data-rec-key="' + esc(full) + '"></span><span class="hint rec-msg" data-rec-msg="' + esc(full) + '">' + (blocked ? T('микрофон недоступен в этом окне') : micHint()) + '</span>';
  }
  function recMsg(key, text) { var el = document.querySelector('[data-rec-msg="' + key + '"]'); if (el) el.textContent = text; }
  function startRec(key, btn) {
    var blocked = micBlocked();
    if (blocked) { recMsg(key, T('Запись недоступна:') + ' ' + (blocked === 'insecure' ? T('нужен https') : T('браузер не поддерживает'))); return; }
    recMsg(key, T('Запрашиваю доступ к микрофону… разрешите его во всплывающем окне браузера.'));
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      rec.stream = stream; rec.chunks = []; rec.key = key; rec.t0 = Date.now();
      var mr = new MediaRecorder(stream); rec.mr = mr;
      mr.ondataavailable = function (e) { if (e.data && e.data.size) rec.chunks.push(e.data); };
      mr.onstop = function () {
        var blob = new Blob(rec.chunks, { type: mr.mimeType || 'audio/webm' });
        stream.getTracks().forEach(function (tr) { tr.stop(); });
        var k = rec.key; rec.key = null; rec.mr = null; rec.stream = null; clearInterval(rec.iv);
        recPut(k, blob).catch(function () {}).then(function () { route(); });
      };
      mr.start(); route();
      rec.iv = setInterval(function () { var c = document.getElementById('rec-clock'); if (c) c.textContent = mmss((Date.now() - rec.t0) / 1000); }, 500);
    }).catch(function (err) {
      var name = err && err.name ? err.name : String(err);
      var policy = false; try { policy = !!(document.featurePolicy && !document.featurePolicy.allowsFeature('microphone')); } catch (x) {}
      var msg = /NotAllowed|Permission|Security/i.test(name) ? (policy ? T('Это окно встроено в другую страницу, и она не пропускает микрофон внутрь. Откройте тренажёр отдельной вкладкой (кнопка «открыть в новой вкладке» у артефакта или локальный dist/index.html) — там запись работает.') : T('Доступ к микрофону запрещён. Нажмите на значок замка или камеры в адресной строке и разрешите микрофон, затем повторите.')) :
        /NotFound|Devices/i.test(name) ? T('Микрофон не найден: проверьте, что он подключён и выбран в системе.') : T('Не удалось включить микрофон:') + ' ' + name;
      recMsg(key, msg);
    });
  }
  function stopRec() { if (rec.mr && rec.mr.state !== 'inactive') rec.mr.stop(); else if (rec.stream) { rec.stream.getTracks().forEach(function (tr) { tr.stop(); }); rec.key = null; } }
  function fillRecSlots() {
    var slots = document.querySelectorAll('[data-rec-key]');
    Array.prototype.forEach.call(slots, function (el) {
      var key = el.getAttribute('data-rec-key');
      recGet(key).then(function (r) {
        if (!r || !el.isConnected) return;
        var url = URL.createObjectURL(r.blob);
        el.innerHTML = '<audio controls src="' + url + '"></audio><span class="hint">' + fmtDate(r.at) + '</span>';
      });
    });
  }
  /* --- разбор / результат --- */
  function viewReview(t, sec, es, saved) {
    var head, body;
    if (sec.questions) {
      var pct = Math.round(100 * saved.score / saved.total);
      head = '<div class="score-card"><div class="score-big">' + saved.score + '<small>/' + saved.total + '</small></div><div><b>' + (pct >= 80 ? T('Уверенно.') : pct >= 50 ? T('Есть пробелы — смотрите разбор.') : T('Слабо — раздел стоит пройти заново после разбора.')) + '</b><div class="m">' + T('Время:') + ' ' + mmss(saved.secondsUsed || 0) + ' ' + T('из') + ' ' + sec.minutes + ':00 · ' + fmtDate(saved.finishedAt) + '</div></div></div>';
      body = (sec.script ? '<div class="block"><span class="setlabel">' + T('Скрипт') + '</span><h3>' + esc(sec.script.title) + '</h3>' + (KZ.audio && KZ.audio[t.id] ? '<audio controls preload="none" src="' + KZ.audio[t.id].src + '" style="width:100%;margin-bottom:10px"></audio>' : '') + '<div class="script" lang="kk">' + esc(sec.script.text) + '</div></div>' : '') +
        (sec.passage ? '<div class="block"><div class="passage-title">Мәтін · ' + esc(sec.passage.title) + '</div><div class="passage">' + sec.passage.paragraphs.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div></div>' : '') +
        '<div class="block"><span class="setlabel">' + T('Разбор') + '</span>' + renderQuestions(sec, saved.answers || {}, true) + '</div>';
    } else if (sec.tasks) {
      var pct2 = Math.round(100 * saved.score / saved.total);
      head = '<div class="score-card"><div class="score-big">' + saved.score + '<small>/' + saved.total + '</small></div><div><b>' + T('Самооценка по официальным критериям') + (pct2 >= 80 ? ' — ' + T('уровень C1.') : pct2 >= 60 ? ' — ' + T('уровень B2.') : pct2 >= 50 ? ' — ' + T('уровень B1.') : pct2 >= 40 ? ' — ' + T('уровень A2.') : pct2 >= 30 ? ' — ' + T('уровень A1.') : ' — ' + T('ниже порога A1.')) + '</b><div class="m">' + T('Пороги блока: B1 от 50 %, B2 от 60 %, C1 от 80 %') + ' · ' + mmss(saved.secondsUsed || 0) + ' · ' + fmtDate(saved.finishedAt) + '</div></div></div>';
      body = sec.tasks.map(function (x) {
        var crit = x.criteria || sec.criteria;
        return '<div class="block"><span class="setlabel">' + esc(x.title) + ' · ' + x.points + ' ' + T('баллов') + '</span>' +
          (sec.type === 'writing' ? '<p class="small muted">' + esc(x.prompt) + '</p><div class="essay-view">' + esc((saved.texts || {})[x.id] || '') + '</div><div class="wc">' + wordCount((saved.texts || {})[x.id]) + ' ' + T('слов') + '</div>' : speakTaskHtml(x) + '<div class="row mt"><span class="rec-slot" data-rec-key="' + esc(t.id + '/speaking/' + x.id) + '"></span></div>') +
          critView(crit, (saved.crit || {})[x.id]) + '</div>';
      }).join('');
    } else if (sec.type === 'writing') {
      var prompt = sec.prompts.filter(function (p) { return p.id === saved.promptId; })[0] || {};
      head = '<div class="score-card"><div class="score-big">' + saved.score + '<small>/' + saved.total + '</small></div><div><b>' + T('Чек-лист самопроверки.') + '</b><div class="m">' + wordCount(saved.text) + ' ' + T('слов') + ' · ' + mmss(saved.secondsUsed || 0) + ' ' + T('из') + ' ' + sec.minutes + ':00 · ' + fmtDate(saved.finishedAt) + '</div></div></div>';
      body = '<div class="block"><span class="setlabel">' + T('Тема') + '</span><p>' + esc(prompt.text) + '</p><div class="essay-view">' + esc(saved.text) + '</div></div>' +
        '<div class="block"><span class="setlabel">' + T('Самопроверка') + '</span><ul class="checklist">' + sec.checklist.map(function (c, i) { return '<li class="static" style="' + (saved.checks && saved.checks[i] ? 'color:var(--good)' : '') + '">' + esc(c) + (saved.checks && saved.checks[i] ? ' ✓' : '') + '</li>'; }).join('') + '</ul></div>';
    } else {
      var set = sec.sets.filter(function (s) { return s.id === saved.setId; })[0] || { title: '', questions: [] };
      head = '<div class="score-card"><div class="score-big">' + saved.score + '<small>/' + saved.total + '</small></div><div><b>' + T('Чек-лист самопроверки.') + '</b><div class="m">' + esc(set.title) + ' · ' + mmss(saved.secondsUsed || 0) + ' · ' + fmtDate(saved.finishedAt) + '</div></div></div>';
      body = '<div class="block"><span class="setlabel">' + T('Вопросы и записи') + '</span><ol class="prompt-list">' + set.questions.map(function (q, i) { return '<li><span>' + esc(q) + '<div class="row mt"><span class="rec-slot" data-rec-key="' + esc(t.id + '/speaking/' + set.id + '-' + i) + '"></span></div></span></li>'; }).join('') + '</ol></div>' +
        '<div class="block"><span class="setlabel">' + T('Самопроверка') + '</span><ul class="checklist">' + sec.checklist.map(function (c, i) { return '<li class="static" style="' + (saved.checks && saved.checks[i] ? 'color:var(--good)' : '') + '">' + esc(c) + (saved.checks && saved.checks[i] ? ' ✓' : '') + '</li>'; }).join('') + '</ul></div>';
    }
    var next = nextSection(t, sec.type);
    run.afterRender = null;
    return head + body + '<div class="actions">' + (next ? '<a class="btn" href="#/test/' + t.id + '/' + next.type + '">' + T('Следующий раздел:') + ' ' + esc(LK(KZ.sectionTypes[next.type], 'label')) + '</a>' : '<a class="btn" href="#/test/' + t.id + '">' + T('К итогам теста') + '</a>') +
      '<button class="btn ghost" data-act="retry">' + T('Пройти заново') + '</button>' + feedbackLink(t, sec, saved) + '</div>';
  }
  function feedbackLink(t, sec, saved) {
    if (!KZ.site || !KZ.site.feedbackTelegram) return '';
    var ctx = (t ? t.id : '') + (sec ? '/' + sec.type : '') + (saved && saved.total ? ' ' + saved.score + '/' + saved.total : '');
    return '<a class="btn ghost" target="_blank" rel="noopener" href="https://t.me/' + esc(KZ.site.feedbackTelegram) + '" data-ctx="' + esc(ctx) + '">' + T('Написать в Telegram') + '</a><span class="hint">' + T('Отзыв о тесте') + ': ' + esc(ctx) + '</span>';
  }
  function viewSources() {
    var tiers = { 1: T('Основные учебники и лексический минимум'), 2: T('Дополнительные пособия и тексты'), 3: T('Словари и справочники') };
    var groups = {};
    (KZ.sources || []).forEach(function (x) { (groups[x.tier || 9] = groups[x.tier || 9] || []).push(x); });
    var html = Object.keys(groups).sort().map(function (tk) {
      return '<section><h2>' + esc(tiers[tk] || T('Прочее')) + '</h2><ol class="prompt-list">' + groups[tk].map(function (x) {
        return '<li><span><b lang="kk">' + esc(x.title) + '</b><br><span class="small muted">' + esc(x.author || '') + (x.year ? ', ' + x.year : '') + (x.kind ? ' · ' + esc(x.kind) : '') + (x.level ? ' · ' + esc(x.level) : '') + '</span></span></li>';
      }).join('') + '</ol></section>';
    }).join('');
    var official = KZ.examOrder.map(function (eid) { var ex = KZ.exams[eid]; return '<h3>' + esc(ex.name) + '</h3><ul class="srclist">' + ex.sources.map(function (x) { return '<li><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a></li>'; }).join('') + '</ul>'; }).join('');
    return topbar([{ label: T('Хаб'), href: '#/' }, { label: T('Источники') }]) +
      '<div class="kicker">' + T('Литература и источники') + '</div><h1>' + T('На чём построен тренажёр') + '</h1>' +
      '<p class="lede">' + T('Учебники и словари, по которым собраны лексика, грамматика и тексты курса. Задания тренажёра — собственные, написаны по методу этих пособий, а не скопированы из них; всё сгенерированное помечено как не вычитанное.') + '</p>' +
      html + '<section><h2>' + T('Официальные документы экзаменов') + '</h2>' + official + '</section>';
  }
  function nextSection(t, type) { for (var i = 0; i < t.sections.length - 1; i++) if (t.sections[i].type === type) return t.sections[i + 1]; return null; }

  /* ---------------- events ---------------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    var t = run && findTest(run.testId), sec = null;
    if (t) t.sections.forEach(function (s) { if (s.type === run.type) sec = s; });

    if (act === 'go') { e.preventDefault(); location.hash = b.getAttribute('data-href'); return; }
    if (act === 'lang') { KZ.setLang(b.getAttribute('data-v')); saveUi(); route(); return; }
    else if (act === 'ui-panel') { var up = document.getElementById('ui-panel'); if (up) { up.hidden = !up.hidden; b.setAttribute('aria-expanded', String(!up.hidden)); } return; }
    else if (act === 'ui-size' || act === 'ui-font' || act === 'ui-hints' || act === 'ui-transcript') { var v = b.getAttribute('data-v'); ui[act.slice(3)] = v === 'true' ? true : v === 'false' ? false : v; saveUi(); var keep = document.getElementById('ui-panel') && !document.getElementById('ui-panel').hidden; route(); if (keep) { var up2 = document.getElementById('ui-panel'); if (up2) up2.hidden = false; } return; }
    if (act === 'io') { var p = document.getElementById('io-panel'); p.hidden = !p.hidden; }
    else if (act === 'io-copy') { var ta = document.getElementById('io-text'); ta.select(); try { navigator.clipboard.writeText(ta.value); } catch (x) { document.execCommand('copy'); } document.getElementById('io-msg').textContent = T('Скопировано.'); }
    else if (act === 'io-import') { try { var s = JSON.parse(document.getElementById('io-text').value); if (!s.tests) throw 0; state = s; saveState(); route(); } catch (x) { document.getElementById('io-msg').textContent = T('Не удалось прочитать JSON.'); } }
    else if (act === 'io-reset') { if (confirm(T('Удалить весь сохранённый прогресс?'))) { state = { version: 1, tests: {} }; saveState(); route(); } }
    else if (act === 'reset-test') { if (confirm(T('Сбросить результаты этого теста?'))) { delete state.tests[b.getAttribute('data-test')]; saveState(); route(); } }
    else if (act === 'start') { run.phase = 'run'; route(); }
    else if (act === 'tts') { playScript(t, sec); }
    else if (act === 'au-play') { playAudio(t, sec, b); }
    else if (act === 'tts-stop') { stopSpeak(); run.playing = false; run.playsUsed++; route(); }
    else if (act === 'tts-pause') { if (window.speechSynthesis) { if (speechSynthesis.paused) { speechSynthesis.resume(); b.textContent = '⏸ ' + T('Пауза'); } else { speechSynthesis.pause(); b.textContent = '▶ ' + T('Продолжить'); } } }
    else if (act === 'au-pause') { var au = document.getElementById('au'); if (au) { if (au.paused) { au.play(); b.textContent = '⏸ ' + T('Пауза'); } else { au.pause(); b.textContent = '▶ ' + T('Продолжить'); } } }
    else if (act === 'voice') { state.voice = b.getAttribute('data-name'); saveState(); route(); }
    else if (act === 'show-script') { showScriptTimed(t, sec); }
    else if (act === 'rec-start') { startRec(b.getAttribute('data-key'), b); }
    else if (act === 'rec-stop') { stopRec(); }
    else if (act === 'submit') { submitQuiz(t, sec); }
    else if (act === 'retry') { clearSection(t.id, sec.type); if (sec.type === 'speaking') { var pref = t.id + '/speaking/'; idb().then(function (db) { var st = db.transaction('recs', 'readwrite').objectStore('recs'); var q = st.openCursor(); q.onsuccess = function () { var c = q.result; if (c) { if (String(c.key).indexOf(pref) === 0) c.delete(); c.continue(); } }; }).catch(function () {}); } run = null; route(); }
    else if (act === 'pick-prompt') { var r = document.querySelector('input[name="prompt"]:checked'); if (!r) { document.getElementById('submit-msg').textContent = T('Выберите тему.'); return; } run.promptId = r.value; run.sub = 'write'; setSection(t.id, 'writing', { status: 'draft', promptId: run.promptId, text: '' }); route(); }
    else if (act === 'finish-writing') { clearTimeout(draftTO); run.secondsUsed = Math.round(elapsed()); setSection(t.id, 'writing', { status: 'draft', promptId: run.promptId, text: run.text, secondsUsed: run.secondsUsed }); stopTimer(); run.sub = 'check'; route(); }
    else if (act === 'back-writing') { run.sub = 'write'; run.resume = true; route(); }
    else if (act === 'save-writing') { clearTimeout(draftTO); var n = run.checks.filter(Boolean).length; setSection(t.id, 'writing', { status: 'done', promptId: run.promptId, text: run.text, checks: run.checks, score: n, total: sec.checklist.length, secondsUsed: run.secondsUsed || 0, finishedAt: Date.now() }); run.phase = 'review'; route(); }
    else if (act === 'next-task') {
      var cur = sec.tasks[run.taskIdx]; run.taskSec[cur.id] = Math.round(taskElapsed()); run.taskStart = null; clearTimeout(draftTO);
      if (run.taskIdx < sec.tasks.length - 1) { run.taskIdx++; setSection(t.id, 'writing', { status: 'draft', texts: run.texts, taskIdx: run.taskIdx, taskSec: run.taskSec, secondsUsed: Math.round(elapsed()) }); }
      else { run.secondsUsed = Math.round(elapsed()); setSection(t.id, 'writing', { status: 'draft', texts: run.texts, taskIdx: run.taskIdx, taskSec: run.taskSec, secondsUsed: run.secondsUsed }); stopTimer(); run.sub = 'check'; }
      route();
    }
    else if (act === 'back-tasks') { run.sub = 'write'; run.taskIdx = 0; run.taskStart = null; route(); }
    else if (act === 'crit') { var tid = b.getAttribute('data-task'); run.crit[tid] = run.crit[tid] || []; run.crit[tid][+b.getAttribute('data-i')] = +b.getAttribute('data-v'); route(); }
    else if (act === 'save-tasks') { clearTimeout(draftTO); setSection(t.id, 'writing', { status: 'done', kind: 'points', texts: run.texts, crit: run.crit, taskSec: run.taskSec, score: critSum(run.crit), total: tasksTotal(sec), secondsUsed: run.secondsUsed || 0, finishedAt: Date.now() }); run.phase = 'review'; route(); }
    else if (act === 'prep-done') { run.answerStart = elapsed(); run.sub = 'answer'; route(); }
    else if (act === 'task-start') { startTaskTimer(b.getAttribute('data-task'), +b.getAttribute('data-min')); }
    else if (act === 'task-stop') { if (tkTimer) clearInterval(tkTimer); run.tdone[b.getAttribute('data-task')] = Math.round(run.tkElapsed || 0); route(); }
    else if (act === 'finish-speaking-tasks') { if (tkTimer) clearInterval(tkTimer); run.secondsUsed = Math.round(elapsed()); stopTimer(); run.sub = 'check'; route(); }
    else if (act === 'save-speaking-tasks') { setSection(t.id, 'speaking', { status: 'done', kind: 'points', crit: run.crit, tdone: run.tdone, score: critSum(run.crit), total: tasksTotal(sec), secondsUsed: run.secondsUsed || 0, finishedAt: Date.now() }); run.phase = 'review'; route(); }
    else if (act === 'pick-set') { var rs = document.querySelector('input[name="set"]:checked'); run.setId = rs ? rs.value : sec.sets[0].id; run.sub = 'ask'; route(); }
    else if (act === 'q-start') { startQuestionTimer(sec, +b.getAttribute('data-q')); }
    else if (act === 'q-stop') { if (qTimer) clearInterval(qTimer); run.qdone[+b.getAttribute('data-q')] = Math.round(run.qElapsed || 0); route(); }
    else if (act === 'finish-speaking') { if (qTimer) clearInterval(qTimer); run.secondsUsed = Math.round(elapsed()); stopTimer(); run.sub = 'check'; route(); }
    else if (act === 'save-speaking') { var m = run.checks.filter(Boolean).length; setSection(t.id, 'speaking', { status: 'done', setId: run.setId, checks: run.checks, score: m, total: sec.checklist.length, secondsUsed: run.secondsUsed || 0, finishedAt: Date.now() }); run.phase = 'review'; route(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target; if (!el || el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
    var b = el.closest('[data-act]'); if (!b) return;
    e.preventDefault(); b.click();
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!run) return;
    if (el.type === 'radio' && el.name && el.closest('.opts')) {
      run.answers[el.name] = +el.value;
      var ul = el.closest('.opts'); Array.prototype.forEach.call(ul.querySelectorAll('.opt'), function (o) { o.classList.remove('selected'); });
      el.closest('.opt').classList.add('selected');
    }
    if (el.type === 'checkbox' && el.hasAttribute('data-check')) run.checks[+el.getAttribute('data-check')] = el.checked;
  });
  var draftTO = null;
  document.addEventListener('input', function (e) {
    if (e.target.id === 'essay' && run) {
      var tid = e.target.getAttribute('data-task');
      if (tid) {
        run.texts[tid] = e.target.value;
        var tk = null; findTest(run.testId).sections.forEach(function (s) { if (s.type === 'writing') s.tasks.forEach(function (x) { if (x.id === tid) tk = x; }); });
        document.getElementById('wc').textContent = wordCount(run.texts[tid]) + ' ' + T('слов · для максимума от') + ' ' + (tk ? tk.minWords : '');
        clearTimeout(draftTO); draftTO = setTimeout(function () { if (run && run.type === 'writing' && run.sub !== 'check') setSection(run.testId, 'writing', { status: 'draft', texts: run.texts, taskIdx: run.taskIdx, taskSec: run.taskSec, secondsUsed: Math.round(elapsed()) }); }, 800);
        return;
      }
      run.text = e.target.value;
      document.getElementById('wc').textContent = wordCount(run.text) + ' ' + T('слов');
      clearTimeout(draftTO); draftTO = setTimeout(function () { if (run && run.type === 'writing' && run.sub === 'write') setSection(run.testId, 'writing', { status: 'draft', promptId: run.promptId, text: run.text, secondsUsed: Math.round(elapsed()) }); }, 800);
    }
  });

  KZ.util = { esc: esc, topbar: topbar, renderQuestions: renderQuestions, state: function () { return state; }, save: saveState, mmss: mmss };
  route();
})();

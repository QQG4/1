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

  /* ---------------- статистика ----------------
     KZ.track(name, props) и trackPage(path) — единственная точка отправки. Работает только в публичной сборке
     (KZ.site.build === 'site'), чтобы лаборатория и локальные прогоны не пачкали цифры.
     Персональных данных не отправляем: идентификатор сессии случайный, живёт до закрытия вкладки и никуда не привязан.
     Два приёмника, оба необязательные: KZ.site.eventsUrl (свой endpoint — POST JSON, шлём sendBeacon,
     чтобы уход со страницы не терял событие) и счётчик из analyticsSnippet (GoatCounter / Umami / Plausible —
     что подключено, то и используется). Не настроено ничего → все вызовы молча ничего не делают. */
  var TRACK_ON = !!(KZ.site && KZ.site.build === 'site') && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);   // локальный просмотр docs/ цифры не пачкает
  var SID = (function () {
    if (!TRACK_ON) return '';
    try {
      var k = 'kz-trainer:sid', v = sessionStorage.getItem(k);
      if (!v) { v = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); sessionStorage.setItem(k, v); }
      return v;
    } catch (e) { return 'nostore'; }
  })();
  function sendEvent(name, props) {
    var url = KZ.site && KZ.site.eventsUrl; if (!url) return;
    var body = JSON.stringify({ e: name, sid: SID, lang: KZ.lang, ts: Date.now(), p: props || {} });
    /* тип тела — text/plain намеренно: это один из типов, не требующих предварительного запроса CORS.
       С application/json браузер шлёт preflight, а sendBeacon уходит с credentials, и ответ с '*' он не принимает —
       событие молча теряется. Приёмник разбирает тело как JSON независимо от заголовка. */
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      else fetch(url, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
    } catch (e) {}
  }
  function track(name, props) {
    if (!TRACK_ON) return;
    sendEvent(name, props);
    try {
      if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: 'event/' + name, title: name, event: true });
      else if (window.umami && window.umami.track) window.umami.track(name, props || {});
      else if (window.plausible) window.plausible(name, { props: props || {} });
    } catch (e) {}
  }
  var lastPage = null;
  function trackPage(path) {
    if (!TRACK_ON || path === lastPage) return;
    var first = lastPage === null;
    lastPage = path;
    sendEvent('pageview', first ? landing(path) : { path: path });
    try {
      if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: '/' + path });
      else if (window.plausible) window.plausible('pageview', { u: location.origin + location.pathname + '#/' + path });
    } catch (e) {}   // Umami считает переходы по history сам
  }
  /* Откуда пришли — только при первом просмотре во вкладке: домен сайта-источника (без адреса страницы)
     и utm-метки из ссылки (?utm_source=telegram&utm_campaign=…). Нужны, чтобы понять, какой канал продвижения работает. */
  function landing(path) {
    var p = { path: path }, ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    if (ref && ref !== location.hostname) p.ref = ref.replace(/^www\./, '').slice(0, 80);
    try {
      var sp = new URLSearchParams(location.search), utm = ['utm_source', 'utm_medium', 'utm_campaign'].map(function (k) { return (sp.get(k) || '').slice(0, 40); });
      if (utm[0] || utm[1] || utm[2]) p.utm = utm.join('/');
    } catch (e) {}
    return p;
  }
  KZ.track = track;

  /* Ошибки JavaScript у посетителей: текст ошибки, файл и строка, страница и браузер. Не больше пяти разных за вкладку,
     повторы не шлём. Так поломки видны в статистике раньше, чем о них напишут. */
  var errSeen = {}, errCount = 0;
  function reportError(msg, where) {
    msg = String(msg || '');
    if (!TRACK_ON || !msg || msg === 'Script error.' || errCount >= 5 || errSeen[msg]) return;
    errSeen[msg] = 1; errCount++;
    sendEvent('js-error', { text: msg.slice(0, 300) + (where ? ' @ ' + where : ''), path: location.hash.replace(/^#\/?/, '').slice(0, 120), ua: navigator.userAgent.slice(0, 200) });
  }
  window.addEventListener('error', function (e) { if (e && e.message) reportError(e.message, (e.filename || '').split('/').pop() + ':' + e.lineno + ':' + e.colno); });
  window.addEventListener('unhandledrejection', function (e) { var r = e && e.reason; reportError('Promise: ' + (r && r.message ? r.message : r), ''); });
  /* Клик по напоминаниям считаем отдельным событием: иначе непонятно, работает ли призыв вообще. */
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest && ev.target.closest('a[data-remind]');
    if (a) track('remind', { where: a.getAttribute('data-remind') });
  });

  /* ---------------- store ---------------- */
  var STORE_KEY = (KZ.site && KZ.site.build === 'lab') ? 'kz-trainer:lab:v1' : 'kz-trainer:v1'; // лаборатория хранит прогресс отдельно от сайта
  function loadState() {
    try { var s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.tests) { if (!Array.isArray(s.history)) s.history = seedHistory(s); return s; } } catch (e) {}
    return { version: 1, tests: {}, history: [] };
  }
  /* История попыток для графика «Мой прогресс»: {t: testId, s: раздел, sc, tot, at, pr: тренировка}.
     До 17.09.2026 хранилась только последняя попытка раздела — старый прогресс превращается в историю из неё. */
  var HIST_MAX = 2000;
  function seedHistory(st) {
    var h = [];
    Object.keys(st.tests || {}).forEach(function (id) {
      var secs = (st.tests[id] && st.tests[id].sections) || {};
      Object.keys(secs).forEach(function (ty) { var r = secs[ty]; if (r && r.status === 'done' && +r.total > 0) h.push({ t: id, s: ty, sc: +r.score || 0, tot: +r.total, at: +r.finishedAt || +st.tests[id].updatedAt || 0, pr: !!r.practice }); });
    });
    return h.sort(function (a, b) { return a.at - b.at; });
  }
  function saveState() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  var state = loadState();
  /* другая вкладка изменила прогресс — перечитать, если здесь не идёт раздел */
  window.addEventListener('storage', function (e) { if (e.key === STORE_KEY && !(run && run.phase === 'run')) { state = loadState(); route(); } });
  /* импорт: оставляем только известные тесты, числовые поля приводим к числу (защита от мусора и разметки в JSON) */
  function cleanState(s) {
    var NUM = ['score', 'total', 'secondsUsed', 'finishedAt', 'startedAt', 'playsUsed', 'taskIdx'];
    var out = { version: 1, tests: {}, course: {} };
    if (typeof s.voice === 'string') out.voice = s.voice;
    Object.keys(s.tests).forEach(function (id) {
      var t = s.tests[id]; if (!findTest(id) || !t || typeof t.sections !== 'object') return;
      var o = { sections: {}, updatedAt: +t.updatedAt || 0 };
      Object.keys(t.sections).forEach(function (ty) {
        var r = t.sections[ty]; if (!r || typeof r !== 'object' || !KZ.sectionTypes[ty]) return;
        var c = {};
        Object.keys(r).forEach(function (k) { var v = r[k]; if (NUM.indexOf(k) >= 0) c[k] = +v || 0; else if (k === 'status') c[k] = v === 'done' ? 'done' : 'draft'; else if (typeof v === 'string' || typeof v === 'boolean' || (v && typeof v === 'object')) c[k] = v; });
        o.sections[ty] = c;
      });
      out.tests[id] = o;
    });
    if (s.course && typeof s.course === 'object' && !Array.isArray(s.course)) out.course = s.course;
    out.history = Array.isArray(s.history) ? s.history.filter(function (x) { return x && findTest(x.t) && KZ.sectionTypes[x.s] && +x.tot > 0; })
      .map(function (x) { return { t: String(x.t), s: String(x.s), sc: +x.sc || 0, tot: +x.tot, at: +x.at || 0, pr: !!x.pr }; }).slice(-HIST_MAX) : seedHistory(out);
    return out;
  }

  function tp(testId) { return state.tests[testId] || (state.tests[testId] = { sections: {} }); }
  function sp(testId, type) { return tp(testId).sections[type] || null; }
  function setSection(testId, type, data) {
    var t = tp(testId);
    t.sections[type] = Object.assign({}, t.sections[type] || {}, data);
    t.updatedAt = Date.now();
    var r = t.sections[type];
    if (data && data.status === 'done' && +r.total > 0) {   // каждая завершённая попытка — в историю (перезапись раздела её не стирает)
      if (!Array.isArray(state.history)) state.history = [];
      state.history.push({ t: testId, s: type, sc: +r.score || 0, tot: +r.total, at: +r.finishedAt || t.updatedAt, pr: !!r.practice });
      if (state.history.length > HIST_MAX) state.history.splice(0, state.history.length - HIST_MAX);
    }
    saveState();
    if (data && data.status === 'done') {   // завершение любого раздела — единая точка учёта
      var tt = findTest(testId);
      track('section-done', {
        test: testId, exam: tt && tt.exam, level: tt && tt.level, section: type,
        pct: r.total ? Math.round(100 * r.score / r.total) : null,
        seconds: r.secondsUsed || 0, practice: !!r.practice, timedOut: !!(run && run.timedOut),
        self: type === 'writing' || type === 'speaking'
      });
      var v = tt && verdict(tt);
      if (v && v.all && !doneFired[testId]) { doneFired[testId] = 1; track('test-done', { test: testId, exam: tt.exam, level: tt.level, pass: v.pass }); }
    }
  }
  var doneFired = {};
  function clearSection(testId, type) { var t = tp(testId); delete t.sections[type]; saveState(); }

  /* ---------------- настройки интерфейса: язык, размер текста, шрифт, подсказки, транскрипт ---------------- */
  var UI_KEY = 'kz-trainer:ui';
  var ui = { size: 'm', font: 'std', hints: false, transcript: false, practice: false };
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
      '<div class="row"><span class="lbl">' + T('Таймер') + '</span>' + seg('ui-practice', 'practice', [false, true], [T('как на экзамене'), T('тренировка')]) + '<span class="hint">' + T('тренировка: время показывается, но раздел не закрывается; уровень в этом режиме не подтверждается') + '</span></div>' +
      '<p class="small muted">' + T('Содержание заданий всегда на казахском языке; переключается только интерфейс.') + '</p></div>';
  }
  function uiButtons() {
    return '<button class="btn ghost small" data-act="lang" data-v="' + (KZ.lang === 'ru' ? 'kk' : 'ru') + '" aria-label="' + T('Язык интерфейса') + '">' + (KZ.lang === 'ru' ? 'KK' : 'RU') + '</button>' +
      '<button class="btn ghost small gear" data-act="ui-panel" aria-expanded="false" aria-controls="ui-panel" title="' + T('Настройки') + '">⚙<span class="sr">' + T('Настройки') + '</span></button>';
  }

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function letter(i) { return String.fromCharCode(65 + i); }
  /* русская плюрализация: 1 тема / 2 темы / 5 тем; в казахском интерфейсе форма одна */
  function plural(n, one, few, many) { if (KZ.lang === 'kk') return many; n = Math.abs(n) % 100; var d = n % 10; if (n > 10 && n < 20) return many; if (d === 1) return one; if (d >= 2 && d <= 4) return few; return many; }
  KZ.plural = plural;
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
    var sc = esc(r.score) + '/' + esc(r.total);
    var lbl = r.kind === 'points' ? sc + ' ' + T('баллов') : (sec.type === 'writing' || sec.type === 'speaking') ? T('чек-лист') + ' ' + sc : sc;
    return { label: lbl, cls: cls, pct: pct };
  }
  /* Вердикт по строгой шкале (KZ.strict): вывод об уровне считается ТОЛЬКО по разделам с автоматической проверкой
     (аудирование, чтение, лексика). Письмо и говорение оценивает сам пользователь — они показываются в списке,
     но на вывод не влияют: обещать точность там, где оценку ставит себе сам сдающий, нельзя. */
  function verdict(t) {
    var need = KZ.strict && KZ.strict.pct && KZ.strict.pct[t.level]; if (!need || !t.sections.length) return null;
    var ex = KZ.exams[t.exam], rows = [], done = 0, autoTotal = 0, pass = true;
    t.sections.forEach(function (s) {
      var r = sp(t.id, s.type), es = examSection(ex, s.type) || {};
      var name = (KZ.lang === 'kk' && es.kk) || es.title || LK(KZ.sectionTypes[s.type], 'label');
      var self = s.type === 'writing' || s.type === 'speaking';
      if (!self) autoTotal++;
      if (r && r.status === 'done' && r.total) {
        var pct = Math.round(100 * r.score / r.total), ok = pct >= need && !r.practice;
        if (!self) { done++; if (!ok) pass = false; }
        rows.push({ name: name, pct: pct, ok: ok, self: self, practice: !!r.practice });
      } else { if (!self) pass = false; rows.push({ name: name, pct: null, ok: false, self: self }); }
    });
    var all = autoTotal > 0 && done === autoTotal;
    return { need: need, rows: rows, done: done, autoTotal: autoTotal, all: all, pass: pass && all };
  }
  function verdictCard(t) {
    var v = verdict(t); if (!v) return '';
    var failed = v.rows.filter(function (r) { return r.pct != null && !r.ok && !r.self; }).map(function (r) { return r.name; }).join(', ');
    var head = v.pass ? T('Ваш уровень по чтению и аудированию:') + ' ' + t.level : v.all ? t.level + ' ' + T('— баллов не хватило в разделах:') + ' ' + failed + '.' : T('Пройдите разделы с автоматической проверкой, чтобы увидеть результат по уровню.');
    var selfNote = v.rows.some(function (r) { return r.self; }) ? '<p class="small muted">' + T('Письмо и говорение вы оцениваете сами, поэтому в вывод об уровне они не входят.') + '</p>' : '';
    return '<div class="notice ' + (v.pass ? 'good' : v.all ? '' : 'info') + '"><b class="t">' + T('Результат') + ' · ' + t.level + '</b><p><b>' + head + '</b></p>' + selfNote + '<ul>' +
      v.rows.map(function (r) { return '<li>' + esc(r.name) + ': ' + (r.pct == null ? T('не пройден') : r.pct + ' %' + (r.self ? '' : ' ' + (r.ok ? '✓' : '✗'))) + (r.self ? ' <span class="muted">· ' + T('самооценка, в вывод не входит') + '</span>' : '') + (r.practice ? ' <span class="muted">· ' + T('тренировка без таймера — для подтверждения пройдите как на экзамене') + '</span>' : '') + '</li>'; }).join('') +
      '</ul></div>';
  }
  function testStatus(test) {
    if (test.status === 'draft') return { label: T('в разработке'), cls: 'muted' };
    var done = 0, any = false;
    test.sections.forEach(function (s) { var r = sp(test.id, s.type); if (r && r.status === 'done') done++; if (r) any = true; });
    if (done === test.sections.length) { var v = verdict(test); if (v) return { label: v.pass ? '✓ ' + test.level : T('баллов не хватило'), cls: v.pass ? 'ok' : 'bad', done: done }; return { label: T('пройден'), cls: 'ok', done: done }; }
    if (any || done) return { label: done + '/' + test.sections.length + ' ' + T('разделов'), cls: 'warn', done: done };
    return { label: T('не начат'), cls: 'muted', done: 0 };
  }

  /* ---------------- timer ---------------- */
  var timer = { iv: null, start: 0, limit: 0, el: null, onTick: null, warned: false };
  function stopTimer() { if (timer.iv) clearInterval(timer.iv); timer.iv = null; }
  function startTimer(limitSec, onTick) {
    stopTimer();
    timer.start = Date.now(); timer.limit = limitSec; timer.onTick = onTick; timer.warned = false;
    timer.iv = setInterval(tick, 500); tick();
  }
  /* объявление для скринридера (aria-live), не видно на экране */
  function announce(msg) {
    var el = document.getElementById('live'); if (!el) { el = document.createElement('div'); el.id = 'live'; el.className = 'sr'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'assertive'); document.body.appendChild(el); }
    el.textContent = ''; setTimeout(function () { el.textContent = msg; }, 50);
  }
  function elapsed() { return timer.start ? (Date.now() - timer.start) / 1000 : 0; }
  function tick() {
    var el = document.getElementById('clock'); if (!el) return;
    var left = timer.limit - elapsed();
    el.textContent = left >= 0 ? mmss(left) : '−' + mmss(-left);
    el.className = 'clock' + (left < 0 ? ' over' : left < 60 ? ' warn' : '');
    el.setAttribute('aria-label', (left >= 0 ? T('осталось') : T('сверх лимита')) + ' ' + el.textContent);
    if (left < 60 && left > 0 && !timer.warned) { timer.warned = true; announce(T('Осталась одна минута.')); }
    if (timer.onTick) timer.onTick(elapsed());
    if (left <= 0 && run && run.phase === 'run' && !run.timedOut) { if (ui.practice) { if (!timer.overNoted) { timer.overNoted = true; announce(T('Время вышло. Режим тренировки: раздел остаётся открытым.')); } } else timeUp(); }
  }
  /* Время раздела вышло — раздел закрывается, как на экзамене: ответы фиксируются, письмо/говорение переходят к самопроверке */
  function timeUp() {
    var t = findTest(run.testId); if (!t) return;
    var sec = null; t.sections.forEach(function (x) { if (x.type === run.type) sec = x; }); if (!sec) return;
    run.timedOut = true; run.secondsUsed = Math.round(elapsed()); stopTimer(); stopSpeak(); stopRec(); announce(T('Время вышло') + '. ' + T('Раздел закрыт по таймеру, как на экзамене: ответы зафиксированы, оцените то, что успели.'));
    var au = document.getElementById('au'); if (au) { try { au.pause(); } catch (e) {} }
    if (qTimer) clearInterval(qTimer); if (tkTimer) clearInterval(tkTimer);
    var ta = document.getElementById('essay'); if (ta) { if (ta.getAttribute('data-task')) { run.texts = run.texts || {}; run.texts[ta.getAttribute('data-task')] = ta.value; } else run.text = ta.value; }
    if (sec.questions) { run.confirmSkip = true; submitQuiz(t, sec); return; }
    if (run.type === 'writing' && !sec.tasks && !run.promptId) { run.promptId = sec.prompts[0].id; run.text = run.text || ''; }
    if (run.type === 'speaking' && !sec.tasks && !run.setId) run.setId = sec.sets[0].id;
    run.sub = 'check'; route();
  }
  function timeUpNotice() {
    return run && run.timedOut ? '<div class="notice" role="alert"><b class="t">' + T('Время вышло') + '</b><p>' + T('Раздел закрыт по таймеру, как на экзамене: ответы зафиксированы, оцените то, что успели.') + '</p></div>' : '';
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

  /* ---------------- перемешивание вариантов ответа ----------------
     В данных ключ часто стоит первым. Один раз при загрузке переставляем варианты детерминированно
     (сид = id теста + id вопроса), чтобы порядок был стабилен между сессиями и разбор совпадал с сохранёнными ответами. */
  function seedOf(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function seededPerm(n, seed) { var a = []; for (var i = 0; i < n; i++) a.push(i); var x = seed || 1; for (var j = n - 1; j > 0; j--) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; var k = (x >>> 0) % (j + 1); var t = a[j]; a[j] = a[k]; a[k] = t; } return a; }
  function shuffleQuestion(q, key) {
    if (!q || q.kind === 'tf' || !q.options || q.options.length < 2 || q._shuffled) return;
    var perm = seededPerm(q.options.length, seedOf(key));
    q.options = perm.map(function (i) { return q.options[i]; });
    q.answer = perm.indexOf(q.answer); q._shuffled = true;
    q._perm = perm;   // позиция на экране → индекс в исходных данных теста (нужно статистике по дистракторам)
  }
  KZ.shuffleQuestion = shuffleQuestion;
  KZ.tests.forEach(function (t) { t.sections.forEach(function (sec) { (sec.questions || []).forEach(function (q) { shuffleQuestion(q, t.id + '/' + sec.type + '/' + q.id); }); }); });
  if (KZ.courses) Object.keys(KZ.courses).forEach(function (lv) { KZ.courses[lv].topics.forEach(function (tp) {
    tp.grammar.forEach(function (g) { g.tasks.forEach(function (x, i) { shuffleQuestion(x, lv + '/' + g.id + '/' + i); }); });
    tp.texts.forEach(function (tx) { tx.questions.forEach(function (x, i) { shuffleQuestion(x, lv + '/' + tx.id + '/' + i); }); });
  }); });

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
  var lastHash = null;
  /* селектор, по которому вернуть фокус после перерисовки той же страницы */
  function focusKey(el) {
    if (!el || el === document.body) return null;
    if (el.tagName === 'INPUT' && el.name) return 'input[name="' + el.name + '"][value="' + el.value + '"]';
    if (el.id) return '#' + el.id;
    var b = el.closest('[data-act]'); if (!b) return null;
    var s = '[data-act="' + b.getAttribute('data-act') + '"]', s2 = s;
    ['data-v', 'data-i', 'data-task', 'data-q', 'data-test', 'data-href', 'data-name', 'data-key', 'data-check'].forEach(function (a) { if (b.hasAttribute(a)) s += '[' + a + '="' + b.getAttribute(a).replace(/"/g, '') + '"]'; });
    return s + ',' + s2;
  }
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var p = h.split('/').filter(Boolean);
    var samePage = lastHash === h; lastHash = h;
    var sameSection = run && p[0] === 'test' && p[1] === run.testId && p[2] === run.type;
    if (!sameSection) { stopTimer(); if (qTimer) clearInterval(qTimer); if (tkTimer) clearInterval(tkTimer); run = null; stopSpeak(); stopRec(); }
    var app = document.getElementById('app');
    var html;
    var extHtml = null;
    for (var ei = 0; ei < extRoutes.length && extHtml == null; ei++) extHtml = extRoutes[ei](p);
    if (extHtml != null) { run = null; html = extHtml; }
    else if (p[0] === 'sources') html = viewSources();
    else if (p[0] === 'progress' && !p[1]) html = viewProgress();
    else if (p[0] === 'exam' && KZ.exams[p[1]]) html = viewExam(KZ.exams[p[1]]);
    else if (p[0] === 'test' && findTest(p[1]) && !p[2]) html = viewTest(findTest(p[1]));
    else if (p[0] === 'test' && findTest(p[1]) && p[2]) html = viewSection(findTest(p[1]), p[2]);
    else if (p.length && p[0] !== 'main') html = viewNotFound(h);
    else html = viewHub();
    var keepAu = sameSection && run && run.playing ? document.getElementById('au') : null; // не прерывать звучащее аудио при перерисовке (язык, настройки, транскрипт)
    var fk = samePage ? focusKey(document.activeElement) : null, sy = window.scrollY;
    app.innerHTML = html;
    if (keepAu) { var na = document.getElementById('au'); if (na && na !== keepAu) na.parentNode.replaceChild(keepAu, na); }
    if (samePage) { window.scrollTo(0, sy); if (fk) { var fe = null; try { fe = document.querySelector(fk); } catch (e) {} if (fe) try { fe.focus({ preventScroll: true }); } catch (e2) {} } }
    else window.scrollTo(0, 0);
    if (run && run.afterRender) run.afterRender();
    fillRecSlots();
    trackPage(h || '');
  }
  window.addEventListener('hashchange', function () { if (location.hash === '#main') return; route(); });
  /* ссылка «К содержимому»: фокус на начало контента без смены маршрута (иначе роутер перерисовал бы хаб и сбросил раздел) */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a.skip'); if (!a) return;
    e.preventDefault(); var m = document.getElementById('main'); if (m) { m.setAttribute('tabindex', '-1'); m.focus(); m.scrollIntoView(); }
  });
  function viewNotFound(h) {
    return topbar([{ label: T('Хаб'), href: '#/' }, { label: T('Страница не найдена') }]) +
      '<div class="kicker">404</div><h1>' + T('Страница не найдена') + '</h1><p class="lede">' + T('Такого адреса нет:') + ' <code>#/' + esc(h) + '</code></p>' +
      '<div class="actions"><a class="btn" href="#/">' + T('На хаб') + '</a></div>';
  }

  function crumbs(items) {
    var out = [];
    items.forEach(function (it, i) {
      if (i) out.push('<span class="sep">/</span>');
      out.push(it.href ? '<a href="' + it.href + '">' + esc(it.label) + '</a>' : '<b>' + esc(it.label) + '</b>');
    });
    return '<div class="crumbs">' + out.join('') + '</div>';
  }
  /* Обратная связь: кнопка в углу на каждой странице. Свободный текст — на случай, когда дело не в конкретном
     вопросе: съехала вёрстка, не играет аудио, опечатка в диалоге, предложение. Вместе с текстом уходит адрес
     страницы и строка браузера — без них «у меня не открывается» невозможно разобрать. */
  // ссылка на страницу «Какие данные мы собираем» (docs/privacy/) — только там, где сайт опубликован; в автономном dist её нет
  function privacyLink() {
    return KZ.site && KZ.site.siteUrl && KZ.site.build !== 'inline' ? ' <a href="' + esc(KZ.site.siteUrl) + 'privacy/" target="_blank" rel="noopener">' + T('Какие данные мы собираем') + '</a>' : '';
  }
  var fbCtx = null;   // если форму открыли из жалобы на вопрос — сюда кладётся его контекст
  function feedbackWidget() {
    if (!(KZ.site && KZ.site.eventsUrl)) return '';
    return '<div class="fb" id="fb">' +
      '<button class="btn small fb-tab" data-act="fb-open">' + T('Сообщить об ошибке') + '</button>' +
      '<div class="fb-panel" hidden>' +
        '<div class="row spread"><b>' + T('Ошибка или предложение') + '</b>' +
        '<button class="btn ghost small" data-act="fb-close" aria-label="' + T('Закрыть') + '">✕</button></div>' +
        '<p class="small muted" id="fb-ctx"></p>' +
        '<textarea id="fb-text" rows="4" placeholder="' + T('Что не так или что улучшить? Чем конкретнее, тем быстрее починим.') + '"></textarea>' +
        '<div class="actions"><button class="btn small" data-act="fb-send">' + T('Отправить') + '</button>' +
        '<span class="hint" id="fb-msg" role="status"></span></div>' +
        '<p class="small muted">' + T('Отправляется текст, адрес страницы и название браузера. Имени и почты не спрашиваем — ответить не сможем, но прочитаем всё.') + privacyLink() + '</p>' +
      '</div></div>';
  }
  function topbar(items, right) {
    return '<a class="skip" href="#main">' + T('К содержимому') + '</a><div class="topbar"><nav aria-label="' + T('Навигация') + '">' + crumbs(items) + '</nav><div class="row">' + (right || '') + uiButtons() + '</div></div>' + uiPanel() + feedbackWidget() + '<div id="main"></div>';
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
          '<span><div class="nm">' + esc(LK(KZ.levels[lv], 'name')) + (tests.length > 1 ? ' <span class="muted small">· ' + tests.length + ' ' + plural(tests.length, T('вариант'), T('варианта'), T('вариантов')) + '</span>' : '') + '</div><div class="dsc">' + esc(t ? LK(t, 'summary') : '') + '</div></span>' +
          '<span class="st">' + chips + '<span class="badge ' + st.cls + '">' + st.label + '</span></span></a>';
      }).join('');
      return '<div class="exam-card-wrap"><a class="exam-card" href="#/exam/' + eid + '">' +
        '<div class="row spread"><span class="badge exam">' + esc(ex.kicker) + '</span>' +
        (ex.verified ? '<span class="badge ok">' + T('структура подтверждена') + '</span>' : '<span class="badge warn">' + T('структура не подтверждена') + '</span>') + '</div>' +
        '<div class="name">' + esc(ex.name) + '</div><p class="tag">' + esc(LK(ex, 'tagline')) + '</p></a>' +
        '<div class="levels" style="margin-top:10px">' + rows + '</div></div>';
    }).join('');

    return topbar([{ label: T('Хаб') }], '<a class="btn ghost small" href="#/progress">' + T('Мой прогресс') + '</a>') +
      '<div class="kicker">' + T('Qazaq trainer · тренажёр') + '</div>' +
      '<h1>' + T('Подготовка к государственным экзаменам по казахскому языку') + '</h1>' +
      '<p class="lede">' + T('Два экзамена, уровни от A1 до C2, по несколько вариантов мок-теста на каждый уровень. Результаты по разделам сохраняются в этом браузере; для переноса на другое устройство есть экспорт.') + '</p>' +
      courseCards() +
      '<section><div class="kicker" style="margin-bottom:8px">' + T('Экзамены') + '</div><h2>' + T('Мок-тесты по уровням') + '</h2><p class="sub">' + T('Варианты мок-теста на каждую пару «экзамен × уровень», формат и хронометраж — по официальным документам.') + '</p><div class="grid2">' + cards + '</div></section>' +
      '<section><div class="kicker" style="margin-bottom:8px">' + T('Шкала') + '</div><h2>' + T('Как отличаются уровни в тренажёре') + '</h2>' +
      '<p class="sub">' + T('Объём лексики — по методике ҚАЗТЕСТ (testcenter.kz). Остальное — рабочие критерии дифференциации заданий, а не официальные требования.') + '</p>' +
      '<div class="ladder">' + KZ.levelOrder.map(function (lv) { var L = KZ.levels[lv]; return '<div class="rung"><div class="rung-head"><span class="rung-level">' + lv + '</span><span><span class="rung-name">' + esc(LK(L, 'name')) + '</span><span class="rung-units">' + esc(LK(L, 'units')) + '</span></span></div><p class="rung-focus">' + esc(LK(L, 'focus')) + '</p></div>'; }).join('') + '</div></section>' +
      '<footer><p><a href="#/sources">' + T('Литература и источники') + '</a>' + (KZ.site && KZ.site.feedbackTelegram ? ' · <a href="https://t.me/' + esc(KZ.site.feedbackTelegram) + '" target="_blank" rel="noopener">' + T('Написать в Telegram') + '</a>' : '') + remindCta('footer') + (KZ.site && KZ.site.supportEmail ? ' · ' + T('Почта:') + ' <a href="mailto:' + esc(KZ.site.supportEmail) + '">' + esc(KZ.site.supportEmail) + '</a>' : '') + (KZ.site && KZ.site.siteUrl && location.protocol !== 'https:' && location.hostname !== 'localhost' ? ' · <a href="' + esc(KZ.site.siteUrl) + '" target="_blank" rel="noopener">' + T('Открыть сайт отдельной вкладкой') + '</a>' : '') + '</p>' + T('Форматы заданий везде — рабочая реконструкция по опубликованной структуре тестов, а не копия реального интерфейса. Подтверждённые и неподтверждённые факты помечены на странице каждого экзамена.') + '<p class="small muted">' + T('Qazaq Trainer — независимый тренажёр. Он не связан с Национальным центром тестирования и организаторами ҚАЗТЕСТ и QazResmiTest; названия экзаменов указаны только для того, чтобы описать, к чему готовят задания.') + '</p>' + (KZ.site && (KZ.site.eventsUrl || KZ.site.analyticsSnippet) ? '<p class="small muted">' + T('Мы считаем обезличенную статистику: какие разделы открывают и какие ответы выбирают. Без cookies, без регистрации, без личных данных — ответы нужны, чтобы находить неудачные вопросы и чинить их.') + privacyLink() + '</p>' : '') + '</footer>';
  }
  function courseCards() {
    if (!KZ.courses) return '';
    var keys = Object.keys(KZ.courses); if (!keys.length) return '';
    return '<section><div class="kicker" style="margin-bottom:8px">' + T('Курс') + '</div><h2>' + T('Учебная программа по уровням') + '</h2><p class="sub">' + T('Программа построена на нашей методологии, разработанной с опорой на официальный лексический минимум ҰТО и типовые учебники уровней; по каждой теме — карточки слов, грамматика с заданиями, тексты с вопросами и итоговый тест.') + '</p><div class="grid2">' + keys.map(function (k) {
      var c = KZ.courses[k], pr = KZ.courseProgress ? KZ.courseProgress(c) : null;
      return '<a class="exam-card" href="#/course/' + k + '"><div class="row spread"><span class="badge level">' + k + '</span>' + (pr ? '<span class="badge ' + (pr.done ? 'ok' : 'muted') + '">' + pr.done + ' / ' + pr.topics + ' ' + T('тем') + '</span>' : '') + '</div><div class="name">' + esc(c.title) + ' · ' + esc(c.kk) + '</div><p class="tag">' + c.topics.length + ' ' + T('тем') + ' · ' + (c.stats.uniqueWords || c.stats.words) + ' ' + T('слов') + (c.coverage ? ' (' + LK(c, 'coverage') + ')' : '') + ' · ' + c.stats.grammar + ' ' + plural(c.stats.grammar, T('грамматическая тема'), T('грамматические темы'), T('грамматических тем')) + ' · ' + c.stats.texts + ' ' + T('текстов') + (c.stats.textsWithQuestions != null ? ', ' + T('с вопросами') + ' ' + c.stats.textsWithQuestions : '') + (pr && pr.known ? ' · ' + T('выучено') + ' ' + pr.known : '') + '</p></a>';
    }).join('') + '</div></section>';
  }
  function ioPanel() {
    return '<div class="block io"><h3>' + T('Экспорт и импорт прогресса') + '</h3>' +
      '<p class="small muted">' + T('Скопируйте JSON и сохраните где удобно; на другом устройстве вставьте его в поле и нажмите «Импортировать». Импорт заменяет текущий прогресс.') + '</p>' +
      '<textarea id="io-text">' + esc(JSON.stringify(state)) + '</textarea>' +
      '<div class="actions"><button class="btn small" data-act="io-copy">' + T('Скопировать') + '</button><button class="btn secondary small" data-act="io-import">' + T('Импортировать из поля') + '</button><button class="btn danger small" data-act="io-reset">' + T('Сбросить весь прогресс') + '</button><span class="hint" id="io-msg" role="status" aria-live="polite"></span></div></div>';
  }

  /* ---------------- views: exam ---------------- */
  function viewExam(ex) {
    var stages = ex.sections.map(function (s) {
      return '<div class="stage' + (s.hypothetical ? ' locked' : '') + '"><div class="stage-num">' + s.num + '</div><div><p class="stage-name">' + esc(KZ.lang === 'kk' ? s.kk : s.title) + (KZ.lang === 'kk' ? '' : ' <span class="muted small">' + esc(s.kk) + '</span>') + (s.hypothetical ? ' <span class="badge warn">' + T('гипотеза') + '</span>' : '') + '</p><p class="stage-desc">' + esc(LK(s, 'desc')) + '</p>' + tipsInline(s) + '</div>' +
        '<div class="stage-meta"><div class="stage-time">' + (s.minutes == null ? '—' : esc(s.minutes) + ' ' + T('мин')) + '</div><div class="stage-tasks">' + esc(LK(s, 'tasks')) + '</div></div></div>';
    }).join('');
    var levels = (ex.examLevels || KZ.levelOrder).map(function (lv) {
      var tests = testsFor(ex.id, lv);
      return tests.map(function (t) {
        var st = testStatus(t);
        var href = t.status === 'draft' ? '#/exam/' + ex.id : '#/test/' + t.id;
        return '<a class="level-row' + (t.status === 'draft' ? ' draft' : '') + '" href="' + href + '"><span class="lvl">' + lv + '</span><span><div class="nm">' + esc(LK(t, 'title')) + ' · ' + esc(LK(KZ.levels[lv], 'name')) + '</div><div class="dsc">' + esc(LK(t, 'summary')) + '</div></span><span class="st"><span class="badge ' + st.cls + '">' + st.label + '</span></span></a>';
      }).join('');
    }).join('');
    return topbar([{ label: T('Хаб'), href: '#/' }, { label: ex.short }]) +
      '<div class="kicker">' + esc(ex.kicker) + '</div><h1>' + esc(ex.name) + '</h1><p class="lede">' + esc(LK(ex, 'tagline')) + '</p>' +
      '<div class="notice ' + (ex.verified ? 'good' : '') + '"><b class="t">' + (ex.verified ? T('Подтверждено') : T('Не подтверждено')) + '</b><p>' + esc(LK(ex, 'verifiedNote')) + '</p></div>' +
      '<section><h2>' + T('Структура теста') + '</h2><p class="sub">' + (ex.verified ? T('По официальному описанию.') : T('Рабочая гипотеза по вторичным источникам — звёздочкой помечены цифры, требующие сверки.')) + '</p>' +
      '<div class="stages">' + stages + (ex.totalMinutes ? '<div class="stages-total"><span>' + T('Итого') + '</span><b>' + ex.totalMinutes + ' ' + T('минут') + ' · ' + ex.sections.length + ' ' + (ex.sections.length === 4 ? T('блока') : T('разделов')) + (ex.totalTasks ? ' · ' + ex.totalTasks + ' ' + T('задания') : '') + '</b></div>' : '') + '</div>' +
      (ex.mockNote ? '<p class="small muted mt">' + esc(LK(ex, 'mockNote')) + '</p>' : '') + '</section>' +
      (ex.scoring ? scoringTable(ex) : '') +
      ('<section><h2>' + T('Что официально не опубликовано') + '</h2><div class="notice"><b class="t">' + T('Рабочая реконструкция') + '</b><ul>' + ((KZ.lang === 'kk' && ex.unverified_kk) || ex.unverified).map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul></div></section>') +
      '<section><h2>' + T('Мок-тесты') + '</h2><div class="levels">' + levels + '</div></section>' +
      '<footer>' + T('Источники:') + '<ul class="srclist">' + ex.sources.map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(LK(s, 'title')) + '</a></li>'; }).join('') + '</ul></footer>';
  }

  /* ---------------- views: test ---------------- */
  /* Объём раздела на странице теста: у разделов с вопросами показываем, сколько их в этом моке, а официальный объём
     экзамена — справкой. Раньше показывался только официальный («20 заданий · 20 баллов»), и мок из 5 вопросов
     выглядел недогрузившимся. */
  function stageTasks(s, es) {
    var official = LK(es, 'tasks') || '';
    if (!s.questions) return esc(official);
    var n = s.questions.length;
    var mine = n + ' ' + T('заданий') + (s.pointsPerTask ? ' · ' + n * s.pointsPerTask + ' ' + T('баллов') : '');
    return esc(mine) + (official && official.indexOf(String(n) + ' ') !== 0 ? '<br><span class="muted">' + T('на экзамене:') + ' ' + esc(official) + '</span>' : '');
  }
  function viewTest(t) {
    var ex = KZ.exams[t.exam];
    var st = testStatus(t);
    var stages = t.sections.map(function (s, i) {
      var es = examSection(ex, s.type) || {};
      var r = sectionResult(t.id, s);
      var meta = es.num || ('0' + (i + 1));
      return '<a class="stage" href="#/test/' + t.id + '/' + s.type + '"><div class="stage-num">' + meta + '</div><div><p class="stage-name">' + esc((KZ.lang === 'kk' && es.kk) || es.title || LK(KZ.sectionTypes[s.type], 'label')) + '</p><p class="stage-desc">' + esc(LK(s, 'intro')).slice(0, 140) + '…</p></div>' +
        '<div class="stage-meta"><div class="stage-time">' + s.minutes + ' ' + T('мин') + '</div><div class="stage-tasks">' + stageTasks(s, es) + '</div>' +
        (r ? '<div class="stage-score ' + r.cls + '">' + esc(r.label) + '</div>' : '<div class="stage-score muted">' + T('не пройден') + '</div>') + '</div></a>';
    }).join('');
    var total = t.sections.reduce(function (a, s) { return a + (s.minutes || 0); }, 0);
    return topbar([{ label: T('Хаб'), href: '#/' }, { label: ex.short, href: '#/exam/' + ex.id }, { label: t.level + ' · ' + LK(t, 'title') }],
        '<span class="badge level">' + t.level + '</span><span class="badge ' + st.cls + '">' + st.label + '</span>') +
      '<div class="kicker">' + esc(ex.kicker) + ' · ' + T('уровень') + ' ' + t.level + '</div><h1>' + esc(LK(t, 'title')) + ' — ' + esc(LK(KZ.levels[t.level], 'name')) + '</h1>' +
      '<p class="lede">' + esc(LK(t, 'summary')) + ' ' + T('Разделы можно проходить по порядку, как на экзамене, или по одному. Ответы фиксируются один раз, после этого открывается разбор.') + '</p>' +
      verdictCard(t) +
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
      if (saved && saved.status === 'draft') { run.phase = 'run'; run.resume = true; if (saved.answers) run.answers = Object.assign({}, saved.answers); if (saved.playsUsed != null) run.playsUsed = saved.playsUsed; }
    }
    var head = topbar([{ label: T('Хаб'), href: '#/' }, { label: ex.short, href: '#/exam/' + ex.id }, { label: t.level + ' · ' + LK(t, 'title'), href: '#/test/' + t.id }, { label: (KZ.lang === 'kk' && es.kk) || es.title || type }],
      '<span class="badge level">' + t.level + '</span>' + sectionDots(t, type));
    var title = '<div class="kicker">' + T('Раздел') + ' ' + (es.num || '') + ' · ' + es.kk + '</div><h1>' + esc((KZ.lang === 'kk' && es.kk) || es.title || LK(KZ.sectionTypes[type], 'label')) + '</h1>' +
      '<p class="lede' + (run.phase === 'ready' ? '' : ' hintx') + '">' + esc(LK(sec, 'intro')) + '</p>';
    title += timeUpNotice();
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
    var tasks = sec.tasks ? '<ol class="prompt-list mt">' + sec.tasks.map(function (x) { return '<li><span><b>' + esc(LK(x, 'title')) + '</b><br><span class="small muted">' + (x.minutes ? '~' + x.minutes + ' ' + T('мин') + ' · ' : '') + x.points + ' ' + T('баллов') + (x.minWords ? ' · ' + T('от') + ' ' + x.minWords + ' ' + T('слов') : '') + (x.questions ? ' · ' + x.questions.length + ' ' + T('вопросов') : '') + '</span></span></li>'; }).join('') + '</ol>' : '';
    return '<div class="block"><div class="row spread"><div><span class="badge exam">' + sec.minutes + ' ' + T('мин') + '</span> <span class="badge muted">' + n + '</span>' + (pts ? ' <span class="badge muted">' + pts + ' ' + T('баллов') + '</span>' : '') + '</div></div>' + tasks +
      '<p class="small muted mt">' + T('Задания созданы нашими специалистами по официальной структуре теста.') + '</p>' +
      (sec.checkNote ? '<div class="notice mt" style="margin-bottom:0"><b class="t">' + T('Орфография') + '</b><p>' + esc(LK(sec, 'checkNote')) + '</p></div>' : '') +
      '<div class="actions"><button class="btn" data-act="start">' + T('Начать раздел — таймер') + ' ' + sec.minutes + ' ' + T('мин') + '</button><span class="hint">' + (KZ.exams[t.exam].verified ? T('Структура по официальным документам; конкретные тексты — тренировочные.') : T('Формат заданий — рабочая реконструкция.')) + '</span></div></div>' +
      tipsBlock(es);
  }
  function tipsInline(es) {
    if (!tipsOf(es) || !tipsOf(es).length) return '';
    return '<p class="tip"><span class="tip-tag">' + T('по опыту сдававших') + '</span>' + esc(tipsOf(es)[0]) + (tipsOf(es).length > 1 ? ' <span class="muted">(+' + (tipsOf(es).length - 1) + ')</span>' : '') + '</p>';
  }
  function tipsBlock(es) {
    if (!tipsOf(es) || !tipsOf(es).length) return '';
    return '<div class="notice info hintx"><b class="t">' + T('По опыту сдававших') + '</b><ul>' + tipsOf(es).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul><p class="small muted" style="margin-top:8px">' + esc((KZ.lang === 'kk' && KZ.tipsSource_kk) || KZ.tipsSource) + '</p></div>';
  }
  function scoringTable(ex) {
    var sc = ex.scoring;
    var head = '<tr><th>' + T('Блок') + '</th><th>' + T('Макс.') + '</th>' + sc.levels.map(function (l, i) { return '<th>' + l + '<br><span class="muted">' + sc.pct[i] + ' %</span></th>'; }).join('') + '</tr>';
    var rows = sc.blocks.map(function (b) { return '<tr><td>' + esc(b.title) + '</td><td>' + b.max + '</td>' + b.min.map(function (m) { return '<td>' + m + '</td>'; }).join('') + '</tr>'; }).join('');
    return '<section><h2>' + T('Баллы и пороги уровней') + '</h2><p class="sub">' + esc(LK(sc, 'note')) + '</p><div class="tablewrap"><table class="scoring"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
      (ex.certificateNote ? '<p class="small muted mt">' + esc(LK(ex, 'certificateNote')) + '</p>' : '') + '</section>';
  }
  function timerBar(sec, extra) {
    return '<div class="timerbar"><span class="lbl">' + esc(LK(KZ.sectionTypes[sec.type], 'label')) + ' · ' + T('лимит') + ' ' + sec.minutes + ' ' + T('мин') + (ui.practice ? ' · ' + T('тренировка') : '') + '</span><div class="right">' + (extra || '') + '<span id="clock" class="clock">' + mmss(sec.minutes * 60) + '</span></div></div>';
  }

  /* --- вопросы с выбором (общие для listening / lexis / reading) --- */
  /* Жалоба на вопрос: показывается в разборе, отправляется тем же маяком, что и статистика.
     Ни почты, ни модерации — в базе сразу видно, на какие вопросы жалуются и на что именно. */
  var REASONS = [
    { id: 'key', label: 'Неверный правильный ответ' },
    { id: 'ambiguous', label: 'Подходят два варианта' },
    { id: 'typo', label: 'Опечатка в тексте' },
    { id: 'unclear', label: 'Непонятно, что спрашивают' },
    { id: 'other', label: 'Другое' }
  ];
  function reportBox(ctx, q, chosen) {
    if (!ctx || !(KZ.site && KZ.site.eventsUrl)) return '';   // приёмник не настроен — кнопку не показываем
    return '<div class="report" data-test="' + esc(ctx.test) + '" data-section="' + esc(ctx.section) + '" data-qid="' + esc(q.id) + '"' +
      ' data-a="' + (chosen == null ? -1 : (q._perm ? q._perm[chosen] : chosen)) + '" data-ok="' + (chosen === q.answer ? 1 : 0) + '">' +
      '<button class="btn ghost small" data-act="report-open">' + T('Сообщить об ошибке') + '</button>' +
      '<span class="rep-why" hidden><span class="small muted">' + T('Что не так?') + '</span> ' +
      REASONS.map(function (r) { return '<button class="cb" data-act="report-send" data-why="' + r.id + '">' + T(r.label) + '</button>'; }).join(' ') +
      '</span></div>';
  }
  function renderQuestions(sec, answers, locked, startNum, ctx) {
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
      if (locked) html += '<div class="explain' + (chosen === q.answer ? '' : ' bad') + '"><b>' + letter(q.answer) + '.</b> ' + esc(LK(q, 'explain')) + '</div>' + reportBox(ctx, q, chosen);
      return html + '</div>';
    }).join('');
  }
  function runQuiz(t, sec, es) {
    var body = '';
    if (sec.passage) {
      body += '<div class="block"><div class="passage-title">Мәтін · ' + esc(sec.passage.title) + '</div><div class="passage">' + sec.passage.paragraphs.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div></div>';  // passage.note — служебная пометка о калибровке, в интерфейс не выводится
    }
    body += '<div class="block"><span class="setlabel">' + T('Задания') + '</span>' + renderQuestions(sec, run.answers, false) +
      '<div class="actions"><button class="btn" data-act="submit">' + T('Зафиксировать ответы') + '</button><span class="hint" id="submit-msg" role="status" aria-live="polite"></span></div></div>';
    run.afterRender = function () { quizTimer(t, sec); };
    return timerBar(sec) + body;
  }
  /* черновик раздела с выбором ответов: ответы и момент старта таймера переживают перезагрузку и уход со страницы */
  function quizDraft() {
    if (!run || run.phase !== 'run' || !timer.start) return;
    var t = findTest(run.testId), sec = null; if (t) t.sections.forEach(function (s) { if (s.type === run.type) sec = s; });
    if (!sec || !sec.questions) return;
    setSection(run.testId, run.type, { status: 'draft', answers: run.answers, startedAt: timer.start, playsUsed: run.playsUsed || 0 });
  }
  function quizTimer(t, sec) {
    if (timer.iv) { tick(); return; }
    startTimer(sec.minutes * 60);
    var d = sp(t.id, sec.type);
    if (run.resume && d && d.startedAt) { timer.start = d.startedAt; tick(); } else quizDraft();
  }
  function runListening(t, sec, es) {
    var plays = sec.plays || Infinity; // повтор не ограничен, пока идёт время раздела (ҚАЗТЕСТ: «мәтін бірнеше рет тыңдалады»; QRT: видео в пределах 10 минут)
    if (run.playsUsed == null) run.playsUsed = 0;
    var voice = kkVoice(), left = plays - run.playsUsed;
    var head;
    var au = KZ.audio && KZ.audio[t.id];
    if (au) {
      head = '<div class="block player"><span class="setlabel">' + T('Аудио') + ' · ' + esc(sec.script.title) + '</span>' +
        '<div class="row"><button class="btn" data-act="au-play"' + (left <= 0 || run.playing ? ' disabled' : '') + '>▶ ' + (run.playing ? T('Звучит…') : T('Воспроизвести')) + '</button>' +
        '<button class="btn ghost small" data-act="au-pause" id="au-pause"' + (run.playing ? '' : ' hidden') + '>⏸ ' + T('Пауза') + '</button>' +
        '<span class="hint" id="tts-msg" role="status" aria-live="polite">' + (left > 0 ? (plays === Infinity ? T('повтор доступен, пока идёт время раздела') : T('прослушиваний осталось:') + ' ' + left + ' ' + T('из') + ' ' + plays) : T('прослушивания исчерпаны — зафиксируйте ответы')) + ' · ' + mmss(au.seconds) + ' · ' + (/[,\/+]/.test(String(au.voices)) ? T('голоса') : T('голос:')) + ' ' + esc(au.voices) + '</span></div>' +
        '<div class="aubar" aria-hidden="true"><i id="aubar"></i></div><audio id="au" preload="auto" src="' + au.src + '"></audio>' + transcriptBlock(sec) +
        '<p class="small muted mt hintx">' + T('Текст скрыт, как на экзамене: читайте вопросы и отмечайте ответы по ходу звучания. Паузу поставить можно, перемотки нет; прослушивание засчитывается, когда запись дозвучала до конца.') + (plays === Infinity ? ' ' + T('Повторять запись можно, пока идёт время раздела.') : plays > 1 ? ' ' + T('Прослушиваний:') + ' ' + plays + '.' : ' ' + T('Запись звучит один раз.')) + '</p></div>';
    } else if (voice) {
      head = '<div class="block player"><span class="setlabel">' + T('Аудио') + ' · ' + esc(sec.script.title) + '</span>' +
        '<div class="row"><button class="btn" data-act="tts"' + (left <= 0 || run.playing ? ' disabled' : '') + '>▶ ' + (run.playing ? T('Звучит…') : T('Воспроизвести')) + '</button>' +
        (run.playing ? '<button class="btn ghost small" data-act="tts-pause">' + (window.speechSynthesis && speechSynthesis.paused ? '▶ ' + T('Продолжить') : '⏸ ' + T('Пауза')) + '</button><button class="btn ghost small" data-act="tts-stop">■ ' + T('Остановить') + '</button>' : '') +
        '<span class="hint" id="tts-msg" role="status" aria-live="polite">' + (left > 0 ? (plays === Infinity ? T('повтор доступен, пока идёт время раздела') : T('прослушиваний осталось:') + ' ' + left + ' ' + T('из') + ' ' + plays) : T('прослушивания исчерпаны — зафиксируйте ответы')) + ' · ' + T('голос:') + ' ' + esc(voice.name) + '</span></div>' +
        transcriptBlock(sec) +
        (kkVoices().length > 1 ? '<div class="row mt small"><span class="muted">' + T('Голос:') + '</span>' + kkVoices().map(function (v) { return '<button class="cb' + (v === voice ? ' on' : '') + '" data-act="voice" data-name="' + esc(v.name) + '">' + esc(v.name.replace(/Microsoft |Online |\(Natural\)| - Kazakh.*$/g, '').trim()) + '</button>'; }).join('') + '</div>' : '') +
        '<p class="small muted mt hintx">' + T('Текст скрыт, как на экзамене. Читайте вопросы во время звучания и отмечайте ответы сразу.') + (plays === Infinity ? ' ' + T('Повторять запись можно, пока идёт время раздела.') : plays > 1 ? ' ' + T('Прослушиваний:') + ' ' + plays + '.' : ' ' + T('Запись звучит один раз.')) + '</p></div>';
    } else {
      head = '<div class="notice"><b class="t">' + T('Казахский голос не найден') + '</b><p>' + T('В этом браузере нет голоса для казахского языка, кнопка воспроизведения отключена. Бесплатно работает в') + ' <b>Microsoft Edge</b> ' + T('(голоса Aigul и Daulet, Windows и macOS): откройте эту же ссылку в Edge.') + (isEdge ? ' ' + T('Похоже, это Edge — подождите пару секунд, голоса подгружаются, или проверьте, что в системе включён «Kazakh» в языках речи.') : '') + '</p>' +
        '<p>' + T('Запасной режим без голоса: текст покажется на') + ' ' + (sec.script.readSeconds || 90) + ' ' + T('секунд, читайте его вслух в темпе диктора и отвечайте по ходу — это слабая замена, но лучше, чем запоминать текст целиком.') + '</p>' +
        '<div class="actions"><button class="btn secondary small" data-act="show-script"' + (left <= 0 || run.scriptVisible ? ' disabled' : '') + '>' + T('Показать текст на') + ' ' + (sec.script.readSeconds || 90) + ' ' + T('с') + '</button><span class="hint" role="status">' + (plays === Infinity ? T('повтор доступен, пока идёт время раздела') : T('показов осталось:') + ' ' + left + ' ' + T('из') + ' ' + plays) + '</span></div></div>' +
        (run.scriptVisible ? '<div class="block"><span class="setlabel">' + T('Скрипт') + ' · <span id="script-left"></span></span><div class="script">' + esc(sec.script.text) + '</div></div>' : '');
    }
    var body = '<div class="block"><span class="setlabel">' + T('Задания') + '</span>' + renderQuestions(sec, run.answers, false) +
      '<div class="actions"><button class="btn" data-act="submit">' + T('Зафиксировать ответы') + '</button><span class="hint" id="submit-msg" role="status" aria-live="polite"></span></div></div>';
    run.afterRender = function () { quizTimer(t, sec); };
    return timerBar(sec) + head + body;
  }
  function transcriptBlock(sec) {
    return '<div class="row mt"><button class="btn ghost small" data-act="ui-transcript" data-v="' + (!ui.transcript) + '" aria-pressed="' + (!!ui.transcript) + '">' + (ui.transcript ? T('Скрыть транскрипт') : T('Показать транскрипт (для слабослышащих)')) + '</button></div>' +
      (ui.transcript ? '<div class="script" lang="kk" aria-live="off">' + esc(sec.script.text) + '</div>' : '');
  }
  function playAudio(t, sec, btn) {
    var plays = sec.plays || Infinity; // повтор не ограничен, пока идёт время раздела (ҚАЗТЕСТ: «мәтін бірнеше рет тыңдалады»; QRT: видео в пределах 10 минут)
    if (run.playsUsed >= plays || run.playing) return;
    var a = document.getElementById('au'); if (!a) return;
    run.playing = true; btn.disabled = true; btn.textContent = '▶ ' + T('Звучит…');
    var pb = document.getElementById('au-pause'); if (pb) { pb.hidden = false; pb.textContent = '⏸ ' + T('Пауза'); }
    a.currentTime = 0;
    a.ontimeupdate = function () { var bar = document.getElementById('aubar'); if (bar && a.duration) bar.style.width = (100 * a.currentTime / a.duration) + '%'; };
    var finished = false;
    function finish() { if (finished) return; finished = true; run.playing = false; run.playsUsed++; quizDraft(); route(); }
    a.onended = finish;
    a.onpause = function () { if (!finished && a.duration && a.currentTime >= a.duration - 0.75) finish(); };
    a.onerror = function () { run.playing = false; var m = document.getElementById('tts-msg'); if (m) m.textContent = T('Не удалось воспроизвести аудио.'); btn.disabled = false; btn.textContent = '▶ ' + T('Воспроизвести'); };
    var pr = a.play(); if (pr && pr.catch) pr.catch(function (e) {
      run.playing = false; btn.disabled = false; btn.textContent = '▶ ' + T('Воспроизвести');
      if (!run.audioRetried) { // вторая попытка с абсолютным адресом и явной загрузкой (Safari иногда отвечает NotSupportedError на первый play())
        run.audioRetried = true; try { a.src = new URL(a.getAttribute('src'), location.href).href; a.load(); } catch (x) {}
        setTimeout(function () { playAudio(t, sec, btn); }, 400); return;
      }
      var m = document.getElementById('tts-msg'); if (m) m.innerHTML = esc((e && e.name === 'NotSupportedError') || (a.error && a.error.code === 4) ? T('Аудиофайл не найден или не поддерживается браузером.') : T('Браузер заблокировал воспроизведение:') + ' ' + (e && e.name ? e.name : e)) + ' <a href="' + esc(a.currentSrc || a.src) + '" target="_blank" rel="noopener">' + T('Открыть аудио отдельной вкладкой') + '</a>';
    });
  }
  function playScript(t, sec) {
    var plays = sec.plays || Infinity; // повтор не ограничен, пока идёт время раздела (ҚАЗТЕСТ: «мәтін бірнеше рет тыңдалады»; QRT: видео в пределах 10 минут)
    if (run.playsUsed >= plays || run.playing) return;
    run.playing = true;
    var ok = speak(sec.script.text, function () { run.playing = false; run.playsUsed++; route(); });
    if (!ok) { run.playing = false; route(); return; }
    route();
  }
  function showScriptTimed(t, sec) {
    var plays = sec.plays || Infinity; // повтор не ограничен, пока идёт время раздела (ҚАЗТЕСТ: «мәтін бірнеше рет тыңдалады»; QRT: видео в пределах 10 минут)
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
    setSection(t.id, sec.type, { status: 'done', score: score, total: sec.questions.length, answers: run.answers, secondsUsed: Math.round(elapsed()), finishedAt: Date.now(), practice: !!ui.practice, startedAt: undefined });
    /* подробность по вопросам — ради неё всё и затевалось: видно, какой дистрактор выбирают и какой не выбирает никто */
    sendEvent('answers', { test: t.id, section: sec.type, level: t.level, exam: t.exam,
      q: sec.questions.map(function (q) {
        var a = run.answers[q.id];
        return { id: q.id, a: a == null ? -1 : (q._perm ? q._perm[a] : a), ok: a === q.answer ? 1 : 0 };   // a — индекс в исходных данных, не на экране
      }) });
    run.phase = 'review'; route();
  }

  /* --- письмо --- */
  function runWriting(t, sec, es) {
    if (sec.tasks) return runWritingTasks(t, sec, es);
    var saved = sp(t.id, 'writing') || {};
    if (run.promptId == null) run.promptId = saved.promptId || null;
    if (run.text == null) run.text = saved.text || '';
    if (run.checks == null) run.checks = saved.checks || [];
    if (run.sub === 'script' && run.promptId) run.sub = 'write'; // возврат к черновику: иначе автосохранение (sub === 'write') не работало
    var body = '';
    if (run.sub === 'script' && !run.promptId) {
      body = '<div class="block"><span class="setlabel">' + T('Выберите тему') + '</span><div class="prompt-pick">' + sec.prompts.map(function (p, i) { return '<label class="opt"><input type="radio" name="prompt" value="' + p.id + '"><span class="k">' + (i + 1) + '</span><span>' + esc(p.text) + '</span></label>'; }).join('') + '</div>' +
        '<p class="small muted mt">' + esc(LK(sec, 'targetNote') || '') + '</p><div class="actions"><button class="btn" data-act="pick-prompt">' + T('Начать писать') + '</button><span class="hint" id="submit-msg" role="status" aria-live="polite"></span></div></div>';
      run.afterRender = function () { if (!timer.iv) startTimer(sec.minutes * 60); else tick(); };
      return timerBar(sec) + body;
    }
    var prompt = sec.prompts.filter(function (p) { return p.id === run.promptId; })[0];
    if (run.sub !== 'check') {
      var acc = 0;
      var skel = sec.scaffold.map(function (s) { var from = acc; acc += s.minutes; return '<div class="skel" data-from="' + from * 60 + '" data-to="' + acc * 60 + '"><span class="tag">' + esc(LK(s, 'label')) + '<br>~' + s.minutes + ' ' + T('мин') + '</span><span><b>' + esc(LK(s, 'label')) + '.</b> <span class="hint hintx">' + esc(LK(s, 'hint')) + '</span></span></div>'; }).join('');
      body = '<div class="block"><span class="setlabel">' + T('Тема') + '</span><p style="font-size:16.5px;font-weight:600">' + esc(prompt.text) + '</p>' +
        '<div class="skeleton" id="skel">' + skel + '</div>' +
        '<div class="tags">' + sec.connectors.map(function (c) { return '<span class="tag-chip">' + esc(c) + '</span>'; }).join('') + '</div>' +
        (sec.sample ? '<details class="sample"><summary>' + T('Образец текста (структура, не копируйте)') + '</summary><div lang="kk" class="script">' + esc(sec.sample) + '</div></details>' : '') +
        '<textarea class="essay" id="essay" lang="kk" spellcheck="false" placeholder="Жазыңыз…">' + esc(run.text) + '</textarea><div class="wc" id="wc">' + wordCount(run.text) + ' ' + T('слов') + '</div>' +
        '<div class="actions"><button class="btn" data-act="finish-writing">' + T('Завершить и перейти к самопроверке') + '</button><span class="hint">' + T('Черновик сохраняется автоматически.') + '</span></div></div>';
      run.afterRender = function () {
        var startAt = run.secondsUsed || saved.secondsUsed || 0;
        if (!timer.iv) { startTimer(sec.minutes * 60, updateSkel); timer.start -= startAt * 1000; } else { timer.onTick = updateSkel; tick(); }
      };
      return timerBar(sec) + body;
    }
    body = '<div class="block"><span class="setlabel">' + T('Ваш текст') + '</span><p class="small muted">' + esc(prompt.text) + '</p><div class="essay-view">' + esc(run.text) + '</div><div class="wc">' + wordCount(run.text) + ' ' + T('слов') + ' · ' + mmss(run.secondsUsed || 0) + '</div></div>' +
      '<div class="block"><span class="setlabel">' + T('Самопроверка') + '</span>' + (wordCount(run.text) === 0 ? '<p class="small cap-note">' + T('Текст пустой — чек-лист не засчитывается, результат будет 0.') + '</p>' : '') + '<ul class="checklist">' + checklistOf(sec).map(function (c, i) { return '<li><label><input type="checkbox" data-check="' + i + '"' + (run.checks[i] ? ' checked' : '') + '><span>' + esc(c) + '</span></label></li>'; }).join('') + '</ul>' +
      '<div class="actions"><button class="btn" data-act="save-writing">' + T('Сохранить результат') + '</button>' + (run.timedOut ? '' : '<button class="btn ghost" data-act="back-writing">' + T('Вернуться к тексту') + '</button>') + '</div></div>';
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
      body = '<div class="block"><span class="setlabel">' + T('Выберите комплект') + '</span><div class="prompt-pick">' + sec.sets.map(function (s, i) { return '<label class="opt"><input type="radio" name="set" value="' + s.id + '"' + (i === 0 ? ' checked' : '') + '><span class="k">' + (i + 1) + '</span><span>' + esc(LK(s, 'title')) + (s.main ? ' <span class="badge level">' + T('основной') + '</span>' : '') + '</span></label>'; }).join('') + '</div>' +
        '<div class="actions"><button class="btn" data-act="pick-set">' + T('Начать интервью') + '</button></div></div>';
      run.afterRender = function () { if (!timer.iv) startTimer(sec.minutes * 60); else tick(); };
      return timerBar(sec) + body;
    }
    var set = sec.sets.filter(function (s) { return s.id === run.setId; })[0];
    var totalF = sec.answerFrame.reduce(function (a, f) { return a + f.seconds; }, 0);
    if (run.sub !== 'check') {
      var bar = '<div class="timebar">' + sec.answerFrame.map(function (f) { return '<span style="flex:' + f.seconds + '">~' + f.seconds + T('с') + '</span>'; }).join('') + '</div><div class="timebar-labels">' + sec.answerFrame.map(function (f) { return '<span>' + esc(LK(f, 'label')) + '</span>'; }).join('') + '</div>';
      body = micNotice() + '<div class="block"><span class="setlabel">' + esc(LK(set, 'title')) + '</span><p class="small muted">' + T('Каркас одного ответа (') + mmss(totalF) + '):</p>' + bar +
        '<div class="mt">' + set.questions.map(function (q, i) {
          return '<div class="sq' + (run.qdone[i] ? ' done' : '') + '" id="sq' + i + '"><p class="qt"><span class="qn">' + (i + 1) + '.</span>' + esc(q) + '</p><div class="row">' +
            (run.qdone[i] ? '<span class="badge ok">' + T('отвечен') + ' · ' + mmss(run.qdone[i]) + '</span>' :
              '<button class="btn secondary small" data-act="q-start" data-q="' + i + '">' + T('Старт таймера') + '</button><span class="clock" id="qclock' + i + '"></span><span class="phase" id="qphase' + i + '"></span>') + ' ' + recButton(set.id + '-' + i) + '</div></div>';
        }).join('') + '</div>' +
        '<div class="actions"><button class="btn" data-act="finish-speaking">' + T('Завершить интервью → самопроверка') + '</button><span class="hint">' + T('Записывайте ответы на телефон — переслушать на следующий день.') + '</span></div></div>';
      run.afterRender = function () { if (!timer.iv) startTimer(sec.minutes * 60); else tick(); };
      return timerBar(sec) + body;
    }
    body = '<div class="block"><span class="setlabel">' + esc(LK(set, 'title')) + '</span><ol class="prompt-list">' + set.questions.map(function (q, i) { return '<li><span>' + esc(q) + '<div class="row mt"><span class="rec-slot" data-rec-key="' + esc(recKey(set.id + '-' + i)) + '"></span></div></span></li>'; }).join('') + '</ol></div>' +
      '<div class="block"><span class="setlabel">' + T('Самопроверка') + '</span><ul class="checklist">' + checklistOf(sec).map(function (c, i) { return '<li><label><input type="checkbox" data-check="' + i + '"' + (run.checks[i] ? ' checked' : '') + '><span>' + esc(c) + '</span></label></li>'; }).join('') + '</ul>' +
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
      for (var k = 0; k < frames.length; k++) { acc += frames[k].seconds; if (e < acc) { label = LK(frames[k], 'label'); break; } }
      p.textContent = '→ ' + label;
      run.qElapsed = e;
    }, 250);
  }


  /* ---------- многозадачные разделы (ҚАЗТЕСТ: письмо 2 задания, говорение 2 задания) ---------- */
  function taskTabs(sec, idx) {
    return '<div class="tasktabs">' + sec.tasks.map(function (x, i) { return '<span class="ttab' + (i === idx ? ' now' : i < idx ? ' past' : '') + '">' + (i + 1) + '. ' + esc(x.title.split(' · ')[1] || x.title) + '</span>'; }).join('') + '</div>';
  }
  /* Лимиты самооценки письма по объёму текста. Пустой текст не оценивается; при недоборе слов максимум по критерию
     «Сөздік қорды пайдалануы» ограничивается пропорционально — именно там официальный дескриптор требует объём
     («50 сөзден артық», «шамамен 250 сөз»). Без этого эссе из одного слова можно было оценить на 50/50. */
  function critCaps(task, text) {
    var w = wordCount(text);
    return task.criteria.map(function (c) {
      if (w === 0) return 0;
      if (task.minWords && w < task.minWords && /сөздік қор/i.test(c.name)) return Math.round(c.max * w / task.minWords);
      return c.max;
    });
  }
  function capNote(task, text) {
    var w = wordCount(text);
    if (w === 0) return '<p class="small cap-note">' + T('Текст пустой — оценивать нечего, все критерии — 0.') + '</p>';
    if (task.minWords && w < task.minWords) return '<p class="small cap-note">' + T('В тексте') + ' ' + w + ' ' + T('слов при ориентире') + ' ' + task.minWords + ': ' + T('по критерию «Сөздік қорды пайдалануы» максимум снижен пропорционально объёму.') + '</p>';
    return '';
  }
  function critScorer(taskId, criteria, values, caps) {
    var max = 0, sum = 0;
    var rows = criteria.map(function (c, i) {
      var cap = caps ? caps[i] : c.max;
      if (values[i] != null && values[i] > cap) values[i] = cap;
      max += c.max; if (values[i] != null) sum += values[i];
      var btns = ''; for (var v = 0; v <= c.max; v++) btns += '<button type="button" class="cb' + (values[i] === v ? ' on' : '') + '" data-act="crit" data-task="' + taskId + '" data-i="' + i + '" data-v="' + v + '"' + (v > cap ? ' disabled aria-disabled="true"' : '') + '>' + v + '</button>';
      return '<div class="crit-row"><div class="crit-name"><b>' + esc(c.name) + '</b><span>' + esc(LK(c, 'top')) + '</span></div><div class="crit-btns">' + btns + '</div></div>';
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
      '<rect x="0" y="300" width="640" height="40" fill="#d7d2c8"/>',
    dastarkhan: '<rect width="640" height="340" fill="#efe4d2"/><rect y="238" width="640" height="102" fill="#c9a57a"/><rect y="238" width="640" height="6" fill="#b08a5e"/>' +
      '<rect x="56" y="34" width="200" height="140" rx="4" fill="#b8453a"/><rect x="68" y="46" width="176" height="116" fill="none" stroke="#e8c46a" stroke-width="5"/><path d="M156 62 L196 104 L156 146 L116 104Z" fill="#e8c46a"/><path d="M156 82 L176 104 L156 126 L136 104Z" fill="#7a2a24"/><path d="M92 70 l12 12 -12 12 -12 -12Z M220 70 l12 12 -12 12 -12 -12Z M92 114 l12 12 -12 12 -12 -12Z M220 114 l12 12 -12 12 -12 -12Z" fill="#f2d98f"/>' +
      '<rect x="440" y="36" width="160" height="132" fill="#cfe3ee" stroke="#8b5a2b" stroke-width="6"/><line x1="520" y1="36" x2="520" y2="168" stroke="#8b5a2b" stroke-width="5"/><line x1="440" y1="102" x2="600" y2="102" stroke="#8b5a2b" stroke-width="5"/><circle cx="572" cy="66" r="14" fill="#f2d47a"/>' +
      '<path d="M146 176 Q142 124 170 124 Q198 124 194 176Z" fill="#f4f4f4"/><circle cx="170" cy="152" r="13" fill="#f1c9a5"/><rect x="146" y="170" width="48" height="70" rx="10" fill="#7b5aa6"/>' +
      '<circle cx="270" cy="166" r="12" fill="#f1c9a5"/><path d="M258 163 Q270 148 282 163 Z" fill="#3b2a1a"/><rect x="254" y="180" width="32" height="56" rx="8" fill="#d94f3d"/>' +
      '<path d="M358 176 Q354 124 380 124 Q406 124 402 176Z" fill="#3b2a1a"/><circle cx="380" cy="150" r="13" fill="#f1c9a5"/><rect x="356" y="168" width="48" height="70" rx="10" fill="#3b7dd8"/><ellipse cx="404" cy="196" rx="10" ry="6" fill="#ffffff" stroke="#2b6cb0" stroke-width="2"/>' +
      '<circle cx="480" cy="146" r="17" fill="#f1c9a5"/><path d="M462 144 Q480 122 498 144 Z" fill="#1f1f1f"/><rect x="454" y="165" width="52" height="74" rx="10" fill="#3f8f5a"/>' +
      '<ellipse cx="320" cy="262" rx="200" ry="40" fill="#8b5a2b"/><ellipse cx="320" cy="254" rx="200" ry="40" fill="#f6efe0"/><ellipse cx="320" cy="254" rx="186" ry="33" fill="none" stroke="#c8453a" stroke-width="3" stroke-dasharray="10 6"/>' +
      '<ellipse cx="320" cy="244" rx="26" ry="20" fill="#2f6fb5"/><rect x="310" y="218" width="20" height="8" rx="3" fill="#2f6fb5"/><circle cx="320" cy="215" r="4" fill="#2f6fb5"/><path d="M344 240 q18 -4 20 -16" stroke="#2f6fb5" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M296 236 q-14 2 -12 14" stroke="#2f6fb5" stroke-width="5" fill="none"/><path d="M306 246 q14 8 28 0" stroke="#ffffff" stroke-width="3" fill="none"/>' +
      '<ellipse cx="220" cy="262" rx="34" ry="12" fill="#e9dcc2" stroke="#b08a5e" stroke-width="2"/><circle cx="208" cy="258" r="7" fill="#d9a441"/><circle cx="222" cy="262" r="7" fill="#c98f2e"/><circle cx="234" cy="257" r="7" fill="#d9a441"/><circle cx="216" cy="250" r="7" fill="#e3b457"/>' +
      '<ellipse cx="420" cy="262" rx="12" ry="7" fill="#ffffff" stroke="#2b6cb0" stroke-width="2"/><ellipse cx="460" cy="250" rx="12" ry="7" fill="#ffffff" stroke="#2b6cb0" stroke-width="2"/><ellipse cx="170" cy="244" rx="12" ry="7" fill="#ffffff" stroke="#2b6cb0" stroke-width="2"/><ellipse cx="270" cy="276" rx="12" ry="7" fill="#ffffff" stroke="#2b6cb0" stroke-width="2"/>' +
      '<ellipse cx="380" cy="282" rx="26" ry="9" fill="#e9dcc2" stroke="#b08a5e" stroke-width="2"/><circle cx="370" cy="279" r="6" fill="#d94f3d"/><circle cx="386" cy="281" r="6" fill="#6aa84f"/><circle cx="378" cy="273" r="6" fill="#f0a22c"/>' +
      '<ellipse cx="566" cy="306" rx="34" ry="14" fill="#8a8a8a"/><circle cx="598" cy="296" r="13" fill="#8a8a8a"/><path d="M590 286 l3 -10 6 8Z M604 286 l3 -10 4 10Z" fill="#8a8a8a"/><circle cx="602" cy="295" r="1.8" fill="#222"/><path d="M534 306 q-22 4 -18 -14" stroke="#8a8a8a" stroke-width="6" fill="none" stroke-linecap="round"/>',
    busstop: '<rect width="640" height="340" fill="#dbe6ee"/><rect x="0" y="60" width="110" height="170" fill="#b9c4cf"/><rect x="120" y="30" width="130" height="200" fill="#a7b4c0"/><rect x="470" y="50" width="170" height="180" fill="#b9c4cf"/>' +
      '<path d="M14 80 h20 v22 h-20Z M50 80 h20 v22 h-20Z M14 120 h20 v22 h-20Z M50 120 h20 v22 h-20Z M140 50 h22 v24 h-22Z M180 50 h22 v24 h-22Z M140 94 h22 v24 h-22Z M180 94 h22 v24 h-22Z M140 138 h22 v24 h-22Z M180 138 h22 v24 h-22Z M490 70 h24 v24 h-24Z M530 70 h24 v24 h-24Z M570 70 h24 v24 h-24Z M490 114 h24 v24 h-24Z M530 114 h24 v24 h-24Z M570 114 h24 v24 h-24Z" fill="#f2d98f"/>' +
      '<path d="M0 64 h110 v-6 h-110Z M120 34 h130 v-6 h-130Z M470 54 h170 v-6 h-170Z" fill="#ffffff"/>' +
      '<rect y="226" width="640" height="114" fill="#8d97a0"/><rect y="226" width="640" height="10" fill="#f4f7fa"/><rect y="290" width="640" height="50" fill="#eef3f7"/><path d="M40 262 h60 M160 262 h60 M280 262 h60 M400 262 h60 M520 262 h60" stroke="#f4f7fa" stroke-width="4"/>' +
      '<rect x="20" y="172" width="230" height="84" rx="14" fill="#e8b233"/><rect x="20" y="236" width="230" height="10" fill="#c98f1f"/><rect x="36" y="184" width="40" height="34" rx="4" fill="#cfe3ee"/><rect x="84" y="184" width="40" height="34" rx="4" fill="#cfe3ee"/><rect x="132" y="184" width="40" height="34" rx="4" fill="#cfe3ee"/><rect x="180" y="184" width="40" height="34" rx="4" fill="#cfe3ee"/><rect x="226" y="184" width="18" height="50" rx="3" fill="#cfe3ee"/><rect x="100" y="162" width="70" height="14" rx="3" fill="#333"/><circle cx="64" cy="258" r="16" fill="#333"/><circle cx="64" cy="258" r="6" fill="#999"/><circle cx="206" cy="258" r="16" fill="#333"/><circle cx="206" cy="258" r="6" fill="#999"/><circle cx="246" cy="224" r="5" fill="#fff6c8"/>' +
      '<rect x="320" y="150" width="6" height="140" fill="#5a6570"/><rect x="460" y="150" width="6" height="140" fill="#5a6570"/><rect x="310" y="140" width="166" height="14" rx="3" fill="#3f6f8f"/><rect x="330" y="160" width="126" height="90" fill="#cfe3ee" opacity="0.55"/><rect x="316" y="136" width="154" height="6" rx="3" fill="#ffffff"/><rect x="336" y="258" width="112" height="8" rx="2" fill="#6b4a2b"/><rect x="342" y="266" width="6" height="22" fill="#4a3a2a"/><rect x="436" y="266" width="6" height="22" fill="#4a3a2a"/>' +
      '<rect x="500" y="130" width="5" height="160" fill="#5a6570"/><rect x="488" y="112" width="30" height="30" rx="15" fill="#2f7a5a"/><rect x="495" y="120" width="16" height="11" rx="2" fill="#ffffff"/><circle cx="498" cy="133" r="2" fill="#ffffff"/><circle cx="508" cy="133" r="2" fill="#ffffff"/>' +
      '<circle cx="372" cy="208" r="13" fill="#f1c9a5"/><path d="M358 206 Q372 184 386 206Z" fill="#c8453a"/><rect x="356" y="222" width="32" height="50" rx="8" fill="#7b5aa6"/><rect x="358" y="270" width="12" height="20" fill="#333"/><rect x="374" y="270" width="12" height="20" fill="#333"/><rect x="388" y="238" width="20" height="24" rx="3" fill="#8b5a2b"/>' +
      '<circle cx="428" cy="204" r="13" fill="#f1c9a5"/><rect x="414" y="186" width="28" height="12" rx="4" fill="#333"/><rect x="412" y="218" width="32" height="56" rx="8" fill="#2b4f8f"/><rect x="412" y="226" width="32" height="6" fill="#d94f3d"/><rect x="414" y="272" width="12" height="18" fill="#333"/><rect x="430" y="272" width="12" height="18" fill="#333"/>' +
      '<circle cx="560" cy="232" r="10" fill="#f1c9a5"/><path d="M549 230 Q560 214 571 230Z" fill="#3f8f5a"/><rect x="548" y="242" width="24" height="32" rx="6" fill="#3f8f5a"/><rect x="550" y="272" width="9" height="16" fill="#333"/><rect x="561" y="272" width="9" height="16" fill="#333"/><rect x="578" y="286" width="44" height="6" rx="3" fill="#c8453a"/><path d="M572 256 L584 284" stroke="#6b4a2b" stroke-width="3"/>' +
      '<g fill="#ffffff"><circle cx="40" cy="30" r="3"/><circle cx="90" cy="20" r="2.5"/><circle cx="280" cy="40" r="3"/><circle cx="330" cy="90" r="2.5"/><circle cx="400" cy="30" r="3"/><circle cx="440" cy="100" r="2.5"/><circle cx="600" cy="30" r="3"/><circle cx="270" cy="120" r="2.5"/><circle cx="560" cy="170" r="3"/><circle cx="300" cy="190" r="2.5"/><circle cx="620" cy="200" r="2.5"/><circle cx="200" cy="20" r="2.5"/></g>'
  };
  function pictureSvg(pic) {
    var scene = SCENES[pic.scene] || SCENES.park;
    var svg = '<svg viewBox="0 0 640 340" role="img" aria-label="' + esc(pic.alt) + '"><title>' + esc(pic.alt) + '</title>' + scene + '</svg>';
    return '<figure class="picture">' + svg + '<figcaption>' + esc(LK(pic, 'note') || '') + '</figcaption></figure>';
  }
  function taskSkeleton(task) {
    var acc = 0;
    return '<div class="skeleton" id="skel">' + (task.scaffold || []).map(function (st) { var from = acc; acc += st.minutes; return '<div class="skel" data-from="' + from * 60 + '" data-to="' + acc * 60 + '"><span class="tag">' + esc(LK(st, 'label')) + '<br>~' + st.minutes + ' ' + T('мин') + '</span><span><b>' + esc(LK(st, 'label')) + '.</b> <span class="hint hintx">' + esc(LK(st, 'hint')) + '</span></span></div>'; }).join('') + '</div>';
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
        '<p class="prompt-text">' + esc(task.prompt) + '</p>' + (task.targetNote ? '<p class="small muted">' + esc(LK(task, 'targetNote')) + '</p>' : '') +
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
      return '<div class="block"><span class="setlabel">' + esc(task.title) + ' · ' + task.points + ' ' + T('баллов') + '</span><p class="small muted">' + esc(task.prompt) + '</p><div class="essay-view">' + esc(run.texts[task.id] || '') + '</div><div class="wc">' + wordCount(run.texts[task.id]) + ' ' + T('слов') + ' · ' + mmss(run.taskSec[task.id] || 0) + '</div>' + capNote(task, run.texts[task.id]) + critScorer(task.id, task.criteria, run.crit[task.id] = run.crit[task.id] || [], critCaps(task, run.texts[task.id])) + '</div>';
    }).join('') + '<div class="actions"><button class="btn" data-act="save-tasks">' + T('Сохранить результат') + '</button>' + (run.timedOut ? '' : '<button class="btn ghost" data-act="back-tasks">' + T('Вернуться к тексту') + '</button>') + '</div>';
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
        sec.tasks.map(function (x) { return '<h3 class="mt">' + esc(LK(x, 'title')) + ' <span class="muted small">· ' + x.points + ' ' + T('баллов') + '</span></h3>' + speakTaskHtml(x); }).join('') +
        '<div class="actions"><button class="btn" data-act="prep-done">' + T('Подготовка окончена → отвечать (') + sec.answerMinutes + ' ' + T('мин)') + '</button></div></div>';
      clockLbl = T('подготовка');
    } else if (run.sub === 'answer') {
      body = micNotice() + '<div class="block"><span class="setlabel">' + T('Жауап беру') + ' · ' + sec.answerMinutes + ' ' + T('мин на оба задания') + '</span>' +
        sec.tasks.map(function (x, i) {
          return '<div class="sq" id="sq' + i + '"><h3>' + esc(LK(x, 'title')) + ' <span class="muted small">· ~' + x.minutes + ' ' + T('мин') + '</span></h3>' + speakTaskHtml(x) +
            '<div class="row mt">' + (run.tdone[x.id] != null ? '<span class="badge ok">' + T('отвечено') + ' · ' + mmss(run.tdone[x.id]) + '</span>' :
              '<button class="btn secondary small" data-act="task-start" data-task="' + x.id + '" data-min="' + x.minutes + '">' + T('Старт таймера') + '</button><span class="clock" id="tk-' + x.id + '"></span>') + ' ' + recButton(x.id) + '</div></div>';
        }).join('') +
        '<div class="actions"><button class="btn" data-act="finish-speaking-tasks">' + T('Завершить говорение → самооценка') + '</button><span class="hint">' + T('Запишите ответ на телефон, оценивать будете по записи.') + '</span></div></div>';
      clockLbl = T('ответ');
    } else {
      body = sec.tasks.map(function (x) { return '<div class="block"><span class="setlabel">' + esc(LK(x, 'title')) + ' · ' + x.points + ' ' + T('баллов') + '</span>' + speakTaskHtml(x) + '<div class="row mt"><span class="rec-slot" data-rec-key="' + esc(recKey(x.id)) + '"></span><span class="small muted">' + T('таймер:') + ' ' + mmss(run.tdone[x.id] || 0) + '</span></div>' + critScorer(x.id, sec.criteria, run.crit[x.id] || []) + '</div>'; }).join('') +
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
        '<div class="block"><span class="setlabel">' + T('Разбор') + '</span>' + renderQuestions(sec, saved.answers || {}, true, null, { test: t.id, section: sec.type }) + '</div>';
    } else if (sec.tasks) {
      var pct2 = Math.round(100 * saved.score / saved.total);
      head = '<div class="score-card"><div class="score-big">' + saved.score + '<small>/' + saved.total + '</small></div><div><b>' + T('Самооценка по официальным критериям') + (pct2 >= 80 ? ' — ' + T('уровень C1.') : pct2 >= 60 ? ' — ' + T('уровень B2.') : pct2 >= 50 ? ' — ' + T('уровень B1.') : pct2 >= 40 ? ' — ' + T('уровень A2.') : pct2 >= 30 ? ' — ' + T('уровень A1.') : ' — ' + T('ниже порога A1.')) + '</b><div class="m">' + T('Пороги блока: A1 от 30 %, A2 от 40 %, B1 от 50 %, B2 от 60 %, C1 от 80 %') + ' · ' + mmss(saved.secondsUsed || 0) + ' · ' + fmtDate(saved.finishedAt) + '</div></div></div>';
      body = sec.tasks.map(function (x) {
        var crit = x.criteria || sec.criteria;
        return '<div class="block"><span class="setlabel">' + esc(LK(x, 'title')) + ' · ' + x.points + ' ' + T('баллов') + '</span>' +
          (sec.type === 'writing' ? '<p class="small muted">' + esc(x.prompt) + '</p><div class="essay-view">' + esc((saved.texts || {})[x.id] || '') + '</div><div class="wc">' + wordCount((saved.texts || {})[x.id]) + ' ' + T('слов') + '</div>' : speakTaskHtml(x) + '<div class="row mt"><span class="rec-slot" data-rec-key="' + esc(t.id + '/speaking/' + x.id) + '"></span></div>') +
          critView(crit, (saved.crit || {})[x.id]) + '</div>';
      }).join('');
    } else if (sec.type === 'writing') {
      var prompt = sec.prompts.filter(function (p) { return p.id === saved.promptId; })[0] || {};
      head = '<div class="score-card"><div class="score-big">' + saved.score + '<small>/' + saved.total + '</small></div><div><b>' + T('Чек-лист самопроверки.') + '</b><div class="m">' + wordCount(saved.text) + ' ' + T('слов') + ' · ' + mmss(saved.secondsUsed || 0) + ' ' + T('из') + ' ' + sec.minutes + ':00 · ' + fmtDate(saved.finishedAt) + '</div></div></div>';
      body = '<div class="block"><span class="setlabel">' + T('Тема') + '</span><p>' + esc(prompt.text) + '</p><div class="essay-view">' + esc(saved.text) + '</div></div>' +
        '<div class="block"><span class="setlabel">' + T('Самопроверка') + '</span><ul class="checklist">' + checklistOf(sec).map(function (c, i) { return '<li class="static" style="' + (saved.checks && saved.checks[i] ? 'color:var(--good)' : '') + '">' + esc(c) + (saved.checks && saved.checks[i] ? ' ✓' : '') + '</li>'; }).join('') + '</ul></div>';
    } else {
      var set = sec.sets.filter(function (s) { return s.id === saved.setId; })[0] || { title: '', questions: [] };
      head = '<div class="score-card"><div class="score-big">' + saved.score + '<small>/' + saved.total + '</small></div><div><b>' + T('Чек-лист самопроверки.') + '</b><div class="m">' + esc(LK(set, 'title')) + ' · ' + mmss(saved.secondsUsed || 0) + ' · ' + fmtDate(saved.finishedAt) + '</div></div></div>';
      body = '<div class="block"><span class="setlabel">' + T('Вопросы и записи') + '</span><ol class="prompt-list">' + set.questions.map(function (q, i) { return '<li><span>' + esc(q) + '<div class="row mt"><span class="rec-slot" data-rec-key="' + esc(t.id + '/speaking/' + set.id + '-' + i) + '"></span></div></span></li>'; }).join('') + '</ol></div>' +
        '<div class="block"><span class="setlabel">' + T('Самопроверка') + '</span><ul class="checklist">' + checklistOf(sec).map(function (c, i) { return '<li class="static" style="' + (saved.checks && saved.checks[i] ? 'color:var(--good)' : '') + '">' + esc(c) + (saved.checks && saved.checks[i] ? ' ✓' : '') + '</li>'; }).join('') + '</ul></div>';
    }
    var next = nextSection(t, sec.type);
    run.afterRender = null;
    return head + body + '<div class="actions">' + (next ? '<a class="btn" href="#/test/' + t.id + '/' + next.type + '">' + T('Следующий раздел:') + ' ' + esc(LK(KZ.sectionTypes[next.type], 'label')) + '</a>' : '<a class="btn" href="#/test/' + t.id + '">' + T('К итогам теста') + '</a>') +
      '<button class="btn ghost" data-act="retry">' + T('Пройти заново') + '</button>' + feedbackLink(t, sec, saved) + '</div>' + remindCta('after');
  }
  /* Канал напоминаний (KZ.site.telegramChannel): даты регистрации на тестирование и окно апелляции в 2 рабочих дня.
     Показывается в подвале ссылкой и блоком после пройденного раздела — в момент, когда человек думает о реальном экзамене.
     Пустая настройка выключает и то, и другое. */
  function remindCta(where) {
    if (!KZ.site || !KZ.site.telegramChannel) return '';
    var url = 'https://t.me/' + esc(KZ.site.telegramChannel);
    if (where === 'footer') return " · <a href='" + url + "' target='_blank' rel='noopener' data-remind='footer'>" + T('Напоминания в Telegram') + '</a>';
    return '<div class="notice"><b class="t">' + T('Не пропустите регистрацию') + '</b><p>' +
      T('Сессии тестирования идут по графику, а на апелляцию после результата есть всего 2 рабочих дня. Напомним заранее, без писем и без регистрации.') +
      "</p><p><a class='btn' href='" + url + "' target='_blank' rel='noopener' data-remind='after'>" + T('Подписаться на напоминания') + '</a></p></div>';
  }
  function feedbackLink(t, sec, saved) {
    if (!KZ.site || !KZ.site.feedbackTelegram) return '';
    var ctx = (t ? t.id : '') + (sec ? '/' + sec.type : '') + (saved && saved.total ? ' ' + saved.score + '/' + saved.total : '');
    return '<a class="btn ghost" target="_blank" rel="noopener" href="https://t.me/' + esc(KZ.site.feedbackTelegram) + '" data-ctx="' + esc(ctx) + '">' + T('Написать в Telegram') + '</a><span class="hint">' + T('Отзыв о тесте') + ': ' + esc(ctx) + '</span>';
  }
  /* ---------------- views: мой прогресс ---------------- */
  var progLv = null;   // фильтр графика: 'all' или 'exam:level'; null — пара последней попытки
  var AUTO_TYPES = ['listening', 'reading', 'lexis'];   // порядок = цвет и форма маркера на графике; цвет закреплён за разделом, не за рангом
  var SEC_ORDER = ['listening', 'lexis', 'reading', 'writing', 'speaking'];
  function secShort(ty) { return ty === 'lexis' ? T('Лексика') : LK(KZ.sectionTypes[ty], 'label'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dm(ts) { var d = new Date(ts); return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1); }
  function hPct(x) { return Math.round(100 * x.sc / x.tot); }
  function testName(t) { return KZ.exams[t.exam].short + ' ' + t.level + ' · ' + LK(t, 'title'); }
  function pgMark(ty, x, y, hollow) {
    var k = AUTO_TYPES.indexOf(ty), c = 'mk s' + (k + 1) + (hollow ? ' hollow' : '');
    if (k === 0) return '<circle class="' + c + '" cx="' + x + '" cy="' + y + '" r="4.5"/>';
    if (k === 1) return '<rect class="' + c + '" x="' + (x - 4.5) + '" y="' + (y - 4.5) + '" width="9" height="9" rx="1.5"/>';
    return '<path class="' + c + '" d="M' + x + ' ' + (y - 6) + 'L' + (x + 6) + ' ' + y + 'L' + x + ' ' + (y + 6) + 'L' + (x - 6) + ' ' + y + 'Z"/>';
  }
  /* линейный график: по оси X — попытки по порядку (подписи — даты), по Y — процент; линия на раздел */
  function progressChart(pts) {
    if (!pts.length) return '<p class="muted small">' + T('График появится, когда вы пройдёте аудирование, чтение или лексику.') + '</p>';
    var W = Math.round(Math.max(280, Math.min(750, (window.innerWidth || 800) - 80))), narrow = W < 520;
    var H = narrow ? 220 : 260, L = 42, R = narrow ? 14 : 110, TOP = 14, B = 30, pw = W - L - R, ph = H - TOP - B, n = pts.length;
    function X(i) { return Math.round(10 * (L + (n === 1 ? pw / 2 : i * pw / (n - 1)))) / 10; }
    function Y(p) { return Math.round(10 * (TOP + (1 - p / 100) * ph)) / 10; }
    var g = '';
    [0, 25, 50, 75, 100].forEach(function (v) { g += '<line class="' + (v ? 'grid' : 'base') + '" x1="' + L + '" x2="' + (L + pw) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (L - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v + '%</text>'; });
    var maxT = narrow ? 3 : 6, step = Math.max(1, Math.ceil((n - 1) / (maxT - 1))), ticks = [], lastLbl = null;
    for (var i = 0; i < n; i += step) ticks.push(i);
    if (n > 1 && ticks[ticks.length - 1] !== n - 1) { if (n - 1 - ticks[ticks.length - 1] < step / 2) ticks.pop(); ticks.push(n - 1); }
    ticks.forEach(function (i) {
      var lbl = dm(pts[i].at); if (lbl === lastLbl) return; lastLbl = lbl;
      var anchor = n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle';
      g += '<text class="ax" x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' + lbl + '</text>';
    });
    var lines = '', marks = '', hits = '', ends = [];
    AUTO_TYPES.forEach(function (ty, k) {
      var idx = []; pts.forEach(function (x, i) { if (x.s === ty) idx.push(i); });
      if (!idx.length) return;
      if (idx.length > 1) lines += '<path class="ln s' + (k + 1) + '" d="' + idx.map(function (i, j) { return (j ? 'L' : 'M') + X(i) + ' ' + Y(hPct(pts[i])); }).join('') + '"/>';
      var last = idx[idx.length - 1]; ends.push({ ty: ty, y: Y(hPct(pts[last])) });
    });
    pts.forEach(function (x, i) {
      var t = findTest(x.t), p = hPct(x), d = new Date(x.at);
      marks += pgMark(x.s, X(i), Y(p), x.pr);
      var tip = '<b>' + esc(secShort(x.s)) + ': ' + p + ' %</b> <span class="muted">(' + x.sc + '/' + x.tot + ')</span><br>' + esc(testName(t)) + '<br><span class="muted">' + dm(x.at) + '.' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + (x.pr ? ' · ' + T('тренировка') : '') + '</span>';
      hits += '<circle class="pg-hit" cx="' + X(i) + '" cy="' + Y(p) + '" r="12" data-tip="' + esc(tip) + '"/>';
    });
    var labels = '';
    if (!narrow) {   // подписи линий справа, раздвинутые, чтобы не наезжали друг на друга
      ends.sort(function (a, b) { return a.y - b.y; });
      ends.forEach(function (e, j) { e.ly = Math.max(e.y, TOP + 4, j ? ends[j - 1].ly + 16 : 0); });
      for (var j = ends.length - 1; j >= 0; j--) ends[j].ly = Math.min(ends[j].ly, j < ends.length - 1 ? ends[j + 1].ly - 16 : TOP + ph);
      ends.forEach(function (e) { labels += '<text class="dl-lbl" x="' + (L + pw + 12) + '" y="' + (e.ly + 4) + '">' + esc(secShort(e.ty)) + '</text>'; });
    }
    return '<div class="chart"><svg data-w="' + W + '" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + T('График результатов по попыткам; те же данные — в таблице ниже.') + '">' + g +
      '<line class="xh" x1="0" x2="0" y1="' + TOP + '" y2="' + (TOP + ph) + '" visibility="hidden"/>' + lines + marks + labels + '<g class="hits">' + hits + '</g></svg><div class="pg-tip" hidden></div></div>';
  }
  function pgTip(chart, hit) {
    var tip = chart.querySelector('.pg-tip'), svg = chart.querySelector('svg'), xh = svg.querySelector('.xh');
    if (!hit) { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); return; }
    var k = svg.getBoundingClientRect().width / +svg.getAttribute('data-w'), sr = svg.getBoundingClientRect(), br = chart.getBoundingClientRect();
    var cx = +hit.getAttribute('cx'), cy = +hit.getAttribute('cy'), px = sr.left - br.left + cx * k, py = sr.top - br.top + cy * k;
    xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('visibility', 'visible');
    tip.innerHTML = hit.getAttribute('data-tip'); tip.hidden = false;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.max(4, Math.min(px - tw / 2, chart.clientWidth - tw - 4)) + 'px';
    tip.style.top = (py - th - 14 >= 0 ? py - th - 14 : py + 16) + 'px';
  }
  /* наведение: ближайшая по X попытка — перекрестие и подсказка; на телефоне то же по касанию */
  function pgNearest(e) {
    var chart = e.target.closest && e.target.closest('.chart'); if (!chart) return;
    var svg = chart.querySelector('svg'), sr = svg.getBoundingClientRect(), k = sr.width / +svg.getAttribute('data-w');
    var x = (e.clientX - sr.left) / k, best = null, bd = 1e9;
    Array.prototype.forEach.call(svg.querySelectorAll('.pg-hit'), function (h) { var d = Math.abs(+h.getAttribute('cx') - x); if (d < bd) { bd = d; best = h; } });
    pgTip(chart, best);
  }
  document.addEventListener('mousemove', pgNearest);
  document.addEventListener('click', pgNearest);
  document.addEventListener('mouseout', function (e) { var chart = e.target.closest && e.target.closest('.chart'); if (chart && !(e.relatedTarget && chart.contains(e.relatedTarget))) pgTip(chart, null); });
  var pgResizeTO = null;
  window.addEventListener('resize', function () { if (!/^#\/progress/.test(location.hash)) return; clearTimeout(pgResizeTO); pgResizeTO = setTimeout(route, 200); });

  function viewProgress() {
    var hist = Array.isArray(state.history) ? state.history : [];
    var tests = KZ.tests.filter(function (t) { var st = state.tests[t.id]; return st && st.sections && Object.keys(st.sections).length; })
      .sort(function (a, b) { return (KZ.examOrder.indexOf(a.exam) - KZ.examOrder.indexOf(b.exam)) || (KZ.levelOrder.indexOf(a.level) - KZ.levelOrder.indexOf(b.level)) || (a.id < b.id ? -1 : 1); });
    var doneN = 0, autoSum = 0, autoN = 0, best = null;
    tests.forEach(function (t) {
      t.sections.forEach(function (s) { var r = sp(t.id, s.type); if (r && r.status === 'done') { doneN++; if (AUTO_TYPES.indexOf(s.type) >= 0 && r.total) { autoSum += 100 * r.score / r.total; autoN++; } } });
      var v = verdict(t); if (v && v.pass && (!best || KZ.levelOrder.indexOf(t.level) > KZ.levelOrder.indexOf(best.level))) best = t;
    });
    function tile(big, small) { return '<div class="tile"><div class="tile-big">' + big + '</div><div class="tile-lbl">' + small + '</div></div>'; }
    var head = topbar([{ label: T('Хаб'), href: '#/' }, { label: T('Мой прогресс') }]) +
      '<div class="kicker">' + T('Прогресс') + '</div><h1>' + T('Мой прогресс') + '</h1>' +
      '<p class="lede">' + T('Результаты хранятся только в этом браузере. Каждая завершённая попытка попадает в историю, поэтому рост виден, даже если раздел пройден заново.') + '</p>';
    var io = '<section><details class="io-details"><summary>' + T('Перенести прогресс на другое устройство') + '</summary>' + ioPanel() + '</details></section>';
    if (!tests.length && !hist.length) return head + '<div class="notice info"><b class="t">' + T('Пока пусто') + '</b><p>' + T('Пройдите любой раздел мок-теста — здесь появятся таблица результатов и график.') + ' <a href="#/">' + T('На хаб') + '</a></p></div>' + io;

    var tiles = '<div class="tiles">' +
      tile(tests.length, plural(tests.length, T('тест начат'), T('теста начато'), T('тестов начато'))) +
      tile(doneN, plural(doneN, T('раздел пройден'), T('раздела пройдено'), T('разделов пройдено'))) +
      tile(autoN ? Math.round(autoSum / autoN) + ' %' : '—', T('средний результат: аудирование, чтение, лексика')) +
      tile(best ? '✓ ' + best.level : '—', best ? T('подтверждённый уровень') + ' · ' + esc(KZ.exams[best.exam].short) : T('уровень пока не подтверждён')) + '</div>';

    var autoHist = hist.filter(function (x) { return AUTO_TYPES.indexOf(x.s) >= 0 && findTest(x.t); });
    // линия внутри одной пары «экзамен + уровень»: смешивать QRT A1 и ҚАЗТЕСТ B2 на одной линии бессмысленно
    function grp(x) { var t = findTest(x.t); return t.exam + ':' + t.level; }
    var groups = [];
    KZ.examOrder.forEach(function (eid) { KZ.levelOrder.forEach(function (lv) { var g = eid + ':' + lv; if (autoHist.some(function (x) { return grp(x) === g; })) groups.push(g); }); });
    var latest = autoHist.reduce(function (m, x) { return !m || x.at > m.at ? x : m; }, null);
    if (progLv !== 'all' && groups.indexOf(progLv) < 0) progLv = latest ? grp(latest) : 'all';
    if (groups.length < 2) progLv = 'all';
    var pts = autoHist.filter(function (x) { return progLv === 'all' || grp(x) === progLv; }).slice().sort(function (a, b) { return a.at - b.at; });
    var chips = groups.length > 1 ? '<div class="seg pg-filter" role="group" aria-label="' + T('Уровень') + '">' + groups.concat(['all']).map(function (v) { var q = v.split(':'); return '<button class="cb' + (progLv === v ? ' on' : '') + '" data-act="pg-lv" data-v="' + v + '" aria-pressed="' + (progLv === v) + '">' + (v === 'all' ? T('все вместе') : esc(KZ.exams[q[0]].short) + ' ' + q[1]) + '</button>'; }).join('') + '</div>' : '';
    var legend = '<div class="legend">' + AUTO_TYPES.map(function (ty) {
      var s = pts.filter(function (x) { return x.s === ty; }); if (!s.length) return '';
      var a = hPct(s[0]), z = hPct(s[s.length - 1]);
      return '<span class="lg"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' + pgMark(ty, 7, 7) + '</svg>' + esc(secShort(ty)) + ' <span class="muted">' + (s.length > 1 && progLv !== 'all' ? a + ' → ' + z + ' % · ' + s.length + ' ' + plural(s.length, T('попытка'), T('попытки'), T('попыток')) : progLv === 'all' ? s.length + ' ' + plural(s.length, T('попытка'), T('попытки'), T('попыток')) : z + ' %') + '</span></span>';
    }).join('') + (pts.some(function (x) { return x.pr; }) ? '<span class="lg muted">' + T('пустой маркер — тренировка') + '</span>' : '') + '</div>';
    var chart = '<section><h2>' + T('Результаты по попыткам') + '</h2><p class="sub">' + T('Разделы с автоматической проверкой. Письмо и интервью оцениваете вы сами, поэтому они только в таблице.') + '</p>' +
      '<div class="block pg-chart">' + chips + (pts.length ? legend : '') + progressChart(pts) + '</div></section>';

    var cols = SEC_ORDER.filter(function (ty) { return tests.some(function (t) { return t.sections.some(function (s) { return s.type === ty; }); }); });
    var rows = tests.map(function (t) {
      var cells = cols.map(function (ty) {
        if (!t.sections.some(function (s) { return s.type === ty; })) return '<td class="na" title="' + T('нет в этом экзамене') + '"></td>';
        var r = sp(t.id, ty);
        if (!r || !r.status) return '<td class="muted">—</td>';
        if (r.status !== 'done' || !r.total) return '<td class="muted small">' + (r.status === 'done' ? T('пройден') : T('черновик')) + '</td>';
        var p = Math.round(100 * r.score / r.total), att = hist.filter(function (x) { return x.t === t.id && x.s === ty; }), dl = '';
        if (att.length > 1) { var d = hPct(att[att.length - 1]) - hPct(att[att.length - 2]); if (d) dl = ' <span class="delta ' + (d > 0 ? 'up' : 'down') + '" title="' + T('к прошлой попытке') + '">' + (d > 0 ? '↑' : '↓') + Math.abs(d) + '</span>'; }
        return '<td' + (att.length > 1 ? ' title="' + T('попыток') + ': ' + att.length + '"' : '') + '><b class="pc ' + (p >= 80 ? 'good' : p >= 50 ? 'mid' : 'bad') + '">' + p + ' %</b><span class="sc">' + r.score + '/' + r.total + dl + (r.practice ? ' · ' + T('тренировка') : '') + '</span></td>';
      }).join('');
      var st = testStatus(t), upd = state.tests[t.id].updatedAt;
      return '<tr><td><a href="#/test/' + t.id + '">' + esc(testName(t)) + '</a></td>' + cells + '<td><span class="badge ' + st.cls + '">' + st.label + '</span></td><td class="muted small">' + (upd ? new Date(upd).toLocaleDateString('ru-RU') : '') + '</td></tr>';
    }).join('');
    var table = tests.length ? '<section><h2>' + T('Таблица результатов') + '</h2><p class="sub">' + T('Последняя попытка каждого раздела; стрелка — изменение к прошлой попытке.') + '</p>' +
      '<div class="tablewrap"><table class="prog"><thead><tr><th>' + T('Тест') + '</th>' + cols.map(function (ty) { return '<th>' + esc(secShort(ty)) + (ty === 'writing' || ty === 'speaking' ? '*' : '') + '</th>'; }).join('') + '<th>' + T('Итог') + '</th><th>' + T('Дата') + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (cols.indexOf('writing') >= 0 || cols.indexOf('speaking') >= 0 ? '<p class="small muted">* ' + T('самооценка, в вывод не входит') + '</p>' : '') + '</section>' : '';

    var course = '';
    if (KZ.courses && KZ.courseProgress && Object.keys(KZ.courses).length) {
      course = '<section><h2>' + T('Курс') + '</h2><div class="levels">' + Object.keys(KZ.courses).map(function (k) {
        var c = KZ.courses[k], pr = KZ.courseProgress(c), w = pr.topics ? Math.round(100 * pr.done / pr.topics) : 0;
        return '<a class="level-row" href="#/course/' + k + '"><span class="lvl">' + k + '</span><span><div class="nm">' + esc(c.title) + '</div><div class="meter" aria-hidden="true"><i style="width:' + w + '%"></i></div></span><span class="st">' + pr.done + ' / ' + pr.topics + ' ' + T('тем') + (pr.known ? ' · ' + T('выучено') + ' ' + pr.known : '') + '</span></a>';
      }).join('') + '</div></section>';
    }
    return head + tiles + chart + table + course + io;
  }

  function viewSources() {
    var tiers = { 1: T('Ключевые пособия — рекомендуем'), 2: T('Дополнительная литература'), 3: T('Словари и справочники') };
    var groups = {};
    (KZ.sources || []).forEach(function (x) { (groups[x.tier || 9] = groups[x.tier || 9] || []).push(x); });
    var html = Object.keys(groups).sort().map(function (tk) {
      return '<section><h2>' + esc(tiers[tk] || T('Прочее')) + '</h2><ol class="prompt-list">' + groups[tk].map(function (x) {
        return '<li><span><b lang="kk">' + esc(LK(x, 'title')) + '</b><br><span class="small muted">' + esc(x.author || '') + (x.year ? ', ' + x.year : '') + (x.kind ? ' · ' + esc(T(x.kind)) : '') + (x.level ? ' · ' + esc(x.level) : '') + '</span></span></li>';
      }).join('') + '</ol></section>';
    }).join('');
    var official = KZ.examOrder.map(function (eid) { var ex = KZ.exams[eid]; return '<h3>' + esc(ex.name) + '</h3><ul class="srclist">' + ex.sources.map(function (x) { return '<li><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(LK(x, 'title')) + '</a></li>'; }).join('') + '</ul>'; }).join('');
    return topbar([{ label: T('Хаб'), href: '#/' }, { label: T('Источники') }]) +
      '<div class="kicker">' + T('Литература и источники') + '</div><h1>' + T('Литература, на которую мы опирались') + '</h1>' +
      '<p class="lede">' + T('Пособия и словари, которые мы изучали и которыми вдохновлялись, строя собственную методологию тренажёра. Все задания созданы нашими специалистами. Особое внимание мы уделяем авторам из первого раздела и рекомендуем их пособия для самостоятельной работы.') + '</p>' +
      html + '<section><h2>' + T('Официальные документы экзаменов') + '</h2>' + official + '</section>';
  }
  function checklistOf(sec) { return (KZ.lang === 'kk' && sec.checklist_kk) || sec.checklist; }
  function tipsOf(es) { return (KZ.lang === 'kk' && es.tips_kk) || es.tips; }
  function nextSection(t, type) { for (var i = 0; i < t.sections.length - 1; i++) if (t.sections[i].type === type) return t.sections[i + 1]; return null; }

  /* ---------------- events ---------------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    var t = run && findTest(run.testId), sec = null;
    if (t) t.sections.forEach(function (s) { if (s.type === run.type) sec = s; });

    if (act === 'fb-open' || act === 'fb-close') {
      var fb = document.getElementById('fb'); if (!fb) return;
      var panel = fb.querySelector('.fb-panel'), tab = fb.querySelector('.fb-tab'), open = act === 'fb-open';
      panel.hidden = !open; tab.hidden = open;
      if (open) {
        var c = document.getElementById('fb-ctx');
        if (c) c.textContent = fbCtx ? T('Вопрос:') + ' ' + fbCtx.test + ' · ' + fbCtx.section + ' · ' + fbCtx.qid : '';
        var ta = document.getElementById('fb-text'); if (ta) ta.focus();
      } else fbCtx = null;
      return;
    }
    if (act === 'fb-send') {
      var ta2 = document.getElementById('fb-text'), msg = document.getElementById('fb-msg');
      var txt = (ta2 && ta2.value || '').trim();
      if (txt.length < 5) { if (msg) msg.textContent = T('Напишите хотя бы пару слов.'); return; }
      sendEvent('feedback', { text: txt.slice(0, 1000), path: location.hash.replace(/^#\/?/, ''), ua: navigator.userAgent,
        test: fbCtx && fbCtx.test, section: fbCtx && fbCtx.section, qid: fbCtx && fbCtx.qid });
      fbCtx = null;
      var panel2 = document.getElementById('fb').querySelector('.fb-panel');
      panel2.innerHTML = '<p role="status"><b>' + T('Спасибо — прочитаем.') + '</b></p>' +
        '<div class="actions"><button class="btn ghost small" data-act="fb-close">' + T('Закрыть') + '</button></div>';
      return;
    }
    if (act === 'report-open') { var box = b.closest('.report'); if (box) { b.hidden = true; var w = box.querySelector('.rep-why'); if (w) w.hidden = false; } return; }
    if (act === 'report-send') {
      var box2 = b.closest('.report'); if (!box2) return;
      if (b.getAttribute('data-why') === 'other') {   // «Другое» — просим написать словами, иначе жалоба бесполезна
        fbCtx = { test: box2.getAttribute('data-test'), section: box2.getAttribute('data-section'), qid: box2.getAttribute('data-qid') };
        var ob = document.querySelector('.fb-tab'); if (ob) ob.click();
        return;
      }
      sendEvent('report', { test: box2.getAttribute('data-test'), section: box2.getAttribute('data-section'), qid: box2.getAttribute('data-qid'),
        why: b.getAttribute('data-why'), a: +box2.getAttribute('data-a'), ok: +box2.getAttribute('data-ok') });
      box2.innerHTML = '<span class="small good-text" role="status">' + T('Спасибо — отметили, проверим этот вопрос.') + '</span>';
      return;
    }
    if (act === 'pg-lv') { progLv = b.getAttribute('data-v'); route(); return; }
    if (act === 'go') { e.preventDefault(); location.hash = b.getAttribute('data-href'); return; }
    if (act === 'lang') { KZ.setLang(b.getAttribute('data-v')); track('lang', { to: KZ.lang }); saveUi(); route(); return; }
    else if (act === 'ui-panel') { var up = document.getElementById('ui-panel'); if (up) { up.hidden = !up.hidden; b.setAttribute('aria-expanded', String(!up.hidden)); } return; }
    else if (act === 'ui-size' || act === 'ui-font' || act === 'ui-hints' || act === 'ui-transcript' || act === 'ui-practice') { var v = b.getAttribute('data-v'); ui[act.slice(3)] = v === 'true' ? true : v === 'false' ? false : v; saveUi(); track('setting', { name: act.slice(3), value: String(v) }); var keep = document.getElementById('ui-panel') && !document.getElementById('ui-panel').hidden; route(); if (keep) { var up2 = document.getElementById('ui-panel'); if (up2) up2.hidden = false; } return; }
    if (act === 'io-copy') {
      var ta = document.getElementById('io-text'), im = document.getElementById('io-msg');
      function copyFallback() { try { ta.select(); if (document.execCommand('copy')) { im.textContent = T('Скопировано.'); return; } } catch (x) {} im.textContent = T('Не удалось скопировать — выделите текст и скопируйте вручную.'); }
      var pr = null; try { pr = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(ta.value) : null; } catch (x) {}
      if (pr && pr.then) pr.then(function () { im.textContent = T('Скопировано.'); }, copyFallback); else copyFallback();
    }
    else if (act === 'io-import') { try { var s = JSON.parse(document.getElementById('io-text').value); if (!s || typeof s !== 'object' || typeof s.tests !== 'object' || Array.isArray(s.tests)) throw 0; var nT = Object.keys(s.tests).length, nC = s.course ? Object.keys(s.course).length : 0; if (!confirm(T('Заменить текущий прогресс импортированным?') + ' (' + T('тестов') + ': ' + nT + ', ' + T('курсов') + ': ' + nC + ')')) return; state = cleanState(s); saveState(); route(); } catch (x) { document.getElementById('io-msg').textContent = T('Не удалось прочитать JSON.'); } }
    else if (act === 'io-reset') { if (confirm(T('Удалить весь сохранённый прогресс?'))) { state = { version: 1, tests: {}, history: [] }; saveState(); route(); } }
    else if (act === 'reset-test') { if (confirm(T('Сбросить результаты этого теста?'))) { var rid = b.getAttribute('data-test'); delete state.tests[rid]; if (Array.isArray(state.history)) state.history = state.history.filter(function (x) { return x.t !== rid; }); saveState(); route(); } }
    else if (act === 'start') { run.phase = 'run'; track('section-start', { test: t.id, exam: t.exam, level: t.level, section: sec.type, practice: !!ui.practice }); route(); }
    else if (act === 'tts') { playScript(t, sec); }
    else if (act === 'au-play') { track('audio-play', { test: t.id, section: sec.type, n: (run.playsUsed || 0) + 1 }); playAudio(t, sec, b); }
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
    else if (act === 'save-writing') { clearTimeout(draftTO); var n = wordCount(run.text) === 0 ? 0 : run.checks.filter(Boolean).length; setSection(t.id, 'writing', { status: 'done', promptId: run.promptId, text: run.text, checks: run.checks, score: n, total: sec.checklist.length, secondsUsed: run.secondsUsed || 0, finishedAt: Date.now(), practice: !!ui.practice }); run.phase = 'review'; route(); }
    else if (act === 'next-task') {
      var cur = sec.tasks[run.taskIdx]; run.taskSec[cur.id] = Math.round(taskElapsed()); run.taskStart = null; clearTimeout(draftTO);
      if (run.taskIdx < sec.tasks.length - 1) { run.taskIdx++; setSection(t.id, 'writing', { status: 'draft', texts: run.texts, taskIdx: run.taskIdx, taskSec: run.taskSec, secondsUsed: Math.round(elapsed()) }); }
      else { run.secondsUsed = Math.round(elapsed()); setSection(t.id, 'writing', { status: 'draft', texts: run.texts, taskIdx: run.taskIdx, taskSec: run.taskSec, secondsUsed: run.secondsUsed }); stopTimer(); run.sub = 'check'; }
      route();
    }
    else if (act === 'back-tasks') { run.sub = 'write'; run.taskIdx = 0; run.taskStart = null; route(); }
    else if (act === 'crit') { if (b.disabled) return; var tid = b.getAttribute('data-task'); run.crit[tid] = run.crit[tid] || []; run.crit[tid][+b.getAttribute('data-i')] = +b.getAttribute('data-v'); route(); }
    else if (act === 'save-tasks') { clearTimeout(draftTO); setSection(t.id, 'writing', { status: 'done', kind: 'points', texts: run.texts, crit: run.crit, taskSec: run.taskSec, score: critSum(run.crit), total: tasksTotal(sec), secondsUsed: run.secondsUsed || 0, finishedAt: Date.now(), practice: !!ui.practice }); run.phase = 'review'; route(); }
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
      quizDraft();
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

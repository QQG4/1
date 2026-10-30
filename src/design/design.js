/* Варианты дизайна в лаборатории (30.10.2026): воркер лаборатории подключает этот файл только в видах «Дизайн 1» и «Дизайн 2»,
   в публичную сборку он не попадает. Приложение не меняется: после каждой отрисовки достраиваем то, чего одними стилями
   не сделать: шапку страницы, полосу прогресса, значки разделов, порядок блоков на экране результата.
   Новых слов здесь нет, только цифры и название сайта: казахских текстов дизайн не добавляет. */
(function () {
  'use strict';
  var root = document.documentElement, D = root.getAttribute('data-design');
  if (!D) return;

  /* Свой рисунок мотива қошқар мүйіз: пара завитков-рогов на общем стебле. Только контур, штрихом currentColor */
  var HORN = '<path d="M50 92V60C50 36 60 12 79 12c13 0 20 12 15 23-5 10-20 9-22-1-1-8 8-12 13-6"/><path d="M50 60C50 36 40 12 21 12 8 12 1 24 6 35c5 10 20 9 22-1 1-8-8-12-13-6"/><path d="M50 74c7 2 16 1 20-6 3-6-3-11-8-8"/><path d="M50 74c-7 2-16 1-20-6-3-6 3-11 8-8"/><path d="M36 92h28"/>';
  function mark(cls) { return '<svg class="' + cls + '" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + HORN + '</svg>'; }

  var ICONS = {
    listening: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.5" y="13.5" width="5" height="7" rx="2"/><rect x="16.5" y="13.5" width="5" height="7" rx="2"/>',
    reading: '<path d="M12 6.5C10 5 7 4.5 3 5v14c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5zM12 6.5v14"/>',
    lexis: '<path d="M3 19 8 6l5 13M4.8 15h6.4"/><circle cx="17.5" cy="15.5" r="3.5"/><path d="M21 12v7"/>',
    writing: '<path d="M4 20l1-5L16 4l4 4L9 19l-5 1zM13.5 6.5l4 4"/>',
    speaking: '<rect x="8.5" y="3" width="7" height="11" rx="3.5"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V21"/>'
  };
  function icon(type) { return ICONS[type] ? '<svg class="dz-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICONS[type] + '</svg>' : ''; }

  function el(tag, cls, html) { var x = document.createElement(tag); x.className = cls; if (html) x.innerHTML = html; return x; }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function pct(a, b) { return b ? Math.round(100 * a / b) : 0; }
  function move(into, nodes) { nodes.forEach(function (n) { if (n) into.appendChild(n); }); }

  var theme = $('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', D === 'd1' ? '#0a2472' : '#17c964');

  var app = document.getElementById('app');
  if (!app) { page(); return; }

  /* ---------- шапка: название сайта и знак ---------- */
  function brand() {
    var nav = $('.topbar nav'); if (!nav || $('.dz-brand', nav)) return;
    var a = el('a', 'dz-brand', mark('dz-mark') + '<span>Qazaq Trainer</span>');
    a.href = '#/';
    nav.insertBefore(a, nav.firstChild);
  }

  /* ---------- заголовок страницы: подпись, заголовок и вводный абзац одним блоком ---------- */
  function pageHead(route) {
    var k = $(':scope > .kicker', app), h = $(':scope > h1', app); if (!h) return null;
    var lede = $(':scope > .lede', app);
    var head = el('div', route === 'hub' ? 'dz-hero' : 'dz-head', mark('dz-horn'));
    app.insertBefore(head, k || h);
    move(head, [k, h, lede]);
    return head;
  }

  /* ---------- главная: экспресс-тест входит в первый экран, лестница уровней показывает пройденное ---------- */
  function hub(head) {
    if (!head) return;
    var rows = $$('.exam-card-wrap .level-row');
    var levels = (KZ.levelOrder || []).map(function (lv) {
      var mine = rows.filter(function (r) { var c = $('.lvl', r); return c && c.textContent === lv; });
      var chips = []; mine.forEach(function (r) { chips = chips.concat($$('.vchip', r)); });
      var ok = chips.filter(function (c) { return c.classList.contains('ok'); }).length;
      var part = chips.filter(function (c) { return c.classList.contains('warn'); }).length;
      return { lv: lv, ok: ok, part: part, n: chips.length };
    });
    var done = levels.reduce(function (a, l) { return a + l.ok; }, 0), all = levels.reduce(function (a, l) { return a + l.n; }, 0);
    head.appendChild(el('div', 'dz-track', levels.map(function (l) {
      return '<span class="dz-node' + (l.ok ? ' ok' : l.part ? ' part' : '') + '" data-lv="' + l.lv + '" style="--p:' + pct(l.ok, l.n) + '%"><b>' + l.lv + '</b><i></i></span>';
    }).join('') + '<span class="dz-track-sum">' + done + '/' + all + '</span>'));
    var ex = $$(':scope > section', app).filter(function (s) { return $('a[href^="#/express/"]', s); })[0];
    if (ex) { ex.classList.add('dz-express'); head.appendChild(ex); }
  }

  /* ---------- уровни: цвет и столбик пройденного в строке ---------- */
  function levelsMarks() {
    $$('.level-row', app).forEach(function (r) {
      var c = $('.lvl', r); if (c) r.setAttribute('data-lv', c.textContent);
      var chips = $$('.vchip', r); if (!chips.length || $('.dz-bar', r)) return;
      var ok = chips.filter(function (x) { return x.classList.contains('ok'); }).length;
      var part = chips.filter(function (x) { return x.classList.contains('warn'); }).length;
      var box = r.children[1]; if (box) box.appendChild(el('span', 'dz-bar', '<i style="width:' + pct(ok + part / 2, chips.length) + '%"></i>'));
    });
    $$('.rung-level', app).forEach(function (c) { c.parentNode.parentNode.setAttribute('data-lv', c.textContent); });
    $$('.badge.level', app).forEach(function (c) { c.setAttribute('data-lv', c.textContent); });
  }

  /* ---------- разделы экзамена и теста: значок по типу раздела ---------- */
  function stages(p) {
    var list = $$('.stage', app); if (!list.length) return;
    var types = p[0] === 'exam' && KZ.exams[p[1]] ? KZ.exams[p[1]].sections.map(function (s) { return s.type; }) : null;
    list.forEach(function (s, i) {
      var m = (s.getAttribute('href') || '').match(/^#\/test\/[^/]+\/(\w+)/), type = m ? m[1] : types && types[i];
      if (!type) return;
      s.setAttribute('data-type', type);
      var n = $('.stage-num', s); if (n && !$('.dz-ico', n)) n.insertAdjacentHTML('afterbegin', icon(type));
    });
  }

  /* ---------- полоса ответов на экране вопросов: сегмент на каждый вопрос ---------- */
  function progressPaint() {
    var bar = $('.dz-progress', app); if (!bar) return;
    var names = [];
    $$('.opts input', app).forEach(function (i) { if (names.indexOf(i.name) < 0) names.push(i.name); });
    var done = 0;
    names.forEach(function (n, i) {
      var on = !!$('.opts input[name="' + n.replace(/"/g, '\\"') + '"]:checked', app);
      if (on) done++;
      var seg = bar.children[i]; if (seg) seg.classList.toggle('on', on);
    });
    var sum = $('.dz-progress-sum', bar); if (sum) sum.textContent = done + '/' + names.length;
    bar.style.setProperty('--f', names.length ? done / names.length : 0);
  }
  function progress() {
    if (!$('.opts input:not([disabled])', app)) return;
    var names = {}; $$('.opts input', app).forEach(function (i) { names[i.name] = 1; });
    var n = Object.keys(names).length, segs = '';
    for (var i = 0; i < n; i++) segs += '<i></i>';
    var bar = el('div', 'dz-progress', segs + '<b class="dz-progress-sum"></b>');
    var tb = $(':scope > .timerbar', app);
    if (tb) tb.appendChild(bar);
    else {   // экспресс-тест: таймера-полосы нет, ставим над первым вопросом
      var first = $(':scope > .block', app), wrap = el('div', 'timerbar dz-xbar'); wrap.appendChild(bar);
      if (first) app.insertBefore(wrap, first);
    }
    progressPaint();
  }
  document.addEventListener('change', function (e) { if (e.target && e.target.type === 'radio') setTimeout(progressPaint, 0); }, true);

  /* ---------- чтение на широком экране: текст слева, вопросы справа ---------- */
  function split() {
    var pass = $$(':scope > .block', app).filter(function (b) { return $('.passage', b); })[0];
    if (!pass || !pass.nextElementSibling || !pass.nextElementSibling.classList.contains('block')) return;
    var box = el('div', 'dz-split'), q = pass.nextElementSibling;
    app.insertBefore(box, pass);
    move(box, [pass, q]);
  }

  /* ---------- результат: счёт, «Насколько трудно?», «Что дальше» и кнопки на первом экране, разбор ниже ---------- */
  function result() {
    var card = $(':scope > .score-card', app); if (!card) return;
    var big = $('.score-big', card), m = big && big.textContent.match(/^(\d+)\/(\d+)$/);
    if (m) {
      var p = pct(+m[1], +m[2]);
      card.style.setProperty('--p', p + '%');
      card.setAttribute('data-band', p >= 80 ? 'good' : p >= 50 ? 'mid' : 'bad');
    } else card.setAttribute('data-band', 'level');
    var diff = $(':scope > .diff', app), ns = $(':scope > .nsteps', app), act = $(':scope > .actions', app);
    var after = diff || card;
    if (act && $('.dz-split, .block', app)) { after.parentNode.insertBefore(act, after.nextSibling); after = act; }
    if (ns) after.parentNode.insertBefore(ns, after.nextSibling);
  }

  function enhance() {
    var keep = document.activeElement;
    var p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    var route = !p.length || p[0] === 'main' ? 'hub' : p[0] === 'test' && p[2] ? 'section' : p[0];
    root.setAttribute('data-route', route);
    root.setAttribute('data-phase', $(':scope > .timerbar', app) || (route === 'express' && $('.opts input:not([disabled])', app)) ? 'run' : $(':scope > .score-card', app) ? 'review' : 'view');
    brand();
    levelsMarks();
    var head = pageHead(route);
    if (route === 'hub') hub(head);
    stages(p);
    split();
    progress();
    result();
    if (keep && keep !== document.activeElement && document.contains(keep)) try { keep.focus({ preventScroll: true }); } catch (e) {}
  }
  enhance();
  var obs = new MutationObserver(function () { enhance(); obs.takeRecords(); });
  obs.observe(app, { childList: true });

  /* ---------- посадочные страницы и страницы-ответы: своя лёгкая вёрстка из build.py ---------- */
  function page() {
    var m = $('body > main'); if (!m) return;
    root.setAttribute('data-route', 'landing');
    var hero = el('div', 'dz-hero', mark('dz-horn')), nodes = [];
    for (var n = m.firstElementChild; n && n.tagName !== 'H2'; n = n.nextElementSibling) nodes.push(n);
    m.insertBefore(hero, m.firstChild);
    move(hero, nodes);
    var top = el('div', 'dz-top', '<a class="dz-brand" href="/">' + mark('dz-mark') + '<span>Qazaq Trainer</span></a>');
    m.insertBefore(top, hero);
  }
})();

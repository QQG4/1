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
  if (theme) theme.setAttribute('content', D === 'd1' ? '#34497a' : '#17c964');

  var CHEV = '<svg class="dz-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>';
  var moreN = 0, opened = {};
  var RENAME_RU = [[/Мок-тесты/g, 'Пробные тесты'], [/мок-тесты/g, 'пробные тесты'], [/Мок-тестов/g, 'Пробных тестов'], [/мок-тестов/g, 'пробных тестов'],
    [/Мок-теста/g, 'Пробного теста'], [/мок-теста/g, 'пробного теста'], [/Мок-тест/g, 'Пробный тест'], [/мок-тест/g, 'пробный тест']];
  var RENAME_KK = [[/Мок-тест/g, 'Сынама тест'], [/мок-тест/g, 'сынама тест']];
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

  /* ---------- Дизайн 1: коротко на экране, подробности под кнопкой (просьба владельца 30.10.2026) ----------
     На экране — заголовок и действие. Все пояснения остаются в разметке, только свёрнуты в <details>: кнопка «Подробнее» прямо под текстом
     или раздел-гармошка с прежним заголовком. Ничего не удалено. Что открыто, запоминается на время перерисовки той же страницы. */
  function isKk() { return (window.KZ && KZ.lang === 'kk') || root.lang === 'kk'; }
  function fold(cls, head, nodes) {
    var d = el('details', cls), k = location.pathname + location.hash + '|' + (moreN++);
    d.innerHTML = '<summary>' + head + CHEV + '</summary>';
    var body = el('div', cls + '-body'); move(body, nodes); d.appendChild(body);
    if (opened[k]) d.open = true;
    d.addEventListener('toggle', function () { opened[k] = d.open; });
    return d;
  }
  /* на экране только стрелка (решение владельца 30.10.2026), слово — для экранного диктора. «Толығырақ» ждёт носителя: tools/kk-review-redesign-2026-10-30.md */
  function more(nodes) {
    nodes = nodes.filter(Boolean); if (!nodes.length) return null;
    var box = el('div', 'dz-more'), body = el('div', 'dz-more-body'); move(body, nodes); body.hidden = true;
    box.appendChild(body); return box;
  }
  /* стрелка стоит сразу справа от текста, который раскрывает; сам текст раскрывается под ним. Вызывается, когда блоки уже на месте */
  function attachToggles(area) {
    $$('div.dz-more', area).forEach(function (box) {
      if (box.getAttribute('data-ready')) return;
      box.setAttribute('data-ready', '1');
      var body = $(':scope > .dz-more-body', box), k = location.pathname + location.hash + '|' + (moreN++);
      var b = el('button', 'dz-toggle', '<span class="sr">' + (isKk() ? 'Толығырақ' : 'Подробнее') + '</span>' + CHEV);
      b.type = 'button';
      function show(on) { body.hidden = !on; b.setAttribute('aria-expanded', String(on)); b.classList.toggle('open', on); }
      b.addEventListener('click', function () { opened[k] = body.hidden; show(body.hidden); });
      show(!!opened[k]);
      var prev = box.previousElementSibling, note = box.parentNode.classList.contains('notice') ? $(':scope > b.t', box.parentNode) : null;
      var target = note && (!prev || $('.btn', prev) || prev === note) ? note : prev;
      if (target) target.appendChild(b);
      else box.parentNode.insertBefore(b, box);   // только текст без обёртки: «Источники:» в подвале
    });
  }
  function after(ref, node) { if (node) ref.parentNode.insertBefore(node, ref.nextSibling); }
  function textLen(n) { return (n.textContent || '').trim().length; }
  function accordion(sec) {
    var h = $('h2', sec); if (!h) return;
    var label = h.textContent, rest = Array.prototype.slice.call(sec.childNodes).filter(function (n) { return n !== h && !(n.classList && n.classList.contains('kicker')); });
    var head = document.createElement('span'); head.className = 'dz-acc-title'; head.textContent = label;
    var d = fold('dz-acc', head.outerHTML, rest);
    if (sec.id) d.id = sec.id;
    sec.parentNode.replaceChild(d, sec);
    return d;
  }
  /* плашка: заголовок и кнопки на виду, текст свёрнут */
  function calmNotice(n) {
    var t = $(':scope > b.t', n); if (!t || n.classList.contains('nsteps')) return;
    var rest = Array.prototype.slice.call(n.children).filter(function (c) {
      if (c === t) return false;
      if ($('a.btn, button.btn', c)) return false;
      if (c.tagName === 'P' && c.firstElementChild && c.firstElementChild.tagName === 'B' && c.firstElementChild.textContent === c.textContent) return false;   // итог: «Ваш уровень…»
      return true;
    });
    if (rest.reduce(function (a, c) { return a + textLen(c); }, 0) < 60) return;
    n.appendChild(more(rest));
  }
  function calmNext(n) {
    var steps = $$('.nstep', n); if (!steps.length) return;
    var btns = el('div', 'dz-next-btns'), notes = [];
    steps.forEach(function (s) { var b = $('.btn', s), p = $('p', s); if (b) { b.classList.remove('small'); btns.appendChild(b); } if (p) notes.push(p); s.remove(); });
    n.appendChild(more(notes)); n.appendChild(btns);
  }
  function calmHead(route) {
    var head = $(':scope > .dz-head, :scope > .dz-hero', app); if (!head) return;
    var lede = $(':scope > .lede', head);
    if (route === 'hub') {
      var h1 = $('h1', head), k = $('.kicker', head);
      if (h1) h1.textContent = isKk() ? 'ҚАЗТЕСТ пен QazResmiTest бойынша сынама тесттер' : 'Пробные ҚАЗТЕСТ и QazResmiTest';
      if (k) k.remove();
      var punch = el('p', 'dz-punch'); punch.textContent = isKk() ? 'Тегін. Тіркеусіз.' : 'Бесплатно. Без регистрации.';
      if (h1) after(h1, punch);
      if (lede) after(punch, more([lede]));
    } else if (route !== 'sources' && lede && !lede.classList.contains('hintx') && textLen(lede) > 60) after($('h1', head), more([lede]));   // на странице литературы фраза об авторах всегда на виду
  }
  /* блоки аудирования не стоят в одном списке с уровнями: своя гармошка под экзаменами, строка на экзамен */
  function calmHubBlocks() {
    var rows = $$('.exam-card-wrap .level-row').filter(function (r) { return $('.lvl-au', r); }); if (!rows.length) return;
    var exams = $('.exam-card-wrap').closest('section'), sec = document.createElement('section');
    var title = el('h2', '');
    title.textContent = ($('.hub-nm span', rows[0]).firstChild.nodeValue || '').trim();
    var list = el('div', 'levels');
    rows.forEach(function (r) {
      var name = $('.name', r.closest('.exam-card-wrap')), nm = $('.nm', r);
      if (name && nm) nm.textContent = name.textContent;
      $('.lvl', r).remove(); r.classList.add('dz-au-row');
      var chip = $('.vchip', r); if (chip) r.setAttribute('href', chip.getAttribute('data-href'));   // на странице экзамена списка блоков больше нет
      list.appendChild(r);
    });
    sec.appendChild(title); sec.appendChild(list);
    after(exams, sec);
    accordion(sec);
  }
  function calmHub() {
    var ex = $('.dz-express', app);
    if (ex) { var sub = $('.sub', ex); if (sub) { var m = more([sub]), eh = $('h2', ex); if (eh) after(eh, m); else ex.appendChild(m); } }
    $$(':scope > section', app).forEach(function (s) {
      var k = $(':scope > .kicker', s); if (k) k.remove();
      if ($('.ladder', s)) return accordion(s);
      var sb = $(':scope > .sub', s); if (sb) sb.remove();   // «Мок-тесты по уровням»: заголовок и кнопки понятны сами, решение владельца 30.10.2026
    });
    calmHubBlocks();
    $$('.exam-card .badge.ok, .exam-card .badge.warn', app).forEach(function (x) { x.remove(); });
    $$('.exam-card-wrap').forEach(function (w) {
      var a = $('a.exam-card', w), id = a && (a.getAttribute('href') || '').split('/').pop(), x = id && KZ.exams[id], tag = a && $('.tag', a);
      if (!x || !tag) return;
      var T = KZ.T, n = x.sections.length;
      tag.textContent = n + ' ' + (n === 4 ? T('блока') : T('разделов')) + (x.totalMinutes ? ' · ' + x.totalMinutes + ' ' + T('мин') : '');
    });
  }
  /* страница экзамена: выбор уровня сверху и одной строкой на уровень, остальное — гармошкой */
  function calmExam() {
    var head = $(':scope > .dz-head', app), secs = $$(':scope > section', app);
    /* решение владельца 30.10.2026: на сайте нигде нет «подтверждено / не подтверждено» — ни плашки, ни подписи, ни списка неопубликованного.
       Источники и дата сверки остаются в подробностях; строка «рабочая реконструкция» — в подвале и на посадочных */
    $$(':scope > .notice:not(.info)', app).forEach(function (x) { x.remove(); });
    secs = secs.filter(function (x) {
      if (x.id === 'blocks') { x.remove(); return false; }   // блоки аудирования на странице экзамена не показываем, вход — с главной и из «Что дальше» (решение владельца 30.10.2026)
      if ($('.notice', x) && !$('.levels, .stages, table', x)) { x.remove(); return false; }
      var st = $('.stages', x), sb = st && $(':scope > .sub', x); if (sb) sb.remove();
      return true;
    });
    var callout = $('[data-act=scroll]', app); if (callout && callout.closest('.notice')) callout.closest('.notice').remove();   // блоки аудирования — в своей гармошке ниже, отдельной плашкой не выделяем
    var mock = secs.filter(function (s) { return !s.id && $('.levels', s); })[0];
    if (mock) {
      var list = $('.levels', mock), rows = $$('.level-row', list), groups = {}, order = [];
      rows.forEach(function (r) { var lv = $('.lvl', r).textContent; if (!groups[lv]) { groups[lv] = []; order.push(lv); } groups[lv].push(r); });
      var html = order.map(function (lv) {
        var g = groups[lv], next = g.filter(function (r) { return !$('.badge.ok', r); })[0] || g[0];
        var name = ($('.nm', g[0]).textContent.split(' · ').pop() || '');
        var chips = g.map(function (r, i) { var b = $('.badge', r), cls = b ? b.className.replace('badge', '').trim() : 'muted'; return '<span class="vchip ' + cls + '" role="link" tabindex="0" data-act="go" data-href="' + r.getAttribute('href') + '" title="' + (b ? b.textContent : '') + '">' + (i + 1) + '</span>'; }).join('');
        return '<a class="level-row" data-lv="' + lv + '" href="' + next.getAttribute('href') + '"><span class="lvl">' + lv + '</span><span><div class="nm">' + name + '</div></span><span class="st hub-st"><span class="variants">' + chips + '</span></span></a>';
      }).join('');
      list.innerHTML = html;
      if (head) after(head, mock);
    }
    secs.forEach(function (s) { if (s !== mock) accordion(s); });
    var src = $(':scope > footer ul', app); if (src) { var box = src.parentNode; box.appendChild(more([src])); }
  }
  function calmReady() {
    var start = $('[data-act=start]', app); if (!start) return;
    var block = start.closest('.block'), act = start.closest('.actions'); if (!block || !act) return;
    var notes = $$(':scope > p.small.muted', block);
    var hint = $('.hint', act); if (hint) notes.push(hint);
    var m = more(notes); if (m) after(act, m);
  }
  function calmExpress() {
    var start = $('[data-act=x-start]', app); if (!start) return;
    var block = start.closest('.block'), act = start.closest('.actions');
    var note = $$(':scope > p.small.muted', block).filter(function (p) { return !$('b', p); });
    var m = more(note); if (m) after(act, m);
  }
  function calmFooter() {
    var f = $(':scope > footer', app); if (!f || $('ul', f)) return;
    /* на виду ссылки и строка о независимости от организаторов; реконструкция и статистика — под кнопкой */
    var ps = Array.prototype.slice.call(f.childNodes), first = $(':scope > p', f), hide = [];
    ps.forEach(function (n) {
      if (n === first) return;
      if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = n.nodeValue.trim().split(/\.\s+/)[0] + '.'; hide.push(n); }   // вторая фраза была про подтверждённые факты
      if (n.nodeType === 1 && n.tagName === 'P' && n !== $$(':scope > p', f)[1]) hide.push(n);
    });
    var m = more(hide); if (m) f.appendChild(m);
  }
  function calmSeoNav() {
    var nav = $('.seo-nav'); if (!nav || nav.getAttribute('data-calm')) return;
    nav.setAttribute('data-calm', '1');
    var kids = Array.prototype.slice.call(nav.children).filter(function (c) { return c.tagName !== 'STYLE'; });
    nav.appendChild(fold('dz-more', isKk() ? 'Барлық емтихан мен деңгей' : 'Все экзамены и уровни', kids));
    rename(nav);
  }
  document.addEventListener('click', function (e) {   // «Все блоки ↓» ведёт в свёрнутую гармошку
    var b = e.target.closest && e.target.closest('[data-act=scroll]'); if (!b) return;
    var to = document.getElementById(b.getAttribute('data-to')); if (to && to.tagName === 'DETAILS') to.open = true;
  }, true);
  /* «Мок-тест» путает: в Дизайне 1 везде «пробный тест». В данных и словаре строки прежние, при выкладке заменить там */
  function rename(box) {
    var rules = isKk() ? RENAME_KK : RENAME_RU;
    function fix(v) { rules.forEach(function (r) { v = v.replace(r[0], r[1]); }); return v; }
    var w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) if (/[Мм]ок-тест/.test(n.nodeValue)) n.nodeValue = fix(n.nodeValue);
    if (!isKk()) {   // «хаб» — наше внутреннее слово, посетителю понятнее «главная»
      w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      while ((n = w.nextNode())) { if (n.nodeValue === 'Хаб') n.nodeValue = 'Главная'; else if (n.nodeValue === 'На хаб') n.nodeValue = 'На главную'; }
    }
    $$('a[href="/privacy/"]', box).forEach(function (a) { if (a.textContent === 'privacy') a.textContent = isKk() ? 'Қандай деректер жинаймыз' : 'Какие данные мы собираем'; });
    $$('[title*="ок-тест"]', box).forEach(function (x) { x.title = fix(x.title); });
  }
  var GEAR = '<svg class="dz-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
  function gear() {
    $$('.btn.gear', app).forEach(function (b) {
      Array.prototype.slice.call(b.childNodes).forEach(function (n) { if (n.nodeType === 3) n.remove(); });
      b.insertAdjacentHTML('afterbegin', GEAR);
    });
  }
  function privacyLinks() { $$('a[href$="/privacy/"]', app).forEach(function (a) { a.setAttribute('href', '/privacy/'); }); }
  function calm(route, p) {
    moreN = 0;
    calmHead(route);
    if (route === 'hub') calmHub();
    if (route === 'exam') calmExam();
    if (route === 'section') calmReady();
    if (route === 'express') calmExpress();
    $$('.notice', app).forEach(calmNotice);
    $$('.nsteps', app).forEach(calmNext);
    calmFooter();
    gear();
    privacyLinks();
    rename(app);
    attachToggles(app);
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
    if (D === 'd1') calm(route, p);
    if (keep && keep !== document.activeElement && document.contains(keep)) try { keep.focus({ preventScroll: true }); } catch (e) {}
  }
  enhance();
  if (D === 'd1') calmSeoNav();
  var obs = new MutationObserver(function () { enhance(); obs.takeRecords(); });
  obs.observe(app, { childList: true });

  /* посадочная уровня: кнопка, варианты и всё остальное гармошкой; тексты остаются в HTML, поисковик их видит.
     Страницы-ответы (ru/kaztest/bally/ и другие) не сворачиваем: их открывают ради самого текста. */
  function calmLanding(m, hero) {
    var lead = $(':scope > .lead', hero), last = hero.lastElementChild;
    if (lead && textLen(lead) > 60 && lead !== last) after(last, more([lead]));
    var groups = [], cur = null, tail = $$(':scope > .note, :scope > footer', m);
    Array.prototype.slice.call(m.children).forEach(function (n) {
      if (n === hero || n.classList.contains('dz-top') || tail.indexOf(n) >= 0) return;
      if (n.tagName === 'H2') { cur = { h: n, nodes: [] }; groups.push(cur); }
      else if (cur) cur.nodes.push(n);
    });
    var anchor = hero;
    groups.sort(function (x, y) { return (y.nodes.some(function (n) { return n.tagName === 'OL'; }) ? 1 : 0) - (x.nodes.some(function (n) { return n.tagName === 'OL'; }) ? 1 : 0); });   // варианты сразу под кнопкой
    groups.forEach(function (g) {
      var ol = g.nodes.filter(function (n) { return n.tagName === 'OL'; })[0];
      var tg = g.nodes.filter(function (n) { return n.classList.contains('tgbox'); })[0];
      if (tg) g.nodes.splice(g.nodes.indexOf(tg), 1);
      if (ol) {
        var box = el('section', 'dz-variants');
        box.appendChild(g.h);
        var chips = el('div', 'dz-variant-btns');
        $$('li > a', ol).forEach(function (a) { var c = el('a', 'dz-variant'); c.href = a.getAttribute('href'); c.textContent = a.textContent; chips.appendChild(c); });
        box.appendChild(chips);
        box.appendChild(more(g.nodes));
        after(anchor, box); anchor = box;
        if (tg) { after(anchor, tg); anchor = tg; }
        return;
      }
      var sec = document.createElement('section'); sec.appendChild(g.h); move(sec, g.nodes);
      after(anchor, sec);
      anchor = accordion(sec) || sec;
    });
  }

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
    if (D === 'd1' && /^\/(ru|kk)\/(kaztest|qrt)\/[a-z]\d\/$/.test(location.pathname)) calmLanding(m, hero);
    if (D === 'd1') $$('h2', m).forEach(function (h) { if (/официально не уточнено/.test(h.textContent)) { var nx = h.nextElementSibling; if (nx) nx.remove(); h.remove(); } });
    if (D === 'd1') $$('a[href$="#/exam/kaztest"]', m).forEach(function (a) { if (/аудирован|тыңдал/i.test(a.textContent)) a.setAttribute('href', a.getAttribute('href').replace(/#\/exam\/kaztest$/, '#/test/kaztest-listen-01')); });
    if (D === 'd1') rename(m);
    if (D === 'd1') attachToggles(m);
  }
})();

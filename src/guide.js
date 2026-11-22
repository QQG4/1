/* ============================================================
   Голосовой гид по курсу (21.11.2026). Реплики записаны заранее (tools/guide/), в браузер приходит только манифест KZ.guide
   с текстами и длительностями; mp3 лежат в /guide/<ru|kk>/<ключ>.mp3. Есть только в лаборатории: курс платный.
   Два голоса: проводник n (Даулет / Дмитрий) говорит, куда идти, тренер c (Айгүль / Светлана) оценивает результат и советует.
   Говорящий человечек (лента walker.webp: кадры 8-11 руки) появляется на экране, пока звучит реплика, под ним текст.
   Режим «авто» выключен по умолчанию: включается в настройках или карточкой с советом про наушники.
   ============================================================ */
(function () {
  'use strict';
  var G = KZ.guide; if (!G) return;
  var T = KZ.T, esc = KZ.util.esc;
  var LS = 'kz-trainer:guide', st = {};
  try { st = JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) {}
  st.seen = st.seen || {};
  function save() { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} }
  var ui = function () { return KZ.getUi(); };
  var auto = function () { return ui().guide === 'auto'; };
  var box = null, btn = null, card = null, au = null, queue = [], playing = null, blocked = null, hideT = null, frameT = null, frameN = 0, session = {};
  var SEQ = [8, 9, 10, 11, 10, 9];

  function onCourse() { return /^#\/?course\//.test(location.hash); }
  function build() {
    if (box) return;
    box = document.createElement('div'); box.className = 'guide'; box.id = 'guide'; box.setAttribute('role', 'status');
    box.innerHTML = '<div class="guide-man" style="background-image:url(/guide/walker.webp)" data-g="toggle"></div>' +
      '<div class="guide-bubble"><p class="guide-text"></p><div class="guide-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div class="guide-btns"><button type="button" class="btn ghost small" data-g="toggle" aria-label="' + esc(T('Пауза')) + '">⏸</button>' +
      '<a class="btn small guide-go" hidden></a><button type="button" class="btn ghost small" data-g="close" aria-label="' + esc(T('Закрыть')) + '">✕</button></div></div>';
    document.body.appendChild(box);
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'guide-launch btn small'; btn.setAttribute('data-g', 'next');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.5" y="13.5" width="5" height="7" rx="2"/><rect x="16.5" y="13.5" width="5" height="7" rx="2"/></svg> <span></span>';
    document.body.appendChild(btn);
    document.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('[data-g]'); if (!g) return;
      var a = g.getAttribute('data-g');
      if (a === 'close') stop(true);
      else if (a === 'toggle') toggle();
      else if (a === 'next') next();
      else if (a === 'card-on') { KZ.setUi('guide', 'auto'); st.carded = 1; st.seen['n.welcome'] = 1; save(); if (card) card.hidden = true; say(['n.welcome']); KZ.route(); }
      else if (a === 'card-off') { st.carded = 1; save(); if (card) card.hidden = true; }
    }, true);
    window.addEventListener('hashchange', onRoute);
  }
  function lang() { return KZ.lang === 'kk' ? 'kk' : 'ru'; }
  function textOf(key) { return G[key] ? G[key][lang()] : ''; }
  function frame(i) { var m = box.querySelector('.guide-man'); m.style.backgroundPosition = (-i * m.offsetWidth) + 'px 0'; }
  function startTalk() {
    box.classList.add('talking'); clearInterval(frameT); frameN = 0; frame(8);
    if (document.documentElement.getAttribute('data-motion') === 'off') return;
    frameT = setInterval(function () { frameN++; frame(SEQ[frameN % SEQ.length]); }, 230);
  }
  function stopTalk() { box.classList.remove('talking'); clearInterval(frameT); frameT = null; frame(8); }
  function show() { clearTimeout(hideT); box.classList.add('show'); btn.hidden = true; }
  function hide() { box.classList.remove('show'); stopTalk(); refreshBtn(); }
  function refreshBtn() { if (!btn) return; btn.hidden = !onCourse() || box.classList.contains('show'); btn.querySelector('span').textContent = T('Гид: что дальше?'); }

  /* очередь реплик: ключи или {key, href} */
  function say(items, opts) {
    build();
    if (opts && opts.now) { queue = []; if (au) { au.onended = null; au.pause(); } playing = null; }
    [].concat(items).forEach(function (it) { if (it) queue.push(typeof it === 'string' ? { key: it } : it); });
    if (!playing) playNext();
  }
  function playNext() {
    var it = queue.shift(); if (!it) { playing = null; stopTalk(); hideT = setTimeout(hide, box.querySelector('.guide-go').hidden ? 2500 : 12000); return; }
    if (!G[it.key]) return playNext();
    playing = it; show();
    box.querySelector('.guide-text').textContent = textOf(it.key);
    var go = box.querySelector('.guide-go'); if (it.href) { go.hidden = false; go.href = it.href; go.textContent = T('Перейти'); } else go.hidden = true;
    au = new Audio('/guide/' + lang() + '/' + it.key + '.mp3'); au.playbackRate = parseFloat(ui().rate) || 1;
    au.onended = function () { playing = null; playNext(); };
    au.onerror = function () { playing = null; stopTalk(); };
    var pr = au.play();
    if (pr && pr.catch) pr.catch(function () { blocked = it; box.querySelector('[data-g=toggle]:not(.guide-man)').textContent = '▶'; stopTalk(); });   // браузер не дал начать без нажатия: ждём ▶
    else startTalk();
    if (pr && pr.then) pr.then(function () { blocked = null; box.querySelector('[data-g=toggle]:not(.guide-man)').textContent = '⏸'; startTalk(); });
  }
  function toggle() {
    if (!au) return;
    if (au.paused) { au.play(); startTalk(); box.querySelector('[data-g=toggle]:not(.guide-man)').textContent = '⏸'; }
    else { au.pause(); stopTalk(); box.querySelector('[data-g=toggle]:not(.guide-man)').textContent = '▶'; }
  }
  function stop(hideNow) { queue = []; if (au) { au.onended = null; au.pause(); } playing = null; blocked = null; if (hideNow) hide(); }

  /* «что дальше» по прогрессу курса */
  function ctx() { var p = location.hash.replace(/^#\/?/, '').split('/'); return p[0] === 'course' ? { level: p[1], topic: p[2], tab: p[3] } : null; }
  function next() {
    var c = ctx(); if (!c || !c.level) return;
    var r = KZ.courseNext && KZ.courseNext(c.level, c.topic); if (r) say([r], { now: true });
  }
  /* автогид: что сказать при заходе на страницу курса; каждое вступление звучит один раз */
  function onRoute() {
    refreshBtn(); var c = ctx(); if (!c) { return; }
    if (!auto()) { offerCard(); return; }
    var keys = [];
    function once(k) { if (!st.seen[k] && G[k]) { st.seen[k] = 1; keys.push(k); } }
    if (!st.seen['n.welcome']) { once('n.welcome'); } else if (!session.back && KZ.courseProgress && c.level && KZ.courses[c.level] && KZ.courseProgress(KZ.courses[c.level]).known > 0) { session.back = 1; keys.push('c.back'); }
    if (c.level) once('n.level.' + c.level);
    if (c.topic) { once('n.topic.' + c.level + '.' + c.topic); once('n.tab.' + (c.tab || 'words')); }
    if (keys.length) { save(); say(keys); }
  }
  /* результат задания: реплика тренера, затем что делать дальше; после теста ещё совет */
  G.on = function (kind, ratio) {
    if (!auto()) return; build();
    var k = kind === 'test' ? (ratio >= 0.7 ? 'c.test.pass' : 'c.test.fail') : 'c.' + kind + '.' + (ratio >= 0.8 ? 'high' : ratio >= 0.5 ? 'mid' : 'low');
    var items = [k], c = ctx();
    if (kind === 'test') { st.tip = ((st.tip || 0) % 6) + 1; save(); items.push('c.tip.' + st.tip); }
    var nx = c && KZ.courseNext && KZ.courseNext(c.level, c.topic); if (nx) items.push(nx);
    say(items, { now: true });
  };
  /* карточка с советом про наушники: один раз, при первом заходе в курс */
  function offerCard() {
    if (st.carded || card) return;
    card = document.createElement('div'); card.className = 'guide-card';
    card.innerHTML = '<p>' + esc(T('Совет: надень наушники и включи голосового гида, он будет подсказывать каждый шаг.')) + '</p><div class="row"><button type="button" class="btn small" data-g="card-on">' + esc(T('Включить гида')) + '</button><button type="button" class="btn ghost small" data-g="card-off">' + esc(T('Не сейчас')) + '</button></div>';
    document.body.appendChild(card);
  }
  window.addEventListener('hashchange', function () { if (card && !onCourse()) card.hidden = true; else if (card && !st.carded) card.hidden = false; });
  build(); refreshBtn(); setTimeout(onRoute, 600);
})();

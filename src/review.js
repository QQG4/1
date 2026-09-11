/* ============================================================
   Чек-лист эксперта по содержанию: маршрут #/review (только основной сайт, не демо).
   Сервера нет — ответы уходят готовым письмом (mailto на KZ.site.feedbackEmail), в Telegram
   (KZ.site.feedbackTelegram) или копируются текстом. Черновик — localStorage 'kz-trainer:review'.
   ============================================================ */
(function () {
  'use strict';
  var T = KZ.T, U = KZ.util, esc = U.esc;
  var ITEMS = [
    ['level', 'Тексты и вопросы соответствуют заявленному уровню', 'A1–A2: бытовые темы, простые предложения; B1–B2: официально-деловая и общественная лексика; C1–C2: абстрактная лексика, позиция автора.'],
    ['format', 'Формат соответствует реальному экзамену', 'Типы заданий, число вариантов ответа, формулировки, хронометраж разделов.'],
    ['keys', 'Ключи верны и ответ единственный', 'Правильный ответ действительно правильный, и ни один дистрактор нельзя защитить как тоже верный.'],
    ['distractors', 'Дистракторы правдоподобны', 'Неверные варианты не выдают себя длиной, стилем или явной нелепостью.'],
    ['language', 'Язык заданий: орфография, грамматика, естественность', 'Ошибки в написании, кальки с русского, неестественные обороты в вопросах и вариантах.'],
    ['texts', 'Тексты для чтения и аудирования звучат естественно', 'Похожи ли на реальную речь и публицистику, нет ли искусственных фраз.'],
    ['audio', 'Озвучка: произношение, ударение, темп', 'Отметьте слова с неверным ударением или интонацией — их можно поправить точечно.'],
    ['explain', 'Разбор после ответа верен и понятен', 'Пояснения к правильному ответу не содержат ошибок и помогают понять, почему.'],
    ['writing', 'Письмо и говорение: темы, каркас, критерии', 'Темы реалистичны для экзамена, чек-листы самопроверки и критерии отражены верно.'],
    ['ui', 'Казахский интерфейс и удобство прохождения', 'Переводы кнопок и подсказок корректны, таймер, плеер и навигация не мешают.']
  ];
  var RATES = [['ok', 'Норма'], ['warn', 'Есть замечания'], ['bad', 'Критично']];
  var KEY = 'kz-trainer:review';
  var d = null;
  function load() { if (d) return d; try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {} d = d || { name: '', role: '', scope: '', browser: '', items: {}, issues: [{}], free: '' }; return d; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }

  function view() {
    var v = load();
    var items = ITEMS.map(function (it) {
      var x = v.items[it[0]] || {};
      return '<div class="rv-item' + (x.rate ? ' ' + x.rate : '') + (x.comment || (x.rate && x.rate !== 'ok') ? ' open' : '') + '" data-k="' + it[0] + '">' +
        '<div><div class="q">' + T(it[1]) + '</div><div class="small muted">' + T(it[2]) + '</div></div>' +
        '<div class="rv-seg" role="radiogroup">' + RATES.map(function (r) { return '<label class="' + r[0] + (x.rate === r[0] ? ' on' : '') + '"><input type="radio" name="rv-' + it[0] + '" value="' + r[0] + '"' + (x.rate === r[0] ? ' checked' : '') + '>' + T(r[1]) + '</label>'; }).join('') + '</div>' +
        '<button class="rv-more" type="button" data-act="rv-more">+ ' + T('комментарий') + '</button>' +
        '<textarea data-rv="c-' + it[0] + '" placeholder="' + T('Где именно и что не так') + '">' + esc(x.comment || '') + '</textarea></div>';
    }).join('');
    var issues = (v.issues.length ? v.issues : [{}]).map(function (i, n) {
      return '<div class="rv-issue" data-i="' + n + '">' +
        '<input type="text" data-rv="i-test" placeholder="' + T('Тест или тема (QRT B1 вариант 2)') + '" value="' + esc(i.test || '') + '">' +
        '<input type="text" data-rv="i-section" placeholder="' + T('Раздел (Оқылым, Жазылым…)') + '" value="' + esc(i.section || '') + '">' +
        '<input type="text" data-rv="i-num" placeholder="' + T('№ задания') + '" value="' + esc(i.num || '') + '">' +
        '<textarea data-rv="i-what" placeholder="' + T('Что не так') + '">' + esc(i.what || '') + '</textarea>' +
        '<input type="text" data-rv="i-fix" class="full" placeholder="' + T('Как правильно (если знаете)') + '" value="' + esc(i.fix || '') + '">' +
        '<button class="rv-rm" type="button" data-act="rv-rm" data-i="' + n + '">' + T('убрать') + '</button></div>';
    }).join('');
    var done = ITEMS.filter(function (it) { return v.items[it[0]] && v.items[it[0]].rate; }).length;
    var tg = KZ.site && KZ.site.feedbackTelegram, mail = KZ.site && KZ.site.feedbackEmail;
    return U.topbar([{ label: T('Хаб'), href: '#/' }, { label: T('Чек-лист эксперта') }]) +
      '<div class="kicker">' + T('Сараптама') + '</div><h1>' + T('Чек-лист эксперта по содержанию') + '</h1>' +
      '<p class="lede">' + T('Пройдите один или несколько мок-тестов, затем отметьте пункты ниже и добавьте найденные ошибки. Это займёт около 10 минут. Черновик сохраняется в этом браузере.') + '</p>' +
      '<div class="block"><span class="setlabel">' + T('Кто проверяет') + '</span><div class="rv-grid">' +
        '<label>' + T('Имя') + '<input type="text" data-rv="name" value="' + esc(v.name) + '"></label>' +
        '<label>' + T('Роль') + '<input type="text" data-rv="role" placeholder="' + T('методист, преподаватель, носитель…') + '" value="' + esc(v.role) + '"></label>' +
        '<label>' + T('Что проверяли') + '<input type="text" data-rv="scope" placeholder="' + T('QRT B1 варианты 1 и 2, курс A2…') + '" value="' + esc(v.scope) + '"></label>' +
        '<label>' + T('Браузер и устройство') + '<input type="text" data-rv="browser" placeholder="' + T('Safari на iPhone, Chrome на ноутбуке…') + '" value="' + esc(v.browser) + '"></label>' +
      '</div></div>' +
      '<div class="block"><span class="setlabel">' + T('Чек-лист') + ' · ' + done + ' / ' + ITEMS.length + '</span><p class="small muted">' + T('По каждому пункту одна из трёх оценок. «Есть замечания» и «Критично» открывают поле для пояснения.') + '</p>' + items + '</div>' +
      '<div class="block"><span class="setlabel">' + T('Найденные ошибки') + '</span><p class="small muted">' + T('Каждую ошибку отдельной строкой: так их проще исправить.') + '</p>' + issues +
        '<div class="actions"><button class="btn ghost small" data-act="rv-add">+ ' + T('Добавить ошибку') + '</button></div></div>' +
      '<div class="block"><span class="setlabel">' + T('Дополнительные комментарии') + '</span><p class="small muted">' + T('Свободная форма: наблюдения, сомнения, идеи, сравнение с реальным экзаменом.') + '</p>' +
        '<textarea data-rv="free" style="min-height:140px">' + esc(v.free) + '</textarea></div>' +
      '<div class="block"><div class="actions">' +
        (mail ? '<button class="btn" data-act="rv-mail">' + T('Отправить письмом') + '</button>' : '') +
        (tg ? '<button class="btn secondary" data-act="rv-tg">' + T('Отправить в Telegram') + '</button>' : '') +
        '<button class="btn ghost" data-act="rv-copy">' + T('Скопировать текстом') + '</button><span class="hint" id="rv-msg"></span></div>' +
        '<textarea id="rv-out" class="rv-out" readonly hidden></textarea></div>';
  }

  function asText() {
    var v = load(), L = ['Сараптама Qazaq Trainer', 'Эксперт: ' + v.name + (v.role ? ' (' + v.role + ')' : ''), 'Проверял(а): ' + v.scope, 'Браузер: ' + v.browser, ''];
    ITEMS.forEach(function (it) { var x = v.items[it[0]] || {}; L.push('• ' + it[1] + ': ' + (x.rate ? { ok: 'норма', warn: 'есть замечания', bad: 'КРИТИЧНО' }[x.rate] : '—') + (x.comment ? ' — ' + x.comment : '')); });
    var iss = v.issues.filter(function (i) { return i.what || i.test; });
    if (iss.length) { L.push('', 'Ошибки:'); iss.forEach(function (i, n) { L.push((n + 1) + '. ' + [i.test, i.section, i.num ? '№' + i.num : ''].filter(Boolean).join(' · ') + ': ' + (i.what || '') + (i.fix ? ' → ' + i.fix : '')); }); }
    if (v.free) L.push('', 'Дополнительно: ' + v.free);
    return L.join('\n');
  }
  function msg(s) { var m = document.getElementById('rv-msg'); if (m) m.textContent = s; }
  function showOut() { var o = document.getElementById('rv-out'); if (o) { o.value = asText(); o.hidden = false; o.select(); } }

  KZ.registerRoute(function (p) { if (p[0] !== 'review' || (KZ.site && KZ.site.demo)) return null; return view(); });

  document.addEventListener('input', function (e) {
    var el = e.target, k = el.getAttribute && el.getAttribute('data-rv'); if (!k) return;
    var v = load();
    if (k.indexOf('c-') === 0) { v.items[k.slice(2)] = v.items[k.slice(2)] || {}; v.items[k.slice(2)].comment = el.value; }
    else if (k.indexOf('i-') === 0) { var n = +el.closest('.rv-issue').getAttribute('data-i'); v.issues[n] = v.issues[n] || {}; v.issues[n][k.slice(2)] = el.value; }
    else v[k] = el.value;
    save();
  });
  document.addEventListener('change', function (e) {
    var el = e.target; if (!(el.name && el.name.indexOf('rv-') === 0)) return;
    var v = load(), k = el.name.slice(3); v.items[k] = v.items[k] || {}; v.items[k].rate = el.value; save();
    var it = el.closest('.rv-item'); it.classList.remove('ok', 'warn', 'bad'); it.classList.add(el.value); if (el.value !== 'ok') it.classList.add('open');
    it.querySelectorAll('.rv-seg label').forEach(function (l) { l.classList.toggle('on', l.querySelector('input').checked); });
    var lbl = document.querySelector('.block .setlabel:nth-of-type(1)');
    var done = ITEMS.filter(function (x) { return v.items[x[0]] && v.items[x[0]].rate; }).length;
    document.querySelectorAll('.setlabel').forEach(function (s) { if (s.textContent.indexOf(T('Чек-лист')) === 0) s.textContent = T('Чек-лист') + ' · ' + done + ' / ' + ITEMS.length; });
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act^="rv-"]'); if (!b) return;
    var act = b.getAttribute('data-act'), v = load();
    if (act === 'rv-more') { b.closest('.rv-item').classList.add('open'); b.closest('.rv-item').querySelector('textarea').focus(); }
    else if (act === 'rv-add') { v.issues.push({}); save(); KZ.route(); }
    else if (act === 'rv-rm') { v.issues.splice(+b.getAttribute('data-i'), 1); if (!v.issues.length) v.issues.push({}); save(); KZ.route(); }
    else if (act === 'rv-copy') { showOut(); try { navigator.clipboard.writeText(asText()); msg(T('Скопировано. Отправьте текст команде любым удобным способом.')); } catch (x) { msg(T('Выделите текст ниже и скопируйте.')); } }
    else if (act === 'rv-mail') {
      if (!v.name) { msg(T('Укажите имя, чтобы мы могли вернуться с уточнениями.')); return; }
      var body = asText(); if (body.length > 1800) { showOut(); msg(T('Текст длинный: письмо откроется с началом, остальное скопируйте из поля ниже.')); }
      location.href = 'mailto:' + KZ.site.feedbackEmail + '?subject=' + encodeURIComponent('Сараптама Qazaq Trainer — ' + v.name) + '&body=' + encodeURIComponent(body.slice(0, 1800));
    }
    else if (act === 'rv-tg') { showOut(); try { navigator.clipboard.writeText(asText()); } catch (x) {} msg(T('Текст скопирован — вставьте его в чат.')); window.open('https://t.me/' + KZ.site.feedbackTelegram, '_blank', 'noopener'); }
  });
})();

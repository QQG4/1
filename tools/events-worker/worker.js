/* Приёмник статистики Qazaq Trainer. Cloudflare Worker + D1.
   Принимает POST от KZ.track()/sendEvent() и складывает в две таблицы: events и answers.
   Тело — JSON, но заголовок Content-Type приходит text/plain: так браузер не делает предварительный запрос CORS
   (с application/json событие из sendBeacon теряется). Поэтому тип содержимого здесь не проверяем, читаем как текст.
   Персональных данных не принимает: sid — случайный идентификатор вкладки, IP не пишем.
   Деплой: см. README.md рядом. */

import { SESSIONS } from './sessions.js';

const ALLOWED = [                      // откуда принимаем события (CORS + защита от чужих сайтов)
  'https://qazaqtrainer.com',         // основной домен
  'https://www.qazaqtrainer.com',
  'https://qazaq-trainer.k-k-g-inter.workers.dev',  // площадка Cloudflare, пока домен не привязан
  'https://qqg4.github.io',           // старый адрес, пока живы ссылки на него
];
const EVENTS = ['pageview', 'section-start', 'section-done', 'test-done', 'audio-play', 'lang', 'setting', 'answers', 'report', 'feedback', 'expert_review', 'remind', 'js-error', 'share', 'sync'];
const MAX_BODY = 64 * 1024;   // анкета эксперта бывает длинной

function cors(origin) {
  const ok = ALLOWED.indexOf(origin) >= 0;
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Access-Control-Max-Age': '86400',
  };
}
const str = (v, n) => (v == null ? null : String(v).slice(0, n));
const int = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : null);

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === '/tg/webhook') return tgWebhook(request, env, ctx);
    if (path === '/tg/setup') return tgSetup(request, env);
    if (path === '/agent/report') return agentReport(request, env);
    if (path === '/sync/put' || path === '/sync/get') return transfer(request, env, path);
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors(origin) });
    if (origin && ALLOWED.indexOf(origin) < 0) return new Response('forbidden origin', { status: 403, headers: cors(origin) });

    const raw = await request.text();
    if (raw.length > MAX_BODY) return new Response('too large', { status: 413, headers: cors(origin) });
    let d;
    try { d = JSON.parse(raw); } catch (e) { return new Response('bad json', { status: 400, headers: cors(origin) }); }
    if (!d || EVENTS.indexOf(d.e) < 0) return new Response('unknown event', { status: 400, headers: cors(origin) });

    const p = d.p && typeof d.p === 'object' ? d.p : {};
    const day = new Date().toISOString().slice(0, 10);
    const country = request.cf && request.cf.country ? String(request.cf.country) : null;   // страна, без IP
    const stmts = [];

    stmts.push(env.DB.prepare(
      `INSERT INTO events (day, ts, sid, name, lang, exam, level, test, section, pct, seconds, practice, timed_out, path, country, qid, note, text, ua, ref, utm)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      day, int(d.ts) || Date.now(), str(d.sid, 32), str(d.e, 24), str(d.lang, 4),
      str(p.exam, 16), str(p.level, 4), str(p.test, 40), str(p.section, 16),
      int(p.pct), int(p.seconds), p.practice ? 1 : 0, p.timedOut ? 1 : 0, str(p.path, 120), country,
      str(p.qid, 24), str(d.e === 'expert_review' ? p.expert : p.why, 100),   // жалоба: вопрос и причина; анкета: имя эксперта
      str(p.text, d.e === 'expert_review' ? 20000 : 1000), str(p.ua, 200),   // свободное сообщение и браузер; анкета эксперта — целиком
      str(p.ref, 80), str(p.utm, 130)   // откуда пришли: домен источника и utm-метки (только первый просмотр вкладки)
    ));

    if (d.e === 'answers' && Array.isArray(p.q)) {
      for (const q of p.q.slice(0, 80)) {
        stmts.push(env.DB.prepare(
          `INSERT INTO answers (day, sid, test, section, qid, chosen, ok) VALUES (?,?,?,?,?,?,?)`
        ).bind(day, str(d.sid, 32), str(p.test, 40), str(p.section, 16), str(q.id, 24), int(q.a), q.ok ? 1 : 0));
      }
    }

    try { await env.DB.batch(stmts); }
    catch (e) { return new Response('db error', { status: 500, headers: cors(origin) }); }

    // Владельцу — сразу в Telegram: отзыв, жалоба на вопрос, поломка страницы. Текст писали посетители:
    // отправляем как обычный текст, без разметки и без ссылок из него, и обрезаем.
    if (ctx && ALERTS.indexOf(d.e) >= 0 && env.TG_BOT_TOKEN && env.TG_OWNER_CHAT) {
      const head = { feedback: 'Новое сообщение с сайта', report: 'Жалоба на вопрос', 'js-error': 'Ошибка на странице' }[d.e];
      const lines = [head,
        p.test ? 'тест: ' + str(p.test, 40) + (p.section ? ' / ' + str(p.section, 16) : '') + (p.qid ? ' / ' + str(p.qid, 24) : '') : null,
        p.path ? 'страница: #/' + str(p.path, 120) : null,
        p.why ? 'причина: ' + str(p.why, 100) : null,
        p.text ? '---\n' + String(p.text).slice(0, 700) : null,
        'Статистика: https://lab.qazaqtrainer.com/stats/'];
      ctx.waitUntil(tg(env, 'sendMessage', { chat_id: env.TG_OWNER_CHAT, text: lines.filter(Boolean).join('\n'), disable_web_page_preview: true }));
    }
    return new Response(null, { status: 204, headers: cors(origin) });
  },

  /* Расписания в wrangler.toml: 03:17 UTC — чистка старых записей, 04:00 UTC (09:00 по Алматы) — «задание дня» в канал. */
  /* Расписания в wrangler.toml: 03:17 UTC — чистка старых записей; ежечасно — задания дня в канал
     (09:00, 13:00 и 19:00 по Алматы, то есть 04, 08 и 14 UTC). Часы держим в одном месте — TASKS. */
  async scheduled(event, env) {
    if (event.cron !== HOURLY_CRON) return purge(env);
    const h = new Date().getUTCHours(), task = TASKS.find((t) => t.utc === h);
    if (!task) return;
    if (h === 4) await postReminders(env);
    const kind = typeof task.kind === 'function' ? task.kind() : task.kind;
    if (kind === 'ask') return postAsk(env);
    if (kind === 'weekly') return postWeekly(env);
    return postTask(env, kind);
  },
};

/* ---------- Telegram ---------- */
const HOURLY_CRON = '0 * * * *';
const dayNo = () => Math.floor(Date.now() / 864e5);
/* Три задания в день. Утром — чтение с текстом, днём — грамматика и лексика через день (грамматических заданий
   меньше, так набор растягивается), вечером — аудирование с нашим mp3. Ссылка на сайт идёт только в вечернем
   посте: решение владельца — не больше одного рекламного поста в день. */
const TASKS = [
  { utc: 4, kind: 'reading' },
  { utc: 8, kind: () => {
      const wd = new Date().getUTCDay();          // 0 — воскресенье, 5 — пятница
      if (wd === 0) return 'weekly';              // разбор самого трудного вопроса недели
      if (wd === 5) return 'ask';                 // опрос подписчиков
      return dayNo() % 2 ? 'grammar' : 'lexis';
    } },
  { utc: 14, kind: 'listening' },
];
const KIND_HEAD = {
  reading: '📖 Оқылым / Чтение',
  grammar: '✍️ Грамматика',
  lexis: '🔤 Лексика',
  listening: '🎧 Тыңдалым / Аудирование',
};
const ALERTS = ['feedback', 'report', 'js-error'];
const SITE = 'https://qazaqtrainer.com/';

async function tg(env, method, body) {
  const r = await fetch('https://api.telegram.org/bot' + env.TG_BOT_TOKEN + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) { console.log('telegram ' + method + ' → ' + r.status + ' ' + (await r.text()).slice(0, 300)); return null; }
  try { return (await r.json()).result || true; } catch (e) { return true; }   // result нужен ради id викторины
}

/* Задание дня: вопрос из docs/quiz.json публикуется викториной Telegram с пояснением. Для чтения перед викториной
   уходит сам текст, для аудирования — mp3 с сайта. Вопрос выбирается по номеру дня: шаг 7919 взаимно прост с любым
   разумным размером набора, поэтому задания не повторяются, пока набор не кончится (в каждом от 85 до 320).
   Без канала и токена ничего не делает. */
async function postTask(env, kind) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL) return;
  const res = await fetch(SITE + 'quiz.json', { cf: { cacheTtl: 300 } });
  if (!res.ok) return console.log('quiz.json → ' + res.status);
  const data = await res.json();
  const pool = (data && data[kind]) || [];
  if (!pool.length) return console.log('пустой набор: ' + kind);
  const q = pool[(dayNo() * 7919) % pool.length];
  const exam = q.exam === 'kaztest' ? 'ҚАЗТЕСТ' : 'QazResmiTest';
  const head = KIND_HEAD[kind] + ' · ' + exam + ' ' + q.level;

  if (kind === 'reading') {
    await tg(env, 'sendMessage', { chat_id: env.TG_CHANNEL, disable_web_page_preview: true,
      text: head + (q.excerpt ? ' (үзінді / отрывок)' : '') + '\n\n' + (q.title ? q.title + '\n\n' : '') + String(q.body || '').slice(0, 3400) +
        '\n\nСұраққа жауап беріңіз 👇 / Ответьте на вопрос ниже 👇' });
  } else if (kind === 'listening') {
    await tg(env, 'sendAudio', { chat_id: env.TG_CHANNEL, audio: SITE + q.audio, title: q.title || exam + ' ' + q.level,
      performer: 'Qazaq Trainer', caption: head + '\nТыңдап, сұраққа жауап беріңіз. / Послушайте и ответьте на вопрос.' });
  }

  const sent = await tg(env, 'sendPoll', {
    chat_id: env.TG_CHANNEL,
    question: ((kind === 'reading' || kind === 'listening' ? '' : head + '\n') + q.text).slice(0, 300),
    options: q.options.map((o) => String(o).slice(0, 100)),
    type: 'quiz', correct_option_id: q.answer, is_anonymous: true,
    explanation: (q.explain || '').slice(0, 200),
  });
  if (!sent) return;
  if (sent.poll && sent.poll.id) {
    await env.DB.prepare(`INSERT OR REPLACE INTO tg_polls (poll_id, day, kind, test, qid, question, answer, explain, votes, right_votes)
                          VALUES (?,?,?,?,?,?,?,?,0,0)`)
      .bind(String(sent.poll.id), new Date().toISOString().slice(0, 10), kind, q.test, q.qid,
            q.text.slice(0, 300), q.answer, (q.explain || '').slice(0, 300)).run();
  }

  // Ссылка на сайт — один раз в день, в вечернем посте
  if (kind === 'listening') {
    await tg(env, 'sendMessage', { chat_id: env.TG_CHANNEL, disable_web_page_preview: false,
      text: 'Толық сынақ тест (тегін, тіркеусіз): ' + SITE + 'kk/' + q.exam + '/' + String(q.level).toLowerCase() + '/?utm_source=telegram&utm_medium=quiz' +
        '\nПолный пробный тест — бесплатно, без регистрации.' });
  }
  await env.DB.prepare(`INSERT INTO events (day, ts, name, exam, level, test, section, qid) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(new Date().toISOString().slice(0, 10), Date.now(), 'tg-quiz', q.exam, q.level, q.test, kind, q.qid).run();
}

/* Опрос подписчиков по пятницам: обычный опрос (не викторина), тема меняется по номеру недели.
   Ответы видно в самом Telegram — это и способ узнать аудиторию, и повод зайти в канал. */
const ASKS = [
  { q: 'Қай бөлім сізге қиын? / Какой раздел даётся труднее всего?', o: ['Тыңдалым / Аудирование', 'Оқылым / Чтение', 'Лексика, грамматика', 'Жазылым / Письмо', 'Айтылым / Говорение'] },
  { q: 'Қай емтиханға дайындаласыз? / К какому экзамену готовитесь?', o: ['ҚАЗТЕСТ', 'QazResmiTest', 'Екеуіне де / К обоим', 'Әзірге шешпедім / Пока не решил'] },
  { q: 'Қандай деңгей керек? / Какой уровень нужен?', o: ['A1–A2', 'B1', 'B2', 'C1', 'C2'] },
  { q: 'Емтиханды қашан тапсырасыз? / Когда сдаёте экзамен?', o: ['Бір ай ішінде / В течение месяца', '2–3 ай ішінде / Через 2–3 месяца', 'Биыл / В этом году', 'Әлі белгісіз / Пока не знаю'] },
  { q: 'Арнада не көбірек керек? / Чего не хватает в канале?', o: ['Тыңдалым / Аудирование', 'Жазылым үлгілері / Образцы письма', 'Грамматика түсіндірмесі / Разбор грамматики', 'Сөздік / Лексика', 'Бәрі жеткілікті / Всего хватает'] },
];
async function postAsk(env) {
  const a = ASKS[Math.floor(dayNo() / 7) % ASKS.length];
  const sent = await tg(env, 'sendPoll', { chat_id: env.TG_CHANNEL, question: a.q.slice(0, 300), options: a.o, is_anonymous: true });
  if (sent) await env.DB.prepare(`INSERT INTO events (day, ts, name, section) VALUES (?,?,?,?)`)
    .bind(new Date().toISOString().slice(0, 10), Date.now(), 'tg-quiz', 'ask').run();
}

/* Вопрос недели по воскресеньям: из викторин за семь дней берём ту, где доля верных ответов ниже всего
   (и где проголосовало хотя бы трое), и разбираем её ещё раз. Если данных не набралось, вместо разбора
   выходит обычное задание — пустой пост в канал не уходит. */
async function postWeekly(env) {
  const row = await env.DB.prepare(
    `SELECT question, explain, votes, right_votes FROM tg_polls
     WHERE day >= date('now','-7 day') AND votes >= 3
     ORDER BY (right_votes * 1.0 / votes) ASC, votes DESC LIMIT 1`).first();
  if (!row) return postTask(env, dayNo() % 2 ? 'grammar' : 'lexis');
  const pct = Math.round(100 * row.right_votes / row.votes);
  await tg(env, 'sendMessage', { chat_id: env.TG_CHANNEL, disable_web_page_preview: true,
    text: '🏁 Апта сұрағы / Вопрос недели\n\n' + row.question + '\n\n' +
      'Дұрыс жауап берген / Ответили верно: ' + pct + ' % (' + row.votes + ' дауыс / голосов)\n\n' +
      (row.explain || '') });
  await env.DB.prepare(`INSERT INTO events (day, ts, name, section) VALUES (?,?,?,?)`)
    .bind(new Date().toISOString().slice(0, 10), Date.now(), 'tg-quiz', 'weekly').run();
}

/* Напоминания о сессиях ҚАЗТЕСТ из sessions.js. Сегодняшняя дата — по Астане (UTC+5). */
function dayShift(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function ruDate(iso) { const m = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']; const [, mm, dd] = iso.split('-'); return +dd + ' ' + m[+mm - 1]; }
function kkDate(iso) { const m = ['қаңтар','ақпан','наурыз','сәуір','мамыр','маусым','шілде','тамыз','қыркүйек','қазан','қараша','желтоқсан']; const [, mm, dd] = iso.split('-'); return +dd + ' ' + m[+mm - 1]; }
async function postReminders(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL || !SESSIONS.length) return;
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  for (const s of SESSIONS) {
    let kk = '', ru = '';
    if (today === s.regFrom) {
      kk = '📝 ҚАЗТЕСТ: өтінім қабылдау ашылды — ' + kkDate(s.regFrom) + ' – ' + kkDate(s.regTo) + '. Тестілеу — ' + kkDate(s.test) + '.';
      ru = '📝 ҚАЗТЕСТ: открыт приём заявок — ' + ruDate(s.regFrom) + ' – ' + ruDate(s.regTo) + '. Тестирование — ' + ruDate(s.test) + '.';
    } else if (today === dayShift(s.regTo, -1)) {
      kk = '⏳ ҚАЗТЕСТ: ертең, ' + kkDate(s.regTo) + ', өтінім берудің соңғы күні. Тестілеу — ' + kkDate(s.test) + '.';
      ru = '⏳ ҚАЗТЕСТ: завтра, ' + ruDate(s.regTo) + ', последний день приёма заявок. Тестирование — ' + ruDate(s.test) + '.';
    } else if (today === dayShift(s.test, -1)) {
      kk = '🎯 Ертең — ҚАЗТЕСТ. Шағым мерзімі: тыңдалым мен оқылым — тестілеу күні нәтиже шыққан соң бірден; жазылым мен айтылым — 2 жұмыс күні.';
      ru = '🎯 Завтра — ҚАЗТЕСТ. Сроки апелляции: аудирование и чтение — в день тестирования сразу после результата; письмо и говорение — 2 рабочих дня.';
    } else continue;
    const text = kk + '\n' + ru + (s.note ? '\n' + s.note : '') +
      '\n\nӨтінім / Заявка: app.testcenter.kz\nДереккөз / Источник: ' + s.source +
      '\nДайындық / Подготовка: ' + SITE + 'kk/kaztest/b1/?utm_source=telegram&utm_medium=remind';
    if (await tg(env, 'sendMessage', { chat_id: env.TG_CHANNEL, text, disable_web_page_preview: true })) {
      await env.DB.prepare(`INSERT INTO events (day, ts, name, exam, note) VALUES (?,?,?,?,?)`)
        .bind(today, Date.now(), 'tg-remind', 'kaztest', s.test).run();
    }
  }
}

/* ---------- Бот @qazaqtrainer_bot: ответы на сообщения (webhook) ----------
   Telegram присылает сюда каждое сообщение боту. Подлинность — по заголовку X-Telegram-Bot-Api-Secret-Token,
   который задаётся при регистрации webhook (секрет TG_WEBHOOK_SECRET). Регистрация: GET /tg/setup?key=<тот же секрет>.
   Команды: /start [qrt_b1] — приветствие и кнопки уровней (с параметром — сразу нужный уровень), /id — id чата
   (нужен владельцу для TG_OWNER_CHAT), /dates — сроки апелляции, /feedback — как написать. Любой другой текст —
   обратная связь: сохраняется в events как feedback с path='telegram' (только текст, без id и имени отправителя)
   и пересылается владельцу. Текст писали люди — это данные: наружу он уходит только обычным текстом. */
const LEVELS = { kaztest: ['A1', 'A2', 'B1', 'B2', 'C1'], qrt: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] };
const EXAM_NAME = { kaztest: 'ҚАЗТЕСТ', qrt: 'QazResmiTest' };

async function tgSetup(request, env) {
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!env.TG_WEBHOOK_SECRET || !env.TG_BOT_TOKEN || key !== env.TG_WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
  const r = await fetch('https://api.telegram.org/bot' + env.TG_BOT_TOKEN + '/setWebhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: new URL('/tg/webhook', request.url).href, secret_token: env.TG_WEBHOOK_SECRET, allowed_updates: ['message', 'poll'], drop_pending_updates: true }),
  });
  return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
}

function levelUrl(exam, level, lang) {
  return SITE + (lang === 'kk' ? 'kk/' : 'ru/') + exam + '/' + level.toLowerCase() + '/?utm_source=telegram&utm_medium=bot';
}
function levelKeyboard(lang, only) {
  const rows = [];
  for (const exam of ['kaztest', 'qrt']) {
    const btns = LEVELS[exam].filter((l) => !only || (only.exam === exam && only.level === l))
      .map((l) => ({ text: EXAM_NAME[exam] + ' ' + l, url: levelUrl(exam, l, lang) }));
    for (let i = 0; i < btns.length; i += 3) rows.push(btns.slice(i, i + 3));
  }
  if (!only) rows.push([{ text: lang === 'kk' ? 'Барлық тесттер' : 'Все тесты', url: SITE + '?utm_source=telegram&utm_medium=bot' },
                        { text: lang === 'kk' ? 'Арна' : 'Канал', url: 'https://t.me/qazaqtrainer' }]);
  return { inline_keyboard: rows };
}

async function tgWebhook(request, env, ctx) {
  if (request.method !== 'POST' || !env.TG_WEBHOOK_SECRET ||
      request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TG_WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
  let u; try { u = await request.json(); } catch (e) { return new Response('ok'); }
  if (u && u.poll) {   // Telegram присылает обновлённые счётчики нашей викторины
    const p = u.poll, votes = p.total_voter_count || 0;
    const right = (p.options && p.correct_option_id != null && p.options[p.correct_option_id])
      ? (p.options[p.correct_option_id].voter_count || 0) : 0;
    await env.DB.prepare(`UPDATE tg_polls SET votes = ?, right_votes = ? WHERE poll_id = ?`).bind(votes, right, String(p.id)).run();
    return new Response('ok');
  }
  const m = u && u.message;
  if (!m || !m.chat || typeof m.text !== 'string') return new Response('ok');
  const chat = m.chat.id, text = m.text.trim();
  const lang = String((m.from && m.from.language_code) || '').startsWith('kk') ? 'kk' : 'ru';
  const say = (t, extra) => tg(env, 'sendMessage', Object.assign({ chat_id: chat, text: t, disable_web_page_preview: true }, extra || {}));
  const cmd = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : '';

  if (cmd === '/start') {
    const arg = (text.split(/\s+/)[1] || '').toLowerCase(), am = /^(kaztest|qrt)_(a1|a2|b1|b2|c1|c2)$/.exec(arg);
    const only = am && LEVELS[am[1]].indexOf(am[2].toUpperCase()) >= 0 ? { exam: am[1], level: am[2].toUpperCase() } : null;
    await say(only
      ? (EXAM_NAME[only.exam] + ' ' + only.level + ' — 5 нұсқа, тегін, тіркеусіз.\n' + EXAM_NAME[only.exam] + ' ' + only.level + ' — 5 вариантов, бесплатно и без регистрации. 👇')
      : 'Сәлеметсіз бе! Qazaq Trainer — ҚАЗТЕСТ пен QazResmiTest бойынша тегін сынақ тесттер: таймер, аудио, әр жауапқа түсіндірме.\n' +
        'Здравствуйте! Бесплатные пробные тесты ҚАЗТЕСТ и QazResmiTest: таймер, аудио, разбор каждого ответа.\n\n' +
        'Деңгейді таңдаңыз / Выберите уровень 👇\n\nҚате немесе ұсыныс — жай ғана осында жазыңыз. / Ошибка или предложение — просто напишите сюда.',
      { reply_markup: levelKeyboard(lang, only) });
  } else if (cmd === '/id') {
    await say('Telegram id: ' + chat);
  } else if (cmd === '/dates') {
    await say('ҚАЗТЕСТ бойынша шағым беру мерзімі: тыңдалым мен оқылым — тестілеу күні нәтиже шыққан соң бірден; жазылым мен айтылым — нәтижеден кейін 2 жұмыс күні ішінде (app.testcenter.kz).\n' +
      'Апелляция по ҚАЗТЕСТ: аудирование и чтение — в день тестирования сразу после результата; письмо и говорение — 2 рабочих дня после результата (app.testcenter.kz).\n\n' +
      'Тестілеу кестесі / Расписание: testcenter.kz\nЕске салулар / Напоминания: t.me/qazaqtrainer');
  } else if (cmd === '/feedback') {
    await say('Не дұрыс емес немесе нені жақсартуға болады — бір хабарламамен осында жазыңыз.\nЧто не так или что улучшить — напишите одним сообщением сюда.');
  } else if (cmd) {
    await say('/start — деңгейлер / уровни\n/dates — шағым мерзімі / сроки апелляции\n/feedback — қате туралы / сообщить об ошибке');
  } else {
    const body = text.slice(0, 1000);
    await env.DB.prepare(`INSERT INTO events (day, ts, name, path, text) VALUES (?,?,?,?,?)`)
      .bind(new Date().toISOString().slice(0, 10), Date.now(), 'feedback', 'telegram', body).run();
    if (env.TG_OWNER_CHAT && String(chat) !== String(env.TG_OWNER_CHAT)) {
      ctx.waitUntil(tg(env, 'sendMessage', { chat_id: env.TG_OWNER_CHAT, text: 'Сообщение боту\n---\n' + body, disable_web_page_preview: true }));
    }
    await say('Рақмет, хабарламаңызды алдық. / Спасибо, сообщение получили.');
  }
  return new Response('ok');
}

/* Перенос прогресса между устройствами по коду. Без аккаунта: POST /sync/put кладёт прогресс и возвращает код,
   GET /sync/get?code=… отдаёт его обратно. В прогрессе нет ни имени, ни почты — только результаты разделов;
   запись живёт 24 часа и удаляется ночным cron. Код из 8 знаков без похожих букв (0/O, 1/I) — 32^8 ≈ 1e12 вариантов. */
const CODE_ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const SYNC_MAX = 512 * 1024;
const SYNC_TTL = 24 * 3600e3;
function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(r, (b) => CODE_ABC[b % 32]).join('');
}
async function transfer(request, env, path) {
  const origin = request.headers.get('Origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (origin && ALLOWED.indexOf(origin) < 0) return new Response('forbidden origin', { status: 403, headers: cors(origin) });
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, cors(origin)) });

  if (path === '/sync/put') {
    if (request.method !== 'POST') return json({ error: 'post only' }, 405);
    const body = await request.text();
    if (!body || body.length > SYNC_MAX) return json({ error: 'size' }, 413);
    try { JSON.parse(body); } catch (e) { return json({ error: 'bad json' }, 400); }
    const code = newCode();
    await env.DB.prepare(`INSERT OR REPLACE INTO transfers (code, ts, data) VALUES (?,?,?)`).bind(code, Date.now(), body).run();
    return json({ code, hours: 24 });
  }
  const code = (new URL(request.url).searchParams.get('code') || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
  if (code.length !== 8) return json({ error: 'bad code' }, 400);
  const row = await env.DB.prepare(`SELECT data, ts FROM transfers WHERE code = ?`).bind(code).first();
  if (!row || Date.now() - row.ts > SYNC_TTL) return json({ error: 'not found' }, 404);
  return new Response(row.data, { headers: Object.assign({ 'Content-Type': 'application/json' }, cors(origin)) });
}

/* Утренний отчёт дежурного агента (задача Claude на Mac владельца) → личный чат владельца.
   Токен бота живёт только в Cloudflare, поэтому агент шлёт отчёт сюда: POST с заголовком X-Agent-Key
   (секрет AGENT_KEY; копия у владельца в ~/.config/qazaq-trainer/telegram.env) и телом — обычным текстом.
   Длинный отчёт режется на куски по 3900 знаков (лимит сообщения Telegram — 4096). */
async function agentReport(request, env) {
  if (request.method !== 'POST' || !env.AGENT_KEY || request.headers.get('X-Agent-Key') !== env.AGENT_KEY) return new Response('forbidden', { status: 403 });
  if (!env.TG_BOT_TOKEN || !env.TG_OWNER_CHAT) return new Response('telegram not configured', { status: 503 });
  const text = (await request.text()).slice(0, 20000).trim();
  if (!text) return new Response('empty', { status: 400 });
  let ok = true;
  for (let i = 0; i < text.length; i += 3900) {
    ok = (await tg(env, 'sendMessage', { chat_id: env.TG_OWNER_CHAT, text: text.slice(i, i + 3900), disable_web_page_preview: true })) && ok;
  }
  return new Response(ok ? 'sent' : 'telegram error', { status: ok ? 200 : 502 });
}

// Срок хранения — 12 месяцев (обещан на странице /privacy/). Раз в сутки по расписанию из wrangler.toml
  // удаляются события и ответы старше года, включая тексты обратной связи и анкеты экспертов.
async function purge(env) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM events WHERE day < date('now', '-365 day')`),
    env.DB.prepare(`DELETE FROM answers WHERE day < date('now', '-365 day')`),
    env.DB.prepare(`DELETE FROM transfers WHERE ts < ?`).bind(Date.now() - SYNC_TTL),
  ]);
}

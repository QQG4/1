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
const EVENTS = ['pageview', 'section-start', 'section-done', 'test-done', 'audio-play', 'lang', 'setting', 'answers', 'report', 'feedback', 'expert_review', 'remind', 'js-error', 'share'];
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
  async scheduled(event, env) {
    if (event.cron === QUIZ_CRON) { await postReminders(env); return postQuiz(env); }
    return purge(env);
  },
};

/* ---------- Telegram ---------- */
const QUIZ_CRON = '0 4 * * *';
const ALERTS = ['feedback', 'report', 'js-error'];
const SITE = 'https://qazaqtrainer.com/';

async function tg(env, method, body) {
  const r = await fetch('https://api.telegram.org/bot' + env.TG_BOT_TOKEN + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) console.log('telegram ' + method + ' → ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return r.ok;
}

/* «Задание дня»: вопрос из docs/quiz.json публикуется как викторина Telegram с пояснением,
   следом — короткое сообщение со ссылкой на полный тест. Вопрос выбирается по номеру дня:
   шаг 7919 взаимно прост с любым разумным размером списка, поэтому вопросы не повторяются,
   пока не кончится список (сейчас ~380, то есть больше года). Без канала и токена ничего не делает. */
async function postQuiz(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL) return;
  const res = await fetch(SITE + 'quiz.json', { cf: { cacheTtl: 300 } });
  if (!res.ok) return console.log('quiz.json → ' + res.status);
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) return;
  const day = Math.floor(Date.now() / 864e5);
  const q = list[(day * 7919) % list.length];
  const exam = q.exam === 'kaztest' ? 'ҚАЗТЕСТ' : 'QazResmiTest';
  const link = SITE + 'kk/' + q.exam + '/' + String(q.level).toLowerCase() + '/?utm_source=telegram&utm_medium=quiz';
  const ok = await tg(env, 'sendPoll', {
    chat_id: env.TG_CHANNEL,
    question: (exam + ' · ' + q.level + '\n' + q.text).slice(0, 300),
    options: q.options.map((o) => String(o).slice(0, 100)),
    type: 'quiz', correct_option_id: q.answer, is_anonymous: true,
    explanation: (q.explain || '').slice(0, 200),
  });
  if (ok) {
    await tg(env, 'sendMessage', {
      chat_id: env.TG_CHANNEL,
      text: 'Толық сынақ тест (тегін, тіркеусіз): ' + link + '\nПолный пробный тест — бесплатно, без регистрации.',
      disable_web_page_preview: false,
    });
    await env.DB.prepare(`INSERT INTO events (day, ts, name, exam, level, test, qid) VALUES (?,?,?,?,?,?,?)`)
      .bind(new Date().toISOString().slice(0, 10), Date.now(), 'tg-quiz', q.exam, q.level, q.test, q.qid).run();
  }
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
    body: JSON.stringify({ url: new URL('/tg/webhook', request.url).href, secret_token: env.TG_WEBHOOK_SECRET, allowed_updates: ['message'], drop_pending_updates: true }),
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
  ]);
}

/* Приёмник статистики Qazaq Trainer. Cloudflare Worker + D1.
   Принимает POST от KZ.track()/sendEvent() и складывает в две таблицы: events и answers.
   Тело — JSON, но заголовок Content-Type приходит text/plain: так браузер не делает предварительный запрос CORS
   (с application/json событие из sendBeacon теряется). Поэтому тип содержимого здесь не проверяем, читаем как текст.
   Персональных данных не принимает: sid — случайный идентификатор вкладки, IP не пишем.
   Деплой: см. README.md рядом. */

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
    if (event.cron === QUIZ_CRON) return postQuiz(env);
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

// Срок хранения — 12 месяцев (обещан на странице /privacy/). Раз в сутки по расписанию из wrangler.toml
  // удаляются события и ответы старше года, включая тексты обратной связи и анкеты экспертов.
async function purge(env) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM events WHERE day < date('now', '-365 day')`),
    env.DB.prepare(`DELETE FROM answers WHERE day < date('now', '-365 day')`),
  ]);
}

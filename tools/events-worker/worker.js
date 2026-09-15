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
const EVENTS = ['pageview', 'section-start', 'section-done', 'test-done', 'audio-play', 'lang', 'setting', 'answers', 'report'];
const MAX_BODY = 32 * 1024;

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
  async fetch(request, env) {
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
      `INSERT INTO events (day, ts, sid, name, lang, exam, level, test, section, pct, seconds, practice, timed_out, path, country, qid, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      day, int(d.ts) || Date.now(), str(d.sid, 32), str(d.e, 24), str(d.lang, 4),
      str(p.exam, 16), str(p.level, 4), str(p.test, 40), str(p.section, 16),
      int(p.pct), int(p.seconds), p.practice ? 1 : 0, p.timedOut ? 1 : 0, str(p.path, 120), country,
      str(p.qid, 24), str(p.why, 24)      // жалоба на вопрос: какой вопрос и что именно не так
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
    return new Response(null, { status: 204, headers: cors(origin) });
  },
};

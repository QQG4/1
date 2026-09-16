/* Лаборатория: отдаёт сборку lab-site/ только после входа.
   Два рубежа, намеренно независимых друг от друга:
     1) Cloudflare Access на lab.qazaqtrainer.com — вход по почте, настраивается в панели, срабатывает ДО воркера;
     2) пароль ниже — работает, даже если в Access что-то перенастроили или сломали.
   Пароль в коде не лежит: логин и пароль берутся из секретов воркера LAB_USER / LAB_PASS
   (`npx wrangler secret put LAB_PASS -c tools/lab-deploy/wrangler.jsonc`).
   Если секретов нет, воркер не пускает никого — открытой лаборатория не останется ни при каком стечении обстоятельств. */

function equal(a, b) {            // сравнение без утечки времени
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const DENY = (msg) => new Response(msg, {
  status: 401,
  headers: { 'WWW-Authenticate': 'Basic realm="Qazaq Trainer lab", charset="UTF-8"', 'Cache-Control': 'no-store' },
});

/* Статистика публичного сайта для страницы /stats/ (lab-site/stats/index.html). Та же база D1, что у приёмника
   tools/events-worker, но только чтение. Доступно лишь после входа — проверка выше, до этого места чужой не дойдёт:
   в ответе есть тексты обратной связи и анкеты экспертов. */
async function stats(url, env) {
  if (!env.DB) return Response.json({ error: 'база не подключена' }, { status: 500 });
  const d = Math.max(1, Math.min(3650, parseInt(url.searchParams.get('days'), 10) || 30));
  const since = new Date(Date.now() - (d - 1) * 864e5).toISOString().slice(0, 10);
  const q = (sql) => env.DB.prepare(sql).bind(since);
  const [daily, funnel, countries, langs, tests, questions, reports, feedback, reviews, audio] = await env.DB.batch([
    q(`SELECT day, COUNT(DISTINCT CASE WHEN name='pageview' THEN sid END) visitors,
              COUNT(DISTINCT CASE WHEN name='section-start' THEN sid END) starters,
              SUM(name='section-done') done
       FROM events WHERE day >= ? GROUP BY day ORDER BY day`),
    q(`SELECT COUNT(DISTINCT CASE WHEN name='pageview' THEN sid END) visitors,
              COUNT(DISTINCT CASE WHEN name='section-start' THEN sid END) starters,
              COUNT(DISTINCT CASE WHEN name='section-done' THEN sid END) finishers,
              COUNT(DISTINCT CASE WHEN name='test-done' THEN sid END) whole_test,
              SUM(name='section-done') sections_done
       FROM events WHERE day >= ?`),
    q(`SELECT COALESCE(country, '?') country, COUNT(DISTINCT sid) n FROM events WHERE day >= ? GROUP BY country ORDER BY n DESC LIMIT 15`),
    q(`SELECT COALESCE(lang, '?') lang, COUNT(DISTINCT sid) n FROM events WHERE day >= ? AND name='pageview' GROUP BY lang ORDER BY n DESC`),
    q(`SELECT test, section, SUM(name='section-start') starts, SUM(name='section-done') done,
              ROUND(AVG(CASE WHEN name='section-done' THEN pct END)) avg_pct,
              ROUND(AVG(CASE WHEN name='section-done' THEN seconds END)) avg_seconds,
              SUM(name='section-done' AND timed_out=1) timed_out, SUM(name='section-done' AND practice=1) practice
       FROM events WHERE day >= ? AND test IS NOT NULL AND name IN ('section-start','section-done')
       GROUP BY test, section ORDER BY starts DESC`),
    q(`SELECT test, section, qid, chosen, COUNT(*) n, SUM(ok) ok FROM answers WHERE day >= ? GROUP BY test, section, qid, chosen`),
    q(`SELECT day, test, section, qid, note, text FROM events WHERE day >= ? AND name='report' ORDER BY ts DESC LIMIT 300`),
    q(`SELECT day, path, test, section, qid, text, ua FROM events WHERE day >= ? AND name='feedback' ORDER BY ts DESC LIMIT 300`),
    q(`SELECT day, note expert, text FROM events WHERE day >= ? AND name='expert_review' ORDER BY ts DESC LIMIT 100`),
    q(`SELECT test, COUNT(*) plays, COUNT(DISTINCT sid) people FROM events WHERE day >= ? AND name='audio-play' GROUP BY test ORDER BY plays DESC`),
  ]);
  const r = (x) => x.results;
  return Response.json({
    days: d, since, generated: new Date().toISOString(),
    daily: r(daily), funnel: r(funnel)[0], countries: r(countries), langs: r(langs), tests: r(tests),
    questions: r(questions), reports: r(reports), feedback: r(feedback), reviews: r(reviews), audio: r(audio),
  }, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

export default {
  async fetch(request, env) {
    const user = env.LAB_USER, pass = env.LAB_PASS;
    if (!user || !pass) return DENY('Лаборатория закрыта: пароль не настроен.');
    const header = request.headers.get('Authorization') || '';
    if (!header.startsWith('Basic ')) return DENY('Лаборатория Qazaq Trainer — нужен вход.');
    let decoded = '';
    try { decoded = atob(header.slice(6)); } catch (e) { decoded = ''; }
    const i = decoded.indexOf(':');
    if (i <= 0 || !equal(decoded.slice(0, i), user) || !equal(decoded.slice(i + 1), pass)) {
      return DENY('Неверный логин или пароль.');
    }
    const url = new URL(request.url);
    if (url.pathname === '/api/stats') return stats(url, env);
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');   // лаборатория в поиск не попадает ни при каких условиях
    return out;
  },
};

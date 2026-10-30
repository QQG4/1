/* Лаборатория: отдаёт сборку lab-site/ только после входа.
   Два рубежа, намеренно независимых друг от друга:
     1) Cloudflare Access на lab.qazaqtrainer.com — вход по почте, настраивается в панели, срабатывает ДО воркера;
     2) пароль ниже — работает, даже если в Access что-то перенастроили или сломали.
   Пароль в коде не лежит: логин и пароль берутся из секретов воркера LAB_USER / LAB_PASS
   (`npx wrangler secret put LAB_PASS -c tools/lab-deploy/wrangler.jsonc`).
   Если секретов нет, воркер не пускает никого — открытой лаборатория не останется ни при каком стечении обстоятельств.
   С 29.10.2026 (просьба владельца): кто уже вошёл через Access, пароль не вводит. Access кладёт в запрос подписанный
   токен (Cf-Access-Jwt-Assertion); воркер проверяет подпись ключами нашей команды Access, издателя, срок и почту
   из LAB_EMAILS. Подделать токен нельзя, а если Access снимут, токена не будет и снова спросят пароль. */

const ACCESS_TEAM = 'https://square-flower-0289.cloudflareaccess.com';
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function accessOk(request, env) {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  const parts = jwt.split('.');
  if (parts.length !== 3) return false;
  try {
    const head = JSON.parse(new TextDecoder().decode(b64u(parts[0])));
    const body = JSON.parse(new TextDecoder().decode(b64u(parts[1])));
    if (body.iss !== ACCESS_TEAM || !body.exp || body.exp * 1000 < Date.now()) return false;
    const emails = String(env.LAB_EMAILS || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
    if (!emails.length || emails.indexOf(String(body.email || '').toLowerCase()) < 0) return false;
    if (env.LAB_ACCESS_AUD && [].concat(body.aud).indexOf(env.LAB_ACCESS_AUD) < 0) return false;
    const certs = await (await fetch(ACCESS_TEAM + '/cdn-cgi/access/certs', { cf: { cacheTtl: 3600 } })).json();
    const jwk = (certs.keys || []).find((k) => k.kid === head.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  } catch (e) { return false; }
}

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
  const [daily, funnel, countries, langs, tests, questions, reports, feedback, reviews, audio, sources, errors] = await env.DB.batch([
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
    q(`SELECT COALESCE(ref, '(прямой заход или закладка)') ref, utm, COUNT(DISTINCT sid) n
       FROM events WHERE day >= ? AND name='pageview' GROUP BY ref, utm ORDER BY n DESC LIMIT 50`),
    q(`SELECT text, COUNT(*) n, COUNT(DISTINCT sid) people, MAX(day) last_day, MAX(path) path, MAX(ua) ua
       FROM events WHERE day >= ? AND name='js-error' GROUP BY text ORDER BY n DESC LIMIT 100`),
  ]);
  const r = (x) => x.results;
  return Response.json({
    days: d, since, generated: new Date().toISOString(),
    daily: r(daily), funnel: r(funnel)[0], countries: r(countries), langs: r(langs), tests: r(tests),
    questions: r(questions), reports: r(reports), feedback: r(feedback), reviews: r(reviews), audio: r(audio), sources: r(sources), errors: r(errors),
  }, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

/* Переключатель «Обучение · Новый сайт» (29.10.2026): в лаборатории лежат две сборки — обучалка (корень) и новая
   версия публичного сайта (/_site, собирает build.py). Выбор хранится в куке qt_view, ссылки /?view=site и /?view=lab.
   Обучалку не трогаем: кнопку переключателя дописываем в HTML на лету. Аудио, шрифты и статистика — общие. */
const SHARED = /^\/(audio|fonts|api|stats|_site|_design)(\/|$)/;
/* «Дизайн 1» и «Дизайн 2» (30.10.2026): та же сборка /_site, что и «Новый сайт», плюс слой стилей из /_design (src/design, только лаборатория).
   Ссылки на стили ставятся сразу за стилями страницы: у приложения они лежат в начале <body>, у посадочных в <head>.
   Страницы privacy и review со своей вёрсткой остаются как есть. */
const VIEWS = [['lab', 'Обучение'], ['site', 'Новый сайт'], ['d1', 'Дизайн 1'], ['d2', 'Дизайн 2']];
const DESIGN_LINKS = (d) => ['fonts/fonts.css', 'base.css', d + '.css'].map((f) => '<link rel="stylesheet" href="/_design/' + f + '">').join('');
const SWITCH = (view) => '<div id="qt-view-switch" style="position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;gap:2px;' +
  'padding:3px;border-radius:999px;background:#10171b;box-shadow:0 2px 10px rgba(0,0,0,.25);font:600 13px/1 system-ui,-apple-system,sans-serif;white-space:nowrap">' +
  VIEWS.map(([v, t]) => '<a href="/?view=' + v + '" style="padding:7px 10px;border-radius:999px;text-decoration:none;' +
    (v === view ? 'background:#5cc2dc;color:#0a1417' : 'color:#cfe3e8') + '">' + t + '</a>').join('') + '</div>';

export default {
  async fetch(request, env) {
    const user = env.LAB_USER, pass = env.LAB_PASS;
    if (!user || !pass) return DENY('Лаборатория закрыта: пароль не настроен.');
    if (!(await accessOk(request, env))) {   // вошёл через Access с разрешённой почтой — без пароля
      const header = request.headers.get('Authorization') || '';
      if (!header.startsWith('Basic ')) return DENY('Лаборатория Qazaq Trainer — нужен вход.');
      let decoded = '';
      try { decoded = atob(header.slice(6)); } catch (e) { decoded = ''; }
      const i = decoded.indexOf(':');
      if (i <= 0 || !equal(decoded.slice(0, i), user) || !equal(decoded.slice(i + 1), pass)) {
        return DENY('Неверный логин или пароль.');
      }
    }
    const url = new URL(request.url);
    if (url.pathname === '/api/stats') return stats(url, env);
    const pick = url.searchParams.get('view');
    if (VIEWS.some(([v]) => v === pick)) {
      return new Response(null, { status: 302, headers: { Location: '/', 'Cache-Control': 'no-store',
        'Set-Cookie': 'qt_view=' + pick + '; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax' } });
    }
    const view = ((request.headers.get('Cookie') || '').match(/(?:^|;\s*)qt_view=(site|d1|d2)(?:;|$)/) || [])[1] || 'lab';
    let res;
    if (view !== 'lab' && !SHARED.test(url.pathname)) {
      const inner = new URL(url);
      // Дизайн 1: короткая страница о данных вместо полной (полная в сборке _site не меняется)
      inner.pathname = view === 'd1' && /^\/privacy\/?$/.test(url.pathname) ? '/_design/privacy/' : '/_site' + url.pathname;
      res = await env.ASSETS.fetch(new Request(inner, request));
    } else res = await env.ASSETS.fetch(request);
    let out = new Response(res.body, res);
    const loc = out.headers.get('Location');
    if (loc && loc.startsWith('/_site/')) out.headers.set('Location', loc.slice(6));   // переадресации сборки сайта без /_site
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');   // лаборатория в поиск не попадает ни при каких условиях
    if ((out.headers.get('Content-Type') || '').includes('text/html') && !url.pathname.startsWith('/stats')) {
      out.headers.set('Cache-Control', 'no-store');
      let rw = new HTMLRewriter().on('body', { element(el) { el.append(SWITCH(view), { html: true }); } });
      if ((view === 'd1' || view === 'd2') && !/^\/(privacy|review)(\/|$)/.test(url.pathname)) {
        const before = { element(el) { el.before(DESIGN_LINKS(view), { html: true }); } };
        rw = rw.on('html', { element(el) { el.setAttribute('data-design', view); } })
          .on('div.wrap', before).on('body > main', before)
          .on('body', { element(el) { el.append('<script src="/_design/design.js"></script>', { html: true }); } });
      }
      out = rw.transform(out);
    }
    return out;
  },
};

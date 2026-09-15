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
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');   // лаборатория в поиск не попадает ни при каких условиях
    return out;
  },
};

/* Instagram Reels через официальный Instagram API с входом через Instagram (13.10.2026, решение владельца: 2 в день).
   Одобрение общее с Telegram (videos.js): ролик со статусом approved/published в tg_videos годится и для Instagram.
   Два шага на каждый эфир: за час до него создаётся контейнер (Instagram сам скачивает mp4 по адресу воркера и
   обрабатывает), в час эфира — проверка status_code и media_publish. Ждать обработки внутри одного запуска нельзя.
   Токен: владелец генерирует его в App Dashboard (Instagram → API setup with Instagram business login → Generate token,
   живёт 60 дней) и шлёт боту `/igtoken <токен>`; бот удаляет сообщение и хранит токен в D1 (ig_auth). Раз в сутки,
   если токену больше 20 дней, воркер его продлевает (refresh_access_token, токен должен быть старше суток и живой).
   Лимит API — 100 публикаций в сутки, нам нужно 2. Музыку из библиотеки через API не добавить — публикуем без неё. */

export const IG_PREP_UTC = [6, 13];   // контейнер: за час до эфира
export const IG_PUB_UTC = [7, 14];    // эфир: 12:00 и 19:00 по Алматы
const GRAPH = 'https://graph.instagram.com/v25.0/';
const SELF = 'https://qazaq-trainer-stats.k-k-g-inter.workers.dev/';

const rows = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
async function owner(env, text) {
  if (!env.TG_BOT_TOKEN || !env.TG_OWNER_CHAT) return;
  await fetch('https://api.telegram.org/bot' + env.TG_BOT_TOKEN + '/sendMessage', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.TG_OWNER_CHAT, text, disable_web_page_preview: true }) });
}
async function auth(env) {
  const r = await rows(env, `SELECT token, user_id, username, ts FROM ig_auth WHERE id = 1`);
  return r[0] || null;
}
async function graph(method, path, params) {
  const url = GRAPH + path + (method === 'GET' ? '?' + new URLSearchParams(params) : '');
  const r = await fetch(url, method === 'GET' ? {} : { method: 'POST', body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && !j.error, j };
}

/* /igtoken <токен> от владельца: проверить токен, узнать id аккаунта, сохранить. */
export async function saveToken(env, token) {
  const me = await graph('GET', 'me', { fields: 'user_id,username', access_token: token });
  const d = me.j && (me.j.data ? me.j.data[0] : me.j);
  if (!me.ok || !d || !d.user_id) return 'Токен не подошёл: ' + JSON.stringify(me.j && me.j.error ? me.j.error.message : me.j).slice(0, 200);
  await env.DB.prepare(`INSERT OR REPLACE INTO ig_auth (id, token, user_id, username, ts) VALUES (1, ?, ?, ?, ?)`)
    .bind(token, String(d.user_id), d.username || '', Date.now()).run();
  return 'Instagram подключён: @' + (d.username || d.user_id) + '. Первый Reels выйдет в ближайшие 12:00 или 19:00 из одобренных роликов.';
}

export async function igReady(env) { return !!(await auth(env)); }

/* Ролики, одобренные владельцем и ещё не ушедшие в Instagram (для запаса одобренных в videos.js). */
export async function igBacklog(env) {
  const [{ c }] = await rows(env, `SELECT COUNT(*) AS c FROM tg_videos WHERE status IN ('approved', 'published')
    AND n NOT IN (SELECT n FROM ig_posts WHERE status IN ('published', 'container'))`);
  return c;
}

/* За час до эфира: контейнер для следующего одобренного ролика. */
export async function igPrepare(env, queue) {
  const a = await auth(env); if (!a) return;
  if ((await rows(env, `SELECT n FROM ig_posts WHERE status = 'container'`)).length) return;   // прошлый ещё не вышел
  const next = await rows(env, `SELECT n FROM tg_videos WHERE status IN ('approved', 'published')
    AND n NOT IN (SELECT n FROM ig_posts WHERE status IN ('published', 'container', 'error')) ORDER BY n LIMIT 1`);
  if (!next.length) return owner(env, 'Instagram: одобренных роликов нет, ближайший Reels не выйдет. Нажмите ✅ под роликом в боте.');
  const item = (await queue(env)).find((x) => x.n === next[0].n);
  if (!item) return;
  const r = await graph('POST', a.user_id + '/media', { media_type: 'REELS', video_url: SELF + item.file,
    caption: (item.caption_ig || item.caption).slice(0, 2200), share_to_feed: 'true', access_token: a.token });
  if (!r.ok) return igError(env, item.n, 'контейнер: ' + JSON.stringify(r.j.error || r.j).slice(0, 300));
  await env.DB.prepare(`INSERT OR REPLACE INTO ig_posts (n, status, container_id, media_id, err, ts) VALUES (?, 'container', ?, NULL, NULL, ?)`)
    .bind(item.n, String(r.j.id), Date.now()).run();
}

/* Час эфира: опубликовать готовый контейнер. Не готов — попробуем в следующий эфир, ошибка — сообщить владельцу. */
export async function igPublish(env) {
  const a = await auth(env); if (!a) return;
  const c = await rows(env, `SELECT n, container_id FROM ig_posts WHERE status = 'container' ORDER BY n LIMIT 1`);
  if (!c.length) return;
  const st = await graph('GET', c[0].container_id, { fields: 'status_code', access_token: a.token });
  const code = st.j && st.j.status_code;
  if (code === 'IN_PROGRESS') return console.log('instagram: ролик ' + c[0].n + ' ещё обрабатывается');
  if (code !== 'FINISHED') return igError(env, c[0].n, 'обработка: ' + (code || JSON.stringify(st.j).slice(0, 200)));
  const r = await graph('POST', a.user_id + '/media_publish', { creation_id: c[0].container_id, access_token: a.token });
  if (!r.ok) return igError(env, c[0].n, 'публикация: ' + JSON.stringify(r.j.error || r.j).slice(0, 300));
  await env.DB.prepare(`UPDATE ig_posts SET status = 'published', media_id = ?, ts = ? WHERE n = ?`).bind(String(r.j.id), Date.now(), c[0].n).run();
}

async function igError(env, n, msg) {
  await env.DB.prepare(`INSERT OR REPLACE INTO ig_posts (n, status, container_id, media_id, err, ts) VALUES (?, 'error', NULL, NULL, ?, ?)`)
    .bind(n, msg, Date.now()).run();
  await owner(env, 'Instagram: ролик ' + n + ' не вышел (' + msg + '). Он пропущен, следующий пойдёт по расписанию.');
}

/* Раз в сутки: продлить токен, если ему больше 20 дней (живёт 60). */
export async function igRefresh(env) {
  const a = await auth(env); if (!a || Date.now() - a.ts < 20 * 864e5) return;
  const url = 'https://graph.instagram.com/refresh_access_token?' + new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: a.token });
  const j = await (await fetch(url)).json().catch(() => ({}));
  if (!j.access_token) return owner(env, 'Instagram: не удалось продлить токен (' + JSON.stringify(j.error || j).slice(0, 200) + '). Сгенерируйте новый и пришлите /igtoken.');
  await env.DB.prepare(`UPDATE ig_auth SET token = ?, ts = ? WHERE id = 1`).bind(j.access_token, Date.now()).run();
}

export async function igStatus(env) {
  const a = await auth(env);
  if (!a) return 'Instagram: не подключён (/igtoken <токен>)';
  const by = {};
  for (const r of await rows(env, `SELECT status, COUNT(*) AS c FROM ig_posts GROUP BY status`)) by[r.status] = r.c;
  return 'Instagram @' + a.username + ': опубликовано ' + (by.published || 0) + ', в обработке ' + (by.container || 0) +
    ', с ошибкой ' + (by.error || 0) + ', одобрены и ждут ' + (await igBacklog(env));
}

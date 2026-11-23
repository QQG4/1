/* Сторис-анонс ролика дня (23.11.2026, слово владельца «да, делай сторис для инсты и tiktok»).
   Файл v/story-N.mp4 собирает tools/social/story_ann.py N (копия соцсети/сторис/NN.mp4), один на обе площадки.
   Instagram: через час после Reels (20:00 по Алматы) воркер создаёт контейнер STORIES для ролика, который сегодня
   вышел в Instagram, в 21:00 проверяет обработку и публикует (не готов — ещё раз в 22:00). Ссылку и стикеры API не ставит.
   TikTok: API для сторис нет, а в веб-Studio сторис нет вовсе (проверено 15.11.2026), поэтому в 20:00 бот присылает
   владельцу тот же файл в личку: выложить с телефона в пару касаний.
   Нет файла сторис для сегодняшнего ролика — пропускаем молча (видно в /queue). */
import { tgBase } from './tgapi.js';
import { IG_PAUSED } from './ig.js';

export const STORY_PREP_UTC = 15;        // 20:00 по Алматы: контейнер Instagram и файл владельцу для TikTok
export const STORY_PUB_UTC = [16, 17];   // 21:00, запасной заход в 22:00
const GRAPH = 'https://graph.instagram.com/v25.0/';
const SELF = 'https://qazaq-trainer-stats.k-k-g-inter.workers.dev/';

const rows = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
async function graph(method, path, params) {
  const url = GRAPH + path + (method === 'GET' ? '?' + new URLSearchParams(params) : '');
  const r = await fetch(url, method === 'GET' ? {} : { method: 'POST', body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && !j.error, j };
}
async function bot(env, method, body) {
  if (!env.TG_BOT_TOKEN || !env.TG_OWNER_CHAT) return null;
  const r = await fetch(tgBase(env) + '/bot' + env.TG_BOT_TOKEN + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.TG_OWNER_CHAT, ...body }) });
  return (await r.json().catch(() => ({}))).ok;
}
async function hasFile(env, path) {
  const r = await env.ASSETS.fetch(new Request(SELF + path, { method: 'HEAD' }));
  return r.ok;
}

/* 20:00: ролик, вышедший сегодня в Instagram (последние 8 часов), получает сторис. */
export async function storyPrepare(env) {
  const today = await rows(env, `SELECT n FROM ig_posts WHERE status = 'published' AND ts > ? ORDER BY ts DESC LIMIT 1`, Date.now() - 8 * 36e5);
  if (!today.length) return console.log('stories: сегодня Reels не выходил');
  const n = today[0].n, file = 'v/story-' + n + '.mp4';
  if ((await rows(env, `SELECT n FROM ig_stories WHERE n = ?`, n)).length) return;
  if (!(await hasFile(env, file))) return console.log('stories: нет ' + file);
  // TikTok: файл владельцу
  const tt = await bot(env, 'sendVideo', { video: SELF + file, width: 1080, height: 1920, supports_streaming: true,
    caption: 'Сторис для TikTok к сегодняшнему ролику №' + n + '. Выложить с телефона: «+» → «Сторис» → этот файл. В Instagram она выйдет сама в 21:00.' });
  // Instagram: контейнер
  const a = (await rows(env, `SELECT token, user_id FROM ig_auth WHERE id = 1`))[0];
  let status = 'skipped', cid = null, err = null;
  if (a && !IG_PAUSED) {
    const r = await graph('POST', a.user_id + '/media', { media_type: 'STORIES', video_url: SELF + file, access_token: a.token });
    if (r.ok) { status = 'container'; cid = String(r.j.id); }
    else { status = 'error'; err = 'контейнер: ' + JSON.stringify(r.j.error || r.j).slice(0, 300); }
  }
  await env.DB.prepare(`INSERT OR REPLACE INTO ig_stories (n, status, container_id, media_id, err, tt_sent, ts) VALUES (?, ?, ?, NULL, ?, ?, ?)`)
    .bind(n, status, cid, err, tt ? 1 : 0, Date.now()).run();
  if (err) await bot(env, 'sendMessage', { text: 'Instagram: сторис к ролику ' + n + ' не создана (' + err + ').' });
}

/* 21:00 (и 22:00): опубликовать готовый контейнер. */
export async function storyPublish(env) {
  const c = await rows(env, `SELECT n, container_id FROM ig_stories WHERE status = 'container' ORDER BY ts LIMIT 1`);
  if (!c.length) return;
  const a = (await rows(env, `SELECT token, user_id FROM ig_auth WHERE id = 1`))[0];
  if (!a) return;
  const last = new Date().getUTCHours() === STORY_PUB_UTC[STORY_PUB_UTC.length - 1];
  const st = await graph('GET', c[0].container_id, { fields: 'status_code', access_token: a.token });
  const code = st.j && st.j.status_code;
  let err = null;
  if (code === 'IN_PROGRESS' && !last) return console.log('stories: ' + c[0].n + ' ещё обрабатывается');
  if (code !== 'FINISHED') err = 'обработка: ' + (code || JSON.stringify(st.j).slice(0, 200));
  else {
    const r = await graph('POST', a.user_id + '/media_publish', { creation_id: c[0].container_id, access_token: a.token });
    if (r.ok) {
      await env.DB.prepare(`UPDATE ig_stories SET status = 'published', media_id = ?, ts = ? WHERE n = ?`).bind(String(r.j.id), Date.now(), c[0].n).run();
      return;
    }
    err = 'публикация: ' + JSON.stringify(r.j.error || r.j).slice(0, 300);
  }
  await env.DB.prepare(`UPDATE ig_stories SET status = 'error', err = ?, ts = ? WHERE n = ?`).bind(err, Date.now(), c[0].n).run();
  await bot(env, 'sendMessage', { text: 'Instagram: сторис к ролику ' + c[0].n + ' не вышла (' + err + ').' });
}

export async function storyStatus(env) {
  const by = {};
  for (const r of await rows(env, `SELECT status, COUNT(*) AS c FROM ig_stories GROUP BY status`)) by[r.status] = r.c;
  return 'Сторис Instagram: вышло ' + (by.published || 0) + ', ошибок ' + (by.error || 0);
}

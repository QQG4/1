import { igReady, igBacklog, igStatus } from './ig.js';

/* Ролики в канал с одобрением владельца (13.10.2026).
   Очередь — queue.json из статических файлов воркера (собирает tools/social/publish_tg.py, папка соцсети/_publish).
   Бот присылает владельцу в личку ролик с подписью и тремя кнопками: «Публиковать», «Пропустить», «Поменять».
   После нажатия сразу приходит следующий, пока одобренных в запасе меньше VIDEO_BUFFER, — так можно одобрить
   неделю за раз. В VIDEO_UTC (17:00 по Алматы, между заданиями 13:00 и 19:00) в канал уходит один одобренный ролик.
   «Поменять» просит написать одним сообщением, что не так; записка сохраняется в tg_videos.note, Claude забирает
   её запросом к D1 и пересобирает ролик (статус потом сбрасывается на 'queued').
   Статусы: preview (ждёт решения) → approved → published; skipped; change. Ролика нет в таблице — ещё не показан. */

export const VIDEO_UTC = 12;     // 17:00 по Алматы — публикация в канал
/* С 27.10.2026 ролик в канал выходит 3 раза в неделю, а не каждый день: при 7 постах в день охват канала упал
   с 33 до 8 просмотров на пост (аналитика 26.10). Дни недели по UTC: вторник, четверг, суббота. */
export const VIDEO_DAYS = [2, 4, 6];
export const NUDGE_UTC = 15;     // 20:00 по Алматы — напомнить и прислать следующий на одобрение
const VIDEO_BUFFER = 6;          // запас одобренных на две недели: Telegram берёт 3 в неделю (Instagram на паузе, ig.js)
const SELF = 'https://qazaq-trainer-stats.k-k-g-inter.workers.dev/';   // отсюда Telegram забирает mp4

async function api(env, method, body) {
  const r = await fetch('https://api.telegram.org/bot' + env.TG_BOT_TOKEN + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.log('telegram ' + method + ' → ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  return j.ok ? j.result : null;
}

export async function queue(env) {
  const r = await env.ASSETS.fetch(new Request(SELF + 'queue.json'));
  return r.ok ? r.json() : [];
}
const rows = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];

/* Прислать владельцу следующий ролик, если ни один не ждёт решения и запас одобренных не полный. */
export async function previewNext(env, force) {
  if (!env.TG_BOT_TOKEN || !env.TG_OWNER_CHAT) return;
  const pending = await rows(env, `SELECT n FROM tg_videos WHERE status = 'preview'`);
  if (pending.length && !force) return;
  const c = (await igReady(env)) ? await igBacklog(env)   // Instagram расходует быстрее — запас считаем по нему
    : (await rows(env, `SELECT COUNT(*) AS c FROM tg_videos WHERE status = 'approved'`))[0].c;
  if (c >= VIDEO_BUFFER && !force) return;
  const seen = new Set((await rows(env, `SELECT n FROM tg_videos WHERE status <> 'queued'`)).map((r) => r.n));
  const q = await queue(env);
  const item = q.find((x) => !seen.has(x.n));
  if (!item) return api(env, 'sendMessage', { chat_id: env.TG_OWNER_CHAT, text: 'Все ролики очереди просмотрены. Новые появятся после следующей сборки.' });
  const msg = await api(env, 'sendVideo', {
    chat_id: env.TG_OWNER_CHAT, video: SELF + item.file, width: 1080, height: 1920, supports_streaming: true,
    caption: ('Ролик ' + item.n + ' из ' + q.length + ' · ' + item.slot + ' · ' + item.id + '\nВ запасе одобренных: ' + c +
              '\n———\n' + item.caption).slice(0, 1024),
    reply_markup: { inline_keyboard: [[
      { text: '✅ Публиковать', callback_data: 'v:' + item.n + ':ok' },
      { text: '⏭ Пропустить', callback_data: 'v:' + item.n + ':no' },
      { text: '✏️ Поменять', callback_data: 'v:' + item.n + ':edit' },
    ]] },
  });
  if (!msg) return;
  const fileId = msg.video ? msg.video.file_id : null;   // в канал отправим этот же файл, без повторной загрузки
  await env.DB.prepare(`INSERT OR REPLACE INTO tg_videos (n, vid, status, file_id, msg_id, note, ts) VALUES (?,?,?,?,?,NULL,?)`)
    .bind(item.n, item.id, 'preview', fileId, msg.message_id, Date.now()).run();
}

/* Кнопка под роликом. Принимаем только от владельца. */
export async function onCallback(env, cb) {
  const ans = (text) => api(env, 'answerCallbackQuery', { callback_query_id: cb.id, text });
  if (!cb.from || String(cb.from.id) !== String(env.TG_OWNER_CHAT)) return ans('Только для владельца канала');
  const m = /^v:(\d+):(ok|no|edit)$/.exec(cb.data || '');
  if (!m) return ans('');
  const n = +m[1], act = m[2];
  const status = { ok: 'approved', no: 'skipped', edit: 'change' }[act];
  await env.DB.prepare(`UPDATE tg_videos SET status = ?, ts = ? WHERE n = ?`).bind(status, Date.now(), n).run();
  const label = { ok: '✅ Одобрен: выйдет по очереди в канал (17:00) и в Instagram (12:00 или 19:00)', no: '⏭ Пропущен', edit: '✏️ На доработку' }[act];
  if (cb.message) {
    await api(env, 'editMessageReplyMarkup', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    await api(env, 'sendMessage', { chat_id: cb.message.chat.id, reply_to_message_id: cb.message.message_id, text: label });
  }
  await ans(label);
  if (act === 'edit') {
    return api(env, 'sendMessage', { chat_id: env.TG_OWNER_CHAT, text: 'Что поменять в ролике ' + n + '? Напишите одним сообщением.' });
  }
  return previewNext(env);
}

/* Текст владельца, когда ролик ждёт записки «что поменять». Возвращает true, если сообщение забрали сюда. */
export async function onOwnerText(env, text) {
  const wait = await rows(env, `SELECT n FROM tg_videos WHERE status = 'change' AND note IS NULL ORDER BY ts DESC LIMIT 1`);
  if (!wait.length) return false;
  await env.DB.prepare(`UPDATE tg_videos SET note = ?, ts = ? WHERE n = ?`).bind(text.slice(0, 2000), Date.now(), wait[0].n).run();
  await api(env, 'sendMessage', { chat_id: env.TG_OWNER_CHAT,
    text: 'Записал к ролику ' + wait[0].n + '. Скажите Claude «правки из бота» — он заберёт записки и пересоберёт ролики.' });
  await previewNext(env);
  return true;
}

/* 17:00 по Алматы: один одобренный ролик в канал. Если одобренных нет — напомнить владельцу. */
export async function publishVideo(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL) return;
  if (!VIDEO_DAYS.includes(new Date().getUTCDay())) return;
  const next = await rows(env, `SELECT n, file_id FROM tg_videos WHERE status = 'approved' ORDER BY n LIMIT 1`);
  if (!next.length) {
    if (env.TG_OWNER_CHAT) await api(env, 'sendMessage', { chat_id: env.TG_OWNER_CHAT, text: 'Сегодня ролик в канал не вышел: одобренных нет. Нажмите ✅ под роликом выше.' });
    return previewNext(env);
  }
  const item = (await queue(env)).find((x) => x.n === next[0].n);
  if (!item) return console.log('ролика ' + next[0].n + ' нет в queue.json');
  const msg = await api(env, 'sendVideo', { chat_id: env.TG_CHANNEL, video: next[0].file_id || SELF + item.file,
    width: 1080, height: 1920, supports_streaming: true, caption: item.caption.slice(0, 1024) });
  if (msg) await env.DB.prepare(`UPDATE tg_videos SET status = 'published', ts = ? WHERE n = ?`).bind(Date.now(), next[0].n).run();
}

/* /queue в личке владельца: сколько одобрено, что на доработке. */
export async function queueStatus(env) {
  const by = {};
  for (const r of await rows(env, `SELECT status, COUNT(*) AS c FROM tg_videos GROUP BY status`)) by[r.status] = r.c;
  const total = (await queue(env)).length;
  const shown = Object.values(by).reduce((a, b) => a + b, 0);
  return 'Ролики: всего ' + total + ', не показаны ' + (total - shown) + '\nждут решения: ' + (by.preview || 0) +
    '\nодобрены и ждут эфира: ' + (by.approved || 0) + '\nопубликованы: ' + (by.published || 0) +
    '\nпропущены: ' + (by.skipped || 0) + '\nна доработке: ' + (by.change || 0) + '\n\n' + (await igStatus(env)) + '\n\n/next — прислать следующий ролик сейчас\n/igdone 3 — ролик №3 уже выложен в Instagram вручную';
}

/* Пилот «проверка письма командой», часть 3: бот привязывает человека к его работе и пишет, когда отчёт готов (15.11.2026).

   1. `/start w_<код>` (ссылка с сайта: t.me/qzqtrainer_bot?start=w_<8 знаков кода>) — код проверяется по алфавиту
      (normalizeCode из ../writing-api.js) и ищется в writing_submissions. Нашли — в работу пишутся id чата (chat) и время
      привязки (bound), в ответ «Текст получен». Работа уже привязана к другому чату — не перепривязываем. Один чат
      может привязать несколько работ.
   2. Подписка на канал: после привязки getChatMember(TG_CHANNEL, id пользователя). Подписан — в работы чата пишется
      sub (время); не подписан — кнопка-ссылка на канал и кнопка «Я подписался» (callback w:sub, повторная проверка).
      Ошибка getChatMember (бот не админ канала и т. п.) — метку не ставим, человеку ошибку не показываем.
      Instagram и TikTok не проверяются: одна строка с просьбой и кнопки-ссылки, если заданы WRITING_INSTAGRAM_URL /
      WRITING_TIKTOK_URL (решение владельца 15.11.2026). Подписка ничем не обусловлена: отчёт придёт в любом случае.
   3. «Отчёт готов»: notifyWritingReady() выбирает работы status='ready' с чатом, где notified ещё пусто, и шлёт каждой
      одно сообщение со ссылкой <WRITING_SHEET_URL>?c=<код>. Вызывается из ежечасного расписания и из POST /writing/notify.
   4. `/my` — список работ этого чата.
   5. `/delete QT-XXXX-XXXX` — человек удаляет свою работу (строка целиком: текст, отчёт, привязка к чату). Только если работа
      привязана к этому чату; чужую или не привязанную отсюда не удалить (на сайте можно по коду).

   Все вызовы Telegram идут через tgRaw (адрес — TG_API). Таблица и колонки — migrate-2026-11-15-writing.sql / schema.sql.
   Текст работы бот не читает и не отправляет: наружу уходят только код, дата, статус и ссылка. */

import { normalizeCode, codeLabel } from '../writing-api.js';
import { tgRaw } from './tgapi.js';

const SHEET_DEFAULT = 'https://qazaqtrainer.com/sheet/';   // с 17.11.2026 открытая страница отчёта на основном сайте (раньше lab.qazaqtrainer.com/sheet/ за входом); база общая, работы лаборатории открываются там же
const CHANNEL_DEFAULT = 'https://t.me/qazaqtrainer';
export const NOTIFY_MAX = 30;      // сообщений «отчёт готов» за один запуск
const MY_MAX = 15;                 // сколько работ показывает /my
const MEMBER = ['member', 'administrator', 'creator'];

/* ---------- тексты: только по-казахски (решение владельца 17.11.2026), от имени команды ---------- */
const T = {
  received: (label) =>
    'Сәлем! Мәтініңіз қабылданды ✅ Жұмыс коды: ' + label + '\nМамандарымыз жұмысыңызды бір тәулік ішінде тексеріп, пікірін жібереді.\n\n' +
    'Барлық жұмыс: /my\nЖұмысты өшіру: /delete ' + label,
  ready: (label, url) =>
    'Есеп дайын ✅ ' + label + '\nБіздің команда жұмысыңызды тексеріп болды.\n\n' +
    'Есепті ашу:\n' + url,
  notFound: 'Мұндай кодты таппадық. Кодты тексеріңіз (ол QT-XXXX-XXXX түрінде болады) немесе мәтінді сайтта қайта жіберіңіз.',
  taken: 'Бұл код басқа чатқа қосылып қойған. Сұрағыңыз болса, осында жазыңыз.',
  askChannel: 'Біздің арнаға жазылыңыз: онда тапсырмалар мен ҚАЗТЕСТ жаңалықтары шығады.',
  btnChannel: 'Арнаға өту',
  btnSub: 'Жазылдым',
  subOk: 'Рақмет, жазылғаныңыз расталды ✅',
  thanks: 'Рақмет!',
  stillNo: 'Жазылу әлі көрінбейді. Арнаны ашып, жазылыңыз.',
  myHead: 'Жұмыстарыңыз:',
  myEmpty: 'Бұл чатқа әлі жұмыс қосылмаған. Мәтінді сайтта жіберіп, «Telegram-да хабарландыру алу» батырмасын басыңыз.',
  stNew: 'алынды',
  stReady: 'дайын',
  delUsage: 'Жұмысты өшіру үшін кодты жазыңыз: /delete QT-XXXX-XXXX\nӨшіру кезінде мәтін, есеп және чатқа қосылу жойылады. Жұмыстарыңыз: /my',
  delOk: (label) => 'Жұмыс өшірілді ✅ ' + label + '\nМәтін, есеп және чатқа қосылу жойылды.',
  delNotYours: 'Бұл жұмыс осы чатқа қосылмаған, сондықтан мұнда өшіре алмаймыз. Сайттағы «Менің прогресім» бетінен өшіруге болады.',
  fail: 'Қазір жауап бере алмаймыз, сәлден соң қайталап көріңіз.',
};

/* ---------- ссылки и кнопки ---------- */
export function sheetLink(env, code) {
  const base = String(env.WRITING_SHEET_URL || SHEET_DEFAULT);
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'c=' + code;
}
const channelUrl = (env) => (/^@[A-Za-z0-9_]{4,}$/.test(String(env.TG_CHANNEL || ''))
  ? 'https://t.me/' + String(env.TG_CHANNEL).slice(1) : CHANNEL_DEFAULT);

/* Instagram и TikTok: только если адрес задан переменной (https://…). Возвращает [{name, url}]. */
function socials(env) {
  const out = [];
  const ig = String(env.WRITING_INSTAGRAM_URL || ''), tt = String(env.WRITING_TIKTOK_URL || '');
  if (/^https:\/\//.test(ig)) out.push({ name: 'Instagram', url: ig });
  if (/^https:\/\//.test(tt)) out.push({ name: 'TikTok', url: tt });
  return out;
}
function socialLine(list) {   // одна строка с просьбой, по-казахски и по-русски
  if (!list.length) return null;
  const both = list.length === 2, n = list.map((s) => s.name);
  const kk = both ? 'Instagram мен TikTok-тағы беттерімізге де жазылыңыз.'
    : n[0] === 'Instagram' ? 'Instagram-дағы бетімізге де жазылыңыз.' : 'TikTok-тағы бетімізге де жазылыңыз.';
  const ru = 'Подписывайтесь и на ' + (both ? 'наши страницы' : 'нашу страницу') + ' в ' + n.join(' и ') + '.';
  return { kk, ru };
}
const socialRow = (list) => list.map((s) => ({ text: s.name, url: s.url }));

/* ---------- подписка на канал ---------- */
/* 'yes' | 'no' | 'unknown'. unknown — не проверить (нет канала или токена, бот не админ канала, сбой сети). */
async function memberState(env, userId) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL || userId == null) return 'unknown';
  const r = await tgRaw(env, 'getChatMember', { chat_id: env.TG_CHANNEL, user_id: userId });
  if (!r.ok || !r.result || typeof r.result.status !== 'string') return 'unknown';
  const st = r.result.status;
  if (MEMBER.indexOf(st) >= 0 || (st === 'restricted' && r.result.is_member)) return 'yes';
  return 'no';
}
const markSub = (env, chat) =>
  env.DB.prepare(`UPDATE writing_submissions SET sub = ? WHERE chat = ? AND sub IS NULL`).bind(Date.now(), String(chat)).run();

/* ---------- /start w_<код> ---------- */
export async function wStart(env, m, rawCode) {
  const chat = m.chat.id, uid = (m.from && m.from.id != null) ? m.from.id : chat;
  const say = (text, extra) => tgRaw(env, 'sendMessage', Object.assign({ chat_id: chat, text, disable_web_page_preview: true }, extra || {}));
  try {
    const code = normalizeCode(rawCode);
    const row = code ? await env.DB.prepare(`SELECT code, status, chat, blocked FROM writing_submissions WHERE code = ?`).bind(code).first() : null;
    if (!row) { await say(T.notFound); return; }
    const me = String(chat);
    if (row.chat && row.chat !== me) { await say(T.taken); return; }
    if (!row.chat) {
      // привязка одним условным UPDATE: два чата с одним кодом одновременно не пройдут оба
      const r = await env.DB.prepare(`UPDATE writing_submissions SET chat = ?, bound = ? WHERE code = ? AND chat IS NULL`).bind(me, Date.now(), code).run();
      if (!(r.meta && r.meta.changes)) {
        const now = await env.DB.prepare(`SELECT chat FROM writing_submissions WHERE code = ?`).bind(code).first();
        if (!now || now.chat !== me) { await say(T.taken); return; }
      }
    } else if (row.blocked) {   // тот же чат снова написал боту: разблокировал, уведомления снова можно слать
      await env.DB.prepare(`UPDATE writing_submissions SET blocked = NULL WHERE code = ?`).bind(code).run();
    }

    if (row.status === 'ready') {   // отчёт уже есть: сразу ссылка, расписание второе сообщение не пришлёт
      const sent = await say(T.ready(codeLabel(code), sheetLink(env, code)));
      if (sent.ok) await env.DB.prepare(`UPDATE writing_submissions SET notified = ? WHERE code = ? AND notified IS NULL`).bind(Date.now(), code).run();
    } else {
      await say(T.received(codeLabel(code)));
    }

    const st = await memberState(env, uid);
    if (st === 'yes') await markSub(env, chat);
    const soc = socials(env), line = socialLine(soc);
    if (st === 'no') {
      const kb = [[{ text: T.btnChannel, url: channelUrl(env) }, { text: T.btnSub, callback_data: 'w:sub' }]];
      if (soc.length) kb.push(socialRow(soc));
      await say(T.askChannel + (line ? ' ' + line.kk : ''), { reply_markup: { inline_keyboard: kb } });
    } else if (line) {   // подписан или проверить нельзя (про ошибку молчим): только просьба про Instagram/TikTok
      await say(line.kk, { reply_markup: { inline_keyboard: [socialRow(soc)] } });
    }
  } catch (e) {
    console.log('writing bind: ' + String(e && e.message || e).slice(0, 200));
    await say(T.fail);
  }
}

/* ---------- кнопка «Я подписался» ---------- */
export async function wCallback(env, cb) {
  const ans = (text, alert) => tgRaw(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: text || '', show_alert: !!alert });
  try {
    if (cb.data !== 'w:sub' || !cb.from) { await ans(''); return; }
    const st = await memberState(env, cb.from.id);
    if (st === 'no') { await ans(T.stillNo, true); return; }
    if (st === 'yes') {
      const chat = cb.message && cb.message.chat ? cb.message.chat.id : cb.from.id;
      await markSub(env, chat);
      if (cb.message) {   // заменяем просьбу подтверждением; кнопки Instagram/TikTok остаются
        const soc = socials(env), line = socialLine(soc);
        await tgRaw(env, 'editMessageText', {
          chat_id: cb.message.chat.id, message_id: cb.message.message_id, disable_web_page_preview: true,
          text: T.subOk + (line ? '\n\n' + line.kk : ''),
          reply_markup: { inline_keyboard: soc.length ? [socialRow(soc)] : [] },
        });
      }
    }
    await ans(T.thanks);   // 'yes' и 'unknown' (не смогли проверить): человеку ошибку не показываем, метку при unknown не ставим
  } catch (e) {
    console.log('writing callback: ' + String(e && e.message || e).slice(0, 200));
    await ans('');
  }
}

/* ---------- /my ---------- */
const almatyDate = (ts) => { const d = new Date(+ts + 5 * 3600e3).toISOString(); return d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4); };
export async function wMy(env, m) {
  const chat = m.chat.id;
  const say = (text) => tgRaw(env, 'sendMessage', { chat_id: chat, text, disable_web_page_preview: true });
  try {
    const rows = (await env.DB.prepare(`SELECT code, ts, status FROM writing_submissions WHERE chat = ? ORDER BY ts DESC LIMIT ?`)
      .bind(String(chat), MY_MAX).all()).results || [];
    if (!rows.length) { await say(T.myEmpty); return; }
    const total = (await env.DB.prepare(`SELECT COUNT(*) AS c FROM writing_submissions WHERE chat = ?`).bind(String(chat)).first()).c;
    const lines = rows.map((r) => codeLabel(r.code) + ' · ' + almatyDate(r.ts) + ' · ' + (r.status === 'ready' ? T.stReady + '\n' + sheetLink(env, r.code) : T.stNew));
    await say(T.myHead + '\n\n' + lines.join('\n\n') + (total > rows.length ? '\n\n… тағы ' + (total - rows.length) : ''));
  } catch (e) {
    console.log('writing my: ' + String(e && e.message || e).slice(0, 200));
    await say(T.fail);
  }
}

/* ---------- /delete ---------- */
/* Без кода - подсказка. Кода нет в базе или он написан неверно - то же «не нашли», что у /start w_… Работа привязана к другому чату или ни к какому -
   не удаляем. Свой чат - DELETE с условием на чат (после проверки: гонка двух чатов не пройдёт), строка уходит целиком. */
export async function wDelete(env, m, rawArg) {
  const chat = m.chat.id;
  const say = (text) => tgRaw(env, 'sendMessage', { chat_id: chat, text, disable_web_page_preview: true });
  try {
    if (!String(rawArg || '').trim()) { await say(T.delUsage); return; }
    const code = normalizeCode(rawArg);
    const row = code ? await env.DB.prepare(`SELECT chat FROM writing_submissions WHERE code = ?`).bind(code).first() : null;
    if (!row) { await say(T.notFound); return; }
    if (row.chat !== String(chat)) { await say(T.delNotYours); return; }
    const r = await env.DB.prepare(`DELETE FROM writing_submissions WHERE code = ? AND chat = ?`).bind(code, String(chat)).run();
    await say(r.meta && r.meta.changes ? T.delOk(codeLabel(code)) : T.notFound);   // 0 строк: успели удалить с сайта между запросами
  } catch (e) {
    console.log('writing delete: ' + String(e && e.message || e).slice(0, 200));
    await say(T.fail);
  }
}

/* ---------- «отчёт готов» ---------- */
/* Сначала одним UPDATE ... RETURNING «занимаем» до NOTIFY_MAX работ (notified = сейчас): так два запуска подряд не пришлют
   одно и то же дважды, а запросов к D1 на запуск не больше трёх. Потом по одному сообщению; ошибка одной не мешает другим.
   Не доставлено (сеть, 5xx) — notified снимаем, следующий запуск попробует снова. 403 «бот заблокирован» (и «чат не найден») —
   notified снимаем и ставим blocked: по часам больше не пытаемся, пока человек сам не напишет боту `/start w_<код>` снова.
   429 — прекращаем запуск, остаток вернётся в очередь. Возвращает {sent, failed, blocked}. */
export async function notifyWritingReady(env, max = NOTIFY_MAX) {
  const out = { sent: 0, failed: 0, blocked: 0 };
  if (!env.TG_BOT_TOKEN || !env.DB) return out;
  let items;
  try {
    items = (await env.DB.prepare(
      `UPDATE writing_submissions SET notified = ?
       WHERE code IN (SELECT code FROM writing_submissions
                      WHERE status = 'ready' AND chat IS NOT NULL AND notified IS NULL AND blocked IS NULL
                      ORDER BY updated, ts LIMIT ?)
       RETURNING code, chat`).bind(Date.now(), max).all()).results || [];
  } catch (e) {   // например, миграция ещё не применена: расписание из-за этого не ломаем
    console.log('writing notify: ' + String(e && e.message || e).slice(0, 200));
    return out;
  }
  const undo = [], block = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const r = await tgRaw(env, 'sendMessage', { chat_id: it.chat, text: T.ready(codeLabel(it.code), sheetLink(env, it.code)), disable_web_page_preview: true });
    if (r.ok) { out.sent++; continue; }
    if (r.status === 403 || (r.status === 400 && /chat not found|user is deactivated/i.test(r.desc))) { block.push(it.code); out.blocked++; continue; }
    undo.push(it.code); out.failed++;
    if (r.status === 429) { for (let j = i + 1; j < items.length; j++) undo.push(items[j].code); break; }
  }
  const stmts = [
    ...undo.map((c) => env.DB.prepare(`UPDATE writing_submissions SET notified = NULL WHERE code = ?`).bind(c)),
    ...block.map((c) => env.DB.prepare(`UPDATE writing_submissions SET notified = NULL, blocked = ? WHERE code = ?`).bind(Date.now(), c)),
  ];
  if (stmts.length) { try { await env.DB.batch(stmts); } catch (e) { console.log('writing notify undo: ' + String(e && e.message || e).slice(0, 200)); } }
  return out;
}

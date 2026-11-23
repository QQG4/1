/* Посты по расписанию (22.11.2026, владелец: «чтобы делалось само по времени»).
   PLAN — разовые публикации: час по UTC ('ГГГГ-ММ-ДДTЧЧ'), вид и текст. Ежечасное расписание воркера вызывает runPlan:
   запись, чей час наступил, выходит один раз (отметка в events: name='tg-plan', note=id; повтор не публикует).
   Виды: text — сообщение в канал; album — альбом картинок из статических файлов воркера (img/…, папка соцсети/_publish)
   с подписью на первой; ig — одна картинка в Instagram (ig.js → igImage); draw — розыгрыш конкурса эссе
   (случайно до N работ за окно дат, сначала с отметкой подписки на канал; итог в канал, победителям — сообщение в бот,
   владельцу — список). link: true — в этот день вечернее аудирование выходит без ссылки на сайт (правило одной ссылки в день).
   Казахские строки проверены мастером казахского 22.11.2026, носитель не читал. Время в комментариях — Алматы (UTC+5). */
import { tgBase } from './tgapi.js';
import { igImage } from './ig.js';

const SELF = 'https://qazaq-trainer-stats.k-k-g-inter.workers.dev/';
const IG_URL = 'https://www.instagram.com/qazaq.trainer/';
const TT_URL = 'https://www.tiktok.com/@qazaq.trainer';

const ANNOUNCE = '🏆 Эссе байқауы: 20 жұмысты біздің команда тексереді\n' +
  'Конкурс эссе: наша команда проверит 20 работ по критериям ҚАЗТЕСТ.\n\n' +
  'Что получите: балл по каждому критерию и почему он такой, ваш текст с пометками (что исправить и как правильно), ' +
  'три шага до следующей работы. На русском и на казахском, как на картинке.\n\n' +
  'Как участвовать:\n' +
  '1. Напишите эссе в любом тесте ҚАЗТЕСТ на сайте и нажмите «Отправить на проверку команде».\n' +
  '2. Нажмите «Получить уведомление в Telegram»: наш бот пришлёт отчёт.\n' +
  '3. Подпишитесь на этот канал, наш Instagram и TikTok.\n\n' +
  'Приём до среды, 25 ноября. В четверг выберем 20 работ случайно и опубликуем их коды здесь.\n\n' +
  'Мәтінді сайтта жіберіңіз, арнамызға, Instagram мен TikTok-қа жазылыңыз. Бейсенбіде 20 жұмысты кездейсоқ таңдаймыз, нәтижесін осында жариялаймыз.\n\n' +
  'https://qazaqtrainer.com/?utm_source=telegram&utm_campaign=konkurs1';

export const PLAN = [
  { id: 'teaser-1122', at: '2026-11-22T15', kind: 'text',   // вс 20:00
    text: 'Ертең эссе жазатындарға жаңалық бар.\n\nЗавтра новость для всех, кто пишет эссе на ҚАЗТЕСТ. ' +
      'Проверьте, что вы подписаны на наш Instagram и TikTok.\n\nInstagram мен TikTok-тағы беттерімізге жазылғаныңызды тексеріңіз.\n\n' +
      'Instagram: ' + IG_URL + '\nTikTok: ' + TT_URL },
  { id: 'konkurs-1123', at: '2026-11-23T07', kind: 'album', link: true,   // пн 12:00
    photos: ['img/sheet-ru.jpg', 'img/sheet-kk.jpg'], text: ANNOUNCE },
  { id: 'konkurs-ig-1123', at: '2026-11-23T08', kind: 'ig', photo: 'img/sheet-ig.jpg',   // пн 13:00
    caption: 'Эссе байқауы / Конкурс эссе\n\nНаша команда проверит 20 эссе по критериям ҚАЗТЕСТ: балл по каждому критерию, ' +
      'ваш текст с пометками и три шага до следующей работы. На русском и на казахском.\n\n' +
      'Как участвовать: напишите эссе в тесте ҚАЗТЕСТ на сайте qazaqtrainer.com, нажмите «Отправить на проверку команде» ' +
      'и подпишитесь на нас в Instagram, TikTok и Telegram (t.me/qazaqtrainer). Приём до среды, 25 ноября; в четверг выберем 20 работ.\n\n' +
      '#казахскийязык #қазақтілі #казтест #қазтест #эссе' },
  { id: 'remind-1124', at: '2026-11-24T07', kind: 'text', link: true,   // вт 12:00
    text: '⏳ Эссе байқауы жалғасып жатыр / Конкурс эссе продолжается\n\n' +
      'Енді QazResmiTest жазылымын да жіберуге болады. / Проблему с отправкой письма QazResmiTest мы решили: теперь его тоже можно отправить на проверку.\n\n' +
      'Тест тапсырмай-ақ жазу үшін байқау бетінде тақырып пен мәтін өрісі бар. / Не хотите проходить тест — на странице конкурса есть тема и поле для текста, отправка в одно нажатие.\n\n' +
      'Жұмыстар сәрсенбіге дейін қабылданады. / Приём до среды, 25 ноября. В четверг выберем 20 работ.\n\n' +
      'https://qazaqtrainer.com/?utm_source=telegram&utm_campaign=konkurs2#/konkurs' },
  { id: 'draw-1126', at: '2026-11-26T05', kind: 'draw', n: 20,   // чт 10:00
    since: Date.UTC(2026, 10, 22, 19), until: Date.UTC(2026, 10, 25, 19) },   // пн 23.11 00:00 – ср 25.11 24:00 по Алматы
];

const hourKey = (d) => d.toISOString().slice(0, 13);
const dayKey = (d) => d.toISOString().slice(0, 10);

/* В этот день у вечернего аудирования убрать ссылку: ссылка уже была в посте плана. */
export function linkTakenToday(now = new Date()) {
  return PLAN.some((p) => p.link && p.at.slice(0, 10) === dayKey(now));
}

async function tgCall(env, method, body) {
  const r = await fetch(tgBase(env) + '/bot' + env.TG_BOT_TOKEN + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.log('plan telegram ' + method + ' → ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  return j.ok ? (j.result || true) : null;
}
const owner = (env, text) => env.TG_OWNER_CHAT ? tgCall(env, 'sendMessage', { chat_id: env.TG_OWNER_CHAT, text, disable_web_page_preview: true }) : null;
const label = (c) => 'QT-' + c.slice(0, 4) + '-' + c.slice(4);

/* Честный случайный порядок: перемешивание Фишера — Йетса на crypto.getRandomValues. */
function shuffle(a) {
  const r = new Uint32Array(a.length); crypto.getRandomValues(r);
  for (let i = a.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function draw(env, p) {
  const rows = (await env.DB.prepare(`SELECT code, chat, sub FROM writing_submissions
      WHERE status = 'new' AND picked IS NULL AND ts >= ? AND ts < ?`).bind(p.since, p.until).all()).results || [];
  if (!rows.length) { await owner(env, 'Розыгрыш ' + p.id + ': за окно не пришло ни одной работы, пост в канал не вышел.'); return true; }
  const subd = shuffle(rows.filter((r) => r.sub)), rest = shuffle(rows.filter((r) => !r.sub));
  const win = subd.concat(rest).slice(0, p.n);   // сначала подписанные на канал, недостающие — из остальных
  const now = Date.now();
  await env.DB.batch(win.map((w) => env.DB.prepare(`UPDATE writing_submissions SET picked = ? WHERE code = ?`).bind(now, w.code)));
  const codes = win.map((w) => label(w.code)).sort();
  const text = '🎉 Эссе байқауының қорытындысы / Итоги конкурса эссе\n\n' +
    'Барлығы ' + rows.length + ' жұмыс келді. / Всего пришло работ: ' + rows.length + '.\n\n' +
    'Біздің команда тексеретін жұмыстар: / Работы, которые проверит наша команда:\n' + codes.join('\n') + '\n\n' +
    'Есепті бір тәулік ішінде ботқа жібереміз. / Отчёт придёт в бот в течение суток.\n\n' +
    'Қатысқандарыңызға рақмет! Келесі байқау жақында. / Спасибо всем, кто участвовал! Следующий конкурс скоро.';
  const ok = await tgCall(env, 'sendMessage', { chat_id: env.TG_CHANNEL, text, disable_web_page_preview: true });
  for (const w of win) if (w.chat) await tgCall(env, 'sendMessage', { chat_id: w.chat,
    text: 'Сіздің жұмысыңыз таңдалды! ✅ ' + label(w.code) + '\nБіздің команда оны бір тәулік ішінде тексереді, есеп осында келеді.' });
  await owner(env, 'Розыгрыш ' + p.id + ': пришло ' + rows.length + ', с подпиской ' + subd.length + ', выбрано ' + win.length +
    '.\nКоды: ' + codes.join(' ') + '\nДальше: qt_check.py fetch → проверка → publish.');
  return ok;
}

export async function runPlan(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL) return;
  const h = hourKey(new Date());
  for (const p of PLAN.filter((x) => x.at === h)) {
    const done = await env.DB.prepare(`SELECT 1 FROM events WHERE name = 'tg-plan' AND note = ? LIMIT 1`).bind(p.id).first();
    if (done) continue;
    let ok = null;
    try {
      if (p.kind === 'text') ok = await tgCall(env, 'sendMessage', { chat_id: env.TG_CHANNEL, text: p.text, disable_web_page_preview: true });
      else if (p.kind === 'album') ok = await tgCall(env, 'sendMediaGroup', { chat_id: env.TG_CHANNEL,
        media: p.photos.map((f, i) => ({ type: 'photo', media: SELF + f, ...(i === 0 ? { caption: p.text.slice(0, 1024) } : {}) })) });
      else if (p.kind === 'ig') ok = await igImage(env, SELF + p.photo, p.caption);
      else if (p.kind === 'draw') ok = await draw(env, p);
    } catch (e) { console.log('plan ' + p.id + ': ' + e); }
    if (ok) await env.DB.prepare(`INSERT INTO events (day, ts, name, note) VALUES (?,?,?,?)`).bind(dayKey(new Date()), Date.now(), 'tg-plan', p.id).run();
    else await owner(env, 'Пост по расписанию ' + p.id + ' не вышел, подробности в журнале воркера.');
  }
}

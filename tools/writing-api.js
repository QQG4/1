/* Проверка письма командой: серверная часть пилота (15.11.2026).
   Чистые функции над env.DB (D1), без привязки к конкретному воркеру. Подключены к двум воркерам с одной базой:
   лаборатории (tools/lab-deploy/worker.js, после проверки входа) и публичному (tools/events-worker/worker.js, с 17.11.2026:
   `import { handleWriting } from '../writing-api.js'`, CORS и проверку Origin делает сам воркер и передаёт заголовки вторым аргументом).

   Что хранится: текст работы и задание, к которому он написан, id теста и задания, уровень, язык интерфейса,
   число слов, utm/ref первого просмотра вкладки. Имени, почты, IP и идентификатора посетителя нет: человек
   узнаёт свою работу по коду QT-XXXX-XXXX, который сайт сохраняет у него в прогрессе.

   Интерфейс:
     POST /api/writing/submit  тело text/plain с JSON {text, prompt, test, task, level, lang, words, utm, ref, t, hp}
                               → 200 {code, label, status, dup}; 400 {error:'bad_json'|'empty'|'too_short'|'bad_task'|'too_fast'};
                                 413 {error:'too_long'|'too_large'}; 429 {error:'busy', retry} (общий потолок приёма, см. WR_LIMITS)
                               Защита от спама без IP и сторонних сервисов (17.11.2026): t - сколько секунд человек пробыл над заданием
                               (считает клиент, меньше WR_LIMITS.minSeconds - 400 too_fast); hp - невидимое поле-ловушка формы
                               (непустое - работа молча не сохраняется, ответ обычный, с вымышленным кодом); потолок приёма
                               rateHour/rateDay на все посещения вместе (таблица writing_rate, счётчики без текста и без идентификаторов).
     GET  /api/writing/status?code=…  → 200 {code, status:'new'|'ready', ts, updated}; 400 bad_code; 404 not_found
     GET  /api/writing/report?code=…  → для посетителя: 200 {code, label, report}; 400 bad_code; 404 not_found;
                               409 {error:'not_ready', code, label, ts}. Отдаёт только отчёт этой работы.
     POST /api/writing/delete  тело text/plain с JSON {code} → для посетителя, без служебного ключа: код и есть право доступа.
                               Удаляет строку целиком (текст, условие, отчёт, привязку к чату Telegram).
                               200 {deleted:true}; 400 {error:'bad_json'|'bad_code'}; 404 {error:'not_found'}; 413 too_large.
   Служебные запросы (для нашей команды, только с заголовком X-Writing-Key = env.WRITING_KEY; нет переменной или ключ
   не совпал - 403, открытыми не бывают никогда):
     GET  /api/writing/list?status=new|ready|all&limit=… → 200 {items:[{code, label, ts, status, test, task, level, lang, words, prompt, text, sub}]}
                               дополнительно: since, until (мс, ts >= since и ts < until), brief=1 (без текста и условия, до listBriefMax строк:
                               для розыгрыша), codes=КОД,КОД (до 50 работ по кодам)
     POST /api/writing/report  тело JSON {code, report} → кладёт отчёт, status='ready', updated; повторная публикация заменяет отчёт
                               → 200 {code, label, status, updated, bytes}; 400 bad_json|bad_code|bad_report; 404 not_found; 413 too_large
   report - JSON {v:1, lang:{ru:'<html>', kk:…}, meta:{total, date, words}}: html - содержимое <main class="sheet"> после полосы
   .band (рисует только qt_check.py, страница /sheet/ лишь вставляет его). В колонке хранится строка JSON.
   Таблица writing_submissions — tools/events-worker/schema.sql и migrate-2026-11-15-writing.sql. */

export const WR_ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // тот же алфавит, что у кода переноса прогресса (без 0/O, 1/I)
export const WR_LIMITS = {
  textMax: 8000,          // знаков в тексте
  minWords: 50,           // короче не принимаем (19.11.2026, владелец: как минимум по заданию «по картинке»)
  bodyMax: 48 * 1024,     // тело запроса целиком (8000 знаков кириллицы - около 16 КБ в UTF-8)
  promptMax: 1500,
  dupMs: 24 * 3600e3,     // тот же текст того же задания в течение суток - прежний код
  codeTries: 6,           // сколько раз пробуем новый код при совпадении
  reportMax: 600 * 1024,  // отчёт в виде строки JSON, байт (служебная публикация)
  listMax: 200,           // сколько работ отдаёт list за раз; по умолчанию listDefault
  listDefault: 50,
  listBriefMax: 2000,     // brief=1 (без текстов): столько строк за раз
  listCodesMax: 50,       // codes=…: столько работ по кодам
  // --- защита от спама (17.11.2026): без IP, отпечатков и сторонних сервисов ---
  rateHour: 100,          // общий потолок приёма: новых работ в час (календарный час UTC) на всех посетителей вместе
  rateDay: 600,           // и в сутки (календарные сутки UTC); больше - 429 busy, пока не начнётся новый час / сутки
  minSeconds: 20,         // минимум секунд над заданием до отправки (считает клиент, присылает в t); меньше - 400 too_fast
  rateKeepDays: 3,        // как долго хранятся счётчики потолка (чистит ночной cron воркера)
};

/* Слова считаем так же, как клиент (wordCount в app.js): последовательности не-пробельных знаков. */
export function countWords(s) {
  const m = String(s || '').trim().match(/[^\s]+/g);
  return m ? m.length : 0;
}

/* Код работы: 8 знаков из WR_ABC, криптослучайно. 256 делится на 32 без остатка, поэтому перекоса нет. */
export function newWritingCode() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(r, (b) => WR_ABC[b % 32]).join('');
}

/* Любой ввод кода (QT-ABCD-EFGH, abcd efgh, ABCDEFGH) → 8 знаков или ''. Знаки вне алфавита (0, O, 1, I) — не код. */
export function normalizeCode(v) {
  let c = String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (c.length === 10 && c.slice(0, 2) === 'QT') c = c.slice(2);
  return c.length === 8 && [...c].every((ch) => WR_ABC.indexOf(ch) >= 0) ? c : '';
}
export const codeLabel = (c) => 'QT-' + c.slice(0, 4) + '-' + c.slice(4);

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}
const clip = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
const reply = (status, json, headers) => ({ status, json, headers });

/* Потолок приёма (17.11.2026). Счётчики лежат в writing_rate: ключ - календарный час или сутки по UTC, число - сколько новых работ
   принято. Отдельная таблица, а не подсчёт строк writing_submissions: иначе «отправил и удалил» (удаление открыто по коду)
   сбрасывало бы потолок. Окна календарные, не скользящие: на стыке часа за короткое время может пройти до двух норм.
   Проверка и запись разнесены (читаем до вставки, прибавляем после): при одновременных запросах потолок может быть превышен
   на единицы, это не страшно; зато отказы счётчик не раздувают. Нет таблицы (миграция не применена) - потолок не работает, приём идёт. */
const rateKeys = (now) => ['h' + Math.floor(now / 3600e3), 'd' + Math.floor(now / 86400e3)];
async function rateBusy(env, now) {
  try {
    const [h, d] = rateKeys(now);
    const rows = (await env.DB.prepare(`SELECT bucket, n FROM writing_rate WHERE bucket IN (?, ?)`).bind(h, d).all()).results || [];
    const n = (k) => (rows.find((r) => r.bucket === k) || {}).n || 0;
    if (n(h) >= WR_LIMITS.rateHour) return 3600 - Math.floor((now % 3600e3) / 1000);       // секунд до нового часа
    if (n(d) >= WR_LIMITS.rateDay) return 86400 - Math.floor((now % 86400e3) / 1000);      // секунд до новых суток
  } catch (e) { console.log('writing rate: ' + String(e && e.message || e).slice(0, 160)); }
  return 0;
}
async function rateCount(env, now) {
  try {
    const st = rateKeys(now).map((k) => env.DB.prepare(`INSERT INTO writing_rate (bucket, n) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET n = n + 1`).bind(k));
    await env.DB.batch(st);
  } catch (e) { console.log('writing rate: ' + String(e && e.message || e).slice(0, 160)); }
}
/* Ночная чистка счётчиков (вызывает purge воркера events-worker). Сутки и часы старше rateKeepDays не нужны. */
export async function purgeWritingRate(env, now = Date.now()) {
  const day = Math.floor(now / 86400e3) - WR_LIMITS.rateKeepDays, hour = day * 24;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM writing_rate WHERE bucket LIKE 'd%' AND CAST(substr(bucket, 2) AS INTEGER) < ?`).bind(day),
    env.DB.prepare(`DELETE FROM writing_rate WHERE bucket LIKE 'h%' AND CAST(substr(bucket, 2) AS INTEGER) < ?`).bind(hour),
  ]);
}

/* Приём работы. raw — тело запроса строкой. Возвращает {status, json}; в базу пишет только при успехе.
   Порядок проверок: размер и JSON → ловушка hp (молча, ответ как при успехе) → текст и задание → время над заданием t →
   повтор того же текста (прежний код, потолок не тратит) → общий потолок → запись → счётчик. */
export async function submitWriting(env, raw, now = Date.now()) {
  if (!env || !env.DB) return reply(500, { error: 'no_db' });
  raw = String(raw || '');
  if (raw.length > WR_LIMITS.bodyMax) return reply(413, { error: 'too_large' });
  let d;
  try { d = JSON.parse(raw); } catch (e) { return reply(400, { error: 'bad_json' }); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return reply(400, { error: 'bad_json' });

  // поле-ловушка: человек его не видит и не заполняет, бот, который заполняет все поля формы, заполнит. Работа не сохраняется,
  // а ответ обычный (вымышленный код, которого в базе нет), чтобы бот не понял, что его раскрыли
  if (d.hp != null && String(d.hp).trim() !== '') {
    const code = newWritingCode();
    return reply(200, { code, label: codeLabel(code), status: 'new', dup: false });
  }

  // сохраняем текст как есть (абзацы важны для разбора), только обрезаем края и приводим переводы строк
  const text = String(d.text == null ? '' : d.text).replace(/\r\n?/g, '\n').trim();
  if (!text) return reply(400, { error: 'empty' });
  if ([...text].length > WR_LIMITS.textMax) return reply(413, { error: 'too_long', max: WR_LIMITS.textMax });
  const words = countWords(text);   // слова считаем заново: присланному числу не верим
  if (words < WR_LIMITS.minWords) return reply(400, { error: 'too_short', words, min: WR_LIMITS.minWords });

  const test = clip(d.test, 60), task = clip(d.task, 40);
  if (!test || !task) return reply(400, { error: 'bad_task' });
  const level = clip(d.level, 12), lang = d.lang === 'kk' ? 'kk' : 'ru';
  const prompt = clip(d.prompt, WR_LIMITS.promptMax), utm = clip(d.utm, 130), ref = clip(d.ref, 80);

  // время над заданием: клиент присылает секунды в t; нет числа или меньше минимума - слишком быстро. Человек за 20 секунд
  // 30 слов не напишет, а прочитать свой текст перед отправкой успеет; значение клиентское, поэтому это лишь барьер для простых ботов
  const t = typeof d.t === 'number' ? d.t : NaN;
  if (!(t >= WR_LIMITS.minSeconds)) return reply(400, { error: 'too_fast', min: WR_LIMITS.minSeconds });

  // защита от повторов: тот же текст того же задания за сутки — прежний код, второй работы не создаём
  const hash = await sha256hex(test + '\n' + task + '\n' + text.replace(/\s+/g, ' '));
  const dup = await env.DB.prepare(`SELECT code, status FROM writing_submissions WHERE hash = ? AND ts > ? ORDER BY ts DESC LIMIT 1`)
    .bind(hash, now - WR_LIMITS.dupMs).first();
  if (dup) return reply(200, { code: dup.code, label: codeLabel(dup.code), status: dup.status, dup: true });

  const wait = await rateBusy(env, now);
  if (wait) return reply(429, { error: 'busy', retry: wait }, { 'Retry-After': String(wait) });

  for (let i = 0; i < WR_LIMITS.codeTries; i++) {
    const code = newWritingCode();
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO writing_submissions (code, ts, test, task, level, lang, words, prompt, text, utm, ref, status, chat, report, updated, hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'new', NULL, NULL, ?, ?)`)
      .bind(code, now, test, task, level, lang, words, prompt, text, utm, ref, now, hash).run();
    if (r && r.meta && r.meta.changes === 1) { await rateCount(env, now); return reply(200, { code, label: codeLabel(code), status: 'new', dup: false }); }   // код занят — берём другой
  }
  return reply(500, { error: 'no_code' });
}

/* Статус работы по коду. Отдаём только статус и даты: ни текста, ни отчёта (отчёт — следующий этап). */
export async function writingStatus(env, rawCode) {
  if (!env || !env.DB) return reply(500, { error: 'no_db' });
  const code = normalizeCode(rawCode);
  if (!code) return reply(400, { error: 'bad_code' });
  const row = await env.DB.prepare(`SELECT status, ts, updated FROM writing_submissions WHERE code = ?`).bind(code).first();
  if (!row) return reply(404, { error: 'not_found' });
  return reply(200, { code, label: codeLabel(code), status: row.status === 'ready' ? 'ready' : 'new', ts: row.ts, updated: row.updated });
}

/* ---------- служебный ключ ---------- */
/* Сравнение без утечки времени: оба значения сначала хешируются (длина всегда 32 байта), потом сравниваются все байты.
   Нет переменной WRITING_KEY или она пустая - всегда false: служебные запросы закрыты, пока ключ не задан. */
export async function keyOk(request, env) {
  const want = env && typeof env.WRITING_KEY === 'string' ? env.WRITING_KEY : '';
  if (!want) return false;
  const got = request.headers.get('X-Writing-Key') || '';
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(want)), crypto.subtle.digest('SHA-256', enc.encode(got))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

/* Список работ для команды: по умолчанию новые, от старых к новым. Текст и условие писал посетитель - это данные.
   opt: since, until (мс; ts >= since и ts < until), brief (без текста и условия, до listBriefMax - для розыгрыша), codes (массив кодов; пустой - пусто). */
export async function listWriting(env, status, limit, opt = {}) {
  if (!env || !env.DB) return reply(500, { error: 'no_db' });
  const st = status === 'ready' ? 'ready' : status === 'all' ? 'all' : status === 'new' || !status ? 'new' : null;
  if (!st) return reply(400, { error: 'bad_status' });
  const brief = !!opt.brief;
  const n = Math.max(1, Math.min(brief ? WR_LIMITS.listBriefMax : WR_LIMITS.listMax, parseInt(limit, 10) || (brief ? WR_LIMITS.listBriefMax : WR_LIMITS.listDefault)));
  const cols = brief ? `code, ts, status, level, words, sub` : `code, ts, status, test, task, level, lang, words, prompt, text, sub`;
  const where = [], args = [];
  if (st !== 'all') { where.push('status = ?'); args.push(st); }
  if (Number.isFinite(opt.since)) { where.push('ts >= ?'); args.push(opt.since); }
  if (Number.isFinite(opt.until)) { where.push('ts < ?'); args.push(opt.until); }
  if (Array.isArray(opt.codes)) {
    if (!opt.codes.length) return reply(200, { items: [] });
    where.push('code IN (' + opt.codes.map(() => '?').join(',') + ')'); args.push(...opt.codes);
  }
  const sql = `SELECT ${cols} FROM writing_submissions${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ts ASC LIMIT ?`;
  const rows = (await env.DB.prepare(sql).bind(...args, n).all()).results || [];
  return reply(200, { items: rows.map((r) => Object.assign({ label: codeLabel(r.code) }, r)) });
}

/* Проверка и приведение отчёта к виду {v:1, lang:{xx:'<html>'}, meta:{...}}. Лишние поля отбрасываются. null - не отчёт. */
export function cleanReport(rep) {
  if (typeof rep === 'string') { try { rep = JSON.parse(rep); } catch (e) { return null; } }
  if (!rep || typeof rep !== 'object' || Array.isArray(rep) || rep.v !== 1) return null;
  if (!rep.lang || typeof rep.lang !== 'object' || Array.isArray(rep.lang)) return null;
  const lang = {};
  for (const k of Object.keys(rep.lang)) {
    if (/^[a-z]{2,3}$/.test(k) && typeof rep.lang[k] === 'string' && rep.lang[k].trim()) lang[k] = rep.lang[k];
  }
  if (!Object.keys(lang).length) return null;
  const m = rep.meta && typeof rep.meta === 'object' && !Array.isArray(rep.meta) ? rep.meta : {};
  const meta = {};
  if (Number.isFinite(m.total)) meta.total = m.total;
  if (Number.isFinite(m.words)) meta.words = m.words;
  if (typeof m.date === 'string') meta.date = m.date.slice(0, 40);
  return { v: 1, lang, meta };
}

/* Публикация отчёта: кладёт его в колонку report, ставит status='ready' и updated. Повторная - заменяет. raw - тело запроса. */
export async function publishWriting(env, raw, now = Date.now()) {
  if (!env || !env.DB) return reply(500, { error: 'no_db' });
  let d;
  try { d = JSON.parse(String(raw || '')); } catch (e) { return reply(400, { error: 'bad_json' }); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return reply(400, { error: 'bad_json' });
  const code = normalizeCode(d.code);
  if (!code) return reply(400, { error: 'bad_code' });
  const rep = cleanReport(d.report);
  if (!rep) return reply(400, { error: 'bad_report' });
  const body = JSON.stringify(rep);
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > WR_LIMITS.reportMax) return reply(413, { error: 'too_large', max: WR_LIMITS.reportMax });
  const r = await env.DB.prepare(`UPDATE writing_submissions SET report = ?, status = 'ready', updated = ? WHERE code = ?`).bind(body, now, code).run();
  if (!r || !r.meta || r.meta.changes !== 1) return reply(404, { error: 'not_found' });
  return reply(200, { code, label: codeLabel(code), status: 'ready', updated: now, bytes });
}

/* Отчёт для посетителя по коду. Отдаёт только отчёт этой работы (и свои код/дату), ни текста, ни чужих данных. */
export async function readReport(env, rawCode) {
  if (!env || !env.DB) return reply(500, { error: 'no_db' });
  const code = normalizeCode(rawCode);
  if (!code) return reply(400, { error: 'bad_code' });
  const row = await env.DB.prepare(`SELECT status, ts, report FROM writing_submissions WHERE code = ?`).bind(code).first();
  if (!row) return reply(404, { error: 'not_found' });
  if (row.status !== 'ready' || !row.report) return reply(409, { error: 'not_ready', code, label: codeLabel(code), ts: row.ts });
  let report;
  try { report = JSON.parse(row.report); } catch (e) { return reply(500, { error: 'server' }); }
  return reply(200, { code, label: codeLabel(code), report });
}

/* Удаление работы самим посетителем. raw — тело запроса строкой. Строка удаляется целиком одним DELETE: после этого status, report
   и страница отчёта отвечают 404 «такого кода нет». Повторное удаление - 404. */
export async function deleteWriting(env, raw) {
  if (!env || !env.DB) return reply(500, { error: 'no_db' });
  let d;
  try { d = JSON.parse(String(raw || '')); } catch (e) { return reply(400, { error: 'bad_json' }); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return reply(400, { error: 'bad_json' });
  const code = normalizeCode(d.code);
  if (!code) return reply(400, { error: 'bad_code' });
  const r = await env.DB.prepare(`DELETE FROM writing_submissions WHERE code = ?`).bind(code).run();
  if (!r || !r.meta || r.meta.changes !== 1) return reply(404, { error: 'not_found' });
  return reply(200, { deleted: true });
}

/* Тело запроса не больше max байт: читаем потоком и бросаем, как только перебрали (Content-Length можно не указать или соврать). null - слишком большое. */
async function readLimited(request, max) {
  if ((+request.headers.get('Content-Length') || 0) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch (e) {} return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return new TextDecoder().decode(all);
}

const PATHS = new Set(['/api/writing/submit', '/api/writing/status', '/api/writing/list', '/api/writing/report', '/api/writing/delete']);
/* Обёртка для воркера: возвращает Response, если путь наш, иначе null (воркер идёт дальше по своим маршрутам).
   headers — дополнительные заголовки ответа (публичный воркер передаёт сюда CORS); no-store всегда:
   статус меняется, кэшировать его нельзя. */
export async function handleWriting(request, env, headers = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!PATHS.has(path)) return null;
  const out = (r) => new Response(JSON.stringify(r.json), {
    status: r.status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers, r.headers),
  });
  try {
    if (path === '/api/writing/submit') {
      if (request.method !== 'POST') return out(reply(405, { error: 'post_only' }));
      // заранее отсекаем явно огромное тело, не читая его
      const len = +request.headers.get('Content-Length') || 0;
      if (len > WR_LIMITS.bodyMax) return out(reply(413, { error: 'too_large' }));
      return out(await submitWriting(env, await request.text()));
    }
    if (path === '/api/writing/delete') {   // посетителю, без ключа: код - право доступа; тело крошечное ({code}), читаем с пределом
      if (request.method !== 'POST') return out(reply(405, { error: 'post_only' }));
      const raw = await readLimited(request, 1024);
      if (raw == null) return out(reply(413, { error: 'too_large' }));
      return out(await deleteWriting(env, raw));
    }
    if (path === '/api/writing/list') {   // служебный: сначала ключ, потом всё остальное (в том числе метод)
      if (!(await keyOk(request, env))) return out(reply(403, { error: 'forbidden' }));
      if (request.method !== 'GET') return out(reply(405, { error: 'get_only' }));
      const q = url.searchParams, num = (k) => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : NaN);
      return out(await listWriting(env, q.get('status'), q.get('limit'), {
        since: num('since'), until: num('until'), brief: q.get('brief') === '1',
        codes: q.has('codes') ? q.get('codes').split(/[,\s]+/).map(normalizeCode).filter(Boolean).slice(0, WR_LIMITS.listCodesMax) : undefined,
      }));
    }
    if (path === '/api/writing/report') {
      if (request.method === 'GET') return out(await readReport(env, url.searchParams.get('code')));   // посетитель, без ключа
      if (request.method !== 'POST') return out(reply(405, { error: 'get_or_post' }));
      if (!(await keyOk(request, env))) return out(reply(403, { error: 'forbidden' }));   // публикация: только с ключом, тело не читаем
      const max = WR_LIMITS.reportMax + 4096;   // отчёт плюс код и обвязка JSON
      const raw = await readLimited(request, max);
      if (raw == null) return out(reply(413, { error: 'too_large', max: WR_LIMITS.reportMax }));
      return out(await publishWriting(env, raw));
    }
    if (request.method !== 'GET') return out(reply(405, { error: 'get_only' }));
    return out(await writingStatus(env, url.searchParams.get('code')));
  } catch (e) {
    return out(reply(500, { error: 'server' }));
  }
}

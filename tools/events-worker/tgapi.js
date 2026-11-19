/* Адрес и вызов Telegram Bot API для всего воркера (15.11.2026).
   TG_API — переменная окружения: по умолчанию настоящий api.telegram.org; для локальной проверки (wrangler dev) туда
   подставляют адрес заглушки, чтобы не трогать настоящий бот. Секрет TG_BOT_TOKEN читается из env, нигде не печатается. */

export const tgBase = (env) => String((env && env.TG_API) || 'https://api.telegram.org').replace(/\/+$/, '');

/* Вызов метода с полным ответом: {ok, status, result, desc}. Не бросает исключений (сеть, не-JSON, ошибка Telegram) —
   вызывающий сам решает, что делать с 403 («бот заблокирован») или 429. Ошибки в журнал, без токена и без тела запроса. */
export async function tgRaw(env, method, body) {
  try {
    const r = await fetch(tgBase(env) + '/bot' + env.TG_BOT_TOKEN + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    const ok = r.ok && j.ok !== false;
    if (!ok) console.log('telegram ' + method + ' → ' + r.status + ' ' + String(j.description || '').slice(0, 200));
    return { ok, status: r.status, result: j.result, desc: String(j.description || ''), retry: j.parameters && j.parameters.retry_after };
  } catch (e) {
    console.log('telegram ' + method + ' → сеть: ' + String(e && e.message || e).slice(0, 120));
    return { ok: false, status: 0, result: null, desc: 'network' };
  }
}

# Приёмник статистики (Cloudflare Worker + D1)

Считает, что происходит на публичном сайте: сколько людей открыли тест, сколько дошли до «Зафиксировать ответы»,
какой процент набрали — и, главное, **какой вариант ответа выбирают на каждом вопросе**. Последнее нужно, чтобы
перекалибровать дистракторы B2–C2 по реальным данным, а не на глаз (см. сводку QA от 13–14.09.2026).

Персональных данных не собираем: `sid` — случайный идентификатор вкладки, живёт до её закрытия; IP не пишем,
из геоданных только страна, которую Cloudflare отдаёт сам.

## Развёртывание (нужен Node — на машине стоит, v26.8.2 на 15.09.2026)

    cd "/Users/kkg/Desktop/Additional projects/kazresmi test programm/qazaq-trainer/tools/events-worker"
    npx wrangler login
    npx wrangler d1 create qazaq-trainer-stats      # выведет database_id — вписать в wrangler.toml
    npx wrangler d1 execute qazaq-trainer-stats --remote --file=schema.sql
    npx wrangler deploy --config wrangler.toml       # выведет https://qazaq-trainer-stats.<аккаунт>.workers.dev

**Флаг `--config wrangler.toml` обязателен**: без него wrangler поднимается вверх по дереву, находит `wrangler.jsonc`
в корне проекта (конфиг публичного сайта) и деплоит не тот воркер, ничего об этом не сказав.

Адрес воркера вписать в `src/data/site.js` → `eventsUrl`, затем `python3 build.py` и запушить `docs/`.
Пока `eventsUrl` пуст, приложение ничего не отправляет.

Если публичный адрес сайта сменится (свой домен) — добавить его в массив `ALLOWED` в `worker.js` и задеплоить заново,
иначе браузер не отпустит события с нового домена.

## Что смотреть

    # воронка за последние 7 дней
    npx wrangler d1 execute qazaq-trainer-stats --remote --command \
      "SELECT name, COUNT(*) n, COUNT(DISTINCT sid) people FROM events WHERE day >= date('now','-7 day') GROUP BY name ORDER BY n DESC"

    # какие тесты доходят до конца
    npx wrangler d1 execute qazaq-trainer-stats --remote --command \
      "SELECT test, section, COUNT(*) done, ROUND(AVG(pct)) avg_pct FROM events WHERE name='section-done' GROUP BY test, section ORDER BY done DESC"

    # вопросы, где ошибается меньше 10 % — слишком лёгкие; где больше 80 % — либо сложные, либо сломанные
    npx wrangler d1 execute qazaq-trainer-stats --remote --command \
      "SELECT test, section, qid, COUNT(*) n, ROUND(100.0*SUM(ok)/COUNT(*)) pct_ok FROM answers GROUP BY test, section, qid HAVING n >= 20 ORDER BY pct_ok"

    # мёртвые дистракторы: варианты, которые не выбрал никто
    npx wrangler d1 execute qazaq-trainer-stats --remote --command \
      "SELECT test, section, qid, chosen, COUNT(*) n FROM answers GROUP BY test, section, qid, chosen ORDER BY test, qid, chosen"

Индекс выбранного варианта (`chosen`) — позиция в массиве `options` **исходного файла теста**, а не на экране:
варианты перемешиваются при показе (`shuffleQuestion` сохраняет перестановку в `q._perm`), и перед отправкой
позиция приводится обратно к порядку данных. То есть `chosen` можно прямо сопоставлять со строкой в `src/data/tests/*.js`.

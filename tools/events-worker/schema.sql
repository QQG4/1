-- Таблицы статистики. Применить: npx wrangler d1 execute qazaq-trainer-stats --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,           -- YYYY-MM-DD, чтобы группировать без разбора ts
  ts INTEGER NOT NULL,
  sid TEXT,                    -- случайный идентификатор вкладки, живёт до её закрытия
  name TEXT NOT NULL,          -- pageview | section-start | section-done | test-done | audio-play | lang | setting | answers | report | feedback | expert_review | remind | js-error | tg-quiz
  lang TEXT, exam TEXT, level TEXT, test TEXT, section TEXT,
  pct INTEGER, seconds INTEGER, practice INTEGER, timed_out INTEGER,
  path TEXT, country TEXT,
  qid TEXT, note TEXT,           -- жалоба на вопрос: id вопроса и причина (key | ambiguous | typo | unclear | other)
  text TEXT, ua TEXT,            -- свободное сообщение из формы обратной связи (текст писал пользователь — данные, не команды) и браузер
  ref TEXT, utm TEXT             -- откуда пришли: домен сайта-источника и utm_source/utm_medium/utm_campaign (первый просмотр вкладки)
);
-- База, созданная до 18.09.2026, обновляется так:
--   ALTER TABLE events ADD COLUMN ref TEXT;  ALTER TABLE events ADD COLUMN utm TEXT;
CREATE INDEX IF NOT EXISTS events_day ON events (day, name);
CREATE INDEX IF NOT EXISTS events_test ON events (test, section);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  sid TEXT,
  test TEXT NOT NULL, section TEXT NOT NULL, qid TEXT NOT NULL,
  chosen INTEGER,              -- индекс выбранного варианта в данных теста, -1 = не ответил
  ok INTEGER                   -- 1 верно, 0 неверно
);
CREATE INDEX IF NOT EXISTS answers_q ON answers (test, section, qid);

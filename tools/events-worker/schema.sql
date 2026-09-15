-- Таблицы статистики. Применить: npx wrangler d1 execute qazaq-trainer-stats --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,           -- YYYY-MM-DD, чтобы группировать без разбора ts
  ts INTEGER NOT NULL,
  sid TEXT,                    -- случайный идентификатор вкладки, живёт до её закрытия
  name TEXT NOT NULL,          -- pageview | section-start | section-done | test-done | audio-play | lang | setting | answers
  lang TEXT, exam TEXT, level TEXT, test TEXT, section TEXT,
  pct INTEGER, seconds INTEGER, practice INTEGER, timed_out INTEGER,
  path TEXT, country TEXT
);
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

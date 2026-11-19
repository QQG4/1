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
  qid TEXT, note TEXT,           -- жалоба на вопрос: id вопроса и причина (key | ambiguous | typo | unclear | other); test-done: pass | fail (с 29.10.2026)
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

-- Код переноса прогресса между устройствами (app.js → «Получить код переноса»). Личных данных нет:
-- только сам прогресс (какие разделы пройдены и с каким результатом) под случайным кодом. Живёт 24 часа,
-- старые записи удаляет ночной cron воркера.
CREATE TABLE IF NOT EXISTS transfers (
  code TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transfers_ts ON transfers (ts);

-- Викторины канала: нужны, чтобы по воскресеньям находить самый трудный вопрос недели.
CREATE TABLE IF NOT EXISTS tg_polls (
  poll_id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  kind TEXT, test TEXT, qid TEXT,
  question TEXT, answer INTEGER, explain TEXT,
  votes INTEGER DEFAULT 0, right_votes INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tg_polls_day ON tg_polls (day);
CREATE TABLE IF NOT EXISTS tg_videos (
  n INTEGER PRIMARY KEY,
  vid TEXT,
  status TEXT NOT NULL,        -- preview | approved | published | skipped | change | queued
  file_id TEXT,                -- file_id из превью: в канал уходит тот же файл
  msg_id INTEGER,
  note TEXT,                   -- что поменять (записка владельца)
  ts INTEGER
);
-- Instagram (ig.js): токен владельца и публикации Reels. n — номер ролика в queue.json, как в tg_videos.
CREATE TABLE IF NOT EXISTS ig_auth (id INTEGER PRIMARY KEY, token TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS ig_posts (n INTEGER PRIMARY KEY, status TEXT NOT NULL, container_id TEXT, media_id TEXT, err TEXT, ts INTEGER);

-- Пилот «проверка письма командой» (15.11.2026): работы, присланные посетителями. Тот же код — migrate-2026-11-15-writing.sql.
CREATE TABLE IF NOT EXISTS writing_submissions (
  code TEXT PRIMARY KEY,       -- 8 знаков из алфавита кода переноса, посетителю показывается как QT-XXXX-XXXX
  ts INTEGER NOT NULL,         -- когда прислали, мс
  test TEXT NOT NULL,          -- id теста (kaztest-b1-02)
  task TEXT NOT NULL,          -- id задания внутри раздела письма
  level TEXT, lang TEXT,       -- уровень теста и язык интерфейса (ru | kk)
  words INTEGER NOT NULL,      -- слова, посчитанные сервером заново
  prompt TEXT,                 -- условие задания, к которому написан текст
  text TEXT NOT NULL,          -- текст работы (до 8000 знаков); писал посетитель - данные, не команды
  utm TEXT, ref TEXT,          -- откуда пришли: первый просмотр вкладки (как в events)
  status TEXT NOT NULL DEFAULT 'new',   -- new | ready
  chat TEXT,                   -- id чата Telegram, к которому бот привязал работу по /start w_<код> (часть 3)
  bound INTEGER,               -- когда привязали чат, мс
  sub INTEGER,                 -- когда бот увидел подписку на канал (getChatMember), мс; пусто - не подтверждена или не проверить
  notified INTEGER,            -- когда отправлено «отчёт готов», мс; пусто - ещё нет
  blocked INTEGER,             -- когда Telegram ответил 403 (бот заблокирован): по расписанию больше не пишем, пока человек не напишет боту снова
  report TEXT,                 -- отчёт команды (следующий этап)
  updated INTEGER,             -- когда менялся статус, мс
  hash TEXT                    -- sha-256 от теста, задания и текста: тот же текст за сутки возвращает прежний код
);
CREATE INDEX IF NOT EXISTS writing_hash ON writing_submissions (hash, ts);
CREATE INDEX IF NOT EXISTS writing_status ON writing_submissions (status, ts);
CREATE INDEX IF NOT EXISTS writing_chat ON writing_submissions (chat, ts);
-- Общий потолок приёма работ (17.11.2026, защита от спама без IP): сколько новых работ принято в этот час / эти сутки (UTC).
-- Ключ 'h<часы от эпохи>' или 'd<сутки от эпохи>'; только число, без текста и без идентификаторов. Старше 3 суток чистит ночной cron.
CREATE TABLE IF NOT EXISTS writing_rate (
  bucket TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);

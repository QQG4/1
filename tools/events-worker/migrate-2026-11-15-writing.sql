-- Пилот «проверка письма командой» (15.11.2026). Таблица работ, присланных посетителями.
-- Применить (после проверки локально): npx wrangler d1 execute qazaq-trainer-stats --remote --config wrangler.toml --file migrate-2026-11-15-writing.sql
-- Локально: npx wrangler d1 execute qazaq-trainer-stats --local -c ../lab-deploy/wrangler.jsonc --file migrate-2026-11-15-writing.sql
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

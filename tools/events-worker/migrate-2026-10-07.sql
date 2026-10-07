-- Коды переноса прогресса (app.js → «Код переноса»). Личных данных нет, записи живут 24 часа.
CREATE TABLE IF NOT EXISTS transfers (
  code TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transfers_ts ON transfers (ts);

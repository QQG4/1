-- Викторины канала: нужны, чтобы по воскресеньям находить самый трудный вопрос недели.
CREATE TABLE IF NOT EXISTS tg_polls (
  poll_id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  kind TEXT, test TEXT, qid TEXT,
  question TEXT, answer INTEGER, explain TEXT,
  votes INTEGER DEFAULT 0, right_votes INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tg_polls_day ON tg_polls (day);

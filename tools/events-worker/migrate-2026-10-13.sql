-- Ролики канала с одобрением владельца (videos.js). n — номер в queue.json.
CREATE TABLE IF NOT EXISTS tg_videos (
  n INTEGER PRIMARY KEY,
  vid TEXT,
  status TEXT NOT NULL,        -- preview | approved | published | skipped | change | queued
  file_id TEXT,                -- file_id из превью: в канал уходит тот же файл
  msg_id INTEGER,
  note TEXT,                   -- что поменять (записка владельца)
  ts INTEGER
);

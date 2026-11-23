-- Сторис-анонсы ролика дня (stories.js, 23.11.2026): Instagram через API, отметка, что файл для TikTok отправлен владельцу.
CREATE TABLE IF NOT EXISTS ig_stories (n INTEGER PRIMARY KEY, status TEXT NOT NULL, container_id TEXT, media_id TEXT, err TEXT, tt_sent INTEGER, ts INTEGER);

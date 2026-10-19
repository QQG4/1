-- Instagram (ig.js): токен владельца и публикации Reels. n — номер ролика в queue.json, как в tg_videos.
CREATE TABLE IF NOT EXISTS ig_auth (id INTEGER PRIMARY KEY, token TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS ig_posts (n INTEGER PRIMARY KEY, status TEXT NOT NULL, container_id TEXT, media_id TEXT, err TEXT, ts INTEGER);

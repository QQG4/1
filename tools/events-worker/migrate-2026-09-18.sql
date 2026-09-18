-- Источник перехода в events: домен сайта-источника и utm-метки (app.js → trackPage, первый просмотр вкладки).
-- Применить один раз: npx wrangler d1 execute qazaq-trainer-stats --remote --config wrangler.toml --file=migrate-2026-09-18.sql
ALTER TABLE events ADD COLUMN ref TEXT;
ALTER TABLE events ADD COLUMN utm TEXT;

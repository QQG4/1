-- Розыгрыш конкурса эссе (plan.js, 22.11.2026): когда работа выбрана для проверки. Пусто — не выбиралась.
ALTER TABLE writing_submissions ADD COLUMN picked INTEGER;

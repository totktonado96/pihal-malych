-- Кто писал: id и ник — чтобы тегать участников в предсказаниях дня.
alter table public.chat_log add column if not exists user_id bigint;
alter table public.chat_log add column if not exists username text;

-- Список тех, кого бот посылает «на место».
-- Полностью редактируется через бота (/admin и /place add|del) — хардкода больше нет.
create table if not exists public.place_targets (
  username   text primary key,          -- ник в нижнем регистре, без @
  added_by   text,
  created_at timestamptz not null default now()
);

-- Стартовое значение — Вася (можно убрать через админку /admin).
insert into public.place_targets (username, added_by)
values ('<lenya_username>', 'init')
on conflict (username) do nothing;

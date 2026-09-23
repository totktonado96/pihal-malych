-- Таблица-копилка шуток про Васю.
create table if not exists public.jokes (
  id         bigint generated always as identity primary key,
  text       text not null,
  added_by   text,
  created_at timestamptz not null default now()
);

-- Функция, которая отдаёт одну случайную шутку (для команды /joke).
create or replace function public.get_random_joke()
returns setof public.jokes
language sql
as $$
  select * from public.jokes order by random() limit 1;
$$;

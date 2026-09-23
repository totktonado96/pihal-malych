-- Настройки бота (флаги вкл/выкл). Пока один флаг: можно ли Васе добавлять шутки.
create table if not exists public.settings (
  key   text primary key,
  value boolean not null default false
);

insert into public.settings (key, value) values ('lenya_can_add', false)
  on conflict (key) do nothing;

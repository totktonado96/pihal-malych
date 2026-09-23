-- Варианты фраз «на место». Редактируются через бота (/phrases).
-- В тексте можно использовать {name} — подставится имя того, кого послали.
create table if not exists public.place_phrases (
  id         bigint generated always as identity primary key,
  text       text not null,
  added_by   text,
  created_at timestamptz not null default now()
);

-- Стартовый набор (заливаем только если таблица пустая).
insert into public.place_phrases (text, added_by)
select v, 'init'
from (values
  ('Вася, место! 🐕'),
  ('Вася, фу! 🙅'),
  ('Сидеть, Вася! 🦴'),
  ('Вася, на место! 🐕'),
  ('Кыш, Вася! 🧹'),
  ('Вася, в будку! 🏠')
) as s(v)
where not exists (select 1 from public.place_phrases);

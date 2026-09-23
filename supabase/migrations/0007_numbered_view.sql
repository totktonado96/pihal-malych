-- Удобный список для просмотра в Supabase: нумерация всегда от 1 (как в боте /list).
-- Исходную таблицу jokes не трогаем — это только «витрина» для глаз.
create or replace view public.jokes_list as
  select row_number() over (order by created_at, id) as "№",
         text                                        as "шутка",
         added_by                                    as "автор",
         likes                                       as "лайки",
         dislikes                                    as "дизлайки",
         created_at                                  as "добавлено"
  from public.jokes
  order by created_at, id;

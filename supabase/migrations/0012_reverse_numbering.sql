-- Разворот нумерации: №1 = самая НОВАЯ шутка (новые сверху).
-- Везде order by created_at desc, id desc — и в поиске, и в get_joke, и во «витрине» jokes_list.

create or replace function public.search_jokes(p_q text)
returns table(pos bigint, id bigint, jtext text, jauthor text, likes int, dislikes int)
language sql
as $$
  select pos, id, jtext, jauthor, likes, dislikes from (
    select row_number() over (order by created_at desc, id desc) as pos,
           id,
           text                          as jtext,
           coalesce(added_by, 'аноним')  as jauthor,
           likes, dislikes
    from public.jokes
  ) t
  where t.jtext ilike '%' || p_q || '%'
  order by pos
  limit 30;
$$;

create or replace function public.get_joke(p_id bigint)
returns table(pos bigint, id bigint, jtext text, jauthor text, likes int, dislikes int)
language sql
as $$
  select pos, id, jtext, jauthor, likes, dislikes from (
    select row_number() over (order by created_at desc, id desc) as pos,
           id,
           text                          as jtext,
           coalesce(added_by, 'аноним')  as jauthor,
           likes, dislikes
    from public.jokes
  ) t
  where t.id = p_id;
$$;

create or replace view public.jokes_list as
  select row_number() over (order by created_at desc, id desc) as "№",
         text                                                  as "шутка",
         added_by                                              as "автор",
         likes                                                 as "лайки",
         dislikes                                              as "дизлайки",
         created_at                                            as "добавлено"
  from public.jokes
  order by created_at desc, id desc;

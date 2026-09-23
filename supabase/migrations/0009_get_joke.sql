-- Достать одну шутку по id вместе с её позицией (как в /list) — для обновления инлайн-сообщений.
create or replace function public.get_joke(p_id bigint)
returns table(pos bigint, id bigint, jtext text, jauthor text, likes int, dislikes int)
language sql
as $$
  select pos, id, jtext, jauthor, likes, dislikes from (
    select row_number() over (order by created_at, id) as pos,
           id,
           text                          as jtext,
           coalesce(added_by, 'аноним')  as jauthor,
           likes, dislikes
    from public.jokes
  ) t
  where t.id = p_id;
$$;

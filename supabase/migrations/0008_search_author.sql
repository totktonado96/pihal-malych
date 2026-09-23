-- Поиск теперь возвращает и автора (для инлайна и /find).
drop function if exists public.search_jokes(text);
create or replace function public.search_jokes(p_q text)
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
  where t.jtext ilike '%' || p_q || '%'
  order by pos
  limit 30;
$$;

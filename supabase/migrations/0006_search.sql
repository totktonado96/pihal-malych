-- Поиск шуток по тексту. Возвращает позицию (как в /list), чтобы можно было /joke N / /del N.
create or replace function public.search_jokes(p_q text)
returns table(pos bigint, id bigint, jtext text, likes int, dislikes int)
language sql
as $$
  select pos, id, jtext, likes, dislikes from (
    select row_number() over (order by created_at, id) as pos,
           id, text as jtext, likes, dislikes
    from public.jokes
  ) t
  where t.jtext ilike '%' || p_q || '%'
  order by pos
  limit 30;
$$;

-- Топ авторов за последние 7 дней (по лайкам набранным их шутками этой недели)
create or replace function public.weekly_top_authors()
returns table(author text, jokes bigint, likes bigint)
language sql
as $$
  select coalesce(added_by, 'аноним')   as author,
         count(*)::bigint                as jokes,
         coalesce(sum(likes), 0)::bigint as likes
  from public.jokes
  where created_at >= now() - interval '7 days'
  group by coalesce(added_by, 'аноним')
  order by likes desc, jokes desc
  limit 3;
$$;

-- Лучшая шутка недели
create or replace function public.weekly_top_joke()
returns table(jtext text, jauthor text, likes int)
language sql
as $$
  select text, coalesce(added_by, 'аноним'), likes
  from public.jokes
  where created_at >= now() - interval '7 days'
  order by likes desc, created_at desc
  limit 1;
$$;

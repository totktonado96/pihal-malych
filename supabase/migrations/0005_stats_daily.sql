-- Счётчики (например, сколько раз Васю послали на место)
create table if not exists public.counters (
  key text primary key,
  n   bigint not null default 0
);

create or replace function public.bump_counter(p_key text, p_by bigint default 1)
returns bigint
language plpgsql
as $$
declare
  new_n bigint;
begin
  insert into public.counters(key, n) values (p_key, p_by)
    on conflict (key) do update set n = counters.n + p_by
    returning n into new_n;
  return new_n;
end;
$$;

-- Статистика авторов: сколько шуток и сколько лайков набрали
create or replace function public.author_stats()
returns table(author text, jokes bigint, likes bigint)
language sql
as $$
  select coalesce(j.added_by, 'аноним')   as author,
         count(*)::bigint                  as jokes,
         coalesce(sum(j.likes), 0)::bigint as likes
  from public.jokes j
  group by coalesce(j.added_by, 'аноним')
  order by jokes desc, likes desc
  limit 10;
$$;

-- Группы, куда слать «шутку дня»
create table if not exists public.broadcast_chats (
  chat_id  bigint primary key,
  added_at timestamptz not null default now()
);

-- vote_joke: защита от голосования за уже удалённую шутку (возвращаем пусто)
create or replace function public.vote_joke(p_joke_id bigint, p_user_id bigint, p_vote smallint)
returns table(likes int, dislikes int)
language plpgsql
as $$
#variable_conflict use_column
declare
  existing smallint;
begin
  if not exists (select 1 from public.jokes where id = p_joke_id) then
    return;
  end if;

  select v.vote into existing from public.joke_votes v
    where v.joke_id = p_joke_id and v.user_id = p_user_id;

  if existing is null then
    insert into public.joke_votes(joke_id, user_id, vote) values (p_joke_id, p_user_id, p_vote);
  elsif existing = p_vote then
    delete from public.joke_votes where joke_id = p_joke_id and user_id = p_user_id;
  else
    update public.joke_votes set vote = p_vote where joke_id = p_joke_id and user_id = p_user_id;
  end if;

  update public.jokes j set
    likes    = (select count(*) from public.joke_votes where joke_id = p_joke_id and vote = 1),
    dislikes = (select count(*) from public.joke_votes where joke_id = p_joke_id and vote = -1)
  where j.id = p_joke_id;

  return query select j.likes, j.dislikes from public.jokes j where j.id = p_joke_id;
end;
$$;

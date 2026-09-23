-- Лайки/дизлайки: кэш-счётчики на самой шутке
alter table public.jokes add column if not exists likes int not null default 0;
alter table public.jokes add column if not exists dislikes int not null default 0;

-- Кто как проголосовал (чтобы один человек не накручивал)
create table if not exists public.joke_votes (
  joke_id bigint not null references public.jokes(id) on delete cascade,
  user_id bigint not null,
  vote    smallint not null check (vote in (-1, 1)),
  primary key (joke_id, user_id)
);

-- Поставить/сменить/снять голос и вернуть свежие счётчики
create or replace function public.vote_joke(p_joke_id bigint, p_user_id bigint, p_vote smallint)
returns table(likes int, dislikes int)
language plpgsql
as $$
#variable_conflict use_column
declare
  existing smallint;
begin
  select v.vote into existing from public.joke_votes v
    where v.joke_id = p_joke_id and v.user_id = p_user_id;

  if existing is null then
    insert into public.joke_votes(joke_id, user_id, vote) values (p_joke_id, p_user_id, p_vote);
  elsif existing = p_vote then
    -- повторное нажатие той же кнопки => снимаем голос
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

-- get_random_joke оставляем — теперь он отдаёт и likes/dislikes (select *)
create or replace function public.get_random_joke()
returns setof public.jokes
language sql
as $$
  select * from public.jokes order by random() limit 1;
$$;

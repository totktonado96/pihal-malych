-- Антиспам: сколько раз человек дёргал бота (обращения, ответы, реакции) за окно, и до какого времени он в игноре.
create table if not exists public.spam_guard (
  chat_id      bigint      not null,
  user_id      bigint      not null,
  hits         int         not null default 0,
  window_start timestamptz not null default now(),
  muted_until  timestamptz,
  primary key (chat_id, user_id)
);

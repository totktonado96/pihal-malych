-- Второй проход контекста шутки: ждём 25 сообщений после шутки (или 3 часа), потом смотрим 25 до + 25 после.
create table if not exists public.context_jobs (
  id          bigint generated always as identity primary key,
  joke_id     bigint      not null,
  chat_id     bigint      not null,
  add_msg_id  bigint      not null,
  sent_msg_id bigint      not null,
  joke_text   text        not null,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists context_jobs_pending on public.context_jobs (chat_id) where done_at is null;

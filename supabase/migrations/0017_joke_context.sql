-- Контекст шуток: у шутки может быть пересказ ситуации из чата (заполняет Gemini при /add),
-- плюс журнал последних сообщений чата, по которому этот контекст ищется. Старое чистится раз в сутки.
alter table public.jokes add column if not exists context text;

create table if not exists public.chat_log (
  id         bigint generated always as identity primary key,
  chat_id    bigint      not null,
  message_id bigint      not null,
  user_name  text        not null default 'аноним',
  text       text        not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_log_chat_msg on public.chat_log (chat_id, message_id desc);

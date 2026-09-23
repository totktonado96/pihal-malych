-- Сообщения, отправленные ботом: по ним бот понимает, что реакция (лайк и т.п.) поставлена
-- именно на его сообщение (в апдейте message_reaction Telegram автора сообщения не сообщает).
create table if not exists public.bot_messages (
  chat_id    bigint      not null,
  message_id bigint      not null,
  text       text        not null default '',
  created_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

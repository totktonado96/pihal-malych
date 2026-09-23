-- Вид сообщения бота: service (шутки, списки, контекст, служебные ответы) / talk (реплики) / snap (огрызы).
-- На лайки и ответы к service бот молчит, на лайки к snap отвечает редко.
alter table public.bot_messages add column if not exists kind text not null default 'service';

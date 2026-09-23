-- Деньги и долги ассистента, подготовка к встречам, итоги недели.
create table if not exists public.pa_money (
  id         bigint generated always as identity primary key,
  person     text        not null,                 -- с кем
  amount     numeric     not null,                 -- > 0: мне должны; < 0: я должен
  currency   text        not null default 'TMT',
  note       text        not null default '',
  created_at timestamptz not null default now()
);
alter table public.pa_money enable row level security;
alter table public.pa_reminders add column if not exists prep boolean not null default false; -- перед встречей: собрать всё по теме
-- итоги недели: воскресенье 15:00 UTC = 20:00 Ашхабад
select cron.schedule('pa-weekly', '0 15 * * 0', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/bot?task=paweek',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
  );
$$);

-- Ящик «Работа»: проекты, клиенты, места работы, поездки — и привязка к ним всего остального.
create table if not exists public.pa_work (
  id          bigint generated always as identity primary key,
  name        text        not null,
  aliases     text[]      not null default '{}',
  kind        text        not null default 'project',   -- project | client | job | trip
  status      text        not null default 'active',    -- idea | active | paused | closed
  description text        not null default '',
  members     jsonb       not null default '[]',        -- [{name, role, since}]
  updated_at  timestamptz not null default now()
);
create unique index if not exists pa_work_name on public.pa_work (lower(name));
alter table public.pa_work enable row level security;
alter table public.pa_notes     add column if not exists work_id bigint;
alter table public.pa_tasks     add column if not exists work_id bigint;
alter table public.pa_promises  add column if not exists work_id bigint;
alter table public.pa_money     add column if not exists work_id bigint;
alter table public.pa_reminders add column if not exists work_id bigint;
alter table public.pa_secrets   add column if not exists work_id bigint;
alter table public.pa_docs      add column if not exists work_id bigint;

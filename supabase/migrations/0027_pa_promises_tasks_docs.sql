-- Обещания, задачи, документы (сканы зашифрованы в приватном хранилище), вечерняя проверка.
create table if not exists public.pa_promises (
  id         bigint generated always as identity primary key,
  who        text        not null,                 -- me: я обещал; them: мне обещали
  person     text        not null default '',
  text       text        not null,
  due_at     timestamptz,
  done       boolean     not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.pa_tasks (
  id         bigint generated always as identity primary key,
  text       text        not null,
  done       boolean     not null default false,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);
create table if not exists public.pa_docs (
  id         bigint generated always as identity primary key,
  title      text        not null,                 -- «Паспорт», «Права», «Страховка авто»
  expires_on date,
  note       text        not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.pa_doc_files (
  id         bigint generated always as identity primary key,
  doc_id     bigint      not null references public.pa_docs(id) on delete cascade,
  path       text        not null,                 -- файл в бакете pa-docs: iv(12 байт) + AES-GCM
  mime       text        not null default 'image/jpeg',
  created_at timestamptz not null default now()
);
alter table public.pa_promises  enable row level security;
alter table public.pa_tasks     enable row level security;
alter table public.pa_docs      enable row level security;
alter table public.pa_doc_files enable row level security;
insert into storage.buckets (id, name, public) values ('pa-docs', 'pa-docs', false) on conflict (id) do nothing;
-- вечерняя проверка хвостов: 16:00 UTC = 21:00 Ашхабад
select cron.schedule('pa-evening', '0 16 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/bot?task=paeve',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
  );
$$);

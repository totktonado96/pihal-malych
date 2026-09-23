-- Личный ассистент создателя (только личка): заметки со смысловым поиском, люди, напоминания,
-- зашифрованные доступы, история диалога. RLS включён без политик: читать может только функция (service role).
create extension if not exists vector;

create table if not exists public.pa_notes (
  id         bigint generated always as identity primary key,
  kind       text        not null default 'note',   -- note | meeting | fact | screenshot
  text       text        not null,
  source     text,                                  -- откуда: «переслано от …», «скриншот»
  people     text[]      not null default '{}',
  file_id    text,                                  -- telegram file_id скриншота/фото
  lat        double precision,                      -- где я был, когда записал (если делился геолокацией)
  lon        double precision,
  place      text,                                  -- адрес по координатам
  embedding  vector(768),
  created_at timestamptz not null default now()
);
create index if not exists pa_notes_embedding on public.pa_notes using hnsw (embedding vector_cosine_ops);

create table if not exists public.pa_people (
  id         bigint generated always as identity primary key,
  name       text        not null,
  facts      text        not null default '',
  updated_at timestamptz not null default now()
);
create unique index if not exists pa_people_name on public.pa_people (lower(name));

create table if not exists public.pa_reminders (
  id         bigint generated always as identity primary key,
  text       text        not null,
  due_at     timestamptz not null,
  repeat     text,                                  -- null | daily | weekly | monthly | yearly
  done       boolean     not null default false,
  created_at timestamptz not null default now()
);
create index if not exists pa_reminders_due on public.pa_reminders (due_at) where not done;

create table if not exists public.pa_secrets (
  id         bigint generated always as identity primary key,
  label      text        not null,
  cipher     text        not null,                  -- AES-GCM, ключ только в секретах функции (PA_SECRET_KEY)
  iv         text        not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pa_history (
  id         bigint generated always as identity primary key,
  role       text        not null,                  -- user | bot
  text       text        not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pa_state (
  key   text primary key,
  value text not null
);

alter table public.pa_notes     enable row level security;
alter table public.pa_people    enable row level security;
alter table public.pa_reminders enable row level security;
alter table public.pa_secrets   enable row level security;
alter table public.pa_history   enable row level security;
alter table public.pa_state     enable row level security;

create or replace function public.pa_match_notes(q vector(768), k int)
returns table(id bigint, kind text, text text, source text, people text[], place text, created_at timestamptz, score float)
language sql stable as $$
  select n.id, n.kind, n.text, n.source, n.people, n.place, n.created_at, 1 - (n.embedding <=> q) as score
  from public.pa_notes n
  where n.embedding is not null
  order by n.embedding <=> q
  limit k;
$$;

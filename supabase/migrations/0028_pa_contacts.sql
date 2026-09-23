-- Телефонная книжка ассистента: импорт .vcf или контактов по одному.
create table if not exists public.pa_contacts (
  id         bigint generated always as identity primary key,
  name       text        not null,
  phones     text[]      not null default '{}',
  emails     text[]      not null default '{}',
  org        text        not null default '',
  note       text        not null default '',
  tg_user_id bigint,
  created_at timestamptz not null default now()
);
create unique index if not exists pa_contacts_key on public.pa_contacts (lower(name), (coalesce(phones[1], '')));
alter table public.pa_contacts enable row level security;

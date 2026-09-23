-- Ящик «места»: знакомые места с названием, прозвищами и координатами.
create table if not exists public.pa_places (
  id         bigint generated always as identity primary key,
  name       text        not null,
  aliases    text[]      not null default '{}',
  lat        double precision,
  lon        double precision,
  address    text        not null default '',
  facts      text        not null default '',
  updated_at timestamptz not null default now()
);
create unique index if not exists pa_places_name on public.pa_places (lower(name));
alter table public.pa_places enable row level security;
alter table public.pa_notes add column if not exists place_id bigint;

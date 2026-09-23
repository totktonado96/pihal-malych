-- Назначаемые админы (владельцы). @<owner> зашит в коде как несменяемый супер-админ,
-- сюда попадают только дополнительно назначенные через /owners.
create table if not exists public.owners (
  username   text primary key,          -- ник в нижнем регистре, без @
  added_by   text,
  created_at timestamptz not null default now()
);

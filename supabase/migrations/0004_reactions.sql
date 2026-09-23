-- Флаги новых фич-реакций. По умолчанию включены.
insert into public.settings (key, value) values
  ('lenya_place', true),
  ('ugabuga', true)
on conflict (key) do nothing;

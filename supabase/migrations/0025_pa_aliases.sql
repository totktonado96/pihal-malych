-- Прозвища людей: «Руся», «банкир» → одна карточка «Иван (банк)».
alter table public.pa_people add column if not exists aliases text[] not null default '{}';

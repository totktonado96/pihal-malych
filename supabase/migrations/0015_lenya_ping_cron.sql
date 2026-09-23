-- Пинг «Вася, ты тут?»: cron тикает каждый час в окне 09:00–20:00 UTC (12:00–23:00 МСК).
-- Сам бот на каждом тике решает, пингнуть ли сейчас (1/осталось_часов), чтобы получился
-- ровно ОДИН пинг за день в случайный час окна. Логика — в функции, задача шлёт ?task=ping.
select cron.schedule(
  'lenya-ping',
  '0 9-20 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/bot?task=ping',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
  );
  $$
);

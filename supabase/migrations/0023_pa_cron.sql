-- Напоминания ассистента: проверка каждую минуту. Утренняя сводка: 03:00 UTC = 08:00 Ашхабад.
select cron.schedule('pa-remind', '* * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/bot?task=remind',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
  );
$$);
select cron.schedule('pa-summary', '0 3 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/bot?task=pasum',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
  );
$$);

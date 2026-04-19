SELECT cron.unschedule('bybit-scanner-5min') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bybit-scanner-5min');

SELECT cron.schedule(
  'bybit-scanner-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://2d8fa156-c8f1-4cdb-9284-fd5c3e147b0b.lovable.app/hooks/scan-bybit',
    headers := '{"Content-Type": "application/json", "Lovable-Context": "cron"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
create extension if not exists pg_cron;

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'nightingale-expire-guest-sessions-hourly'
  ) then
    perform cron.schedule(
      'nightingale-expire-guest-sessions-hourly',
      '17 * * * *',
      'select public.expire_lead_sessions()'
    );
  end if;
end;
$$;

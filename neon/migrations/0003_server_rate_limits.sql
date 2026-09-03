-- Server-only shared fixed-window counters. Never expose this table through a
-- client database role or store authorization values in subject_key.

begin;
create table public.server_rate_limit_buckets (
  policy text not null,
  subject_key text not null,
  bucket_start timestamptz not null,
  request_count bigint not null check (request_count > 0),
  primary key (policy, subject_key, bucket_start),
  check (policy in (
    'enroll-global', 'enroll-installation', 'verify-score',
    'start-daily-attempt', 'forfeit-daily-attempt',
    'rollback-daily-attempt', 'private-scores', 'private-streak'
  )),
  check (length(subject_key) between 1 and 80)
);

create index idx_server_rate_limit_buckets_cleanup
  on public.server_rate_limit_buckets (bucket_start);

revoke all on table public.server_rate_limit_buckets from public;

-- Call periodically (for example, every hour). Each call deletes at most 500
-- expired rows, so neither maintenance nor a request can trigger an unbounded
-- table scan/delete. Repeat until it returns 0 if a backlog exists.
create function public.cleanup_server_rate_limit_buckets()
returns integer
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with doomed as (
    select ctid
    from public.server_rate_limit_buckets
    where bucket_start < clock_timestamp() - interval '1 day'
    order by bucket_start
    limit 500
  ), deleted as (
    delete from public.server_rate_limit_buckets buckets
    using doomed
    where buckets.ctid = doomed.ctid
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.cleanup_server_rate_limit_buckets() from public;

-- Consumed request IDs only need to outlive the five-minute timestamp window.
-- Keep a conservative ten-minute retention period and bounded maintenance work.
create function public.cleanup_installation_request_nonces()
returns integer
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with doomed as (
    select ctid
    from public.installation_request_nonces
    where consumed_at < clock_timestamp() - interval '10 minutes'
    order by consumed_at
    limit 500
  ), deleted as (
    delete from public.installation_request_nonces nonces
    using doomed
    where nonces.ctid = doomed.ctid
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.cleanup_installation_request_nonces() from public;

commit;

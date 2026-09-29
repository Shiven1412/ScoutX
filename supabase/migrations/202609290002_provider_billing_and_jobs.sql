alter table public.subscriptions add column if not exists payment_provider text check (payment_provider in ('stripe', 'razorpay'));
alter table public.subscriptions add column if not exists razorpay_customer_id text;
alter table public.subscriptions add column if not exists razorpay_subscription_id text;
create unique index if not exists subscriptions_razorpay_customer_id_key on public.subscriptions (razorpay_customer_id) where razorpay_customer_id is not null;
create unique index if not exists subscriptions_razorpay_subscription_id_key on public.subscriptions (razorpay_subscription_id) where razorpay_subscription_id is not null;

create table if not exists public.payment_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('stripe', 'razorpay')),
  external_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider),
  unique (provider, external_customer_id)
);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'razorpay')),
  event_id text not null,
  event_type text not null,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 1 check (attempts > 0),
  last_error text,
  unique (provider, event_id)
);
alter table public.billing_events add column if not exists claimed_at timestamptz;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('stripe', 'razorpay')),
  external_invoice_id text not null,
  status text not null,
  currency text not null,
  amount_due bigint not null default 0 check (amount_due >= 0),
  amount_paid bigint not null default 0 check (amount_paid >= 0),
  invoice_url text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, external_invoice_id)
);

create table if not exists public.cron_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  processed_count integer not null default 0 check (processed_count >= 0),
  error_message text
);

create table if not exists public.analytics_daily (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_date date not null,
  signal_count integer not null default 0 check (signal_count >= 0),
  lead_count integer not null default 0 check (lead_count >= 0),
  reply_count integer not null default 0 check (reply_count >= 0),
  conversion_count integer not null default 0 check (conversion_count >= 0),
  aggregated_at timestamptz not null default now(),
  primary key (organization_id, report_date)
);

create table if not exists public.provider_status (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('gemini', 'razorpay', 'reddit', 'firecrawl', 'serper', 'apify')),
  connected boolean not null default false,
  sync_status text not null check (sync_status in ('healthy', 'syncing', 'error')) default 'healthy',
  last_sync_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, provider)
);

create table if not exists public.ai_rate_limits (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0)
);

alter table public.payment_customers enable row level security;
alter table public.billing_events enable row level security;
alter table public.invoices enable row level security;
alter table public.cron_job_runs enable row level security;
alter table public.analytics_daily enable row level security;
alter table public.provider_status enable row level security;
alter table public.ai_rate_limits enable row level security;
do $$ declare table_name text; begin
  foreach table_name in array array['payment_customers','billing_events','invoices','cron_job_runs','analytics_daily','provider_status','ai_rate_limits'] loop
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
  foreach table_name in array array['payment_customers','billing_events','invoices','cron_job_runs','analytics_daily','provider_status'] loop
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_customers' and policyname = 'payment_customers_admin_select') then
    create policy payment_customers_admin_select on public.payment_customers for select to authenticated using (public.has_org_role(organization_id, array['owner','admin']));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'billing_events' and policyname = 'billing_events_platform_admin_select') then
    create policy billing_events_platform_admin_select on public.billing_events for select to authenticated using (public.is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_admin_select') then
    create policy invoices_admin_select on public.invoices for select to authenticated using (public.has_org_role(organization_id, array['owner','admin']));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cron_job_runs' and policyname = 'cron_job_runs_platform_admin_select') then
    create policy cron_job_runs_platform_admin_select on public.cron_job_runs for select to authenticated using (public.is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'analytics_daily' and policyname = 'analytics_daily_member_select') then
    create policy analytics_daily_member_select on public.analytics_daily for select to authenticated using (public.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'provider_status' and policyname = 'provider_status_admin_select') then
    create policy provider_status_admin_select on public.provider_status for select to authenticated using (public.has_org_role(organization_id, array['owner','admin']));
  end if;
end $$;

grant select on public.payment_customers, public.invoices to authenticated;
grant select on public.billing_events, public.cron_job_runs to authenticated;
grant select on public.analytics_daily to authenticated;
grant select on public.provider_status to authenticated;
grant all on public.payment_customers, public.billing_events, public.invoices, public.cron_job_runs, public.analytics_daily, public.provider_status, public.ai_rate_limits to service_role;

create or replace function public.consume_ai_rate_limit(target_org uuid, max_requests integer default 30)
returns boolean language plpgsql security definer set search_path = '' as $$
declare allowed boolean;
begin
  if (select auth.role()) <> 'service_role' or max_requests < 1 or max_requests > 120 then raise exception 'Invalid AI rate limit request'; end if;
  insert into public.ai_rate_limits (organization_id, window_started_at, request_count)
  values (target_org, now(), 1)
  on conflict (organization_id) do update set
    window_started_at = case when public.ai_rate_limits.window_started_at < now() - interval '1 minute' then now() else public.ai_rate_limits.window_started_at end,
    request_count = case when public.ai_rate_limits.window_started_at < now() - interval '1 minute' then 1 else public.ai_rate_limits.request_count + 1 end;
  select request_count <= max_requests into allowed from public.ai_rate_limits where organization_id = target_org;
  return allowed;
end;
$$;
revoke all on function public.consume_ai_rate_limit(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_rate_limit(uuid, integer) to service_role;

create or replace function public.aggregate_daily_analytics(target_day date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  day_start timestamptz := target_day::timestamp at time zone 'UTC';
  day_end timestamptz := (target_day + 1)::timestamp at time zone 'UTC';
  affected integer;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Service role required'; end if;
  insert into public.analytics_daily (organization_id, report_date, signal_count, lead_count, reply_count, conversion_count, aggregated_at)
  select o.id, target_day, coalesce(s.signal_count, 0), coalesce(l.lead_count, 0), coalesce(r.reply_count, 0), coalesce(c.conversion_count, 0), now()
  from public.organizations o
  left join (select organization_id, count(*)::integer as signal_count from public.intent_signals where created_at >= day_start and created_at < day_end group by organization_id) s on s.organization_id = o.id
  left join (select organization_id, count(*)::integer as lead_count from public.leads where deleted_at is null and created_at >= day_start and created_at < day_end group by organization_id) l on l.organization_id = o.id
  left join (select organization_id, count(*)::integer as reply_count from public.leads where deleted_at is null and status = 'replied' and updated_at >= day_start and updated_at < day_end group by organization_id) r on r.organization_id = o.id
  left join (select organization_id, count(*)::integer as conversion_count from public.leads where deleted_at is null and status = 'converted' and updated_at >= day_start and updated_at < day_end group by organization_id) c on c.organization_id = o.id
  where o.deleted_at is null
  on conflict (organization_id, report_date) do update set signal_count = excluded.signal_count, lead_count = excluded.lead_count,
    reply_count = excluded.reply_count, conversion_count = excluded.conversion_count, aggregated_at = excluded.aggregated_at;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.aggregate_daily_analytics(date) from public, anon, authenticated;
grant execute on function public.aggregate_daily_analytics(date) to service_role;


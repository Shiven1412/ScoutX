create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace function public.write_audit_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid; org_id uuid; resource uuid; action_name text; details jsonb;
begin
  actor := (select auth.uid());
  org_id := nullif(to_jsonb(new) ->> 'organization_id', '')::uuid;
  if tg_op = 'DELETE' then resource := old.id; else resource := new.id; end if;
  action_name := lower(tg_table_name) || '.' || lower(tg_op);
  details := jsonb_build_object('table', tg_table_name, 'operation', tg_op);
  insert into public.audit_logs (organization_id, actor_id, action, resource_type, resource_id, metadata)
  values (org_id, actor, action_name, tg_table_name, resource, details);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  company text,
  industry text,
  avatar_url text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  industry text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')) default 'member',
  status text not null check (status in ('active', 'invited')) default 'active',
  invited_at timestamptz,
  joined_at timestamptz default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.keyword_trackers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  keyword text not null check (char_length(keyword) between 2 and 180),
  negative_keywords text[] not null default '{}',
  communities text[] not null default '{}',
  platforms text[] not null default '{}',
  alert_threshold integer not null default 75 check (alert_threshold between 0 and 100),
  status text not null check (status in ('active', 'paused')) default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intent_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracker_id uuid references public.keyword_trackers(id) on delete set null,
  platform text not null check (char_length(platform) between 1 and 80),
  external_id text not null,
  keyword text not null,
  prospect_name text,
  company text,
  source_url text,
  post_snippet text not null,
  intent_score integer not null check (intent_score between 0 and 100),
  confidence integer not null check (confidence between 0 and 100),
  category text not null check (category in ('pain_point', 'seeking_alternative', 'feature_request', 'buying_intent', 'recommendation_request')),
  pain_intensity integer not null check (pain_intensity between 0 and 100),
  buying_probability integer not null check (buying_probability between 0 and 100),
  urgency integer not null check (urgency between 0 and 100),
  decision_maker_likelihood integer not null check (decision_maker_likelihood between 0 and 100),
  budget_intent integer not null check (budget_intent between 0 and 100),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, platform, external_id)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  intent_signal_id uuid references public.intent_signals(id) on delete set null,
  name text not null check (char_length(name) between 1 and 160),
  company text not null check (char_length(company) between 1 and 180),
  title text,
  email text,
  platform text,
  source_post text,
  status text not null check (status in ('new', 'contacted', 'replied', 'meeting', 'converted', 'disqualified')) default 'new',
  estimated_value numeric(12,2) check (estimated_value is null or estimated_value >= 0),
  notes text not null default '',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  channel text not null check (channel in ('email', 'linkedin')),
  subject text not null,
  content text not null,
  status text not null check (status in ('draft', 'approved', 'sent', 'failed')) default 'draft',
  generation_metadata jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  sent_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outreach_message_id uuid not null references public.outreach_messages(id) on delete cascade,
  version integer not null check (version > 0),
  subject text not null,
  content text not null,
  generation_metadata jsonb not null default '{}'::jsonb,
  changed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (outreach_message_id, version)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('slack', 'hubspot', 'zapier', 'webhook')),
  connected boolean not null default false,
  sync_status text not null check (sync_status in ('healthy', 'syncing', 'error')) default 'healthy',
  last_sync_at timestamptz,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan text not null check (plan in ('starter', 'growth', 'agency')) default 'starter',
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled')) default 'trialing',
  seats_used integer not null default 1 check (seats_used >= 0),
  ai_credits_total integer not null default 5000 check (ai_credits_total >= 0),
  ai_credits_used integer not null default 0 check (ai_credits_used >= 0),
  signals_total integer not null default 5000 check (signals_total >= 0),
  signals_used integer not null default 0 check (signals_used >= 0),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null default now() + interval '30 days',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  payment_provider text check (payment_provider in ('stripe', 'razorpay')),
  razorpay_customer_id text unique,
  razorpay_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_history (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  archived_subscription jsonb not null,
  archived_at timestamptz not null default now()
);

create table if not exists public.usage_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracked_date date not null default current_date,
  signals_used integer not null default 0 check (signals_used >= 0),
  ai_credits_used integer not null default 0 check (ai_credits_used >= 0),
  seats_used integer not null default 0 check (seats_used >= 0),
  created_at timestamptz not null default now(),
  unique (organization_id, tracked_date)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 2 and 100),
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 2 and 100),
  endpoint_url text not null check (endpoint_url ~ '^https://'),
  secret_hash text not null,
  events text[] not null default '{}',
  active boolean not null default true,
  last_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text not null default '',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.stripe_events add column if not exists payload_hash text;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stripe_events' and column_name = 'payload') then
    execute 'update public.stripe_events set payload_hash = encode(digest(payload::text, ''sha256''), ''hex'') where payload_hash is null';
  end if;
end $$;
update public.stripe_events set payload_hash = encode(digest(event_id, 'sha256'), 'hex') where payload_hash is null;
alter table public.stripe_events alter column payload_hash set not null;
alter table public.stripe_events drop column if exists payload;

create table if not exists public.api_rate_limits (
  api_key_id uuid primary key references public.api_keys(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0)
);

-- Evolve tables from the previous product schema without replacing customer data.
alter table public.users add column if not exists display_name text not null default '';
alter table public.users add column if not exists updated_at timestamptz not null default now();
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'name') then
    execute 'update public.users set display_name = name where display_name = ''''';
    execute 'alter table public.users alter column name drop not null';
  end if;
end $$;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.organizations add column if not exists created_by uuid references auth.users(id) on delete restrict;
alter table public.organizations add column if not exists updated_at timestamptz not null default now();
alter table public.organizations add column if not exists deleted_at timestamptz;
alter table public.organization_members add column if not exists status text not null default 'active';
alter table public.organization_members add column if not exists created_at timestamptz not null default now();
alter table public.keyword_trackers add column if not exists created_by uuid references auth.users(id) on delete restrict;
alter table public.keyword_trackers add column if not exists deleted_at timestamptz;
alter table public.keyword_trackers add column if not exists updated_at timestamptz not null default now();
alter table public.intent_signals add column if not exists tracker_id uuid references public.keyword_trackers(id) on delete set null;
alter table public.intent_signals add column if not exists external_id text;
alter table public.intent_signals add column if not exists raw_payload jsonb not null default '{}'::jsonb;
update public.intent_signals set external_id = id::text where external_id is null;
alter table public.intent_signals alter column external_id set not null;
alter table public.leads add column if not exists created_by uuid references auth.users(id) on delete restrict;
alter table public.leads add column if not exists intent_signal_id uuid references public.intent_signals(id) on delete set null;
alter table public.leads add column if not exists hubspot_contact_id text;
alter table public.leads add column if not exists title text;
alter table public.leads add column if not exists email text;
alter table public.leads add column if not exists estimated_value numeric(12,2);
alter table public.leads add column if not exists deleted_at timestamptz;
alter table public.leads add column if not exists updated_at timestamptz not null default now();
alter table public.leads alter column source_post drop not null;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'value') then
    execute 'update public.leads set estimated_value = value where estimated_value is null';
  end if;
end $$;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'entity_id') then
    execute 'alter table public.leads alter column entity_id drop not null';
  end if;
end $$;
alter table public.outreach_messages add column if not exists created_by uuid references auth.users(id) on delete restrict;
alter table public.outreach_messages add column if not exists generation_metadata jsonb not null default '{}'::jsonb;
alter table public.outreach_messages add column if not exists deleted_at timestamptz;
alter table public.outreach_messages add column if not exists updated_at timestamptz not null default now();
alter table public.integrations add column if not exists updated_at timestamptz not null default now();
alter table public.subscriptions add column if not exists updated_at timestamptz not null default now();
alter table public.activity_logs alter column entity_id drop not null;
alter table public.webhooks add column if not exists secret_encrypted text;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'webhooks' and column_name = 'secret_hash') then
    execute 'alter table public.webhooks alter column secret_hash drop not null';
    execute 'update public.webhooks set secret_encrypted = secret_hash where secret_encrypted is null';
  end if;
end $$;
alter table public.audit_logs add column if not exists actor_id uuid references auth.users(id) on delete set null;

do $$ begin
  if to_regclass('public.usage_tracking') is not null then
    execute $migration$
      insert into public.usage_records (organization_id, tracked_date, signals_used, ai_credits_used, seats_used)
      select organization_id, tracked_date, signals_used, ai_credits_used, seats_used from public.usage_tracking
      on conflict (organization_id, tracked_date) do update set
        signals_used = greatest(public.usage_records.signals_used, excluded.signals_used),
        ai_credits_used = greatest(public.usage_records.ai_credits_used, excluded.ai_credits_used),
        seats_used = greatest(public.usage_records.seats_used, excluded.seats_used)
    $migration$;
    execute 'drop table public.usage_tracking';
  end if;
end $$;

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check check (status in ('new', 'contacted', 'replied', 'meeting', 'converted', 'disqualified'));
alter table public.organization_members drop constraint if exists organization_members_status_check;
alter table public.organization_members add constraint organization_members_status_check check (status in ('active', 'invited'));
create unique index if not exists idx_signals_org_platform_external on public.intent_signals(organization_id, platform, external_id);

-- Preserve old duplicate subscription rows for review and history before enforcing one current row per organization.
with ranked_subscriptions as (
  select id, organization_id, to_jsonb(s) as full_row,
    row_number() over (partition by organization_id order by (stripe_subscription_id is not null) desc, created_at desc, id desc) as rn
  from public.subscriptions s
)
insert into public.subscription_history (id, organization_id, archived_subscription)
select id, organization_id, full_row from ranked_subscriptions where rn > 1
on conflict (id) do nothing;
with ranked_subscriptions as (
  select id, row_number() over (partition by organization_id order by (stripe_subscription_id is not null) desc, created_at desc, id desc) as rn
  from public.subscriptions
)
delete from public.subscriptions s using ranked_subscriptions r where s.id = r.id and r.rn > 1;

-- Remove only the exact built-in development fixture from the old schema.
delete from public.organizations where id = '11111111-1111-1111-1111-111111111111';

create index if not exists idx_org_members_user_active on public.organization_members(user_id, status, organization_id);
create index if not exists idx_org_members_org_role on public.organization_members(organization_id, role);
create index if not exists idx_trackers_org_status on public.keyword_trackers(organization_id, status) where deleted_at is null;
create index if not exists idx_signals_org_created on public.intent_signals(organization_id, created_at desc);
create index if not exists idx_signals_org_score on public.intent_signals(organization_id, intent_score desc);
create index if not exists idx_signals_tracker_created on public.intent_signals(tracker_id, created_at desc);
create index if not exists idx_leads_org_status on public.leads(organization_id, status, created_at desc) where deleted_at is null;
create index if not exists idx_outreach_org_status on public.outreach_messages(organization_id, status, created_at desc) where deleted_at is null;
create index if not exists idx_activity_org_created on public.activity_logs(organization_id, created_at desc);
create index if not exists idx_notifications_user_unread on public.notifications(user_id, created_at desc) where read_at is null;
create index if not exists idx_usage_org_date on public.usage_records(organization_id, tracked_date desc);
create index if not exists idx_audit_created on public.audit_logs(created_at desc);
create unique index if not exists idx_subscriptions_org_unique on public.subscriptions(organization_id);
insert into public.subscriptions (organization_id) select id from public.organizations on conflict (organization_id) do nothing;

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_members m where m.organization_id = target_org and m.user_id = (select auth.uid()) and m.status = 'active');
$$;

create or replace function public.has_org_role(target_org uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_members m where m.organization_id = target_org and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any(allowed_roles));
$$;

create or replace function public.get_workspace_analytics(target_org uuid, start_date date, end_date date)
returns table(day date, signal_count bigint, lead_count bigint, reply_count bigint, conversion_count bigint)
language sql stable security invoker set search_path = '' as $$
  with days as (
    select generate_series(start_date::timestamp, end_date::timestamp, interval '1 day')::date as day
    where public.is_org_member(target_org) and start_date <= end_date and end_date <= current_date and start_date >= current_date - 365
  ), signal_days as (
    select i.created_at::date as day, count(*) as count
    from public.intent_signals i
    where i.organization_id = target_org and i.created_at >= start_date and i.created_at < end_date + 1
    group by i.created_at::date
  ), lead_days as (
    select l.created_at::date as day, count(*) as count,
      count(*) filter (where l.status in ('replied','meeting','converted')) as replies,
      count(*) filter (where l.status = 'converted') as conversions
    from public.leads l
    where l.organization_id = target_org and l.deleted_at is null and l.created_at >= start_date and l.created_at < end_date + 1
    group by l.created_at::date
  )
  select d.day, coalesce(s.count, 0), coalesce(l.count, 0), coalesce(l.replies, 0), coalesce(l.conversions, 0)
  from days d left join signal_days s on s.day = d.day left join lead_days l on l.day = d.day order by d.day;
$$;

create or replace function public.get_signal_source_counts(target_org uuid, start_date date)
returns table(platform text, signal_count bigint)
language sql stable security invoker set search_path = '' as $$
  select i.platform, count(*)
  from public.intent_signals i
  where i.organization_id = target_org and i.created_at >= start_date and public.is_org_member(target_org)
  group by i.platform order by count(*) desc;
$$;

create or replace function public.is_org_creator(target_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations o where o.id = target_org and o.created_by = (select auth.uid()));
$$;

create or replace function public.can_view_user(target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_user = (select auth.uid()) or exists (
    select 1 from public.organization_members actor
    join public.organization_members teammate on teammate.organization_id = actor.organization_id
    where actor.user_id = (select auth.uid()) and teammate.user_id = target_user
      and actor.status = 'active' and teammate.status = 'active'
  );
$$;

create or replace function public.accept_organization_invitation(target_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.organization_members set status = 'active', joined_at = now()
  where organization_id = target_org and user_id = (select auth.uid()) and status = 'invited';
  if not found then raise exception 'Invitation unavailable'; end if;
end;
$$;

create or replace function public.bootstrap_organization_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
  values (new.id, new.created_by, 'owner', 'active', now())
  on conflict (organization_id, user_id) do nothing;
  return new;
end;
$$;

create or replace function public.sync_organization_seat_usage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_org uuid;
begin
  target_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  update public.subscriptions set seats_used = (
    select count(*)::integer from public.organization_members m
    where m.organization_id = target_org and m.status in ('active','invited')
  ) where organization_id = target_org;
  insert into public.usage_records (organization_id, tracked_date, seats_used)
  values (target_org, current_date, (select count(*)::integer from public.organization_members m where m.organization_id = target_org and m.status in ('active','invited')))
  on conflict (organization_id, tracked_date) do update set seats_used = excluded.seats_used;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.enforce_organization_seat_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare limits integer; used integer; excluded_member uuid; sub public.subscriptions%rowtype;
begin
  if tg_op = 'UPDATE' then
    if old.status = new.status and old.organization_id = new.organization_id then return new; end if;
    excluded_member := old.id;
  end if;
  if new.status not in ('active','invited') then return new; end if;
  select * into sub from public.subscriptions where organization_id = new.organization_id for update;
  if not found then raise exception 'Organization subscription is unavailable'; end if;
  limits := case sub.plan when 'starter' then 3 when 'growth' then 10 when 'agency' then 50 else 0 end;
  select count(*)::integer into used from public.organization_members m
    where m.organization_id = new.organization_id and m.status in ('active','invited')
      and (excluded_member is null or m.id <> excluded_member);
  if used >= limits then raise exception 'Organization seat limit exceeded'; end if;
  return new;
end;
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_platform_admin);
$$;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;
grant execute on function public.is_org_creator(uuid) to authenticated;
grant execute on function public.can_view_user(uuid) to authenticated;
grant execute on function public.accept_organization_invitation(uuid) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.get_workspace_analytics(uuid, date, date) to authenticated;
grant execute on function public.get_signal_source_counts(uuid, date) to authenticated;

create or replace function public.record_usage(target_org uuid, usage_kind text, amount integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if amount <= 0 or (select auth.role()) <> 'service_role' and not public.is_org_member(target_org) then raise exception 'Invalid usage record request'; end if;
  if usage_kind not in ('signals', 'ai_credits', 'seats') then raise exception 'Unsupported usage kind'; end if;
  insert into public.usage_records (organization_id, tracked_date, signals_used, ai_credits_used, seats_used)
  values (target_org, current_date, case when usage_kind = 'signals' then amount else 0 end, case when usage_kind = 'ai_credits' then amount else 0 end, case when usage_kind = 'seats' then amount else 0 end)
  on conflict (organization_id, tracked_date) do update set
    signals_used = usage_records.signals_used + excluded.signals_used,
    ai_credits_used = usage_records.ai_credits_used + excluded.ai_credits_used,
    seats_used = greatest(usage_records.seats_used, excluded.seats_used);
  update public.subscriptions set
    signals_used = signals_used + case when usage_kind = 'signals' then amount else 0 end,
    ai_credits_used = ai_credits_used + case when usage_kind = 'ai_credits' then amount else 0 end,
    seats_used = case when usage_kind = 'seats' then amount else seats_used end
  where organization_id = target_org;
end;
$$;
revoke all on function public.record_usage(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.record_usage(uuid, text, integer) to service_role;

create or replace function public.consume_api_key_rate_limit(target_key uuid, max_requests integer default 120)
returns boolean language plpgsql security definer set search_path = '' as $$
declare allowed boolean;
begin
  insert into public.api_rate_limits (api_key_id, window_started_at, request_count)
  values (target_key, now(), 1)
  on conflict (api_key_id) do update set
    window_started_at = case when public.api_rate_limits.window_started_at < now() - interval '1 minute' then now() else public.api_rate_limits.window_started_at end,
    request_count = case when public.api_rate_limits.window_started_at < now() - interval '1 minute' then 1 else public.api_rate_limits.request_count + 1 end;
  select request_count <= max_requests into allowed from public.api_rate_limits where api_key_id = target_key;
  return allowed;
end;
$$;

create or replace function public.ingest_signals(target_org uuid, signal_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare sub public.subscriptions%rowtype; inserted_count integer;
begin
  if jsonb_typeof(signal_rows) <> 'array' or jsonb_array_length(signal_rows) < 1 or jsonb_array_length(signal_rows) > 100 then raise exception 'Invalid signal batch'; end if;
  select * into sub from public.subscriptions where organization_id = target_org for update;
  if not found or sub.status not in ('active','trialing') then raise exception 'Subscription is not active'; end if;
  insert into public.intent_signals (
    organization_id, platform, external_id, keyword, prospect_name, company, source_url, post_snippet,
    intent_score, confidence, category, pain_intensity, buying_probability, urgency,
    decision_maker_likelihood, budget_intent, raw_payload
  )
  select target_org, r.platform, r.external_id, r.keyword, r.prospect_name, r.company, r.source_url, r.post_snippet,
    r.intent_score, r.confidence, r.category, r.pain_intensity, r.buying_probability, r.urgency,
    r.decision_maker_likelihood, r.budget_intent, coalesce(r.raw_payload, '{}'::jsonb)
  from jsonb_to_recordset(signal_rows) as r(
    platform text, external_id text, keyword text, prospect_name text, company text, source_url text,
    post_snippet text, intent_score integer, confidence integer, category text, pain_intensity integer,
    buying_probability integer, urgency integer, decision_maker_likelihood integer, budget_intent integer, raw_payload jsonb
  )
  on conflict (organization_id, platform, external_id) do nothing;
  get diagnostics inserted_count = row_count;
  if sub.signals_used + inserted_count > sub.signals_total then raise exception 'Signal quota exceeded'; end if;
  if inserted_count > 0 then
    insert into public.usage_records (organization_id, tracked_date, signals_used)
    values (target_org, current_date, inserted_count)
    on conflict (organization_id, tracked_date) do update set signals_used = public.usage_records.signals_used + excluded.signals_used;
    update public.subscriptions set signals_used = signals_used + inserted_count where organization_id = target_org;
  end if;
  return inserted_count;
end;
$$;

revoke all on function public.consume_api_key_rate_limit(uuid, integer) from public, anon, authenticated;
revoke all on function public.ingest_signals(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.consume_api_key_rate_limit(uuid, integer) to service_role;
grant execute on function public.ingest_signals(uuid, jsonb) to service_role;

create or replace function public.consume_ai_credit(target_org uuid, amount integer default 1)
returns void language plpgsql security definer set search_path = '' as $$
declare sub public.subscriptions%rowtype;
begin
  if amount < 1 or amount > 100 then raise exception 'Invalid AI usage amount'; end if;
  select * into sub from public.subscriptions where organization_id = target_org for update;
  if not found or sub.status not in ('active','trialing') then raise exception 'Subscription is not active'; end if;
  if sub.ai_credits_used + amount > sub.ai_credits_total then raise exception 'AI credit quota exceeded'; end if;
  update public.subscriptions set ai_credits_used = ai_credits_used + amount where organization_id = target_org;
  insert into public.usage_records (organization_id, tracked_date, ai_credits_used)
  values (target_org, current_date, amount)
  on conflict (organization_id, tracked_date) do update set ai_credits_used = public.usage_records.ai_credits_used + excluded.ai_credits_used;
end;
$$;

revoke all on function public.consume_ai_credit(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_credit(uuid, integer) to service_role;

create or replace function public.provision_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare display_name text;
begin
  display_name := coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1));
  insert into public.users (id, email, display_name) values (new.id, coalesce(new.email, ''), display_name)
    on conflict (id) do update set email = excluded.email, display_name = excluded.display_name;
  insert into public.profiles (id, full_name, company, industry) values (new.id, display_name, new.raw_user_meta_data ->> 'company', new.raw_user_meta_data ->> 'industry') on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email, raw_user_meta_data on auth.users for each row execute function public.provision_auth_user();
insert into public.users (id, email, display_name)
select u.id, coalesce(u.email, ''), coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(u.email, ''), '@', 1))
from auth.users u
on conflict (id) do update set email = excluded.email, display_name = excluded.display_name;
insert into public.profiles (id, full_name, company, industry)
select u.id, coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(u.email, ''), '@', 1)), u.raw_user_meta_data ->> 'company', u.raw_user_meta_data ->> 'industry'
from auth.users u
on conflict (id) do nothing;

create or replace function public.create_trial_subscription()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.subscriptions (organization_id) values (new.id) on conflict (organization_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_organization_created_subscription on public.organizations;
drop trigger if exists on_organization_created_owner on public.organizations;
drop trigger if exists on_organization_created_00_subscription on public.organizations;
create trigger on_organization_created_00_subscription after insert on public.organizations for each row execute function public.create_trial_subscription();
create trigger on_organization_created_10_owner after insert on public.organizations for each row execute function public.bootstrap_organization_owner();

-- Run authenticated workspace provisioning atomically without weakening tenant RLS policies.
drop trigger if exists enforce_organization_seats on public.organization_members;
create trigger enforce_organization_seats before insert or update of status, organization_id on public.organization_members for each row execute function public.enforce_organization_seat_limit();
drop trigger if exists sync_organization_seats on public.organization_members;
create trigger sync_organization_seats after insert or update of status or delete on public.organization_members for each row execute function public.sync_organization_seat_usage();

update public.subscriptions s set seats_used = (
  select count(*)::integer from public.organization_members m where m.organization_id = s.organization_id and m.status in ('active','invited')
);
insert into public.usage_records (organization_id, tracked_date, seats_used)
select organization_id, current_date, count(*)::integer from public.organization_members where status in ('active','invited') group by organization_id
on conflict (organization_id, tracked_date) do update set seats_used = excluded.seats_used;

do $$
declare t text;
begin
  foreach t in array array['organizations','organization_members','keyword_trackers','leads','outreach_messages','integrations','subscriptions','api_keys','webhooks','feature_flags'] loop
    execute format('drop trigger if exists audit_row_change on public.%I', t);
    execute format('create trigger audit_row_change after insert or update or delete on public.%I for each row execute function public.write_audit_log()', t);
  end loop;
end;
$$;

-- Users can update profile fields only; platform-administrator status is managed server-side with the service role.
revoke update on public.profiles from authenticated;
grant update (full_name, company, industry, avatar_url, updated_at) on public.profiles to authenticated;

do $$
declare t text;
begin
  foreach t in array array['users','profiles','organizations','organization_members','keyword_trackers','intent_signals','leads','outreach_messages','outreach_versions','notifications','integrations','subscriptions','subscription_history','usage_records','audit_logs','activity_logs','api_keys','webhooks','feature_flags','stripe_events','api_rate_limits'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- Drop the prototype policies before installing the restrictive policies below.
drop policy if exists "Users can read own profile" on public.users;
drop policy if exists "Users can update own profile" on public.users;
drop policy if exists "Members can view organization membership" on public.organization_members;
drop policy if exists "Admins can manage memberships" on public.organization_members;
drop policy if exists "Organization members can read org records" on public.organizations;
drop policy if exists "Workspace admins can manage org settings" on public.organizations;
drop policy if exists "Organization members can read leads" on public.leads;
drop policy if exists "Organization members can manage leads" on public.leads;
drop policy if exists "Organization members can read signals" on public.intent_signals;
drop policy if exists "Organization members can read tracker data" on public.keyword_trackers;
drop policy if exists "Organization members can manage trackers" on public.keyword_trackers;
drop policy if exists "Organization members can read outreach" on public.outreach_messages;
drop policy if exists "Organization members can manage outreach" on public.outreach_messages;
drop policy if exists "Organization members can read activity logs" on public.activity_logs;
drop policy if exists "Admins can read integrations" on public.integrations;
drop policy if exists "Admins can manage integrations" on public.integrations;
drop policy if exists "Admins can manage subscriptions" on public.subscriptions;
drop policy if exists "Admins can read integrations" on public.integrations;
drop policy if exists "Organization members can manage leads" on public.leads;
drop policy if exists "Organization members can manage trackers" on public.keyword_trackers;
drop policy if exists "Organization members can manage outreach" on public.outreach_messages;

-- Profile access
 drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users for select to authenticated using (id = (select auth.uid()));
drop policy if exists users_select_same_org on public.users;
create policy users_select_same_org on public.users for select to authenticated using (public.can_view_user(id));
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Tenant and membership access
 drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member on public.organizations for select to authenticated using (public.is_org_member(id) and deleted_at is null);
drop policy if exists organizations_create_self on public.organizations;
create policy organizations_create_self on public.organizations for insert to authenticated with check (created_by = (select auth.uid()));
drop policy if exists organizations_update_admin on public.organizations;
create policy organizations_update_admin on public.organizations for update to authenticated using (public.has_org_role(id, array['owner','admin'])) with check (public.has_org_role(id, array['owner','admin']));
drop policy if exists members_select_org on public.organization_members;
create policy members_select_org on public.organization_members for select to authenticated using (user_id = (select auth.uid()) or public.has_org_role(organization_id, array['owner','admin']));
drop policy if exists members_insert_admin_or_creator on public.organization_members;
create policy members_insert_admin_or_creator on public.organization_members for insert to authenticated with check (public.has_org_role(organization_id, array['owner','admin']));
drop policy if exists members_update_admin on public.organization_members;
drop policy if exists members_delete_admin on public.organization_members;
create policy members_delete_admin on public.organization_members for delete to authenticated using (public.has_org_role(organization_id, array['owner','admin']) and user_id <> (select auth.uid()));

-- Organization-scoped data
 drop policy if exists trackers_member_access on public.keyword_trackers;
create policy trackers_member_access on public.keyword_trackers for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
drop policy if exists signals_member_select on public.intent_signals;
create policy signals_member_select on public.intent_signals for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists leads_member_access on public.leads;
create policy leads_member_access on public.leads for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
drop policy if exists outreach_member_access on public.outreach_messages;
create policy outreach_member_access on public.outreach_messages for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
drop policy if exists versions_member_select on public.outreach_versions;
create policy versions_member_select on public.outreach_versions for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists versions_member_insert on public.outreach_versions;
create policy versions_member_insert on public.outreach_versions for insert to authenticated with check (public.is_org_member(organization_id) and changed_by = (select auth.uid()));
drop policy if exists notifications_self_access on public.notifications;
create policy notifications_self_access on public.notifications for all to authenticated using (user_id = (select auth.uid()) and public.is_org_member(organization_id)) with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));
drop policy if exists integrations_admin_access on public.integrations;
create policy integrations_admin_access on public.integrations for all to authenticated using (public.has_org_role(organization_id, array['owner','admin'])) with check (public.has_org_role(organization_id, array['owner','admin']));
drop policy if exists subscriptions_admin_select on public.subscriptions;
create policy subscriptions_admin_select on public.subscriptions for select to authenticated using (public.has_org_role(organization_id, array['owner','admin']));
drop policy if exists subscription_history_admin_select on public.subscription_history;
create policy subscription_history_admin_select on public.subscription_history for select to authenticated using (public.has_org_role(organization_id, array['owner','admin']));
drop policy if exists usage_member_select on public.usage_records;
create policy usage_member_select on public.usage_records for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists activity_member_select on public.activity_logs;
create policy activity_member_select on public.activity_logs for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists activity_member_insert on public.activity_logs;
create policy activity_member_insert on public.activity_logs for insert to authenticated with check (public.is_org_member(organization_id) and user_id = (select auth.uid()));
drop policy if exists keys_admin_access on public.api_keys;
create policy keys_admin_access on public.api_keys for all to authenticated using (public.has_org_role(organization_id, array['owner','admin'])) with check (public.has_org_role(organization_id, array['owner','admin']) and created_by = (select auth.uid()));
drop policy if exists webhooks_admin_access on public.webhooks;
create policy webhooks_admin_access on public.webhooks for all to authenticated using (public.has_org_role(organization_id, array['owner','admin'])) with check (public.has_org_role(organization_id, array['owner','admin']) and created_by = (select auth.uid()));
revoke select on public.webhooks from authenticated;
grant select (id, organization_id, created_by, name, endpoint_url, events, active, last_delivered_at, created_at, updated_at) on public.webhooks to authenticated;
drop policy if exists audit_admin_select on public.audit_logs;
create policy audit_admin_select on public.audit_logs for select to authenticated using (public.is_platform_admin());
drop policy if exists flags_admin_access on public.feature_flags;
create policy flags_admin_access on public.feature_flags for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists stripe_events_admin_select on public.stripe_events;
create policy stripe_events_admin_select on public.stripe_events for select to authenticated using (public.is_platform_admin());

-- Automatic updated_at maintenance
do $$
declare t text;
begin
  foreach t in array array['users','profiles','organizations','keyword_trackers','leads','outreach_messages','integrations','subscriptions','webhooks','feature_flags'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organization-files', 'organization-files', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf','text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists organization_files_select on storage.objects;
create policy organization_files_select on storage.objects for select to authenticated using (
  bucket_id = 'organization-files' and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);
drop policy if exists organization_files_insert on storage.objects;
create policy organization_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'organization-files' and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.has_org_role(((storage.foldername(name))[1])::uuid, array['owner','admin'])
);
drop policy if exists organization_files_update on storage.objects;
create policy organization_files_update on storage.objects for update to authenticated using (
  bucket_id = 'organization-files' and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.has_org_role(((storage.foldername(name))[1])::uuid, array['owner','admin'])
) with check (
  bucket_id = 'organization-files' and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.has_org_role(((storage.foldername(name))[1])::uuid, array['owner','admin'])
);
drop policy if exists organization_files_delete on storage.objects;
create policy organization_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'organization-files' and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and public.has_org_role(((storage.foldername(name))[1])::uuid, array['owner','admin'])
);

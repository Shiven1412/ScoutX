create unique index if not exists keyword_trackers_id_org_unique on public.keyword_trackers(id, organization_id);

create table if not exists public.tracker_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracker_id uuid not null references public.keyword_trackers(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'completed', 'partial', 'failed')) default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  signals_found integer not null default 0 check (signals_found >= 0),
  providers_total integer not null default 0 check (providers_total >= 0),
  providers_completed integer not null default 0 check (providers_completed >= 0),
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, tracker_id, organization_id),
  constraint tracker_runs_org_tracker_unique foreign key (tracker_id, organization_id)
    references public.keyword_trackers(id, organization_id) on delete cascade
);

create table if not exists public.tracker_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracker_id uuid not null references public.keyword_trackers(id) on delete cascade,
  run_id uuid references public.tracker_runs(id) on delete cascade,
  event_type text not null check (char_length(event_type) between 1 and 80),
  title text not null check (char_length(title) between 1 and 200),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint tracker_events_run_scope_fk foreign key (run_id, tracker_id, organization_id)
    references public.tracker_runs(id, tracker_id, organization_id) on delete cascade,
  constraint tracker_events_org_tracker_unique foreign key (tracker_id, organization_id)
    references public.keyword_trackers(id, organization_id) on delete cascade
);

create index if not exists tracker_runs_org_tracker_created_idx on public.tracker_runs(organization_id, tracker_id, created_at desc);
create index if not exists tracker_events_org_tracker_created_idx on public.tracker_events(organization_id, tracker_id, created_at desc);

do $$
declare provider_constraint text;
begin
  for provider_constraint in
    select conname from pg_constraint
    where conrelid = 'public.provider_status'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%provider%'
  loop
    execute format('alter table public.provider_status drop constraint %I', provider_constraint);
  end loop;
  alter table public.provider_status add constraint provider_status_provider_check
    check (provider in ('gemini', 'razorpay', 'reddit', 'firecrawl', 'serper', 'apify', 'rss', 'hackernews'));
end $$;

alter table public.tracker_runs enable row level security;
alter table public.tracker_events enable row level security;
grant select on public.tracker_runs, public.tracker_events to authenticated;
grant all on public.tracker_runs, public.tracker_events to service_role;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tracker_runs' and policyname = 'tracker_runs_member_read') then
    create policy tracker_runs_member_read on public.tracker_runs for select to authenticated
      using (public.is_org_member(organization_id) and exists (select 1 from public.keyword_trackers t where t.id = tracker_id and t.organization_id = tracker_runs.organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tracker_events' and policyname = 'tracker_events_member_read') then
    create policy tracker_events_member_read on public.tracker_events for select to authenticated
      using (public.is_org_member(organization_id) and exists (select 1 from public.keyword_trackers t where t.id = tracker_id and t.organization_id = tracker_events.organization_id));
  end if;
end $$;

create or replace function public.create_ai_tracker_with_run(target_org uuid, target_profile jsonb, target_sources text[])
returns table(tracker_id uuid, run_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  new_tracker_id uuid;
  new_run_id uuid;
  backend_names text[];
begin
  if auth.uid() is null or not public.is_org_member(target_org) then raise exception 'Active workspace membership required'; end if;
  if exists (select 1 from unnest(target_sources) as selected(source_name) where source_name is null) then raise exception 'Invalid discovery source'; end if;
  if coalesce(array_length(target_sources, 1), 0) = 0 then raise exception 'Select at least one discovery source'; end if;
  if exists (select 1 from unnest(target_sources) as selected(source_name) where source_name not in ('reddit','x','linkedin','hackernews','indiehackers','producthunt','quora','techforums','github','websites','rss')) then
    raise exception 'Unsupported discovery source';
  end if;

  new_tracker_id := public.create_ai_tracker(target_org, target_profile);
  select array_agg(distinct case
    when source_name = 'reddit' then 'reddit'
    when source_name = 'websites' then 'firecrawl'
    when source_name = 'rss' then 'rss'
    when source_name = 'hackernews' then 'hackernews'
    else 'serper'
  end) into backend_names
  from unnest(target_sources) as selected(source_name);

  update public.keyword_trackers set platforms = backend_names, updated_at = now()
    where id = new_tracker_id and organization_id = target_org;

  delete from public.tracker_sources
    where tracker_sources.tracker_id = new_tracker_id and tracker_sources.organization_id = target_org
      and ((tracker_sources.provider = 'reddit' and not ('reddit' = any(target_sources)))
        or (tracker_sources.provider = 'firecrawl' and not ('websites' = any(target_sources))
          and not ('rss' = any(target_sources) and tracker_sources.source_type = 'website' and lower(tracker_sources.source_value) ~ '(\.(rss|xml|atom)(\?.*)?$|/(feed|rss|atom)(/|\?|$))'))
        or (tracker_sources.provider = 'firecrawl' and tracker_sources.source_type = 'website' and lower(tracker_sources.source_value) ~ '\.(rss|xml|atom)(\?.*)?$' and not ('rss' = any(target_sources))));

  delete from public.tracker_queries where tracker_queries.tracker_id = new_tracker_id and tracker_queries.organization_id = target_org;
  insert into public.tracker_queries (organization_id, tracker_id, query)
  select target_org, new_tracker_id, left(trim(term), 240)
  from (
    select jsonb_array_elements_text(target_profile -> 'searchQueries') as term
    union all select jsonb_array_elements_text(target_profile -> 'intentKeywords')
    union all select jsonb_array_elements_text(target_profile -> 'keywords')
  ) terms
  where char_length(trim(term)) >= 2
  on conflict do nothing;

  insert into public.tracker_sources (organization_id, tracker_id, source_type, provider, source_value)
  select target_org, new_tracker_id, 'community', 'serper', source_name
  from unnest(target_sources) as selected(source_name)
  where source_name in ('x','linkedin','indiehackers','producthunt','quora','techforums','github')
  on conflict do nothing;

  insert into public.tracker_sources (organization_id, tracker_id, source_type, provider, source_value)
  select target_org, new_tracker_id, 'website', 'firecrawl', website_url
  from jsonb_array_elements_text(target_profile -> 'websites') as urls(website_url)
  where 'websites' = any(target_sources) and website_url ~ '^https://'
  on conflict do nothing;

  insert into public.tracker_sources (organization_id, tracker_id, source_type, provider, source_value)
  select target_org, new_tracker_id, 'website', 'firecrawl', website_url
  from jsonb_array_elements_text(target_profile -> 'websites') as urls(website_url)
  where 'rss' = any(target_sources) and lower(website_url) ~ '(\.(rss|xml|atom)(\?.*)?$|/(feed|rss|atom)(/|\?|$))'
  on conflict do nothing;

  insert into public.tracker_runs (organization_id, tracker_id, status, progress, providers_total)
  values (target_org, new_tracker_id, 'queued', 0, cardinality(backend_names)) returning id into new_run_id;

  insert into public.tracker_events (organization_id, tracker_id, run_id, event_type, title, details)
  values (target_org, new_tracker_id, new_run_id, 'tracker_created', 'Tracker created', jsonb_build_object('sources', target_sources));

  return query select new_tracker_id, new_run_id;
end;
$$;

revoke all on function public.create_ai_tracker_with_run(uuid, jsonb, text[]) from public, anon;
grant execute on function public.create_ai_tracker_with_run(uuid, jsonb, text[]) to authenticated;

alter table public.intent_signals add column if not exists provider text;
alter table public.intent_signals add column if not exists community text;
alter table public.intent_signals add column if not exists content_hash text;
alter table public.intent_signals drop constraint if exists intent_signals_platform_check;
alter table public.intent_signals add constraint intent_signals_platform_check check (char_length(platform) between 1 and 80);
create unique index if not exists intent_signals_org_content_hash_unique on public.intent_signals(organization_id, content_hash) where content_hash is not null;

create or replace function public.ingest_signals(target_org uuid, signal_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  sub public.subscriptions%rowtype;
  inserted_count integer;
begin
  if jsonb_typeof(signal_rows) <> 'array' or jsonb_array_length(signal_rows) < 1 or jsonb_array_length(signal_rows) > 100 then raise exception 'Invalid signal batch'; end if;
  select * into sub from public.subscriptions where organization_id = target_org for update;
  if not found or sub.status not in ('active', 'trialing') then raise exception 'Subscription is not active'; end if;
  if exists (
    select 1 from jsonb_to_recordset(signal_rows) as r(tracker_id uuid)
    where r.tracker_id is not null and not exists (
      select 1 from public.keyword_trackers t where t.id = r.tracker_id and t.organization_id = target_org and t.status = 'active' and t.deleted_at is null
    )
  ) then raise exception 'Signal tracker is not active in the target organization'; end if;

  insert into public.intent_signals (
    organization_id, tracker_id, platform, external_id, keyword, prospect_name, company, source_url, post_snippet,
    intent_score, confidence, category, pain_intensity, buying_probability, urgency, decision_maker_likelihood, budget_intent,
    raw_payload, provider, community, content_hash
  )
  select target_org, r.tracker_id, r.platform, r.external_id, r.keyword, r.prospect_name, r.company, r.source_url, r.post_snippet,
    r.intent_score, r.confidence, r.category, r.pain_intensity, r.buying_probability, r.urgency, r.decision_maker_likelihood, r.budget_intent,
    coalesce(r.raw_payload, '{}'::jsonb), r.provider, r.community, r.content_hash
  from jsonb_to_recordset(signal_rows) as r(
    tracker_id uuid, platform text, external_id text, keyword text, prospect_name text, company text, source_url text, post_snippet text,
    intent_score integer, confidence integer, category text, pain_intensity integer, buying_probability integer, urgency integer,
    decision_maker_likelihood integer, budget_intent integer, raw_payload jsonb, provider text, community text, content_hash text
  )
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if sub.signals_used + inserted_count > sub.signals_total then raise exception 'Signal quota exceeded'; end if;
  if inserted_count > 0 then
    insert into public.usage_records (organization_id, tracked_date, signals_used) values (target_org, current_date, inserted_count)
      on conflict (organization_id, tracked_date) do update set signals_used = public.usage_records.signals_used + excluded.signals_used;
    update public.subscriptions set signals_used = signals_used + inserted_count where organization_id = target_org;
  end if;
  return inserted_count;
end;
$$;

revoke all on function public.ingest_signals(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_signals(uuid, jsonb) to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tracker_runs') then
      alter publication supabase_realtime add table public.tracker_runs;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tracker_events') then
      alter publication supabase_realtime add table public.tracker_events;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'intent_signals') then
      alter publication supabase_realtime add table public.intent_signals;
    end if;
  end if;
end $$;

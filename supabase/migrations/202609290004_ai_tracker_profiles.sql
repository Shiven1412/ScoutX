create table if not exists public.tracker_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracker_id uuid not null unique references public.keyword_trackers(id) on delete cascade,
  business_description text not null check (char_length(business_description) between 20 and 3000),
  business_summary text not null,
  industry text not null,
  target_audience text[] not null default '{}',
  pain_points text[] not null default '{}',
  generated_at timestamptz not null,
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tracker_keywords (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracker_id uuid not null references public.keyword_trackers(id) on delete cascade,
  keyword_type text not null check (keyword_type in ('product', 'intent', 'negative')),
  keyword text not null check (char_length(keyword) between 2 and 240),
  created_at timestamptz not null default now(),
  unique (tracker_id, keyword_type, keyword)
);

create table if not exists public.tracker_competitors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracker_id uuid not null references public.keyword_trackers(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 240),
  created_at timestamptz not null default now(),
  unique (tracker_id, name)
);

create table if not exists public.tracker_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracker_id uuid not null references public.keyword_trackers(id) on delete cascade,
  source_type text not null check (source_type in ('subreddit', 'community', 'website')),
  provider text not null check (provider in ('reddit', 'firecrawl', 'serper')),
  source_value text not null check (char_length(source_value) between 2 and 500),
  created_at timestamptz not null default now(),
  unique (tracker_id, provider, source_value)
);

create table if not exists public.tracker_queries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracker_id uuid not null references public.keyword_trackers(id) on delete cascade,
  query text not null check (char_length(query) between 2 and 240),
  created_at timestamptz not null default now(),
  unique (tracker_id, query)
);

create table if not exists public.tracker_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracker_id uuid not null references public.keyword_trackers(id) on delete cascade,
  signal_type text not null check (signal_type in ('buying_signal', 'outreach_angle')),
  signal text not null check (char_length(signal) between 2 and 500),
  created_at timestamptz not null default now(),
  unique (tracker_id, signal_type, signal)
);

do $$
declare table_name text;
begin
  foreach table_name in array array['tracker_profiles','tracker_keywords','tracker_competitors','tracker_sources','tracker_queries','tracker_signals'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = table_name and policyname = table_name || '_member_access') then
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_org_member(organization_id) and exists (select 1 from public.keyword_trackers t where t.id = tracker_id and t.organization_id = %I.organization_id)) with check (public.is_org_member(organization_id) and exists (select 1 from public.keyword_trackers t where t.id = tracker_id and t.organization_id = %I.organization_id))',
        table_name || '_member_access', table_name, table_name, table_name
      );
    end if;
  end loop;
end $$;

create or replace function public.create_ai_tracker(target_org uuid, target_profile jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := (select auth.uid());
  tracker_id uuid;
  business text := target_profile ->> 'businessDescription';
  primary_keyword text;
  keyword_values jsonb;
  profile_values jsonb;
begin
  if caller_id is null or not public.is_org_member(target_org) then raise exception 'Active workspace membership required'; end if;
  if jsonb_typeof(target_profile) <> 'object' or char_length(coalesce(business, '')) not between 20 and 3000 then raise exception 'Invalid business description'; end if;
  if jsonb_typeof(target_profile -> 'keywords') <> 'array' or jsonb_array_length(target_profile -> 'keywords') < 1 or jsonb_array_length(target_profile -> 'keywords') > 20 then raise exception 'At least one product keyword is required'; end if;
  if jsonb_typeof(target_profile -> 'negativeKeywords') <> 'array' or jsonb_typeof(target_profile -> 'subreddits') <> 'array'
    or jsonb_typeof(target_profile -> 'communities') <> 'array' or jsonb_typeof(target_profile -> 'websites') <> 'array'
    or jsonb_typeof(target_profile -> 'searchQueries') <> 'array' or jsonb_typeof(target_profile -> 'intentKeywords') <> 'array'
    or jsonb_typeof(target_profile -> 'competitors') <> 'array' or jsonb_typeof(target_profile -> 'buyingSignals') <> 'array'
    or jsonb_typeof(target_profile -> 'outreachAngles') <> 'array' then raise exception 'Invalid AI tracker profile'; end if;

  primary_keyword := left(trim(target_profile -> 'keywords' ->> 0), 180);
  if char_length(primary_keyword) < 2 then raise exception 'Invalid primary keyword'; end if;
  insert into public.keyword_trackers (organization_id, created_by, keyword, negative_keywords, communities, platforms, alert_threshold)
  values (
    target_org,
    caller_id,
    primary_keyword,
    array(select jsonb_array_elements_text(target_profile -> 'negativeKeywords')),
    array(select jsonb_array_elements_text(target_profile -> 'subreddits')),
    array['serper'] || case when jsonb_array_length(target_profile -> 'subreddits') > 0 then array['reddit']::text[] else array[]::text[] end
      || case when jsonb_array_length(target_profile -> 'websites') > 0 then array['firecrawl']::text[] else array[]::text[] end,
    75
  ) returning id into tracker_id;

  insert into public.tracker_profiles (organization_id, tracker_id, business_description, business_summary, industry, target_audience, pain_points, generated_at, model, prompt_version)
  values (target_org, tracker_id, business, target_profile ->> 'businessSummary', target_profile ->> 'industry',
    array(select jsonb_array_elements_text(target_profile -> 'targetAudience')),
    array(select jsonb_array_elements_text(target_profile -> 'painPoints')),
    coalesce((target_profile ->> 'generatedAt')::timestamptz, now()), target_profile ->> 'model', target_profile ->> 'promptVersion');

  for keyword_values in select value from jsonb_array_elements(target_profile -> 'keywords') loop
    insert into public.tracker_keywords (organization_id, tracker_id, keyword_type, keyword) values (target_org, tracker_id, 'product', left(trim(keyword_values #>> '{}'), 240)) on conflict do nothing;
  end loop;
  for keyword_values in select value from jsonb_array_elements(target_profile -> 'intentKeywords') loop
    insert into public.tracker_keywords (organization_id, tracker_id, keyword_type, keyword) values (target_org, tracker_id, 'intent', left(trim(keyword_values #>> '{}'), 240)) on conflict do nothing;
  end loop;
  for keyword_values in select value from jsonb_array_elements(target_profile -> 'negativeKeywords') loop
    insert into public.tracker_keywords (organization_id, tracker_id, keyword_type, keyword) values (target_org, tracker_id, 'negative', left(trim(keyword_values #>> '{}'), 240)) on conflict do nothing;
  end loop;
  for keyword_values in select value from jsonb_array_elements(target_profile -> 'competitors') loop
    insert into public.tracker_competitors (organization_id, tracker_id, name) values (target_org, tracker_id, left(trim(keyword_values #>> '{}'), 240)) on conflict do nothing;
  end loop;
  for keyword_values in select value from jsonb_array_elements(target_profile -> 'subreddits') loop
    insert into public.tracker_sources (organization_id, tracker_id, source_type, provider, source_value) values (target_org, tracker_id, 'subreddit', 'reddit', left(trim(keyword_values #>> '{}'), 500)) on conflict do nothing;
  end loop;
  for keyword_values in select value from jsonb_array_elements(target_profile -> 'communities') loop
    insert into public.tracker_sources (organization_id, tracker_id, source_type, provider, source_value) values (target_org, tracker_id, 'community', 'serper', left(trim(keyword_values #>> '{}'), 500)) on conflict do nothing;
  end loop;
  for keyword_values in select value from jsonb_array_elements(target_profile -> 'websites') loop
    insert into public.tracker_sources (organization_id, tracker_id, source_type, provider, source_value) values (target_org, tracker_id, 'website', 'firecrawl', left(trim(keyword_values #>> '{}'), 500)) on conflict do nothing;
  end loop;
  for keyword_values in select value from jsonb_array_elements(target_profile -> 'searchQueries' || target_profile -> 'intentKeywords') loop
    insert into public.tracker_queries (organization_id, tracker_id, query) values (target_org, tracker_id, left(trim(keyword_values #>> '{}'), 240)) on conflict do nothing;
  end loop;
  for keyword_values in select value from jsonb_array_elements(target_profile -> 'buyingSignals') loop
    insert into public.tracker_signals (organization_id, tracker_id, signal_type, signal) values (target_org, tracker_id, 'buying_signal', left(trim(keyword_values #>> '{}'), 500)) on conflict do nothing;
  end loop;
  for keyword_values in select value from jsonb_array_elements(target_profile -> 'outreachAngles') loop
    insert into public.tracker_signals (organization_id, tracker_id, signal_type, signal) values (target_org, tracker_id, 'outreach_angle', left(trim(keyword_values #>> '{}'), 500)) on conflict do nothing;
  end loop;

  insert into public.activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  values (target_org, caller_id, 'tracker.ai_created', 'keyword_tracker', tracker_id,
    jsonb_build_object('model', target_profile ->> 'model', 'prompt_version', target_profile ->> 'promptVersion'));
  return tracker_id;
end;
$$;

revoke all on function public.create_ai_tracker(uuid, jsonb) from public, anon;
grant execute on function public.create_ai_tracker(uuid, jsonb) to authenticated;
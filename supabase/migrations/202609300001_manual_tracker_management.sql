create or replace function public.create_manual_tracker_with_run(
  target_org uuid,
  target_keyword text,
  target_keywords text[],
  target_intent_keywords text[],
  target_negative_keywords text[],
  target_communities text[],
  target_sources text[],
  target_websites text[],
  target_queries text[],
  target_alert_threshold integer
)
returns table(tracker_id uuid, run_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := (select auth.uid());
  new_tracker_id uuid;
  new_run_id uuid;
begin
  if caller_id is null or not public.is_org_member(target_org) then raise exception 'Active workspace membership required'; end if;
  if char_length(trim(coalesce(target_keyword, ''))) not between 2 and 180 then raise exception 'Invalid tracker keyword'; end if;
  if coalesce(array_length(target_keywords, 1), 0) < 1 or coalesce(array_length(target_keywords, 1), 0) > 30 then raise exception 'At least one tracker keyword is required'; end if;
  if target_alert_threshold not between 0 and 100 then raise exception 'Invalid alert threshold'; end if;
  if coalesce(array_length(target_sources, 1), 0) < 1 or exists (
    select 1 from unnest(target_sources) as sources(source_name)
    where source_name is null or source_name not in ('reddit', 'serper', 'firecrawl', 'rss', 'hackernews')
  ) then raise exception 'Select at least one supported discovery provider'; end if;

  insert into public.keyword_trackers (organization_id, created_by, keyword, negative_keywords, communities, platforms, alert_threshold)
  values (target_org, caller_id, trim(target_keyword), coalesce(target_negative_keywords, '{}'), coalesce(target_communities, '{}'), target_sources, target_alert_threshold)
  returning id into new_tracker_id;

  insert into public.tracker_keywords (organization_id, tracker_id, keyword_type, keyword)
  select target_org, new_tracker_id, 'product', trim(value) from unnest(target_keywords) as items(value) where char_length(trim(value)) >= 2 on conflict do nothing;
  insert into public.tracker_keywords (organization_id, tracker_id, keyword_type, keyword)
  select target_org, new_tracker_id, 'intent', trim(value) from unnest(coalesce(target_intent_keywords, '{}')) as items(value) where char_length(trim(value)) >= 2 on conflict do nothing;
  insert into public.tracker_keywords (organization_id, tracker_id, keyword_type, keyword)
  select target_org, new_tracker_id, 'negative', trim(value) from unnest(coalesce(target_negative_keywords, '{}')) as items(value) where char_length(trim(value)) >= 2 on conflict do nothing;
  insert into public.tracker_sources (organization_id, tracker_id, source_type, provider, source_value)
  select target_org, new_tracker_id, 'subreddit', 'reddit', trim(value) from unnest(coalesce(target_communities, '{}')) as items(value)
  where 'reddit' = any(target_sources) and char_length(trim(value)) >= 2 on conflict do nothing;
  insert into public.tracker_sources (organization_id, tracker_id, source_type, provider, source_value)
  select target_org, new_tracker_id, 'website', 'firecrawl', trim(value) from unnest(coalesce(target_websites, '{}')) as items(value)
  where char_length(trim(value)) >= 2 on conflict do nothing;
  insert into public.tracker_queries (organization_id, tracker_id, query)
  select target_org, new_tracker_id, trim(value) from unnest(coalesce(target_queries, '{}') || coalesce(target_keywords, '{}') || coalesce(target_intent_keywords, '{}')) as items(value)
  where char_length(trim(value)) >= 2 on conflict do nothing;

  insert into public.tracker_runs (organization_id, tracker_id, status, progress, providers_total)
  values (target_org, new_tracker_id, 'queued', 0, cardinality(target_sources)) returning id into new_run_id;
  insert into public.tracker_events (organization_id, tracker_id, run_id, event_type, title, details)
  values (target_org, new_tracker_id, new_run_id, 'tracker_created', 'Manual tracker created', jsonb_build_object('providers', target_sources));
  return query select new_tracker_id, new_run_id;
end;
$$;

create or replace function public.update_manual_tracker(
  target_org uuid,
  target_tracker uuid,
  target_keyword text,
  target_keywords text[],
  target_intent_keywords text[],
  target_negative_keywords text[],
  target_communities text[],
  target_sources text[],
  target_websites text[],
  target_queries text[],
  target_alert_threshold integer
)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_org_member(target_org) then raise exception 'Active workspace membership required'; end if;
  if char_length(trim(coalesce(target_keyword, ''))) not between 2 and 180 then raise exception 'Invalid tracker keyword'; end if;
  if coalesce(array_length(target_keywords, 1), 0) < 1 or coalesce(array_length(target_keywords, 1), 0) > 30 then raise exception 'At least one tracker keyword is required'; end if;
  if target_alert_threshold not between 0 and 100 then raise exception 'Invalid alert threshold'; end if;
  if coalesce(array_length(target_sources, 1), 0) < 1 or exists (
    select 1 from unnest(target_sources) as sources(source_name)
    where source_name is null or source_name not in ('reddit', 'serper', 'firecrawl', 'rss', 'hackernews')
  ) then raise exception 'Select at least one supported discovery provider'; end if;

  update public.keyword_trackers set keyword = trim(target_keyword), negative_keywords = coalesce(target_negative_keywords, '{}'),
    communities = coalesce(target_communities, '{}'), platforms = target_sources, alert_threshold = target_alert_threshold, updated_at = now()
  where id = target_tracker and organization_id = target_org and deleted_at is null;
  if not found then return false; end if;

  delete from public.tracker_keywords where tracker_id = target_tracker and organization_id = target_org;
  delete from public.tracker_sources where tracker_id = target_tracker and organization_id = target_org and source_type in ('subreddit', 'website');
  delete from public.tracker_queries where tracker_id = target_tracker and organization_id = target_org;
  insert into public.tracker_keywords (organization_id, tracker_id, keyword_type, keyword)
  select target_org, target_tracker, 'product', trim(value) from unnest(target_keywords) as items(value) where char_length(trim(value)) >= 2 on conflict do nothing;
  insert into public.tracker_keywords (organization_id, tracker_id, keyword_type, keyword)
  select target_org, target_tracker, 'intent', trim(value) from unnest(coalesce(target_intent_keywords, '{}')) as items(value) where char_length(trim(value)) >= 2 on conflict do nothing;
  insert into public.tracker_keywords (organization_id, tracker_id, keyword_type, keyword)
  select target_org, target_tracker, 'negative', trim(value) from unnest(coalesce(target_negative_keywords, '{}')) as items(value) where char_length(trim(value)) >= 2 on conflict do nothing;
  insert into public.tracker_sources (organization_id, tracker_id, source_type, provider, source_value)
  select target_org, target_tracker, 'subreddit', 'reddit', trim(value) from unnest(coalesce(target_communities, '{}')) as items(value)
  where 'reddit' = any(target_sources) and char_length(trim(value)) >= 2 on conflict do nothing;
  insert into public.tracker_sources (organization_id, tracker_id, source_type, provider, source_value)
  select target_org, target_tracker, 'website', 'firecrawl', trim(value) from unnest(coalesce(target_websites, '{}')) as items(value)
  where char_length(trim(value)) >= 2 on conflict do nothing;
  insert into public.tracker_queries (organization_id, tracker_id, query)
  select target_org, target_tracker, trim(value) from unnest(coalesce(target_queries, '{}') || coalesce(target_keywords, '{}') || coalesce(target_intent_keywords, '{}')) as items(value)
  where char_length(trim(value)) >= 2 on conflict do nothing;
  return true;
end;
$$;

create or replace function public.create_tracker_run(target_org uuid, target_tracker uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_run_id uuid;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then raise exception 'Active workspace membership required'; end if;
  if not exists (select 1 from public.keyword_trackers where id = target_tracker and organization_id = target_org and status = 'active' and deleted_at is null) then
    raise exception 'Tracker is unavailable or paused';
  end if;
  if exists (select 1 from public.tracker_runs where tracker_id = target_tracker and organization_id = target_org and status in ('queued', 'running')) then
    raise exception 'A tracker run is already in progress';
  end if;
  insert into public.tracker_runs (organization_id, tracker_id, status, progress, providers_total)
  select target_org, id, 'queued', 0, cardinality(platforms) from public.keyword_trackers where id = target_tracker and organization_id = target_org
  returning id into new_run_id;
  insert into public.tracker_events (organization_id, tracker_id, run_id, event_type, title, details)
  values (target_org, target_tracker, new_run_id, 'tracker_rerun_requested', 'Manual collection run requested', '{}'::jsonb);
  return new_run_id;
end;
$$;

revoke all on function public.create_manual_tracker_with_run(uuid, text, text[], text[], text[], text[], text[], text[], text[], integer) from public, anon;
revoke all on function public.update_manual_tracker(uuid, uuid, text, text[], text[], text[], text[], text[], text[], text[], integer) from public, anon;
revoke all on function public.create_tracker_run(uuid, uuid) from public, anon;
grant execute on function public.create_manual_tracker_with_run(uuid, text, text[], text[], text[], text[], text[], text[], text[], integer) to authenticated;
grant execute on function public.update_manual_tracker(uuid, uuid, text, text[], text[], text[], text[], text[], text[], text[], integer) to authenticated;
grant execute on function public.create_tracker_run(uuid, uuid) to authenticated;
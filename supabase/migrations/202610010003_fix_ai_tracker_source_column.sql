create or replace function public.create_ai_tracker_with_run(target_org uuid, target_profile jsonb, target_sources text[])
returns table(tracker_id uuid, run_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  new_tracker_id uuid;
  new_run_id uuid;
  backend_names text[];
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'Active workspace membership required';
  end if;
  if exists (select 1 from unnest(target_sources) as selected(source_name) where source_name is null) then
    raise exception 'Invalid discovery source';
  end if;
  if coalesce(array_length(target_sources, 1), 0) = 0 then
    raise exception 'Select at least one discovery source';
  end if;
  if exists (
    select 1 from unnest(target_sources) as selected(source_name)
    where source_name not in ('reddit','x','linkedin','hackernews','indiehackers','producthunt','quora','techforums','github','websites','rss')
  ) then
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

  update public.keyword_trackers
  set platforms = backend_names, updated_at = now()
  where id = new_tracker_id and organization_id = target_org;

  delete from public.tracker_sources
  where tracker_sources.tracker_id = new_tracker_id
    and tracker_sources.organization_id = target_org
    and (
      (tracker_sources.provider = 'reddit' and not ('reddit' = any(target_sources)))
      or (tracker_sources.provider = 'firecrawl' and not ('websites' = any(target_sources))
        and not ('rss' = any(target_sources)
          and tracker_sources.source_type = 'website'
          and lower(tracker_sources.source_value) ~ '(\.(rss|xml|atom)(\?.*)?$|/(feed|rss|atom)(/|\?|$))'))
      or (tracker_sources.provider = 'firecrawl'
        and tracker_sources.source_type = 'website'
        and lower(tracker_sources.source_value) ~ '\.(rss|xml|atom)(\?.*)?$'
        and not ('rss' = any(target_sources)))
    );

  delete from public.tracker_queries
  where tracker_queries.tracker_id = new_tracker_id
    and tracker_queries.organization_id = target_org;
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
  where 'rss' = any(target_sources)
    and lower(website_url) ~ '(\.(rss|xml|atom)(\?.*)?$|/(feed|rss|atom)(/|\?|$))'
  on conflict do nothing;

  insert into public.tracker_runs (organization_id, tracker_id, status, progress, providers_total)
  values (target_org, new_tracker_id, 'queued', 0, cardinality(backend_names))
  returning id into new_run_id;

  insert into public.tracker_events (organization_id, tracker_id, run_id, event_type, title, details)
  values (target_org, new_tracker_id, new_run_id, 'tracker_created', 'Tracker created', jsonb_build_object('sources', target_sources));

  return query select new_tracker_id, new_run_id;
end;
$$;

revoke all on function public.create_ai_tracker_with_run(uuid, jsonb, text[]) from public, anon;
grant execute on function public.create_ai_tracker_with_run(uuid, jsonb, text[]) to authenticated;
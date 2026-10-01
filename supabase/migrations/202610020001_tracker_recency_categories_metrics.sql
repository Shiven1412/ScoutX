alter table public.keyword_trackers
  add column if not exists last_run_at timestamptz,
  add column if not exists excluded_categories text[] not null default array['ignore', 'product_launch', 'self_promotion', 'career_discussion']::text[],
  add column if not exists signals_filtered_old bigint not null default 0,
  add column if not exists signals_filtered_undated bigint not null default 0,
  add column if not exists signals_filtered_category bigint not null default 0;

alter table public.keyword_trackers
  drop constraint if exists keyword_trackers_excluded_categories_check;

alter table public.keyword_trackers
  add constraint keyword_trackers_excluded_categories_check
  check (excluded_categories <@ array[
    'ignore', 'product_launch', 'self_promotion', 'thought_leadership', 'career_discussion', 'general_discussion',
    'buying_intent', 'seeking_alternative', 'recommendation_request', 'pain_point', 'feature_request'
  ]::text[]);

create or replace function public.record_tracker_filter_metrics(
  target_org uuid,
  target_tracker uuid,
  old_count bigint,
  undated_count bigint,
  category_count bigint
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role'
    or old_count < 0 or undated_count < 0 or category_count < 0
    or old_count > 100000 or undated_count > 100000 or category_count > 100000 then
    raise exception 'Invalid tracker filter metrics request';
  end if;

  update public.keyword_trackers
  set signals_filtered_old = signals_filtered_old + old_count,
      signals_filtered_undated = signals_filtered_undated + undated_count,
      signals_filtered_category = signals_filtered_category + category_count,
      updated_at = now()
  where id = target_tracker and organization_id = target_org;

  if not found then raise exception 'Tracker not found in target organization'; end if;
end;
$$;

revoke all on function public.record_tracker_filter_metrics(uuid, uuid, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_tracker_filter_metrics(uuid, uuid, bigint, bigint, bigint) to service_role;

create or replace function public.get_tracker_signal_analytics(target_org uuid, target_trackers uuid[])
returns table(tracker_id uuid, signals_today bigint, signals_7d bigint, signals_30d bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'Active workspace membership required';
  end if;
  if coalesce(array_length(target_trackers, 1), 0) > 500 then
    raise exception 'Too many trackers requested';
  end if;

  return query
  select t.id,
    count(s.id) filter (where s.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    count(s.id) filter (where s.created_at >= now() - interval '7 days'),
    count(s.id) filter (where s.created_at >= now() - interval '30 days')
  from public.keyword_trackers t
  left join public.intent_signals s on s.tracker_id = t.id and s.organization_id = target_org
  where t.organization_id = target_org and t.deleted_at is null and t.id = any(coalesce(target_trackers, '{}'::uuid[]))
  group by t.id;
end;
$$;

revoke all on function public.get_tracker_signal_analytics(uuid, uuid[]) from public, anon;
grant execute on function public.get_tracker_signal_analytics(uuid, uuid[]) to authenticated, service_role;

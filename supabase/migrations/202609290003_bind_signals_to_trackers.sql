create or replace function public.ingest_signals(target_org uuid, signal_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  sub public.subscriptions%rowtype;
  inserted_count integer;
begin
  if jsonb_typeof(signal_rows) <> 'array' or jsonb_array_length(signal_rows) < 1 or jsonb_array_length(signal_rows) > 100 then
    raise exception 'Invalid signal batch';
  end if;
  select * into sub from public.subscriptions where organization_id = target_org for update;
  if not found or sub.status not in ('active', 'trialing') then raise exception 'Subscription is not active'; end if;
  if exists (
    select 1 from jsonb_to_recordset(signal_rows) as r(tracker_id uuid)
    where r.tracker_id is not null and not exists (
      select 1 from public.keyword_trackers t
      where t.id = r.tracker_id and t.organization_id = target_org and t.status = 'active' and t.deleted_at is null
    )
  ) then raise exception 'Signal tracker is not active in the target organization'; end if;

  insert into public.intent_signals (
    organization_id, tracker_id, platform, external_id, keyword, prospect_name, company, source_url, post_snippet,
    intent_score, confidence, category, pain_intensity, buying_probability, urgency,
    decision_maker_likelihood, budget_intent, raw_payload
  )
  select target_org, r.tracker_id, r.platform, r.external_id, r.keyword, r.prospect_name, r.company, r.source_url, r.post_snippet,
    r.intent_score, r.confidence, r.category, r.pain_intensity, r.buying_probability, r.urgency,
    r.decision_maker_likelihood, r.budget_intent, coalesce(r.raw_payload, '{}'::jsonb)
  from jsonb_to_recordset(signal_rows) as r(
    tracker_id uuid, platform text, external_id text, keyword text, prospect_name text, company text, source_url text,
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

revoke all on function public.ingest_signals(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_signals(uuid, jsonb) to service_role;
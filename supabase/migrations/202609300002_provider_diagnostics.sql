alter table public.tracker_runs
  add column if not exists diagnostic_mode boolean not null default false;

create or replace function public.create_tracker_run(target_org uuid, target_tracker uuid, target_diagnostic_mode boolean)
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
  insert into public.tracker_runs (organization_id, tracker_id, status, progress, providers_total, diagnostic_mode)
  select target_org, id, 'queued', 0, cardinality(platforms), target_diagnostic_mode
  from public.keyword_trackers where id = target_tracker and organization_id = target_org
  returning id into new_run_id;
  insert into public.tracker_events (organization_id, tracker_id, run_id, event_type, title, details)
  values (
    target_org,
    target_tracker,
    new_run_id,
    case when target_diagnostic_mode then 'tracker_diagnostic_requested' else 'tracker_rerun_requested' end,
    case when target_diagnostic_mode then 'Diagnostic collection test requested' else 'Manual collection run requested' end,
    jsonb_build_object('diagnosticMode', target_diagnostic_mode)
  );
  return new_run_id;
end;
$$;

revoke all on function public.create_tracker_run(uuid, uuid, boolean) from public, anon;
grant execute on function public.create_tracker_run(uuid, uuid, boolean) to authenticated;
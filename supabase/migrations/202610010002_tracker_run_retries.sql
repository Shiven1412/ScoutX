alter table public.tracker_runs
  add column if not exists attempt_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tracker_runs'::regclass
      and conname = 'tracker_runs_attempt_count_check'
  ) then
    alter table public.tracker_runs
      add constraint tracker_runs_attempt_count_check check (attempt_count between 0 and 3);
  end if;
end $$;

create index if not exists tracker_runs_recovery_idx
  on public.tracker_runs (status, started_at, completed_at, created_at);

alter table public.tracker_sources
  drop constraint if exists tracker_sources_source_value_check;

alter table public.tracker_sources
  add constraint tracker_sources_source_value_check
  check (char_length(source_value) between 1 and 500);

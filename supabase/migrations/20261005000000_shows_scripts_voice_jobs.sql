-- Phase 6: show profiles, editable scripts, voice jobs.
create table public.shows (
  id          text primary key,              -- slug, e.g. 'the-shoebox-files'
  name        text not null,
  profile     jsonb not null,                -- ShowProfile (packages/edit-plan/src/shows.ts)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.shows enable row level security;
create policy "owner all shows" on public.shows
  for all to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));
create trigger shows_touch before update on public.shows
for each row execute function public.touch_updated_at();

-- The episode's script as last saved in the app (paragraphs separated by blank lines).
-- The voiced version is whatever the narration's word timings say.
alter table public.episodes add column script text;

-- voice: first narration for a new episode (options.script); revoice: changed paragraphs only.
alter table public.render_jobs drop constraint render_jobs_kind_check;
alter table public.render_jobs add constraint render_jobs_kind_check
  check (kind in ('episode', 'preview', 'prepare', 'short', 'voice', 'revoice'));

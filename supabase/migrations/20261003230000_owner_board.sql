-- Phase 3: single-owner web app. The owner signs in with an email link;
-- everything is readable/writable only by users listed in app_owners.
-- Applied to shoebox-studio (tfjoqdcysltgmggeyryd) on 2026-10-03, together with
-- 20261003231000_owner_check_private_schema.sql.

create table public.app_owners (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);
alter table public.app_owners enable row level security;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_owners where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated, service_role;

create policy "owner reads own row" on public.app_owners
  for select to authenticated using (user_id = (select auth.uid()));

-- Board stages, in order.
alter table public.episodes
  add constraint episodes_status_check check (status in (
    'idea', 'researched', 'scripted', 'voiced', 'edited',
    'awaiting-approval', 'approved', 'scheduled', 'published'));

-- Approvals, change requests, stage moves and notes, newest last.
create table public.episode_events (
  id          bigint generated always as identity primary key,
  episode_id  text not null references public.episodes(id) on delete cascade,
  kind        text not null check (kind in ('approved', 'changes_requested', 'status', 'note')),
  body        text,
  from_status text,
  to_status   text,
  user_id     uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index episode_events_episode_idx on public.episode_events (episode_id, created_at);
alter table public.episode_events enable row level security;

-- Preview bundles are prepared by the worker without rendering video.
alter table public.render_jobs drop constraint render_jobs_kind_check;
alter table public.render_jobs add constraint render_jobs_kind_check check (kind in ('episode', 'preview', 'prepare'));

-- Owner policies.
create policy "owner all episodes" on public.episodes
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "owner all jobs" on public.render_jobs
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "owner all events" on public.episode_events
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

-- Storage: the owner may read (and sign URLs for) everything in the studio bucket.
create policy "owner reads studio" on storage.objects
  for select to authenticated using (bucket_id = 'studio' and (select public.is_owner()));

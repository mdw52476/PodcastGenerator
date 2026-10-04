-- Phase 4: vertical shorts render as their own jobs (options.shortId).
alter table public.render_jobs drop constraint render_jobs_kind_check;
alter table public.render_jobs add constraint render_jobs_kind_check check (kind in ('episode', 'preview', 'prepare', 'short'));

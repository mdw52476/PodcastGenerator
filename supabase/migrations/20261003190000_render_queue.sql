-- Episodes and the render job queue for the Railway worker.
-- Only the service role (worker + owner CLI) touches these until Phase 3 adds owner auth.
-- Applied to project tfjoqdcysltgmggeyryd (shoebox-studio) on 2026-10-03.

create table public.episodes (
  id          text primary key,                 -- plan.episode.id, e.g. 'ep01-test'
  show        text not null,
  title       text not null,
  status      text not null default 'idea',
  plan        jsonb,                            -- latest edit plan
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.render_jobs (
  id            uuid primary key default gen_random_uuid(),
  episode_id    text not null references public.episodes(id) on delete cascade,
  kind          text not null default 'episode' check (kind in ('episode', 'preview')),
  plan          jsonb not null,                 -- snapshot of the plan at submit time
  assets        jsonb not null default '{}',    -- { "relative/path in plan": "storage key" }
  options       jsonb not null default '{}',    -- { frames, strict, labels, proxy, dropbox }
  status        text not null default 'queued'
                check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  stage         text,
  progress      real not null default 0,
  outputs       jsonb,                          -- { master, proxy, report, dropbox: [...] }
  error         text,
  attempts      int not null default 0,
  max_attempts  int not null default 2,
  worker_id     text,
  heartbeat_at  timestamptz,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

create index render_jobs_queue_idx on public.render_jobs (status, created_at);
create index render_jobs_episode_idx on public.render_jobs (episode_id, created_at desc);

alter table public.episodes enable row level security;
alter table public.render_jobs enable row level security;

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger episodes_touch before update on public.episodes
for each row execute function public.touch_updated_at();

-- Take the oldest queued job. Jobs whose worker stopped sending heartbeats
-- (crash, redeploy) go back to the queue, or fail once attempts run out.
create function public.claim_render_job(p_worker text)
returns setof public.render_jobs
language plpgsql security definer set search_path = '' as $$
declare
  j public.render_jobs;
begin
  update public.render_jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         error = 'worker stopped responding during "' || coalesce(stage, '?') || '"',
         finished_at = case when attempts >= max_attempts then now() else null end,
         worker_id = null
   where status = 'running' and heartbeat_at < now() - interval '3 minutes';

  select * into j from public.render_jobs
   where status = 'queued'
   order by created_at
   for update skip locked
   limit 1;
  if not found then
    return;
  end if;

  update public.render_jobs
     set status = 'running', attempts = attempts + 1, worker_id = p_worker,
         started_at = now(), heartbeat_at = now(), progress = 0, stage = 'starting', error = null
   where id = j.id
   returning * into j;
  return next j;
end $$;

revoke execute on function public.claim_render_job(text) from public, anon, authenticated;
grant execute on function public.claim_render_job(text) to service_role;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Private bucket for inputs (narration, images) and outputs (renders).
insert into storage.buckets (id, name, public, file_size_limit)
values ('studio', 'studio', false, 5368709120);

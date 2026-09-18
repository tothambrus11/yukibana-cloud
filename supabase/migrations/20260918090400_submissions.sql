-- Submissions are evidence. A row is written once and never changed or
-- removed by anyone through the app: there is no update or delete policy, and
-- no grant for either. History is the rows, ordered by `submitted_at`.

-- Supabase runs each migration in one transaction; these bound how long it
-- may wait for a lock or run, so a deploy that would block the site fails
-- instead, and is retried when the table is quiet.
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create table public.submission (
  submission_id uuid primary key default app.uuidv7(),
  edition_id    uuid not null,
  project_id    uuid not null,
  author_id     uuid not null references public.app_user (user_id) on delete restrict,
  submitted_at  timestamptz not null default now(),
  -- The bucket key. Never a URL: a URL bakes the provider into every row and
  -- turns a change of host into a data migration.
  object_key    text not null unique,
  byte_size     bigint not null check (byte_size > 0),
  sha256        bytea not null check (octet_length(sha256) = 32),
  -- Both columns at once, so a submission cannot name a project of another
  -- edition than the one it claims.
  -- Restrict, not cascade: a project with submissions cannot be deleted.
  -- Archive the edition instead; the rows are evidence.
  foreign key (edition_id, project_id) references public.project (edition_id, project_id) on delete restrict
);
create index submission_by_author on public.submission (project_id, author_id, submitted_at desc);

alter table public.submission enable row level security;
revoke all on public.submission from public, anon, authenticated;

-- Whether the caller may submit to `project` right now: enrolled as a
-- student, published, and before the deadline. The insert policy asks this,
-- and the upload route asks it before accepting bytes, so a late student is
-- refused before uploading rather than after.
create or replace function app.can_submit(project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project p
    where p.project_id = project
      and app.project_open(p.edition_id, p.available_after)
      and (p.deadline is null or now() < p.deadline)
  )
$$;

-- The author and the moment are what the server saw, whatever the row said.
-- A BEFORE trigger runs before the policy's WITH CHECK, so a client that
-- names someone else as author does not fail: it is corrected, and the row
-- that lands is theirs.
create or replace function app.stamp_submission()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.author_id    := (select auth.uid());
  new.submitted_at := now();
  return new;
end
$$;
create trigger submission_stamp before insert on public.submission
  for each row execute function app.stamp_submission();

create policy submission_read on public.submission for select to authenticated using (
  author_id = (select auth.uid()) or app.is_staff(edition_id)
);

create policy submission_insert on public.submission for insert to authenticated with check (
  author_id = (select auth.uid()) and app.can_submit(project_id)
);

grant select, insert on public.submission to authenticated;

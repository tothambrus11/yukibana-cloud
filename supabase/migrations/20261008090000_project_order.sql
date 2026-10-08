-- The order of an edition's projects, as its owners arrange it.
--
-- Teachers reorder projects by dragging them. A move should touch one row,
-- not renumber the edition, so a position is a `numeric`: arbitrary
-- precision, and a project dropped between two others takes the midpoint of
-- theirs. The midpoint is `(a + b) * 0.5`, never `(a + b) / 2`: numeric
-- division rounds to a fixed scale, so after enough moves into the same gap
-- two positions would come out equal; multiplying by 0.5 is exact and only
-- lengthens the number by a digit. Positions are compared, never shown, and
-- two that tie (concurrent inserts) are ordered by `created_at`.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- Nullable, and never null in practice: filled for every existing row
-- here, and for every new one by the stamp below; there is no update grant
-- on it, so the only other writer is app.move_project. Declaring it not null
-- would mean either a default to drop afterwards or a `set not null` that
-- scans the table, both of which squawk rightly flags for a value nothing
-- can leave empty anyway. The pages sort with `nulls last` all the same.
alter table public.project add column position numeric;

-- Today's order, kept: what the pages sorted by until now.
update public.project p
set position = o.n
from (
  select project_id, row_number() over (partition by edition_id order by available_after nulls last, slug) as n
  from public.project
) o
where o.project_id = p.project_id;

create index project_by_position on public.project (edition_id, position);

-- New projects go to the end of their edition. The stamp ran before every
-- insert already; it now also fills a position nobody gave.
create or replace function app.stamp_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := (select auth.uid());
  new.created_at := now();
  if new.position is null then
    new.position := coalesce((select max(p.position) from public.project p where p.edition_id = new.edition_id), 0) + 1;
  end if;
  return new;
end
$$;

-- Owner action: move `project` between two neighbours of the same edition,
-- `after` (the one it now follows) and `before` (the one it now precedes).
-- Either may be null, at the start or the end of the list. Only the moved
-- row changes. A neighbour from another edition is refused: it would put a
-- position from somebody else's list into this one.
create or replace function app.move_project(project uuid, after uuid, before uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  edition uuid;
  a numeric;
  b numeric;
  placed numeric;
begin
  select p.edition_id into edition from public.project p where p.project_id = project;
  if edition is null or app.role_in(edition) is distinct from 'owner' then
    raise exception 'only an owner may reorder projects' using errcode = '42501';
  end if;
  if after is not null then
    select p.position into a from public.project p where p.project_id = after and p.edition_id = edition;
    if a is null then raise exception 'the project before it is not in this edition' using errcode = '23514'; end if;
  end if;
  if before is not null then
    select p.position into b from public.project p where p.project_id = before and p.edition_id = edition;
    if b is null then raise exception 'the project after it is not in this edition' using errcode = '23514'; end if;
  end if;
  placed := case
    when a is not null and b is not null then (a + b) * 0.5
    when a is not null then a + 1
    when b is not null then b - 1
  end;
  if placed is null then
    return (select p.position from public.project p where p.project_id = project);
  end if;
  update public.project p set position = placed where p.project_id = project;
  perform app.audit('move_project', jsonb_build_object('project_id', project, 'after', after, 'before', before));
  return placed;
end
$$;

-- Duplicating an edition keeps its order: the copies take the positions of
-- the originals.
create or replace function app.duplicate_edition(from_edition uuid, new_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
  cid uuid;
begin
  if app.role_in(from_edition) is distinct from 'owner' then
    raise exception 'only an owner may duplicate an edition' using errcode = '42501';
  end if;
  select course_id into cid from public.course_edition where edition_id = from_edition;
  insert into public.course_edition (course_id, label)
  values (cid, new_label)
  returning edition_id into eid;

  insert into public.enrollment (edition_id, email, role, source, user_id)
  select eid, e.email, e.role, e.source, e.user_id
  from public.enrollment e
  where e.edition_id = from_edition and e.role in ('assistant', 'owner');

  -- Projects come along without their releases: this year's starter is a
  -- new upload, and last year's teacher archive stays with last year.
  insert into public.project (edition_id, slug, title, kind, position, created_by)
  select eid, slug, title, kind, position, (select auth.uid())
  from public.project
  where edition_id = from_edition;

  perform app.audit('duplicate_edition', jsonb_build_object('source', from_edition, 'edition_id', eid, 'label', new_label));
  return eid;
end
$$;

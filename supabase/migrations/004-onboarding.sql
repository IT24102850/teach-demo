-- ===========================================================================
--  Plus App v4 - teacher onboarding.
--
--  The six-screen wizard is a tool the Plus team fills in while sitting with
--  a teacher, not something the teacher opens themselves. It creates the
--  teacher, their subjects and their classes in one go, and keeps what was
--  said about how they work today.
-- ===========================================================================

alter table teachers add column if not exists email      text;
-- Some teachers also teach at a school; the wizard asks, and it is worth
-- knowing who they are.
alter table teachers add column if not exists school     text;
-- The wizard's answers, kept whole: how they track attendance today, what
-- their biggest headache is, and the Plus team's own notes. Shaped by the
-- form rather than the database, so adding a question needs no migration.
alter table teachers add column if not exists onboarding jsonb;
alter table teachers add column if not exists onboarded_at timestamptz;

-- The wizard asks which days a class runs and roughly how many students, but
-- not what time it starts - that would be a sixth screen for something the
-- teacher can set in ten seconds later. These carry what it did ask, and
-- flag the class as still needing a time before it can sit on a calendar.
alter table classes add column if not exists setup_pending     boolean not null default false;
alter table classes add column if not exists expected_students int;
alter table classes add column if not exists fee_band          text;

create index if not exists classes_setup_idx on classes(teacher_id) where setup_pending;

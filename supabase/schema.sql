-- ===========================================================================
--  Plus Teacher App - database schema  (PostgreSQL / Supabase)
--  Run this once in the Supabase SQL Editor, then run `node scripts/seed.mjs`.
--  Safe to re-run: every statement is idempotent.
-- ===========================================================================

create extension if not exists pgcrypto;



-- ---------------------------------------------------------------- teachers --
create table if not exists teachers (
  id                 uuid primary key default gen_random_uuid(),
  name               text        not null,
  title              text        not null default 'Sir',
  phone              text,
  join_key           text        not null unique,          -- used in /join/<key>
  subjects           text[]      not null default '{Maths,Science,English}',
  curricula          text[]      not null default '{Local,Cambridge,Edexcel}',
  lang               text        not null default 'en'   check (lang  in ('en','si','ta')),
  theme              text        not null default 'night' check (theme in ('night','day','auto')),
  auto_reminders     boolean     not null default true,
  remind_after_days  int         not null default 14     check (remind_after_days in (7,14,30)),
  code_lookup        text        unique,                  -- hmac(code, pepper): indexed lookup
  code_hash          text,                                -- scrypt(code, code_salt + pepper)
  code_salt          text,
  -- Point 12: the teacher's own teaching place, typed once in Settings and
  -- reused by every group class held there.
  own_place_name     text        not null default 'My home',
  own_place_area     text,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------- students --
create table if not exists students (
  id                uuid primary key default gen_random_uuid(),
  teacher_id        uuid        not null references teachers(id) on delete cascade,
  name              text        not null,
  grade             int,
  school            text,
  area              text,
  curriculum        text        not null default 'Local',
  subject           text,                                 -- main subject, for list/search
  wanted_subjects   text[]      not null default '{}',     -- from the join form
  fee_per_class     numeric(10,2) not null default 0,
  parent_name       text,
  parent_phone      text,
  status            text        not null default 'active'
                     check (status in ('pending','active','archived')),
  -- Point 8: the four-step join form asks for these too.
  call_name         text,                                  -- what to call them in the app
  ambition          text,                                  -- "what do you want to be?"
  parent_occupation text,
  photo_path        text,                                  -- storage object path
  slip_path         text,                                  -- storage object path
  slip_sent_at      timestamptz,
  last_reminded_at  timestamptz,
  created_at        timestamptz not null default now(),
  -- Paid / Unpaid as the teacher set it. A zero balance is not "paid": a new
  -- student has no classes on the ledger yet and has not paid anything.
  fee_status        text        not null default 'unpaid'
                     check (fee_status in ('unpaid','paid'))
);
create index if not exists students_teacher_idx on students(teacher_id, status);

-- ----------------------------------------------------------------- classes --
-- A class is stored once. Dated sessions are generated from days[]/once_date.
create table if not exists classes (
  id              uuid primary key default gen_random_uuid(),
  teacher_id      uuid        not null references teachers(id) on delete cascade,
  subject         text        not null,
  curriculum      text        not null default 'Local',
  grade           int,
  title           text        not null,
  place           text,
  -- Point 12: the kind is stored, not guessed from how many students were
  -- picked, and where the class is depends on the kind.
  kind            text        not null default 'group'
                    check (kind in ('individual','group')),
  venue_type      text        not null default 'area'
                    check (venue_type in ('area','institute','own_place')),
  venue_name      text,                                    -- institute name
  area            text,                                    -- Nugegoda, Dehiwala, ...
  days            smallint[]  not null default '{}',       -- 0=Mon .. 6=Sun
  start_time      time        not null,
  duration_hours  numeric(4,2) not null default 1,
  start_date      date        not null default current_date,
  once_date       date,                                    -- set => single session
  active          boolean     not null default true,
  created_at      timestamptz not null default now(),
  -- coalesce matters: array_length('{}', 1) is NULL, not 0, and a CHECK that
  -- evaluates to NULL passes. Without it a class with no weekday and no single
  -- date would be stored and then never appear on any calendar.
  constraint classes_repeat_ck
    check (once_date is not null or coalesce(array_length(days, 1), 0) >= 1)
);
create index if not exists classes_teacher_idx on classes(teacher_id, active);

create table if not exists class_students (
  class_id   uuid not null references classes(id)  on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  primary key (class_id, student_id)
);
create index if not exists class_students_student_idx on class_students(student_id);

-- One cancelled date, without deleting the whole class (rule 7.1.2).
create table if not exists class_exceptions (
  class_id  uuid not null references classes(id) on delete cascade,
  skip_date date not null,
  reason    text,
  primary key (class_id, skip_date)
);

-- ---------------------------------------------------------------- sessions --
-- A row exists only once something happened: marked, or parent notified.
create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid        not null references classes(id)  on delete cascade,
  teacher_id   uuid        not null references teachers(id) on delete cascade,
  session_date date        not null,
  status       text        not null default 'planned'
                 check (status in ('planned','done','cancelled')),
  notified_at  timestamptz,
  done_at      timestamptz,
  -- Point 10: the real clock times, so "hours taught" is what happened and
  -- not what was scheduled.
  started_at   timestamptz,
  ended_at     timestamptz,
  created_at   timestamptz not null default now(),
  unique (class_id, session_date)
);
create index if not exists sessions_teacher_date_idx on sessions(teacher_id, session_date);

create table if not exists attendance (
  session_id uuid    not null references sessions(id) on delete cascade,
  student_id uuid    not null references students(id) on delete cascade,
  present    boolean not null default true,
  primary key (session_id, student_id)
);
create index if not exists attendance_student_idx on attendance(student_id);

-- ------------------------------------------------------------------ money --
-- Ledger: amount owed = sum(charges) - sum(payments). One charge per class
-- attended, so a fee change or a cancelled class can never corrupt history.
create table if not exists charges (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid        not null references teachers(id) on delete cascade,
  student_id  uuid        not null references students(id) on delete cascade,
  session_id  uuid        references sessions(id) on delete set null,
  amount      numeric(10,2) not null,
  charge_date date        not null default current_date,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists charges_student_idx on charges(student_id, charge_date);
create unique index if not exists charges_session_student_uq
  on charges(session_id, student_id) where session_id is not null;

create table if not exists payments (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid        not null references teachers(id) on delete cascade,
  student_id uuid        not null references students(id) on delete cascade,
  amount     numeric(10,2) not null,
  method     text        not null default 'Bank transfer'
               check (method in ('Bank transfer','Cash','Online','Slip')),
  paid_date  date        not null default current_date,
  note       text,
  -- Point 11: the number on the parent's receipt, counted per teacher.
  receipt_no int,
  -- Point 11: Undo marks the row reversed. A payment is never silently
  -- deleted, so the history always explains the balance.
  reversed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists payments_receipt_uq
  on payments(teacher_id, receipt_no) where receipt_no is not null;
create index if not exists payments_student_idx on payments(student_id, paid_date);

-- ------------------------------------------------------------------ marks --
create table if not exists marks (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid        not null references teachers(id) on delete cascade,
  student_id uuid        not null references students(id) on delete cascade,
  title      text        not null,
  score      numeric(6,2) not null,
  max_score  numeric(6,2) not null default 100 check (max_score > 0),
  taken_on   date        not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists marks_student_idx on marks(student_id, taken_on);

-- ----------------------------------------------------------------- events --
-- Every teacher action that a family should see. Drives the Updates feed and
-- the outgoing WhatsApp messages.
create table if not exists events (
  id              uuid primary key default gen_random_uuid(),
  teacher_id      uuid        not null references teachers(id) on delete cascade,
  student_id      uuid        not null references students(id) on delete cascade,
  type            text        not null
                    check (type in ('fee','absent','class','paid','report','mark','slip','join')),
  text            text        not null,
  channel         text        not null default 'app'
                    check (channel in ('app','whatsapp')),
  delivery_status text        not null default 'none'
                    check (delivery_status in ('none','queued','sent','manual','failed')),
  delivery_error  text,
  created_at      timestamptz not null default now()
);
create index if not exists events_student_idx on events(student_id, created_at desc);

-- ----------------------------------------------------------------- papers --
create table if not exists papers (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid        not null references teachers(id) on delete cascade,
  name       text        not null,
  price      numeric(10,2) not null default 0,
  cost       numeric(10,2) not null default 0,
  file_path  text,                                   -- storage object path (PDF)
  created_at timestamptz not null default now()
);
create index if not exists papers_teacher_idx on papers(teacher_id);

create table if not exists paper_sales (
  id         uuid primary key default gen_random_uuid(),
  paper_id   uuid        not null references papers(id)   on delete cascade,
  teacher_id uuid        not null references teachers(id) on delete cascade,
  student_id uuid        references students(id) on delete set null,
  price      numeric(10,2) not null,
  sold_on    date        not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists paper_sales_teacher_idx on paper_sales(teacher_id, sold_on);

-- --------------------------------------------------------------- families --
-- One account per family. A code can open several children.
create table if not exists family_accounts (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid        not null references teachers(id) on delete cascade,
  label         text,
  phone         text,
  code_lookup   text        not null unique,   -- hmac(code, pepper): indexed lookup
  code_hash     text        not null,
  code_salt     text        not null,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists family_children (
  account_id uuid not null references family_accounts(id) on delete cascade,
  student_id uuid not null references students(id)        on delete cascade,
  primary key (account_id, student_id)
);
create index if not exists family_children_student_idx on family_children(student_id);

-- ----------------------------------------------------------- reschedules --
create table if not exists reschedule_requests (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid        not null references teachers(id) on delete cascade,
  student_id   uuid        not null references students(id) on delete cascade,
  class_id     uuid        references classes(id) on delete cascade,
  session_date date,
  note         text,
  status       text        not null default 'open'
                 check (status in ('open','accepted','declined')),
  created_at   timestamptz not null default now()
);

-- -------------------------------------------------------- login attempts --
-- Backs the rate limit / lock-out in api/auth.js.
create table if not exists login_attempts (
  id         bigserial primary key,
  ip         text        not null,
  role       text,
  ok         boolean     not null default false,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_ip_idx on login_attempts(ip, created_at desc);


-- ===========================================================================
--  Bringing an older database up to date.
--  `create table if not exists` leaves an existing table alone, so changes to
--  a constraint have to be applied explicitly. Each block here is safe to run
--  any number of times.
-- ===========================================================================

-- A class with an empty days array and no once_date used to slip through,
-- because array_length('{}', 1) is NULL and a NULL check passes.
alter table classes drop constraint if exists classes_repeat_ck;
alter table classes add  constraint classes_repeat_ck
  check (once_date is not null or coalesce(array_length(days, 1), 0) >= 1);


-- ---------------------------------------------------- Plus App v2 columns --
-- Point 12: the teacher's own teaching place, typed once and reused.
alter table teachers add column if not exists own_place_name text not null default 'My home';
alter table teachers add column if not exists own_place_area text;

-- Point 8: the answers the four-step join form collects.
alter table students add column if not exists call_name         text;
alter table students add column if not exists ambition          text;
alter table students add column if not exists parent_occupation text;
alter table students add column if not exists photo_path        text;

-- Point 12: individual or group, and where the class is held.
alter table classes add column if not exists kind       text;
alter table classes add column if not exists venue_type text;
alter table classes add column if not exists venue_name text;
alter table classes add column if not exists area       text;

-- An existing class keeps the meaning it already had on screen: one student
-- was shown as "Individual", more than one as a group.
update classes c
   set kind = case
                when (select count(*) from class_students cs where cs.class_id = c.id) = 1
                then 'individual' else 'group'
              end
 where c.kind is null;
update classes set venue_type = 'area' where venue_type is null;
update classes set area = place where area is null;

alter table classes alter column kind       set default 'group';
alter table classes alter column venue_type set default 'area';
alter table classes alter column kind       set not null;
alter table classes alter column venue_type set not null;

alter table classes drop constraint if exists classes_kind_check;
alter table classes add  constraint classes_kind_check
  check (kind in ('individual','group'));
alter table classes drop constraint if exists classes_venue_type_check;
alter table classes add  constraint classes_venue_type_check
  check (venue_type in ('area','institute','own_place'));

-- Point 10: when the class really started and ended.
alter table sessions add column if not exists started_at timestamptz;
alter table sessions add column if not exists ended_at   timestamptz;

-- Point 11: receipts, the Online method, and Undo.
alter table payments add column if not exists receipt_no  int;
alter table payments add column if not exists reversed_at timestamptz;

alter table payments drop constraint if exists payments_method_check;
alter table payments add  constraint payments_method_check
  check (method in ('Bank transfer','Cash','Online','Slip'));

create unique index if not exists payments_receipt_uq
  on payments(teacher_id, receipt_no) where receipt_no is not null;

-- The student's Paid / Unpaid, set by hand (migration 006). Added before the
-- views below, because v_students is built from s.* and must pick it up.
--
-- Only on the run that adds the column, a student whose ledger is settled by
-- a real payment starts as Paid - that is what the screen already said about
-- them. Everyone else, including every student with nothing on the ledger,
-- starts Unpaid. Later runs leave whatever the teacher has set alone.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'students'
                    and column_name = 'fee_status') then
    alter table students add column fee_status text not null default 'unpaid';
    update students s
       set fee_status = 'paid'
      from student_dues d
     where d.student_id = s.id and d.amount_due = 0 and d.paid_total > 0;
  end if;
end $$;
alter table students drop constraint if exists students_fee_status_check;
alter table students add  constraint students_fee_status_check
  check (fee_status in ('unpaid','paid'));

-- Number the payments that were taken before receipts existed.
update payments p
   set receipt_no = n.rn
  from (
    select id, row_number() over (partition by teacher_id order by created_at, id) as rn
      from payments
     where receipt_no is null
  ) n
 where n.id = p.id
   and p.receipt_no is null;


-- ===========================================================================
--  Views - the business rules of sections 7.2 / 7.3 / 7.4, computed in SQL so
--  every view of the app shows exactly the same numbers.
-- ===========================================================================

-- Amount due, pending classes and days late, by FIFO allocation of payments
-- against charges (oldest charge paid first).
create or replace view student_dues as
with pay as (
  select student_id, sum(amount) as paid
  from payments where reversed_at is null group by student_id
), ch as (
  select c.student_id, c.teacher_id, c.amount, c.charge_date,
         sum(c.amount) over (partition by c.student_id
                             order by c.charge_date, c.id) as cum
  from charges c
)
select
  ch.student_id,
  ch.teacher_id,
  count(*) filter (where ch.cum > coalesce(pay.paid, 0))              as pending_classes,
  greatest(0, sum(ch.amount) - coalesce(max(pay.paid), 0))            as amount_due,
  min(ch.charge_date) filter (where ch.cum > coalesce(pay.paid, 0))   as oldest_unpaid,
  sum(ch.amount)                                                     as charged_total,
  coalesce(max(pay.paid), 0)                                         as paid_total
from ch
left join pay on pay.student_id = ch.student_id
group by ch.student_id, ch.teacher_id;


-- The last 8 attendance results as a 'PPAPPAPA' string, oldest first
-- (rule 7.3: attendance %, streak and "at risk" all read this window).
create or replace view student_history as
select student_id,
       string_agg(case when present then 'P' else 'A' end, '' order by session_date, sid) as hist
from (
  select a.student_id, a.present, s.session_date, s.id as sid,
         row_number() over (partition by a.student_id
                            order by s.session_date desc, s.id desc) as rn
  from attendance a
  join sessions s on s.id = a.session_id
  where s.status = 'done'
) x
where rn <= 8
group by student_id;

-- Lifetime attendance, for the progress report message.
create or replace view student_attendance_totals as
select a.student_id,
       count(*)                                 as total_classes,
       count(*) filter (where a.present)        as present_classes
from attendance a
join sessions s on s.id = a.session_id and s.status = 'done'
group by a.student_id;

-- Average / first / latest mark percentage (rule 7.4.3).
create or replace view student_marks_summary as
select student_id,
       count(*)                                                as mark_count,
       round(avg(score / max_score * 100))                     as avg_pct,
       round(max(score / max_score * 100))                     as best_pct,
       round((array_agg(score / max_score * 100 order by taken_on, id))[1])      as first_pct,
       round((array_agg(score / max_score * 100 order by taken_on desc, id desc))[1]) as latest_pct
from marks
group by student_id;

-- One row per student with everything the screens need.
--
-- `create or replace view` can only add columns to the end of a view: it
-- cannot reorder or rename them. This view is built from `s.*`, so the moment
-- a column is added to `students` anywhere but the end, the expansion shifts
-- and a replace fails with
--
--     cannot change name of view column "amount_due" to "call_name"
--
-- Dropping it first is therefore not optional, and this is the only view here
-- that needs it - every other one lists its columns explicitly. Nothing in the
-- database depends on v_students (the app reads it over PostgREST), so the
-- drop needs no CASCADE; if it ever complains about a dependency, that
-- dependency is new and wants looking at rather than cascading away.
drop view if exists v_students;
create view v_students as
select
  s.*,
  coalesce(d.amount_due, 0)                             as amount_due,
  coalesce(d.pending_classes, 0)                        as pending_classes,
  d.oldest_unpaid,
  coalesce(d.paid_total, 0)                             as paid_total,
  -- Counted in the teacher's own timezone, so "32 days late" means the same
  -- thing here as it does on the phone. Change the zone with the app's
  -- APP_TIMEZONE if you deploy somewhere else.
  case when d.oldest_unpaid is null then 0
       else greatest(0, ((now() at time zone 'Asia/Colombo')::date - d.oldest_unpaid))
  end as days_late,
  coalesce(h.hist, '')                                  as hist,
  coalesce(t.total_classes, 0)                          as total_classes,
  coalesce(t.present_classes, 0)                        as present_classes,
  coalesce(m.mark_count, 0)                             as mark_count,
  m.avg_pct, m.best_pct, m.first_pct, m.latest_pct
from students s
left join student_dues              d on d.student_id = s.id
left join student_history           h on h.student_id = s.id
left join student_attendance_totals t on t.student_id = s.id
left join student_marks_summary     m on m.student_id = s.id;

-- Money collected / still owed per calendar month, from the ledger
-- (replaces the prototype's hard-coded "earlier months" numbers).
create or replace view teacher_months as
select teacher_id,
       to_char(month, 'YYYY-MM') as month,
       sum(collected)            as collected,
       sum(charged)              as charged
from (
  select teacher_id, date_trunc('month', paid_date)   as month, sum(amount) as collected, 0 as charged
    from payments where reversed_at is null group by teacher_id, 2
  union all
  select teacher_id, date_trunc('month', charge_date) as month, 0 as collected, sum(amount) as charged
    from charges  group by teacher_id, 2
) x
group by teacher_id, month
order by month;

-- Point 10: the hours the teacher actually taught, from the real clock times,
-- falling back to the scheduled length for a class recorded the old way.
create or replace view teacher_taught as
select s.teacher_id,
       s.id          as session_id,
       s.class_id,
       s.session_date,
       s.started_at,
       s.ended_at,
       case
         when s.started_at is not null and s.ended_at > s.started_at
         then round(extract(epoch from (s.ended_at - s.started_at)) / 3600.0, 2)
         else c.duration_hours
       end as hours
from sessions s
join classes c on c.id = s.class_id
where s.status = 'done';


-- ===========================================================================
--  Transactional writes - run as one statement so a half-saved class can
--  never happen (rule 7.2.2: attendance + charges + events together).
-- ===========================================================================

drop function if exists finish_class(uuid, uuid, date, uuid[]);

-- Finish a class: mark the session done, store the real start and end times,
-- write one attendance row per student, and charge everyone who was present.
create or replace function finish_class(
  p_teacher uuid,
  p_class   uuid,
  p_date    date,
  p_absent  uuid[],
  p_started timestamptz default null,
  p_ended   timestamptz default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_session uuid;
  v_student record;
  v_absent  boolean;
  v_subject text;
begin
  select subject into v_subject from classes
   where id = p_class and teacher_id = p_teacher;
  if v_subject is null then
    raise exception 'class not found for this teacher';
  end if;

  insert into sessions (class_id, teacher_id, session_date, status, done_at, started_at, ended_at)
  values (p_class, p_teacher, p_date, 'done', now(),
          p_started, coalesce(p_ended, now()))
  on conflict (class_id, session_date)
    do update set status     = 'done',
                  done_at    = now(),
                  -- Keep a start time that was already recorded by "Start
                  -- class"; only fill it in when there is none.
                  started_at = coalesce(sessions.started_at, excluded.started_at),
                  ended_at   = coalesce(excluded.ended_at, sessions.ended_at, now())
  returning id into v_session;

  -- Re-marking a session replaces the previous result cleanly.
  delete from attendance where session_id = v_session;
  delete from charges    where session_id = v_session;

  for v_student in
    select st.id, st.fee_per_class
      from class_students cs
      join students st on st.id = cs.student_id
     where cs.class_id = p_class
  loop
    v_absent := v_student.id = any (coalesce(p_absent, '{}'::uuid[]));

    insert into attendance (session_id, student_id, present)
    values (v_session, v_student.id, not v_absent);

    -- Rule 7.2.2: only a student who was present is charged for the class.
    if not v_absent then
      insert into charges (teacher_id, student_id, session_id, amount, charge_date, note)
      values (p_teacher, v_student.id, v_session, v_student.fee_per_class, p_date,
              v_subject || ' class');
    end if;
  end loop;

  return v_session;
end $$;

-- Point 10: "Start class" records the real start time without finishing
-- anything, so the session can sit in progress for as long as it takes.
create or replace function start_class(
  p_teacher uuid,
  p_class   uuid,
  p_date    date
) returns timestamptz
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_started timestamptz;
begin
  if not exists (select 1 from classes where id = p_class and teacher_id = p_teacher) then
    raise exception 'class not found for this teacher';
  end if;

  insert into sessions (class_id, teacher_id, session_date, status, started_at)
  values (p_class, p_teacher, p_date, 'planned', now())
  on conflict (class_id, session_date)
    -- Tapping Start twice must not restart the clock.
    do update set started_at = coalesce(sessions.started_at, now())
  returning started_at into v_started;

  return v_started;
end $$;


drop function if exists record_payment(uuid, uuid, int, numeric, text);

create or replace function record_payment(
  p_teacher   uuid,
  p_student   uuid,
  p_classes   int,
  p_amount    numeric,
  p_method    text,
  p_paid_date date default null
) returns json
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_amount  numeric;
  v_due     numeric;
  v_receipt int;
  v_id      uuid;
begin
  if not exists (select 1 from students where id = p_student and teacher_id = p_teacher) then
    raise exception 'student not found for this teacher';
  end if;

  select coalesce(amount_due, 0) into v_due from student_dues where student_id = p_student;
  v_due := coalesce(v_due, 0);

  if p_amount is not null then
    v_amount := p_amount;
  elsif p_classes is not null then
    -- Sum the p_classes oldest unpaid charges, so a past fee change stays correct.
    with pay as (select coalesce(sum(amount), 0) paid
                   from payments where student_id = p_student and reversed_at is null),
         ch  as (select c.amount,
                        sum(c.amount) over (order by c.charge_date, c.id) cum
                   from charges c where c.student_id = p_student)
    select coalesce(sum(amount), 0) into v_amount
      from (select amount from ch, pay
             where ch.cum > pay.paid
             order by ch.cum limit p_classes) y;
  else
    v_amount := v_due;
  end if;

  -- Point 11: a part payment is kept as typed; an over-payment is clamped to
  -- what is owed, so a slipped digit can never create a credit.
  v_amount := least(greatest(v_amount, 0), v_due);
  if v_amount <= 0 then
    raise exception 'nothing is owed';
  end if;

  select coalesce(max(receipt_no), 0) + 1 into v_receipt
    from payments where teacher_id = p_teacher;

  insert into payments (teacher_id, student_id, amount, method, paid_date, receipt_no)
  values (p_teacher, p_student, v_amount,
          coalesce(p_method, 'Bank transfer'),
          coalesce(p_paid_date, (now() at time zone 'Asia/Colombo')::date),
          v_receipt)
  returning id into v_id;

  -- Nothing owed any more: clear the slip and the reminder note (rule 7.2.5).
  if v_amount >= v_due then
    update students
       set slip_path = null, slip_sent_at = null, last_reminded_at = null
     where id = p_student;
  end if;

  return json_build_object(
    'payment_id', v_id,
    'amount',     v_amount,
    'receipt_no', v_receipt,
    'balance',    v_due - v_amount,
    'full',       v_amount >= v_due
  );
end $$;

-- Point 11: Undo. The row stays, marked reversed, so the student's payment
-- history still explains every change to the balance.
create or replace function reverse_payment(
  p_teacher uuid,
  p_payment uuid
) returns json
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_row payments%rowtype;
begin
  select * into v_row from payments
   where id = p_payment and teacher_id = p_teacher;
  if v_row.id is null then
    raise exception 'payment not found for this teacher';
  end if;
  if v_row.reversed_at is not null then
    raise exception 'that payment was already undone';
  end if;

  update payments set reversed_at = now() where id = p_payment;

  return json_build_object(
    'payment_id', v_row.id,
    'amount',     v_row.amount,
    'student_id', v_row.student_id,
    'receipt_no', v_row.receipt_no
  );
end $$;


-- ===========================================================================
--  Plus App v3 - subscriptions and the Income screens.
--
--  A parent subscribes to Plus monthly. The teacher keeps a share of it, and
--  the Income tab is about that share growing: how many students are on Plus,
--  how fast it is growing against tuition, and who is left to invite.
--
--  Money the parent pays the TEACHER for lessons stays where it was, in
--  charges and payments. This is a separate, second stream and never mixes
--  with the fee ledger.
--
--  Every statement is safe to run again.
-- ===========================================================================

-- What a Plus subscription costs, and what the teacher keeps of it. Held on
-- the teacher so a pilot can price differently per teacher without a deploy.
alter table teachers add column if not exists plus_price   numeric(10,2) not null default 500;
alter table teachers add column if not exists plus_share   numeric(4,3)  not null default 0.5;
-- When this teacher started on Plus: the Income graph counts from here.
alter table teachers add column if not exists plus_since   date;

update teachers set plus_since = created_at::date where plus_since is null;

-- ------------------------------------------------------------ subscriptions
-- One row per student per subscription period. A parent who stops and starts
-- again gets a second row, so the history stays true and the monthly counts
-- can be rebuilt for any month.
create table if not exists subscriptions (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid        not null references teachers(id) on delete cascade,
  student_id  uuid        not null references students(id) on delete cascade,
  status      text        not null default 'active'
                check (status in ('active','ended')),
  -- The amount agreed at the time, so a later price change cannot rewrite
  -- what a teacher already earned.
  price       numeric(10,2) not null default 500,
  share       numeric(4,3)  not null default 0.5,
  started_on  date        not null default current_date,
  ended_on    date,
  note        text,
  created_at  timestamptz not null default now(),
  constraint subscriptions_period_ck
    check (ended_on is null or ended_on >= started_on),
  constraint subscriptions_ended_ck
    check ((status = 'ended') = (ended_on is not null))
);
create index if not exists subscriptions_teacher_idx on subscriptions(teacher_id, status);
create index if not exists subscriptions_student_idx on subscriptions(student_id, started_on);

-- A student can only be subscribed once at a time.
create unique index if not exists subscriptions_one_active_uq
  on subscriptions(student_id) where status = 'active';

-- ---------------------------------------------------------------- the rule
-- "There are no free parents in the app": the family screens are for
-- subscribers. This view is the single place that decides.
create or replace view student_plus as
select s.id          as student_id,
       s.teacher_id,
       (sub.id is not null) as on_plus,
       sub.started_on,
       sub.price,
       sub.share
from students s
left join subscriptions sub
       on sub.student_id = s.id and sub.status = 'active';

-- ------------------------------------------------- how many, month by month
-- One row per teacher per month: how many students were on Plus at the end of
-- it, and what the teacher's share came to. A subscription counts for a month
-- if it had started by the end of it and had not ended before it began.
create or replace view teacher_plus_months as
with months as (
  select t.id as teacher_id,
         generate_series(
           date_trunc('month', coalesce(t.plus_since, t.created_at::date)),
           date_trunc('month', (now() at time zone 'Asia/Colombo')::date),
           interval '1 month'
         )::date as month
  from teachers t
)
select m.teacher_id,
       to_char(m.month, 'YYYY-MM') as month,
       count(sub.id)                                    as students,
       coalesce(sum(sub.price * sub.share), 0)          as teacher_income,
       coalesce(sum(sub.price), 0)                      as gross
from months m
left join subscriptions sub
       on sub.teacher_id = m.teacher_id
      and sub.started_on < (m.month + interval '1 month')
      and (sub.ended_on is null or sub.ended_on >= m.month)
group by m.teacher_id, m.month
order by m.month;

-- ------------------------------------------ tuition, month by month, to
-- compare against. This is the existing fee ledger, not Plus money.
create or replace view teacher_tuition_months as
select teacher_id,
       to_char(date_trunc('month', charge_date), 'YYYY-MM') as month,
       sum(amount) as charged
from charges
group by teacher_id, 2
order by 2;


-- ===========================================================================
--  Writes. A subscription is recorded by hand, the way a bank slip is: the
--  teacher or an admin marks it, and the row is the record.
-- ===========================================================================

create or replace function start_subscription(
  p_teacher uuid,
  p_student uuid,
  p_price   numeric default null,
  p_note    text    default null
) returns json
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_price numeric;
  v_share numeric;
  v_id    uuid;
  v_count int;
begin
  if not exists (select 1 from students where id = p_student and teacher_id = p_teacher) then
    raise exception 'student not found for this teacher';
  end if;
  if exists (select 1 from subscriptions where student_id = p_student and status = 'active') then
    raise exception 'that student is already on Plus';
  end if;

  select coalesce(p_price, plus_price), plus_share into v_price, v_share
    from teachers where id = p_teacher;

  insert into subscriptions (teacher_id, student_id, price, share, note)
  values (p_teacher, p_student, v_price, v_share, p_note)
  returning id into v_id;

  select count(*) into v_count
    from subscriptions where teacher_id = p_teacher and status = 'active';

  return json_build_object(
    'subscription_id', v_id,
    'price',           v_price,
    'share',           v_share,
    'students',        v_count
  );
end $$;

create or replace function end_subscription(
  p_teacher uuid,
  p_student uuid
) returns json
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_id    uuid;
  v_count int;
begin
  select id into v_id from subscriptions
   where student_id = p_student and teacher_id = p_teacher and status = 'active';
  if v_id is null then
    raise exception 'that student is not on Plus';
  end if;

  -- Ended, never deleted: the month it was paid for still counts.
  update subscriptions
     set status = 'ended', ended_on = (now() at time zone 'Asia/Colombo')::date
   where id = v_id;

  select count(*) into v_count
    from subscriptions where teacher_id = p_teacher and status = 'active';

  return json_build_object('subscription_id', v_id, 'students', v_count);
end $$;


-- ===========================================================================
--  Grandfathering.
--
--  Every family already using the app keeps it. Without this, turning the
--  subscriber rule on would lock out every parent who has a code today -
--  which is a thing to decide, not a thing to do by accident.
--
--  It runs once: the marker on the teacher stops a later re-run from
--  re-subscribing a family that has since stopped paying.
-- ===========================================================================
alter table teachers add column if not exists plus_grandfathered_at timestamptz;

insert into subscriptions (teacher_id, student_id, price, share, started_on, note)
select s.teacher_id, s.id, t.plus_price, t.plus_share,
       coalesce(t.plus_since, s.created_at::date),
       'Already using the app before Plus subscriptions'
  from students s
  join teachers t on t.id = s.teacher_id
 where s.status = 'active'
   and t.plus_grandfathered_at is null
   and not exists (select 1 from subscriptions x where x.student_id = s.id)
   and exists (select 1 from family_children fc where fc.student_id = s.id);

update teachers set plus_grandfathered_at = now() where plus_grandfathered_at is null;


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


-- ===========================================================================
--  Plus App v5 - teachers sign themselves up.
--
--  Until now a teacher existed only because somebody made them: a row in SQL,
--  or the Plus team's onboarding wizard. This adds self-service sign-up, and
--  with it a credential worth having.
--
--  Families keep their 4-digit code. That is the right trade for a parent on
--  a shared phone looking at data their teacher already shows them. It is the
--  wrong trade for a teacher: the code is the whole account, there are only
--  9,000 of them, they must be unique across the deployment, and open sign-up
--  would let somebody walk the space. Teachers get an email and a password.
--
--  Safe to run again.
-- ===========================================================================

alter table teachers add column if not exists password_hash text;
alter table teachers add column if not exists password_salt text;

-- One account per email, however it was typed. Partial, because every teacher
-- made before this - and anyone the team onboards without one - has no email.
create unique index if not exists teachers_email_uq
  on teachers (lower(email)) where email is not null;

-- A teacher can sign in with a code, a password, or both. The code path stays
-- so existing accounts keep working and the demo login still does.
comment on column teachers.password_hash is
  'scrypt(password, password_salt + LOGIN_PEPPER). Null for accounts that only have a code.';


-- ===========================================================================
--  Plus App v7 - the owner's admin dashboard.
--
--  The dashboard can see every teacher and every rupee, and can pause an
--  account, so it gets an identity of its own rather than borrowing the
--  teacher login:
--
--    admins                 email + scrypt password + TOTP secret (encrypted
--                           by the server; this table never holds it in clear)
--    admin_recovery_codes   ten single-use codes, stored as keyed hashes
--    admin_sessions         server-side sessions, so one can be listed and
--                           revoked; only a keyed hash of the token is kept
--    admin_audit            every sign-in and every action. Append-only: a
--                           trigger refuses UPDATE, DELETE and TRUNCATE, even
--                           from the service role
--    ai_reviews             one row per "Review with AI", so the owner can
--                           see what the AI is costing
--
--  The figures the dashboard shows come from three functions, so a page is
--  one round trip and the arithmetic lives in SQL beside the views it uses.
--  None of them returns a child's name or a parent's phone number: the owner
--  runs the business and does not need to read the children's records.
--
--  `npm run db:push` applies schema.sql, which carries all of this too.
--  Safe to run again.
-- ===========================================================================

-- ------------------------------------------------------- teacher columns --
-- Paused by the owner. A paused teacher cannot sign in, and a session they
-- already hold stops working within a minute (api/_lib/active.js).
alter table teachers add column if not exists suspended_at     timestamptz;
alter table teachers add column if not exists suspended_reason text;
-- Shown to the owner so a teacher who stopped using the app is visible.
alter table teachers add column if not exists last_login_at    timestamptz;

-- ---------------------------------------------------------------- admins --
create table if not exists admins (
  id               uuid primary key default gen_random_uuid(),
  email            text        not null,
  name             text,
  -- owner: everything. viewer: reads the dashboard, changes nothing.
  role             text        not null default 'owner' check (role in ('owner','viewer')),
  -- scrypt$<log2N>$<r>$<p>$<salt>$<hash>, over HMAC(pepper, password).
  password_hash    text,
  -- AES-256-GCM, sealed by the server with a key derived from
  -- ADMIN_SECRET_KEY and bound to this row's id. Useless without both.
  totp_secret      text,
  totp_pending     text,                 -- during setup, until the first code proves it
  totp_last_step   bigint,               -- a code can be used once, never replayed
  setup_token_hash text,                 -- one-time setup link, keyed hash only
  setup_expires_at timestamptz,
  failed_count     int         not null default 0,
  locked_until     timestamptz,
  disabled_at      timestamptz,
  last_login_at    timestamptz,
  last_login_ip    text,
  created_at       timestamptz not null default now()
);
create unique index if not exists admins_email_uq on admins (lower(email));
create unique index if not exists admins_setup_uq on admins (setup_token_hash)
  where setup_token_hash is not null;

create table if not exists admin_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid        not null references admins(id) on delete cascade,
  code_hash  text        not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists admin_recovery_codes_uq on admin_recovery_codes (admin_id, code_hash);

create table if not exists admin_sessions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid        not null references admins(id) on delete cascade,
  token_hash   text        not null unique,
  ip           text,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index if not exists admin_sessions_admin_idx on admin_sessions (admin_id, expires_at desc);

-- No foreign key on admin_id: deleting an admin must not have to rewrite (and
-- so be blocked from rewriting) the history of what they did.
create table if not exists admin_audit (
  id         bigserial primary key,
  admin_id   uuid,
  email      text,
  action     text        not null,
  target     text,
  ok         boolean     not null default true,
  ip         text,
  user_agent text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on admin_audit (created_at desc);

create or replace function admin_audit_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'admin_audit is append-only';
end $$;

drop trigger if exists admin_audit_no_change on admin_audit;
create trigger admin_audit_no_change
  before update or delete on admin_audit
  for each row execute function admin_audit_append_only();
drop trigger if exists admin_audit_no_truncate on admin_audit;
create trigger admin_audit_no_truncate
  before truncate on admin_audit
  for each statement execute function admin_audit_append_only();

-- ------------------------------------------------------------ ai_reviews --
create table if not exists ai_reviews (
  id         bigserial primary key,
  teacher_id uuid        references teachers(id) on delete set null,
  model      text,
  fallback   boolean     not null default false,
  pages      int         not null default 0,
  ms         int,
  ok         boolean     not null default true,
  status     int,
  created_at timestamptz not null default now()
);
create index if not exists ai_reviews_created_idx on ai_reviews (created_at desc);
create index if not exists ai_reviews_teacher_idx on ai_reviews (teacher_id, created_at desc);


-- ===========================================================================
--  The dashboard's figures.
--  security invoker: they read with the caller's rights, so even if one were
--  ever reachable by a browser key, row level security would return nothing.
-- ===========================================================================

create or replace function admin_overview() returns json
language sql stable security invoker
set search_path = public, pg_temp as $$
with
  d as (select (now() at time zone 'Asia/Colombo')::date as today),
  t as (
    select count(*)                                                   as total,
           count(*) filter (where suspended_at is not null)           as suspended,
           count(*) filter (where created_at >= now() - interval '30 days') as new_30d,
           count(*) filter (where last_login_at >= now() - interval '30 days') as signed_in_30d
      from teachers
  ),
  ta as (
    select count(distinct teacher_id) as teaching_30d
      from sessions, d
     where status = 'done' and session_date > d.today - 30
  ),
  st as (
    select count(*) filter (where status = 'active')  as active,
           count(*) filter (where status = 'pending') as pending,
           count(*) filter (where status <> 'archived'
                              and created_at >= now() - interval '30 days') as new_30d
      from students
  ),
  fam as (
    select count(*) as accounts,
           count(*) filter (where last_login_at >= now() - interval '30 days') as active_30d
      from family_accounts
  ),
  sub as (
    select count(*)                          as active,
           coalesce(sum(price), 0)           as gross,
           coalesce(sum(price * share), 0)   as teachers_share
      from subscriptions where status = 'active'
  ),
  cls as (select count(*) as active from classes where active),
  ses as (
    select count(*) as done_30d
      from sessions, d where status = 'done' and session_date > d.today - 30
  ),
  hrs as (
    select coalesce(sum(hours), 0) as taught_30d
      from teacher_taught, d where session_date > d.today - 30
  ),
  att as (
    select count(*) as marked, count(*) filter (where a.present) as present
      from attendance a
      join sessions s on s.id = a.session_id, d
     where s.status = 'done' and s.session_date > d.today - 30
  ),
  money as (
    select
      (select coalesce(sum(amount), 0) from charges, d
        where charge_date >= date_trunc('month', d.today))                     as charged_month,
      (select coalesce(sum(amount), 0) from payments, d
        where reversed_at is null and paid_date >= date_trunc('month', d.today)) as collected_month,
      (select coalesce(sum(amount_due), 0) from student_dues)                    as outstanding
  ),
  ai as (
    select count(*)                          as reviews_30d,
           count(*) filter (where fallback)  as fallback_30d,
           count(*) filter (where not ok)    as failed_30d,
           round(avg(ms) filter (where ok))  as avg_ms
      from ai_reviews where created_at >= now() - interval '30 days'
  ),
  msg as (
    select count(*) filter (where channel = 'whatsapp')          as whatsapp_30d,
           count(*) filter (where delivery_status = 'sent')      as sent_30d,
           count(*) filter (where delivery_status = 'manual')    as manual_30d,
           count(*) filter (where delivery_status = 'failed')    as failed_30d
      from events where created_at >= now() - interval '30 days'
  ),
  lg as (
    select count(*) filter (where not ok)                    as failed_24h,
           count(*) filter (where not ok and role = 'admin') as admin_failed_24h
      from login_attempts where created_at >= now() - interval '24 hours'
  ),
  months as (
    select generate_series(date_trunc('month', d.today) - interval '11 months',
                           date_trunc('month', d.today),
                           interval '1 month')::date as m
      from d
  ),
  series as (
    select m.m,
           (select count(*) from subscriptions x
             where x.started_on < (m.m + interval '1 month')
               and (x.ended_on is null or x.ended_on >= m.m))                        as plus,
           (select coalesce(sum(x.price), 0) from subscriptions x
             where x.started_on < (m.m + interval '1 month')
               and (x.ended_on is null or x.ended_on >= m.m))                        as plus_gross,
           (select count(*) from teachers x
             where x.created_at >= m.m and x.created_at < (m.m + interval '1 month')) as new_teachers,
           (select coalesce(sum(p.amount), 0) from payments p
             where p.reversed_at is null
               and p.paid_date >= m.m and p.paid_date < (m.m + interval '1 month'))   as collected,
           (select count(*) from ai_reviews r
             where r.created_at >= m.m and r.created_at < (m.m + interval '1 month')) as ai_reviews
      from months m
  )
select json_build_object(
  'today',     (select today from d),
  'teachers',  json_build_object('total', t.total, 'suspended', t.suspended, 'new_30d', t.new_30d,
                                 'signed_in_30d', t.signed_in_30d, 'teaching_30d', ta.teaching_30d),
  'students',  json_build_object('active', st.active, 'pending', st.pending, 'new_30d', st.new_30d),
  'families',  json_build_object('accounts', fam.accounts, 'active_30d', fam.active_30d),
  'plus',      json_build_object('active', sub.active, 'gross', sub.gross,
                                 'teachers_share', sub.teachers_share,
                                 'company_share', sub.gross - sub.teachers_share),
  'teaching',  json_build_object('classes', cls.active, 'sessions_30d', ses.done_30d,
                                 'hours_30d', hrs.taught_30d,
                                 'attendance_pct', case when att.marked > 0
                                   then round(100.0 * att.present / att.marked) end),
  'tuition',   json_build_object('charged_month', money.charged_month,
                                 'collected_month', money.collected_month,
                                 'outstanding', money.outstanding),
  'ai',        json_build_object('reviews_30d', ai.reviews_30d, 'fallback_30d', ai.fallback_30d,
                                 'failed_30d', ai.failed_30d, 'avg_ms', ai.avg_ms),
  'messages',  json_build_object('whatsapp_30d', msg.whatsapp_30d, 'sent_30d', msg.sent_30d,
                                 'manual_30d', msg.manual_30d, 'failed_30d', msg.failed_30d),
  'security',  json_build_object('failed_logins_24h', lg.failed_24h,
                                 'admin_failed_24h', lg.admin_failed_24h),
  'months',    (select json_agg(json_build_object(
                   'month', to_char(s.m, 'YYYY-MM'), 'plus', s.plus, 'plus_gross', s.plus_gross,
                   'new_teachers', s.new_teachers, 'collected', s.collected,
                   'ai_reviews', s.ai_reviews) order by s.m)
                  from series s)
)
from t, ta, st, fam, sub, cls, ses, hrs, att, money, ai, msg, lg;
$$;

-- One row per teacher, or just one teacher when an id is given.
create or replace function admin_teachers(p_id uuid default null) returns json
language sql stable security invoker
set search_path = public, pg_temp as $$
select coalesce(json_agg(row_to_json(x) order by x.created_at desc), '[]'::json)
from (
  select t.id, t.title, t.name, t.email, t.phone, t.school,
         t.own_place_area                        as area,
         t.subjects, t.lang, t.join_key,
         t.created_at, t.plus_since, t.onboarded_at, t.last_login_at,
         t.suspended_at, t.suspended_reason,
         t.plus_price, t.plus_share,
         (t.password_hash is not null)           as has_password,
         (t.code_hash is not null)               as has_code,
         (select count(*) from students s where s.teacher_id = t.id and s.status = 'active')  as students,
         (select count(*) from students s where s.teacher_id = t.id and s.status = 'pending') as pending,
         (select count(*) from subscriptions x where x.teacher_id = t.id and x.status = 'active') as plus_active,
         (select count(*) from classes c where c.teacher_id = t.id and c.active)               as classes,
         (select count(*) from sessions z
           where z.teacher_id = t.id and z.status = 'done'
             and z.session_date > (now() at time zone 'Asia/Colombo')::date - 30)              as sessions_30d,
         (select max(z.session_date) from sessions z
           where z.teacher_id = t.id and z.status = 'done')                                    as last_class,
         (select coalesce(sum(p.amount), 0) from payments p
           where p.teacher_id = t.id and p.reversed_at is null
             and p.paid_date > (now() at time zone 'Asia/Colombo')::date - 30)                 as collected_30d,
         (select count(*) from ai_reviews a
           where a.teacher_id = t.id and a.created_at >= now() - interval '30 days')           as ai_30d
    from teachers t
   where p_id is null or t.id = p_id
) x;
$$;

-- One teacher in full: the row above, twelve months of figures, and their
-- classes as shapes (no student names).
create or replace function admin_teacher(p_id uuid) returns json
language sql stable security invoker
set search_path = public, pg_temp as $$
with
  d as (select (now() at time zone 'Asia/Colombo')::date as today),
  months as (
    select generate_series(date_trunc('month', d.today) - interval '11 months',
                           date_trunc('month', d.today), interval '1 month')::date as m
      from d
  )
select case when not exists (select 1 from teachers where id = p_id) then null else
json_build_object(
  'teacher', admin_teachers(p_id) -> 0,
  'months', (
    select json_agg(json_build_object(
             'month', to_char(m.m, 'YYYY-MM'),
             'plus', (select count(*) from subscriptions x
                       where x.teacher_id = p_id
                         and x.started_on < (m.m + interval '1 month')
                         and (x.ended_on is null or x.ended_on >= m.m)),
             'charged', (select coalesce(sum(c.amount), 0) from charges c
                          where c.teacher_id = p_id
                            and c.charge_date >= m.m and c.charge_date < (m.m + interval '1 month')),
             'collected', (select coalesce(sum(p.amount), 0) from payments p
                            where p.teacher_id = p_id and p.reversed_at is null
                              and p.paid_date >= m.m and p.paid_date < (m.m + interval '1 month')),
             'sessions', (select count(*) from sessions z
                           where z.teacher_id = p_id and z.status = 'done'
                             and z.session_date >= m.m and z.session_date < (m.m + interval '1 month'))
           ) order by m.m)
      from months m
  ),
  'classes', (
    select coalesce(json_agg(json_build_object(
             'id', c.id, 'title', c.title, 'subject', c.subject, 'grade', c.grade,
             'kind', c.kind, 'days', c.days, 'once_date', c.once_date, 'start_time', c.start_time,
             'duration_hours', c.duration_hours, 'venue_type', c.venue_type,
             'area', c.area, 'active', c.active, 'setup_pending', c.setup_pending,
             'students', (select count(*) from class_students cs where cs.class_id = c.id)
           ) order by c.active desc, c.title), '[]'::json)
      from classes c where c.teacher_id = p_id
  )
) end;
$$;


-- ===========================================================================
--  Locking it down.
-- ===========================================================================
alter table admins               enable row level security;
alter table admin_recovery_codes enable row level security;
alter table admin_sessions       enable row level security;
alter table admin_audit          enable row level security;
alter table ai_reviews           enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- A function is executable by PUBLIC unless that is taken away, and revoking
-- from anon and authenticated alone leaves the PUBLIC grant standing. Every
-- function this app defines is for the server only: take it from everyone,
-- and give it back to the service role the API uses.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('finish_class','start_class','record_payment','reverse_payment',
                         'start_subscription','end_subscription',
                         'admin_overview','admin_teachers','admin_teacher',
                         'admin_audit_append_only')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;


-- ===========================================================================
--  Plus App v8 - real accounts for parents and students, revocable sessions,
--  and a way back in for a teacher who forgot their password.
--
--  Until now a family shared one code: the same digits opened the parent and
--  the student view, and a student could switch to the parent's and send a
--  "payment" slip. Sessions were signed cookies with no server record, so a
--  changed code or a lost phone could not end a session that was already open.
--
--    accounts           one row per person. A parent signs in with their
--                       mobile number, a student with a username their parent
--                       chose. Both have their own password.
--    account_children   which students an account may see. A parent with
--                       children at two teachers has one account for both.
--    account_invites    a one-time, expiring 6-digit code a teacher sends on
--                       WhatsApp. It proves the phone belongs to that child's
--                       parent; the parent then sets their own password.
--    login_sessions     server-side sessions for teachers, parents and
--                       students. Only a keyed hash of the token is stored.
--                       (Not "sessions": that table holds class sessions.)
--    password_resets    one-time links for a teacher's forgotten password.
--
--  Safe to run again. (Also in supabase/migrations/008-accounts.sql.)
-- ===========================================================================

-- ------------------------------------------------------------------ accounts
create table if not exists accounts (
  id               uuid primary key default gen_random_uuid(),
  kind             text        not null check (kind in ('parent','student')),
  phone            text,                       -- parents: 947XXXXXXXX
  username         text,                       -- students: chosen by the parent
  display_name     text        not null,
  password_hash    text        not null,       -- scrypt, parameters in the string
  parent_id        uuid        references accounts(id) on delete cascade,
  lang             text        not null default 'en' check (lang in ('en','si','ta')),
  failed_logins    int         not null default 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  password_changed_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  constraint accounts_identity_ck check (
    (kind = 'parent'  and phone is not null and username is null and parent_id is null) or
    (kind = 'student' and username is not null and parent_id is not null)
  )
);
create unique index if not exists accounts_phone_uq    on accounts (phone)          where phone is not null;
create unique index if not exists accounts_username_uq on accounts (lower(username)) where username is not null;
create index        if not exists accounts_parent_idx  on accounts (parent_id)      where parent_id is not null;

create table if not exists account_children (
  account_id uuid not null references accounts(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, student_id)
);
create index if not exists account_children_student_idx on account_children (student_id);

-- ------------------------------------------------------------------ invites
create table if not exists account_invites (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid        not null references teachers(id) on delete cascade,
  student_id  uuid        not null references students(id) on delete cascade,
  phone       text        not null,              -- the parent number it was sent to
  code_lookup text        not null unique,       -- keyed hash, for an indexed find
  code_hash   text        not null,              -- scrypt, parameters in the string
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid        references accounts(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists account_invites_student_idx on account_invites (student_id, created_at desc);

-- ----------------------------------------------------------------- sessions
create table if not exists login_sessions (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text        not null unique,     -- keyed hash; the token itself is never stored
  subject_kind  text        not null check (subject_kind in ('teacher','parent','student')),
  subject_id    uuid        not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  ip            text,
  user_agent    text
);
create index if not exists login_sessions_subject_idx
  on login_sessions (subject_kind, subject_id) where revoked_at is null;

-- ---------------------------------------------------------- password resets
create table if not exists password_resets (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid        not null references teachers(id) on delete cascade,
  token_hash  text        not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists password_resets_teacher_idx on password_resets (teacher_id, created_at desc);

-- ------------------------------------------------- teachers: lockout, Sinhala
alter table teachers add column if not exists failed_logins       int not null default 0;
alter table teachers add column if not exists locked_until        timestamptz;
alter table teachers add column if not exists password_changed_at timestamptz;

-- The app now speaks Sinhala, so a teacher may choose it for their messages.
alter table teachers drop constraint if exists teachers_lang_check;
alter table teachers add  constraint teachers_lang_check check (lang in ('en','si','ta'));

-- ------------------------------------------------------------------ locking
-- Row level security with no policies: the anon key reads nothing. The app
-- reaches these tables only through the service role, from the server.
alter table accounts         enable row level security;
alter table account_children enable row level security;
alter table account_invites  enable row level security;
alter table login_sessions   enable row level security;
alter table password_resets  enable row level security;

revoke all on accounts, account_children, account_invites, login_sessions, password_resets
  from public, anon, authenticated;


-- ===========================================================================
--  Storage buckets (private - served through short-lived signed URLs).
-- ===========================================================================
insert into storage.buckets (id, name, public) values ('slips',  'slips',  false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('papers', 'papers', false)
  on conflict (id) do nothing;
-- Point 8: the optional student photo from the join form, already shrunk to a
-- small square on the phone before it was sent.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict (id) do nothing;


-- ===========================================================================
--  Row level security.
--  Every table is locked and NO policy is granted to anon / authenticated, so
--  the public anon key can read nothing at all. The app reaches the database
--  only through the serverless functions in /api, which hold the service role
--  key and scope every query by the signed session's teacher_id / child ids.
-- ===========================================================================
do $$
declare r record;
begin
  for r in
    select tablename from pg_tables
     where schemaname = 'public'
       and tablename in ('teachers','students','classes','class_students','class_exceptions',
                         'sessions','attendance','charges','payments','marks','events',
                         'papers','paper_sales','family_accounts','family_children',
                         'reschedule_requests','login_attempts','subscriptions',
                         'admins','admin_recovery_codes','admin_sessions','admin_audit',
                         'ai_reviews','accounts','account_children','account_invites',
                         'login_sessions','password_resets')
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

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
  lang               text        not null default 'en'   check (lang  in ('en','ta')),
  theme              text        not null default 'night' check (theme in ('night','day','auto')),
  auto_reminders     boolean     not null default true,
  remind_after_days  int         not null default 14     check (remind_after_days in (7,14,30)),
  code_lookup        text        unique,                  -- hmac(code, pepper): indexed lookup
  code_hash          text,                                -- scrypt(code, code_salt + pepper)
  code_salt          text,
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
  slip_path         text,                                  -- storage object path
  slip_sent_at      timestamptz,
  last_reminded_at  timestamptz,
  created_at        timestamptz not null default now()
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
               check (method in ('Bank transfer','Cash','Slip')),
  paid_date  date        not null default current_date,
  note       text,
  created_at timestamptz not null default now()
);
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


-- ===========================================================================
--  Views - the business rules of sections 7.2 / 7.3 / 7.4, computed in SQL so
--  every view of the app shows exactly the same numbers.
-- ===========================================================================

-- Amount due, pending classes and days late, by FIFO allocation of payments
-- against charges (oldest charge paid first).
create or replace view student_dues as
with pay as (
  select student_id, sum(amount) as paid
  from payments group by student_id
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
create or replace view v_students as
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
    from payments group by teacher_id, 2
  union all
  select teacher_id, date_trunc('month', charge_date) as month, 0 as collected, sum(amount) as charged
    from charges  group by teacher_id, 2
) x
group by teacher_id, month
order by month;


-- ===========================================================================
--  Transactional writes - run as one statement so a half-saved class can
--  never happen (rule 7.2.2: attendance + charges + events together).
-- ===========================================================================

-- Finish a class: mark the session done, write one attendance row per student,
-- charge every student who was present, and raise an event per absent student.
create or replace function finish_class(
  p_teacher uuid,
  p_class   uuid,
  p_date    date,
  p_absent  uuid[]
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

  insert into sessions (class_id, teacher_id, session_date, status, done_at)
  values (p_class, p_teacher, p_date, 'done', now())
  on conflict (class_id, session_date)
    do update set status = 'done', done_at = now()
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

-- Record a payment for the N oldest unpaid classes (or an exact amount).
create or replace function record_payment(
  p_teacher uuid,
  p_student uuid,
  p_classes int,
  p_amount  numeric,
  p_method  text
) returns numeric
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_amount numeric;
  v_due    numeric;
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
    with pay as (select coalesce(sum(amount), 0) paid from payments where student_id = p_student),
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

  v_amount := least(greatest(v_amount, 0), v_due);
  if v_amount <= 0 then
    raise exception 'nothing is owed';
  end if;

  insert into payments (teacher_id, student_id, amount, method)
  values (p_teacher, p_student, v_amount, p_method);

  -- Nothing owed any more: clear the slip and the reminder note (rule 7.2.5).
  if v_amount >= v_due then
    update students
       set slip_path = null, slip_sent_at = null, last_reminded_at = null
     where id = p_student;
  end if;

  return v_amount;
end $$;


-- ===========================================================================
--  Storage buckets (private - served through short-lived signed URLs).
-- ===========================================================================
insert into storage.buckets (id, name, public) values ('slips',  'slips',  false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('papers', 'papers', false)
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
                         'reschedule_requests','login_attempts')
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

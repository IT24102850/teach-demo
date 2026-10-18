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

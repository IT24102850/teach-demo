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

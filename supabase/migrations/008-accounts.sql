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
--  Safe to run again.
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

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

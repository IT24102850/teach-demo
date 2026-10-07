-- Fix classes_repeat_ck.
--
-- The original constraint read:
--   check (once_date is not null or array_length(days, 1) >= 1)
-- and array_length('{}', 1) is NULL in PostgreSQL, not 0. A CHECK that
-- evaluates to NULL passes, so a class with no weekdays and no single date
-- could be stored - and would then never appear on any calendar.
--
-- /api already refuses that input, so this is defence in depth rather than an
-- open hole. Safe to run more than once.

alter table classes drop constraint if exists classes_repeat_ck;
alter table classes add  constraint classes_repeat_ck
  check (once_date is not null or coalesce(array_length(days, 1), 0) >= 1);

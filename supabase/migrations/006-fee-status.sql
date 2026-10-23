-- ===========================================================================
--  Plus App v6 - a student's Paid / Unpaid is set by the teacher.
--
--  Until now the student list said "Paid" whenever the ledger showed nothing
--  owing. A student added this morning has no classes on the ledger, so they
--  showed as Paid before paying a rupee. This adds the status the teacher sets
--  by hand. Recording a payment that clears the balance also sets it, and
--  Undo on that payment clears it again.
--
--  v_students is built from s.*, so it has to be rebuilt to show the new
--  column. `npm run db:push` applies the whole of schema.sql, which does both;
--  that is the way to run this. The statements below are the column itself,
--  for reading or for running by hand before a push.
--
--  Safe to run again.
-- ===========================================================================

-- Only on the run that adds the column, a student whose ledger is settled by
-- a real payment starts as Paid - that is what the screen already said about
-- them. Everyone else starts Unpaid. Later runs leave the teacher's choice alone.
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

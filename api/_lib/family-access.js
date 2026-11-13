/**
 * Who a family request is from, and what it may reach.
 *
 * Worked out from the server-side session on every request, never from
 * anything the browser sends: the children an account may see come from
 * account_children, and the teacher is the one who teaches the child being
 * looked at. A `child_id` in a request is only a choice among those children.
 *
 *   parent   reads every linked child; sends slips; asks to reschedule;
 *            makes and manages each child's own student login.
 *   student  reads their own record. Cannot act for the family: no slips,
 *            no reschedule requests, no switching to the parent view.
 */

import * as db from './db.js';
import { readLoginSession } from './accounts.js';

/** Actions only a parent may take. */
export const PARENT_ONLY = new Set(['slip', 'reschedule']);

export async function familyAccess(req, requestedChild = null) {
  const session = await readLoginSession(req);
  if (!session || (session.kind !== 'parent' && session.kind !== 'student')) return null;

  const [account, links] = await Promise.all([
    db.selectOne('accounts', { select: 'id,kind,display_name,lang,parent_id', id: `eq.${session.sub}` }),
    db.select('account_children', { select: 'student_id', account_id: `eq.${session.sub}` }),
  ]);
  if (!account || account.kind !== session.kind) return null;

  const children = links.map((l) => l.student_id);
  if (!children.length) return null;

  const child = requestedChild && children.includes(requestedChild) ? requestedChild : children[0];
  const row = await db.selectOne('students', { select: 'id,teacher_id,status', id: `eq.${child}` });
  if (!row || row.status === 'archived') return null;

  return {
    sessionId: session.id,
    kind: session.kind,
    role: session.kind, // what the screens call it
    accountId: account.id,
    name: account.display_name,
    lang: account.lang,
    children,
    child,
    tid: row.teacher_id,
  };
}

/* ------------------------------------------------------------ the summary -- */

/** What the app needs straight after a family sign-in, and on every reload. */
export async function familySummary(accountId) {
  const [account, links] = await Promise.all([
    db.selectOne('accounts', { select: 'id,kind,display_name,lang', id: `eq.${accountId}` }),
    db.select('account_children', { select: 'student_id', account_id: `eq.${accountId}` }),
  ]);
  if (!account || !links.length) return null;
  const children = await db.select('students', {
    select: 'id,name,call_name,grade,area,subject,curriculum,teacher_id',
    id: db.inList(links.map((l) => l.student_id)),
    status: 'neq.archived',
    order: 'name.asc',
  });
  if (!children.length) return null;
  const teacher = await db.selectOne('teachers', {
    select: 'id,name,title,lang,theme',
    id: `eq.${children[0].teacher_id}`,
  });
  return {
    role: account.kind,
    account: { name: account.display_name, kind: account.kind, lang: account.lang },
    child_id: children[0].id,
    children,
    teacher,
  };
}


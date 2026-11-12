/**
 * Is this teacher's account paused by the owner?
 *
 * The teacher session is a signed cookie that lasts 30 days and is read
 * without touching the database, so on its own a pause would only stop the
 * next sign-in. This closes that gap: the teacher API asks here on each
 * request. The answer is remembered for 30 seconds per function instance, so
 * a busy teacher costs one small query every half minute, not one per tap,
 * and a pause reaches every open phone within about that long.
 */

import * as db from './db.js';

const TTL_MS = 30_000;
const seen = new Map();

export async function teacherSuspended(tid) {
  const hit = seen.get(tid);
  if (hit && hit.until > Date.now()) return hit.suspended;
  const row = await db.selectOne('teachers', { select: 'id,suspended_at', id: `eq.${tid}` });
  // A teacher who no longer exists is as good as paused.
  const suspended = !row || Boolean(row.suspended_at);
  seen.set(tid, { suspended, until: Date.now() + TTL_MS });
  return suspended;
}

/** Called by the admin API right after it pauses or restores someone. */
export function forgetTeacher(tid) {
  if (tid) seen.delete(tid);
  else seen.clear();
}

export const SUSPENDED_MESSAGE = 'This account is paused. Please contact Plus.';

/**
 * Set or reset a login code.
 *
 *   node --env-file=.env scripts/set-code.mjs teacher <join_key> <code>
 *   node --env-file=.env scripts/set-code.mjs family  <student name> <code>
 *
 * Codes are stored hashed, so this is the only way to choose one. Use it to
 * give a real teacher their first code, or when a family loses theirs.
 */

import * as db from '../api/_lib/db.js';
import { codeLookup, hashCode } from '../api/_lib/session.js';

const [kind, target, code] = process.argv.slice(2);

function usage(message) {
  if (message) console.error(`\n${message}`);
  console.error(`
Usage
  node --env-file=.env scripts/set-code.mjs teacher <join_key>     <code>
  node --env-file=.env scripts/set-code.mjs family  <student name> <code>
`);
  process.exit(1);
}

async function free(lookup) {
  const [a, b] = await Promise.all([
    db.selectOne('family_accounts', { select: 'id', code_lookup: `eq.${lookup}` }),
    db.selectOne('teachers', { select: 'id', code_lookup: `eq.${lookup}` }),
  ]);
  return !a && !b;
}

async function main() {
  if (!['teacher', 'family'].includes(kind) || !target || !code) usage();
  if (!/^\d{4,10}$/.test(code)) usage('The code must be 4 to 10 digits.');

  const lookup = codeLookup(code);
  const { hash, salt } = hashCode(code);

  if (kind === 'teacher') {
    const teacher = await db.selectOne('teachers', { select: 'id,name,code_lookup', join_key: `eq.${target}` });
    if (!teacher) usage(`No teacher has the join key "${target}".`);
    if (teacher.code_lookup !== lookup && !(await free(lookup))) usage('That code is already in use.');
    await db.update(
      'teachers',
      { code_lookup: lookup, code_hash: hash, code_salt: salt },
      { id: `eq.${teacher.id}` },
    );
    console.log(`\nTeacher ${teacher.name} can now sign in with ${code}.\n`);
    return;
  }

  const student = await db.selectOne('students', {
    select: 'id,name,teacher_id,parent_phone',
    name: `eq.${target}`,
  });
  if (!student) usage(`No student is called "${target}".`);

  const existing = await db.selectOne('family_children', {
    select: 'account_id',
    student_id: `eq.${student.id}`,
  });
  if (!(await free(lookup))) {
    const account = existing
      ? await db.selectOne('family_accounts', { select: 'code_lookup', id: `eq.${existing.account_id}` })
      : null;
    if (account?.code_lookup !== lookup) usage('That code is already in use.');
  }

  if (existing) {
    await db.update(
      'family_accounts',
      { code_lookup: lookup, code_hash: hash, code_salt: salt },
      { id: `eq.${existing.account_id}` },
    );
  } else {
    const [account] = await db.insert('family_accounts', {
      teacher_id: student.teacher_id,
      label: `${student.name}'s family`,
      phone: student.parent_phone,
      code_lookup: lookup,
      code_hash: hash,
      code_salt: salt,
    });
    await db.insert(
      'family_children',
      { account_id: account.id, student_id: student.id },
      { onConflict: 'account_id,student_id', returning: 'minimal' },
    );
  }

  console.log(`\n${student.name}'s family can now sign in with ${code}.\n`);
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});

/**
 * Login codes that nothing else is using.
 *
 * A code is the whole account, and one code may belong to either a teacher or
 * a family, so a new one is checked against both tables before it is handed
 * out. Shared by the onboarding wizard and the owner's dashboard.
 */

import * as db from './db.js';
import { codeLookup, randomCode } from './session.js';

export async function freeCode() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = randomCode();
    const lookup = codeLookup(candidate);
    const [a, b] = await Promise.all([
      db.selectOne('teachers', { select: 'id', code_lookup: `eq.${lookup}` }),
      db.selectOne('family_accounts', { select: 'id', code_lookup: `eq.${lookup}` }),
    ]);
    if (!a && !b) return candidate;
  }
  throw Object.assign(new Error('Could not make a free code - increase CODE_LENGTH'), {
    status: 500,
  });
}

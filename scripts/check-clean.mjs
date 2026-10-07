/**
 * Remove any scratch teacher a crashed check left behind.
 *
 *   npm run check:clean
 *
 * check:db and check:live each work on their own throwaway teacher and delete
 * it when they finish. If a run dies hard, this clears the leftovers. It only
 * ever touches rows named "Live <digits>" or "Check <digits>", so it can never
 * reach a real teacher.
 */

import { cleanStrays } from './live-check.mjs';

console.log('\nLooking for scratch teachers left behind by a crashed check\n');
try {
  await cleanStrays();
  console.log('');
} catch (err) {
  console.error(`\nCould not clean up: ${err.message}\n`);
  process.exitCode = 1;
}

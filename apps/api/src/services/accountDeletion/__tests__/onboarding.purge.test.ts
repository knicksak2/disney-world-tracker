/**
 * Account deletion integration test for `user_onboarding` (first-run-onboarding R3.1, R3.2):
 * - Purging SUBJECT deletes SUBJECT's `user_onboarding` row.
 * - Bystander BOB's `user_onboarding` row remains completely intact.
 */
import { describe, expect, it } from 'vitest';
import { generatePlaceholderId } from '../placeholderId.js';
import type { ClaimedAccount } from '../ports.js';
import { drivePurge, photoDrivers } from './purgeDriver.js';
import {
  BOB,
  CHUNK_ROWS,
  createWorld,
  makePending,
  SUBJECT,
  type World,
} from './world.js';

const CLAIM_AT = new Date('2026-05-02T09:00:00.000Z');
const PLACEHOLDER = generatePlaceholderId(() =>
  Uint8Array.from({ length: 16 }, (_, i) => (i * 41 + 17) & 255),
);

async function claim(w: World, placeholderId: string): Promise<ClaimedAccount> {
  await makePending(w, SUBJECT.id, { placeholderId });
  const claimed = await w.repo.claimDue(CLAIM_AT, 10);
  return claimed.find((x) => x.id === SUBJECT.id)!;
}

describe('Account Deletion - user_onboarding purge integration (Requirements 3.1, 3.2)', () => {
  it('deletes the purged user onboarding row while leaving bystanders untouched', async () => {
    const w = await createWorld();

    await w.pool.query(
      `INSERT INTO user_onboarding (user_id, completed_at, initial_intent, selected_park)
       VALUES ($1, NOW(), 'plan', 'Magic Kingdom'),
              ($2, NOW(), 'in_park', 'EPCOT')`,
      [SUBJECT.id, BOB.id],
    );

    const c = await claim(w, PLACEHOLDER);
    await drivePurge(w, c, photoDrivers(w), CHUNK_ROWS);

    const subjectRows = await w.pool.query(
      `SELECT * FROM user_onboarding WHERE user_id = $1`,
      [SUBJECT.id],
    );
    expect(subjectRows.rows).toHaveLength(0);

    const bobRows = await w.pool.query(
      `SELECT user_id, initial_intent, selected_park FROM user_onboarding WHERE user_id = $1`,
      [BOB.id],
    );
    expect(bobRows.rows).toEqual([
      {
        user_id: BOB.id,
        initial_intent: 'in_park',
        selected_park: 'EPCOT',
      },
    ]);
  });
});

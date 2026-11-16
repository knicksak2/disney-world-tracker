// Feature: in-app-feedback, Property 8: The purge removes a user's feedback
/**
 * Account deletion integration for in-app feedback: the real purge stages run over the migrated pg-mem world and the
 * deleted person's submissions (including one carrying their contact email) go with the account, while another
 * user's submissions are untouched. `finalize` returning `purged` also proves no foreign key to the user remains.
 *
 * Validates: Requirements 7.1, 7.2
 */
import { describe, expect, it } from 'vitest';
import { drivePurge, photoDrivers } from '../../accountDeletion/__tests__/purgeDriver.js';
import {
  BOB,
  CHUNK_ROWS,
  createWorld,
  makePending,
  SUBJECT,
  userRow,
} from '../../accountDeletion/__tests__/world.js';
import { DISPOSITIONS } from '../../accountDeletion/dispositions.js';

const CLAIM_AT = new Date('2026-05-02T09:00:00.000Z');

describe('account purge removes in-app feedback (Property 8)', () => {
  it('is registered as a stage-4 delete keyed by id', () => {
    const entry = DISPOSITIONS.find((e) => e.table === 'user_feedback' && e.column === 'user_id');
    expect(entry).toMatchObject({ disposition: 'delete', stage: 4, chunkColumns: ['id'] });
  });

  it('deletes the purged user submissions (with and without contact email) and keeps other users rows', async () => {
    const w = await createWorld();
    await w.seeder.insertRow('user_feedback', { user_id: SUBJECT.id, kind: 'bug', message: 'subject bug', contact_ok: false });
    await w.seeder.insertRow('user_feedback', {
      user_id: SUBJECT.id,
      kind: 'idea',
      message: 'subject idea',
      contact_ok: true,
      contact_email: SUBJECT.email,
      app_version: '1.0.0',
      platform: 'ios',
      os_version: '17',
    });
    await w.seeder.insertRow('user_feedback', { user_id: SUBJECT.id, kind: 'other', message: 'subject resolved', status: 'resolved' });
    const bobsFeedback = await w.seeder.insertRow('user_feedback', {
      user_id: BOB.id,
      kind: 'bug',
      message: 'bob bug',
      contact_ok: true,
      contact_email: BOB.email,
    });

    await makePending(w, SUBJECT.id);
    const claimed = (await w.repo.claimDue(CLAIM_AT, 10)).find((c) => c.id === SUBJECT.id)!;
    const verdict = await drivePurge(w, claimed, photoDrivers(w), CHUNK_ROWS);

    expect(verdict).toBe('purged');
    expect(await userRow(w, SUBJECT.id)).toBeUndefined();

    const left = (await w.pool.query(`SELECT id, user_id, message, contact_email FROM user_feedback`)).rows;
    expect(left).toEqual([
      { id: bobsFeedback['id'], user_id: BOB.id, message: 'bob bug', contact_email: BOB.email },
    ]);
    // No trace of the purged person's contact email remains anywhere in the table.
    const withEmail = await w.pool.query(`SELECT count(*)::int AS n FROM user_feedback WHERE contact_email = $1`, [SUBJECT.email]);
    expect((withEmail.rows[0] as { n: number }).n).toBe(0);
  });

  it('purges an account with no feedback exactly as before', async () => {
    const w = await createWorld();
    await makePending(w, SUBJECT.id);
    const claimed = (await w.repo.claimDue(CLAIM_AT, 10)).find((c) => c.id === SUBJECT.id)!;
    expect(await drivePurge(w, claimed, photoDrivers(w), CHUNK_ROWS)).toBe('purged');
  });
});

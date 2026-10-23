/**
 * Repo tests (pg-mem, real SQL) for the keyset-chunked recompute enqueue (R9.12).
 *
 * Feature: account-deletion, Property 17: A purge run is bounded (enqueue half)
 * Feature: account-deletion, Property 14: Every purge stage is idempotent and resumable (enqueue half)
 *
 * Would have failed against a single `INSERT ... SELECT`: that is one statement touching 3 x CHUNK_ROWS
 * rows. Would also have failed against a `RETURNING`-driven cursor: a page whose ids were already queued
 * returns no rows and would end the loop early.
 *
 * Validates: Requirements 9.9, 9.10, 9.12, 12.4, 17.4, 17.10
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { ClaimedAccount } from '../ports.js';
import { stage4PersonalData } from './purgeDriver.js';
import type { Row } from './helpers.js';
import { BOB, CHUNK_ROWS, claimSubject, createWorld, SUBJECT, type World } from './world.js';

describe('accountDeletion repo: enqueueRatedChunk (pg-mem)', () => {
  let w: World;
  let c: ClaimedAccount;
  const TOTAL = CHUNK_ROWS * 3;
  let ids: string[];

  async function seedRatings(userId: string, experienceIds: readonly string[]): Promise<void> {
    for (const experienceId of experienceIds) await w.seeder.insertRow('ratings', { user_id: userId, experience_id: experienceId });
  }
  const queue = async (): Promise<string[]> =>
    ((await w.pool.query(`SELECT experience_id FROM account_deletion_recompute_queue`)).rows as Row[]).map((r) => String(r.experience_id)).sort();

  async function enqueueAll(from: string | null = null): Promise<{ pages: number; withRows: number }> {
    let cursor = from;
    let pages = 0;
    let withRows = 0;
    for (let i = 0; i < 50; i++) {
      const page = await w.repo.enqueueRatedChunk(SUBJECT.id, cursor);
      pages += 1;
      if (page.lastId === null) break;
      withRows += 1;
      cursor = page.lastId;
    }
    return { pages, withRows };
  }

  beforeEach(async () => {
    w = await createWorld();
    c = await claimSubject(w);
    ids = [];
    for (let i = 0; i < TOTAL; i++) ids.push(String((await w.seeder.insertRow('experiences')).id));
    ids.sort();
    await seedRatings(SUBJECT.id, ids);
    await seedRatings(BOB.id, ids.slice(0, 3)); // a bystander's ratings are never queued by the subject's purge
  });

  it('queues exactly 3 x CHUNK_ROWS distinct ids over at least three page reads, every page SELECT and INSERT touching at most CHUNK_ROWS rows', async () => {
    // One id is already queued by an earlier (crashed) run.
    await w.pool.query(`INSERT INTO account_deletion_recompute_queue (experience_id) VALUES ($1)`, [ids[7]]);
    w.resetStatements();

    const { pages, withRows } = await enqueueAll();

    expect(withRows).toBe(3);
    expect(pages).toBe(4); // three full pages, then the empty page that ends the loop
    expect(await queue()).toEqual(ids);

    const selects = w.statements.filter((s) => /^SELECT experience_id FROM ratings/.test(s.text.trim()));
    const inserts = w.statements.filter((s) => /^INSERT INTO account_deletion_recompute_queue/.test(s.text.trim()));
    expect(selects).toHaveLength(4);
    expect(inserts).toHaveLength(3);
    for (const s of selects) expect(s.rowCount).toBeLessThanOrEqual(CHUNK_ROWS);
    for (const s of inserts) {
      expect(s.params.length).toBeLessThanOrEqual(CHUNK_ROWS);
      expect(s.text).toContain('ON CONFLICT (experience_id) DO NOTHING');
      expect(s.text).toMatch(/\(\$1::uuid\)/);
    }
    // The first read has no cursor condition, the later ones do (two statement texts, no IS NULL OR trick).
    expect(selects[0]!.text).not.toContain('experience_id >');
    expect(selects[1]!.text).toContain('experience_id > $2');
    expect(selects[0]!.text).not.toMatch(/IS NULL OR/i);
  });

  it('a page whose ids were ALL queued already does not end the loop early (cursor = last id of the page read, not of RETURNING)', async () => {
    // Pre-queue the entire first page: its INSERT ... ON CONFLICT DO NOTHING returns no rows at all.
    for (const id of ids.slice(0, CHUNK_ROWS)) {
      await w.pool.query(`INSERT INTO account_deletion_recompute_queue (experience_id) VALUES ($1)`, [id]);
    }
    const { withRows } = await enqueueAll();
    expect(withRows).toBe(3);
    expect(await queue()).toEqual(ids);
  });

  it('a rerun after a budget stop (restart from a null cursor) adds no duplicates and ends with exactly the same set', async () => {
    const first = await w.repo.enqueueRatedChunk(SUBJECT.id, null); // budget stops after one page
    expect(first.count).toBe(CHUNK_ROWS);
    expect((await queue()).length).toBe(CHUNK_ROWS);

    await enqueueAll(null); // the resumed stage restarts from the top
    expect(await queue()).toEqual(ids);
    await enqueueAll(null); // and again
    expect(await queue()).toEqual(ids);
    expect(new Set(await queue()).size).toBe(TOTAL);
  });

  it('returns { lastId: null, count: 0 } for a user with no ratings and writes nothing', async () => {
    w.resetStatements();
    expect(await w.repo.enqueueRatedChunk('cccccccc-cccc-4ccc-8ccc-cccccccccccc', null)).toEqual({ lastId: null, count: 0 });
    expect(w.statements.map((s) => s.text.trim().split(' ')[0])).toEqual(['SELECT']);
  });

  it('stage 4 enqueues every rated experience BEFORE the first statement that deletes a ratings row', async () => {
    w.resetStatements();
    await stage4PersonalData(w, c);

    const texts = w.statements.map((s) => s.text.trim().replace(/\s+/g, ' '));
    const lastEnqueue = texts.map((t, i) => (t.startsWith('INSERT INTO account_deletion_recompute_queue') ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const firstRatingsDelete = texts.findIndex((t) => t.startsWith('DELETE FROM ratings'));
    expect(lastEnqueue).toBeGreaterThanOrEqual(0);
    expect(firstRatingsDelete).toBeGreaterThan(lastEnqueue);

    expect(await queue()).toEqual(ids);
    // The subject's ratings are gone, the bystander's remain.
    const left = (await w.pool.query(`SELECT user_id FROM ratings`)).rows as Row[];
    expect(left.every((r) => r.user_id === BOB.id)).toBe(true);
    expect(left).toHaveLength(3);
    // No ratings statement touched more than CHUNK_ROWS rows.
    for (const s of w.statements) {
      if (/^DELETE FROM ratings/.test(s.text.trim())) expect(s.rowCount).toBeLessThanOrEqual(CHUNK_ROWS);
    }
  });
});

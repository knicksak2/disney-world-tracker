/**
 * `server.inject` tests for PUT /trips/:id/budget/lines/:lineId/link (trip-budget task 22.1).
 *
 * // Feature: trip-budget, Property 51: Logging a Budget_Line as an Expense pre-fills faithfully and links softly
 * Validates: Requirements 18.9, 23.5, 23.6, 23.7, 23.8
 *
 * Real route, real `assertTripMember`/`can`, real repo over pg-mem; only the session is faked.
 */

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { createTripBudgetRepo } from '../repo.js';
import { tripBudgetRoutes } from '../routes.js';
import { seedTestData, setupTestDb, type SeedTestData } from './testDb.js';

describe('PUT /trips/:id/budget/lines/:lineId/link', () => {
  let pool: DbPool;
  let seed: SeedTestData;
  let server: FastifyInstance;
  let callerId: string;
  let lineId: string; // created by the organizer
  let expenseId: string;
  let otherTripExpenseId: string;

  async function link(
    url: { tripId?: string; lineId?: string },
    payload: unknown,
  ): Promise<{ status: number; code: string | undefined }> {
    const res = await server.inject({
      method: 'PUT',
      url: `/trips/${url.tripId ?? seed.tripId}/budget/lines/${url.lineId ?? lineId}/link`,
      payload: payload as Record<string, unknown>,
    });
    const body = res.body ? safeJson(res.body) : undefined;
    return { status: res.statusCode, code: body?.error?.code };
  }

  function safeJson(text: string): { error?: { code?: string } } | undefined {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  async function linkedId(): Promise<string | null> {
    const res = await pool.query<{ linked_expense_id: string | null }>(
      'SELECT linked_expense_id FROM trip_budget_lines WHERE id = $1',
      [lineId],
    );
    return res.rows[0]?.linked_expense_id ?? null;
  }

  beforeEach(async () => {
    const testDb = setupTestDb();
    pool = testDb.pool;
    seed = await seedTestData(pool);
    const repo = createTripBudgetRepo(pool);

    const line = await repo.createLine(seed.tripId, seed.organizerId, {
      category: 'dining',
      description: 'Dinner',
      priceSource: 'user_entered',
      allocations: [{ memberId: seed.memberId, amountCents: 5000 }],
    });
    lineId = line.id;

    expenseId = randomUUID();
    await pool.query(
      `INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
       VALUES ($1, $2, $3, $3, 5000, 'Dinner', '2026-10-02', 'even')`,
      [expenseId, seed.tripId, seed.memberId],
    );
    otherTripExpenseId = randomUUID();
    await pool.query(
      `INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
       VALUES ($1, $2, $3, $3, 5000, 'Elsewhere', '2026-11-02', 'even')`,
      [otherTripExpenseId, seed.otherTripId, seed.organizerId],
    );

    callerId = seed.memberId; // a plain member who did NOT create the line
    const session: preHandlerHookHandler = async (request) => {
      (request as unknown as { userId: string }).userId = callerId;
    };
    server = Fastify();
    registerErrorHandler(server);
    await server.register(
      tripBudgetRoutes({
        pool,
        repo,
        requireSession: session,
        config: { ticketPrices: { enabled: false } },
      }),
    );
    await server.ready();
  });

  it('lets a plain member who did not create the line link it, answering 204 and storing the id', async () => {
    const res = await link({}, { expenseId });
    expect(res.status).toBe(204);
    expect(await linkedId()).toBe(expenseId);
  });

  it('is idempotent for the same Expense and rejects a different one on a linked line', async () => {
    expect((await link({}, { expenseId })).status).toBe(204);
    expect((await link({}, { expenseId })).status).toBe(204);

    const second = randomUUID();
    await pool.query(
      `INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
       VALUES ($1, $2, $3, $3, 100, 'Second', '2026-10-03', 'even')`,
      [second, seed.tripId, seed.memberId],
    );
    const res = await link({}, { expenseId: second });
    expect(res.status).toBe(400);
    expect(res.code).toBe('trip_validation_failed');
    expect(await linkedId()).toBe(expenseId);
  });

  it('answers identical trip_forbidden for a non-member and for an unknown Trip', async () => {
    callerId = seed.outsideUserId;
    const nonMember = await link({}, { expenseId });
    const unknownTrip = await link({ tripId: randomUUID() }, { expenseId });

    expect(nonMember).toEqual({ status: 403, code: 'trip_forbidden' });
    expect(unknownTrip).toEqual({ status: 403, code: 'trip_forbidden' });
    expect(await linkedId()).toBeNull();
  });

  it('answers trip_not_found for a line that is not on the Trip', async () => {
    const res = await link({ lineId: randomUUID() }, { expenseId });
    expect(res.status).toBe(404);
    expect(res.code).toBe('trip_not_found');
  });

  it('answers trip_validation_failed for an Expense of another Trip', async () => {
    const res = await link({}, { expenseId: otherTripExpenseId });
    expect(res.status).toBe(400);
    expect(res.code).toBe('trip_validation_failed');
    expect(await linkedId()).toBeNull();
  });

  it('answers trip_validation_failed for a malformed or extra-key body (Requirement 18.9)', async () => {
    for (const body of [{}, { expenseId: 'not-a-uuid' }, { expenseId, extra: 1 }]) {
      const res = await link({}, body);
      expect(res.status).toBe(400);
      expect(res.code).toBe('trip_validation_failed');
    }
    expect(await linkedId()).toBeNull();
  });

  it('GET /budget reports the linked Expense id on the line (regression: loadBudget used to drop the column)', async () => {
    const before = await server.inject({ method: 'GET', url: `/trips/${seed.tripId}/budget` });
    expect(before.statusCode).toBe(200);
    expect(before.json().lines.find((l: { id: string }) => l.id === lineId).linkedExpenseId).toBeNull();

    expect((await link({}, { expenseId })).status).toBe(204);

    const after = await server.inject({ method: 'GET', url: `/trips/${seed.tripId}/budget` });
    expect(after.statusCode).toBe(200);
    expect(after.json().lines.find((l: { id: string }) => l.id === lineId).linkedExpenseId).toBe(expenseId);
  });

  it('lets any Trip member link, not only the planner or an organizer', async () => {
    callerId = seed.otherMemberId; // a third member: neither creator of the line nor payer of the Expense
    const res = await link({}, { expenseId });
    expect(res.status).toBe(204);
    expect(await linkedId()).toBe(expenseId);
  });
});

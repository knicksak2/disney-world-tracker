/**
 * Fastify route plugin for the Trip Expenses feature.
 *
 * Exposes:
 *  - Expenses: POST /trips/:id/expenses, PATCH/DELETE /trips/:id/expenses/:expenseId
 *  - Refunds: POST /trips/:id/expenses/:expenseId/refunds, PATCH/DELETE /trips/:id/expenses/:expenseId/refunds/:refundId
 *  - Guests: GET /trips/:id/guests, POST /trips/:id/guests, PATCH/DELETE /trips/:id/guests/:guestId
 *  - Settlements: POST /trips/:id/settlements, PATCH/DELETE /trips/:id/settlements/:settlementId
 *  - Ledger & Balances: GET /trips/:id/expenses, GET /trips/:id/balances, GET /trips/:id/balances/:memberId/drilldown, GET /trips/:id/expenses/export
 *
 * Validates: Requirements 1.7, 1.9, 1.10, 2.4, 2.10, 7.5, 8.1, 10.1, 10.2, 10.4, 12.6, 13.1, 13.3, 13.4
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z, ZodError } from 'zod';
import {
  expenseCreateSchema,
  expenseEditSchema,
  settlementCreateSchema,
  tripGuestAddSchema,
  tripGuestRenameSchema,
  refundCreateSchema,
  uuidSchema,
  EXPENSE_CATEGORIES,
  type ExpenseDTO,
  type TripBalancesResponseDTO,
} from '@dwt/shared';
import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertTripMember } from '../trips/authz.js';
import type { TripExpenseRepo } from './repo.js';
import type { ExpenseAffectedNotice } from './events.js';

export type ExpenseAffectedDispatch = (event: ExpenseAffectedNotice) => void;

export interface TripExpenseRoutesOptions {
  readonly repo: TripExpenseRepo;
  readonly pool: DbPool;
  readonly requireSession: preHandlerHookHandler;
  readonly emitExpenseAffected?: ExpenseAffectedDispatch;
}

// ---------------------------------------------------------------------------
// Path parameter schemas
// ---------------------------------------------------------------------------

const tripIdParamsSchema = z.object({ id: uuidSchema }).strict();

const tripExpenseParamsSchema = z
  .object({ id: uuidSchema, expenseId: uuidSchema })
  .strict();

const tripExpenseRefundParamsSchema = z
  .object({ id: uuidSchema, expenseId: uuidSchema, refundId: uuidSchema })
  .strict();

const tripGuestParamsSchema = z
  .object({ id: uuidSchema, guestId: uuidSchema })
  .strict();

const tripSettlementParamsSchema = z
  .object({ id: uuidSchema, settlementId: uuidSchema })
  .strict();

const tripDrillDownParamsSchema = z
  .object({ id: uuidSchema, memberId: uuidSchema })
  .strict();

const tripDrillDownQuerySchema = z
  .object({
    counterpartyId: uuidSchema.optional(),
  })
  .strict();

const listExpensesQuerySchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    payerId: uuidSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function requireUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

function parseOrAppError<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): z.infer<S> {
  try {
    return schema.parse(input) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      throw zodErrorToAppError(err);
    }
    throw err;
  }
}

function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field =
    issue && issue.path.length > 0
      ? issue.path.map(String).join('.')
      : undefined;

  const message = `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError('trip_validation_failed', message, { field })
    : new AppError('trip_validation_failed', message);
}

/**
 * Builds a map of memberId -> total amount owed across an Expense's shares,
 * resolving any guest share onto its sponsor.
 */
async function computeOwedAmountsByMember(
  repo: TripExpenseRepo,
  tripId: string,
  expense: ExpenseDTO,
): Promise<Map<string, number>> {
  const guests = await repo.listTripGuests(tripId);
  const guestSponsorMap = new Map(guests.map((g) => [g.id, g.sponsorMemberId]));

  const owed = new Map<string, number>();
  for (const s of expense.shares) {
    let recId: string;
    if (s.guestId) {
      recId = guestSponsorMap.get(s.guestId) ?? s.guestId;
    } else if (s.memberId) {
      recId = s.memberId;
    } else {
      continue;
    }

    const cur = owed.get(recId) ?? 0;
    owed.set(recId, cur + s.amountCents);
  }

  return owed;
}

// ---------------------------------------------------------------------------
// Route Plugin Factory
// ---------------------------------------------------------------------------

export function tripExpenseRoutes(
  options: TripExpenseRoutesOptions,
): FastifyPluginAsync {
  const { repo, pool, requireSession, emitExpenseAffected } = options;

  return async function tripExpenseRoutesPlugin(app: FastifyInstance): Promise<void> {
    // -----------------------------------------------------------------------
    // Expenses
    // -----------------------------------------------------------------------

    // POST /trips/:id/expenses (Req 1.1, 1.7, 1.9)
    app.post(
      '/trips/:id/expenses',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, tripId);
        const input = parseOrAppError(expenseCreateSchema, request.body);

        const expense = await repo.createExpense(tripId, userId, input);

        if (emitExpenseAffected) {
          const owedMap = await computeOwedAmountsByMember(repo, tripId, expense);
          const affectedMemberIds = Array.from(owedMap.keys()).filter((mId) => mId !== userId);
          if (affectedMemberIds.length > 0) {
            try {
              emitExpenseAffected({
                expenseId: expense.id,
                tripId,
                actorUserId: userId,
                affectedMemberIds,
              });
            } catch {
              // fire-and-forget
            }
          }
        }

        reply.code(201);
        return expense;
      },
    );

    // PATCH /trips/:id/expenses/:expenseId (Req 1.10, 8.1, 8.3)
    app.patch(
      '/trips/:id/expenses/:expenseId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId, expenseId } = parseOrAppError(tripExpenseParamsSchema, request.params);
        const callerRole = await assertTripMember(pool, userId, tripId);
        const input = parseOrAppError(expenseEditSchema, request.body);

        const oldExpense = await repo.getExpense(tripId, expenseId);
        const updated = await repo.editExpense(tripId, expenseId, userId, callerRole, input);

        if (emitExpenseAffected && oldExpense) {
          const oldOwed = await computeOwedAmountsByMember(repo, tripId, oldExpense);
          const newOwed = await computeOwedAmountsByMember(repo, tripId, updated);

          const allMembers = new Set([...oldOwed.keys(), ...newOwed.keys()]);
          const affectedMemberIds: string[] = [];
          for (const mId of allMembers) {
            if (mId === userId) continue;
            if ((oldOwed.get(mId) ?? 0) !== (newOwed.get(mId) ?? 0)) {
              affectedMemberIds.push(mId);
            }
          }

          if (affectedMemberIds.length > 0) {
            try {
              emitExpenseAffected({
                expenseId: updated.id,
                tripId,
                actorUserId: userId,
                affectedMemberIds,
              });
            } catch {
              // fire-and-forget
            }
          }
        }

        reply.code(200);
        return updated;
      },
    );

    // DELETE /trips/:id/expenses/:expenseId (Req 8.1, 8.4)
    app.delete(
      '/trips/:id/expenses/:expenseId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId, expenseId } = parseOrAppError(tripExpenseParamsSchema, request.params);
        const callerRole = await assertTripMember(pool, userId, tripId);

        await repo.removeExpense(tripId, expenseId, userId, callerRole);

        reply.code(204);
        return;
      },
    );

    // -----------------------------------------------------------------------
    // Refunds
    // -----------------------------------------------------------------------

    // POST /trips/:id/expenses/:expenseId/refunds (Req 12.1)
    app.post(
      '/trips/:id/expenses/:expenseId/refunds',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId, expenseId } = parseOrAppError(tripExpenseParamsSchema, request.params);
        const callerRole = await assertTripMember(pool, userId, tripId);
        const input = parseOrAppError(refundCreateSchema, request.body);

        const refund = await repo.createRefund(tripId, expenseId, userId, callerRole, input);

        reply.code(201);
        return refund;
      },
    );

    // PATCH /trips/:id/expenses/:expenseId/refunds/:refundId (Req 12.5)
    app.patch(
      '/trips/:id/expenses/:expenseId/refunds/:refundId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId, expenseId, refundId } = parseOrAppError(tripExpenseRefundParamsSchema, request.params);
        const callerRole = await assertTripMember(pool, userId, tripId);
        const input = parseOrAppError(refundCreateSchema, request.body);

        const refund = await repo.editRefund(tripId, expenseId, refundId, userId, callerRole, input);

        reply.code(200);
        return refund;
      },
    );

    // DELETE /trips/:id/expenses/:expenseId/refunds/:refundId (Req 12.5)
    app.delete(
      '/trips/:id/expenses/:expenseId/refunds/:refundId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId, expenseId, refundId } = parseOrAppError(tripExpenseRefundParamsSchema, request.params);
        const callerRole = await assertTripMember(pool, userId, tripId);

        await repo.removeRefund(tripId, expenseId, refundId, userId, callerRole);

        reply.code(204);
        return;
      },
    );

    // -----------------------------------------------------------------------
    // Guests
    // -----------------------------------------------------------------------

    // GET /trips/:id/guests (Req 2.3)
    app.get(
      '/trips/:id/guests',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, tripId);

        return repo.listTripGuests(tripId);
      },
    );

    // POST /trips/:id/guests (Req 2.1)
    app.post(
      '/trips/:id/guests',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, tripId);
        const input = parseOrAppError(tripGuestAddSchema, request.body);

        const targetSponsorId = input.sponsorMemberId ?? userId;
        if (targetSponsorId !== userId) {
          const sponsorCheck = await pool.query(
            `SELECT 1 FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
            [tripId, targetSponsorId],
          );
          if (sponsorCheck.rowCount === 0) {
            throw new AppError('trip_validation_failed', 'Sponsor must be a trip member');
          }
        }

        const guest = await repo.addTripGuest(tripId, targetSponsorId, input);

        reply.code(201);
        return guest;
      },
    );

    // PATCH /trips/:id/guests/:guestId (Req 2.10, 2.11)
    app.patch(
      '/trips/:id/guests/:guestId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId, guestId } = parseOrAppError(tripGuestParamsSchema, request.params);
        const callerRole = await assertTripMember(pool, userId, tripId);
        const input = parseOrAppError(tripGuestRenameSchema, request.body);

        if (input.sponsorMemberId) {
          const sponsorCheck = await pool.query(
            `SELECT 1 FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
            [tripId, input.sponsorMemberId],
          );
          if (sponsorCheck.rowCount === 0) {
            throw new AppError('trip_validation_failed', 'Sponsor must be a trip member');
          }
        }

        const guest = await repo.renameTripGuest(tripId, guestId, userId, callerRole, input);

        reply.code(200);
        return guest;
      },
    );

    // DELETE /trips/:id/guests/:guestId (Req 2.9, 2.10)
    app.delete(
      '/trips/:id/guests/:guestId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId, guestId } = parseOrAppError(tripGuestParamsSchema, request.params);
        const callerRole = await assertTripMember(pool, userId, tripId);

        await repo.removeTripGuest(tripId, guestId, userId, callerRole);

        reply.code(204);
        return;
      },
    );

    // -----------------------------------------------------------------------
    // Settlements
    // -----------------------------------------------------------------------

    // POST /trips/:id/settlements (Req 7.1)
    app.post(
      '/trips/:id/settlements',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, tripId);
        const input = parseOrAppError(settlementCreateSchema, request.body);

        const settlement = await repo.createSettlement(tripId, userId, input);

        reply.code(201);
        return settlement;
      },
    );

    // PATCH /trips/:id/settlements/:settlementId (Req 8.1)
    app.patch(
      '/trips/:id/settlements/:settlementId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId, settlementId } = parseOrAppError(tripSettlementParamsSchema, request.params);
        const callerRole = await assertTripMember(pool, userId, tripId);
        const input = parseOrAppError(settlementCreateSchema, request.body);

        const settlement = await repo.editSettlement(tripId, settlementId, userId, callerRole, input);

        reply.code(200);
        return settlement;
      },
    );

    // DELETE /trips/:id/settlements/:settlementId (Req 8.1)
    app.delete(
      '/trips/:id/settlements/:settlementId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId, settlementId } = parseOrAppError(tripSettlementParamsSchema, request.params);
        const callerRole = await assertTripMember(pool, userId, tripId);

        await repo.removeSettlement(tripId, settlementId, userId, callerRole);

        reply.code(204);
        return;
      },
    );

    // -----------------------------------------------------------------------
    // Ledger listing, Balances, Drill-down, Export
    // -----------------------------------------------------------------------

    // GET /trips/:id/expenses (Req 13.1)
    app.get(
      '/trips/:id/expenses',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, tripId);
        const query = parseOrAppError(listExpensesQuerySchema, request.query);

        return repo.listExpensesAndSettlements(tripId, query);
      },
    );

    // GET /trips/:id/balances (Req 6.1, 6.5)
    app.get(
      '/trips/:id/balances',
      { preHandler: requireSession },
      async (request): Promise<TripBalancesResponseDTO> => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, tripId);

        const [net, pairwise] = await Promise.all([
          repo.getNetBalances(tripId),
          repo.getPairwiseBalances(tripId),
        ]);

        return { net, pairwise };
      },
    );

    // GET /trips/:id/balances/:memberId/drilldown (Req 6.4, 6.7)
    app.get(
      '/trips/:id/balances/:memberId/drilldown',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id: tripId, memberId } = parseOrAppError(tripDrillDownParamsSchema, request.params);
        const query = parseOrAppError(tripDrillDownQuerySchema, request.query);
        await assertTripMember(pool, userId, tripId);

        return repo.getBalanceDrillDown(tripId, memberId, query.counterpartyId);
      },
    );

    // GET /trips/:id/expenses/export (Req 13.3)
    app.get(
      '/trips/:id/expenses/export',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
        await assertTripMember(pool, userId, tripId);

        const csv = await repo.exportLedgerCsv(tripId);

        reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="trip-${tripId}-expenses.csv"`)
          .send(csv);
      },
    );
  };
}

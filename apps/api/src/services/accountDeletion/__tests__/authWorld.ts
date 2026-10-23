/**
 * A whole-API test world for account deletion: pg-mem with every migration, the REAL auth routes, the REAL session
 * middleware over the REAL production adapter SQL, the REAL account-deletion routes, service, repo and purge runner.
 * Only the edges are fake: Redis lockout (in memory), mail (captured), the photo store and the aggregate recompute.
 *
 * The clock is one mutable value shared by the route plugins, the session middleware, the service and the runner,
 * so a test can jump past `scheduled_purge_at` without touching a row.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';

import { makeSessionDbAdapter } from '../../../composeServices.js';
import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { LockoutService } from '../../auth/lockout.js';
import type { MailService } from '../../auth/mailService.js';
import { hash as hashPassword, verify as verifyPassword } from '../../auth/password.js';
import { authRoutes } from '../../auth/routes.js';
import { createSessionMiddleware } from '../../auth/sessionMiddleware.js';
import { hashToken } from '../../auth/sessionToken.js';
import type { AccountDeletionMail, AccountRestorePort } from '../ports.js';
import { createAccountDeletionRepo } from '../repo.js';
import { createPurgeRunner, type PurgeRunner } from '../purgeRunner.js';
import { accountDeletionRoutes } from '../routes.js';
import { createAccountDeletionService } from '../service.js';
import { buildMigratedDb, createRecordingLogger, createTestPool, type Row, type TestPool } from './helpers.js';

export const CRON_SECRET = 'test-account-deletion-cron-secret-12345';
export const SESSION_SECRET = 'test-session-secret-must-be-at-least-32-chars';
export const PASSWORD = 'correct-horse-battery';
export const GRACE_DAYS = 30;
export const DAY_MS = 86_400_000;
/**
 * The world's clock starts at the real current second: the reset-code lookup also compares `expires_at` with the
 * database's own `now()` (pre-existing behaviour), so a fixed past date would make every fresh code look expired.
 */
export const START_MS = Math.floor(Date.now() / 1000) * 1000;

let passwordHash: Promise<string> | null = null;
/** One Argon2 hash for every seeded user: hashing is the slow part and the value is irrelevant to the tests. */
export function seededPasswordHash(): Promise<string> {
  passwordHash ??= hashPassword(PASSWORD);
  return passwordHash;
}

export interface AuthWorldOptions {
  /** Leave `accountRestore` out of `authRoutes`, as an app wired before this feature would be. */
  readonly withoutRestorePort?: boolean;
  /** Wrap the real restore port, e.g. to simulate the purge claim winning a race. */
  readonly wrapRestorePort?: (real: AccountRestorePort) => AccountRestorePort;
}

export interface ResetMail {
  readonly to: string;
  readonly code: string;
  readonly resetUrl: string;
}

export interface AuthWorld {
  readonly app: FastifyInstance;
  readonly db: ReturnType<typeof buildMigratedDb>;
  readonly pool: DbPool;
  readonly testPool: TestPool;
  readonly clock: { t: number };
  readonly repo: ReturnType<typeof createAccountDeletionRepo>;
  readonly service: ReturnType<typeof createAccountDeletionService>;
  readonly runner: PurgeRunner;
  readonly jobs: (() => Promise<void>)[];
  readonly lockoutEvents: string[];
  readonly cancelledMail: string[];
  readonly scheduledMail: { to: string; scheduledPurgeAt: Date }[];
  readonly resetMail: ResetMail[];
  readonly logs: ReturnType<typeof createRecordingLogger>['calls'];
  now(): Date;
  /** Inserts a user (and profile) directly and returns its id. */
  seedUser(email: string, displayName?: string): Promise<string>;
  /** Puts a seeded user into a deletion state with the columns the CHECK constraints require. */
  setState(userId: string, state: 'active' | 'pending_deletion' | 'purging', scheduledPurgeAt?: Date): Promise<void>;
  userRow(userId: string): Promise<Row | undefined>;
  /** Makes the fake lockout report this user as locked (or not). */
  setLocked(userId: string, locked: boolean): void;
  login(email: string, password?: string): Promise<LightMyRequestResponse>;
  forgot(email: string): Promise<LightMyRequestResponse>;
  /** Registers through the real route and returns the bearer token. */
  register(email: string, displayName?: string): Promise<{ token: string; userId: string }>;
  close(): Promise<void>;
}

export async function buildAuthWorld(options: AuthWorldOptions = {}): Promise<AuthWorld> {
  const db = buildMigratedDb();
  const testPool = createTestPool(db);
  const { pool } = testPool;
  const clock = { t: START_MS };
  const now = (): Date => new Date(clock.t);
  const { logger, calls: logs } = createRecordingLogger();

  const lockoutEvents: string[] = [];
  const locked = new Set<string>();
  const lockout: LockoutService & { setLocked(id: string, v: boolean): void } = {
    async isLocked(id: string) {
      lockoutEvents.push(`isLocked:${id}`);
      return locked.has(id);
    },
    async recordFailure(id: string) {
      lockoutEvents.push(`recordFailure:${id}`);
      return false;
    },
    async clearOnSuccess(id: string) {
      lockoutEvents.push(`clearOnSuccess:${id}`);
    },
    setLocked(id: string, v: boolean) {
      if (v) locked.add(id);
      else locked.delete(id);
    },
  } as never;

  const cancelledMail: string[] = [];
  const scheduledMail: { to: string; scheduledPurgeAt: Date }[] = [];
  const resetMail: ResetMail[] = [];
  const deletionMail: AccountDeletionMail = {
    sendDeletionScheduled: async ({ to, scheduledPurgeAt }) => {
      scheduledMail.push({ to, scheduledPurgeAt });
    },
    sendDeletionCancelled: async ({ to }) => {
      cancelledMail.push(to);
    },
  };
  const mailService: MailService = {
    sendPasswordReset: async ({ to, code, resetUrl }) => {
      resetMail.push({ to, code, resetUrl });
    },
  };

  const repo = createAccountDeletionRepo(pool, { chunkRows: 50 });
  const service = createAccountDeletionService({
    repo,
    lockout,
    mail: deletionMail,
    verify: verifyPassword,
    clock: { now },
    logger,
    config: { graceDays: GRACE_DAYS, reauthWindowSeconds: 300 },
    logSecret: SESSION_SECRET,
  });

  const jobs: (() => Promise<void>)[] = [];
  const runner = createPurgeRunner({
    repo,
    photos: { deleteAllForUser: async () => [] },
    tripPhotos: { softDeleteTripPhotos: async () => [] },
    aggregate: { recomputeFromScratch: async () => undefined },
    lockout,
    clock: { now },
    logger,
    logSecret: SESSION_SECRET,
    config: { batch: 10, timeBudgetMs: 25_000, chunkRows: 50 },
    scheduler: { run: (job) => void jobs.push(job) },
  });

  const requireSession = createSessionMiddleware({ db: makeSessionDbAdapter(pool), hashToken, clock: now });

  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.decorate('config', { accountDeletion: { cronSecret: CRON_SECRET } } as never);
  const restorePort = options.wrapRestorePort ? options.wrapRestorePort(service) : service;
  await app.register(
    authRoutes({
      pool,
      lockout,
      requireSession,
      now,
      mailService,
      apiPublicUrl: 'https://api.example.test',
      ...(options.withoutRestorePort ? {} : { accountRestore: restorePort }),
    }),
  );
  await app.register(accountDeletionRoutes({ service, purgeRunner: runner, requireSession }));
  await app.ready();

  const world: AuthWorld = {
    app,
    db,
    pool,
    testPool,
    clock,
    repo,
    service,
    runner,
    jobs,
    lockoutEvents,
    cancelledMail,
    scheduledMail,
    resetMail,
    logs,
    now,
    async seedUser(email, displayName = 'Alice') {
      const id = randomUUID();
      await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`, [id, email, await seededPasswordHash()]);
      await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`, [id, displayName]);
      return id;
    },
    async setState(userId, state, scheduledPurgeAt) {
      if (state === 'active') {
        await pool.query(
          `UPDATE users SET deletion_state = 'active', deletion_requested_at = NULL, scheduled_purge_at = NULL,
                  placeholder_id = NULL, purge_claimed_at = NULL, purge_stage = 0 WHERE id = $1`,
          [userId],
        );
        return;
      }
      const due = scheduledPurgeAt ?? new Date(clock.t + 10 * DAY_MS);
      await pool.query(
        `UPDATE users SET deletion_state = $2, deletion_requested_at = $3, scheduled_purge_at = $4, placeholder_id = $5,
                purge_claimed_at = $6 WHERE id = $1`,
        [userId, state, new Date(due.getTime() - GRACE_DAYS * DAY_MS), due, randomUUID(), state === 'purging' ? new Date(clock.t) : null],
      );
    },
    async userRow(userId) {
      const res = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
      return res.rows[0] as Row | undefined;
    },
    setLocked(userId, v) {
      lockout.setLocked(userId, v);
    },
    login(email, password = PASSWORD) {
      return app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    },
    forgot(email) {
      return app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email } });
    },
    async register(email, displayName = 'Alice') {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, displayName, password: PASSWORD },
      });
      if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.payload}`);
      const body = res.json() as { token: string; user: { id: string } };
      return { token: body.token, userId: body.user.id };
    },
    async close() {
      await app.close();
    },
  };
  return world;
}

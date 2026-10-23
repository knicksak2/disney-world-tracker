/**
 * Shared pieces for the visibility retrofit tests (account-deletion R5, Appendix B): a migrated pg-mem world with
 * four people, helpers to move one of them through the lifecycle, and a small Fastify app builder with a header
 * driven session stub. Every surface test seeds an ACTIVE person (BOB, CAROL, DAVE) and a PENDING one (SUBJECT)
 * and asserts the OMIT / PLACEHOLDER behavior and the same surface after Restoration.
 */
import Fastify, { type FastifyInstance, type FastifyPluginAsync, type preHandlerHookHandler } from 'fastify';

import { registerErrorHandler } from '../../../errors/handler.js';
import { pair } from '../../friends/canonicalPair.js';
import { claimSubject, makePending, SUBJECT, type World } from './world.js';

export * from './world.js';
export type { Row } from './helpers.js';

/** Inside the 30-day grace window that `makePending` sets (requested 2026-04-01, purge 2026-05-01). */
export const RESTORE_AT = new Date('2026-04-02T00:00:00.000Z');

/** Moves the person back to `active` through the real repo, exactly as a sign-in does. */
export async function restore(w: World, id: string = SUBJECT.id): Promise<void> {
  const res = await w.repo.restore(id, RESTORE_AT);
  if (!res.restored) throw new Error(`restore(${id}) did not restore`);
}

/** `pending_deletion` -> `purging` (the cron claimed it): still not visible. */
export async function makePurging(w: World, id: string = SUBJECT.id): Promise<void> {
  await makePending(w, id);
  await w.pool.query(`UPDATE users SET deletion_state = 'purging' WHERE id = $1`, [id]);
}

/** A real tombstone row (as `ensureTombstone` writes it) with a profile; returns its id. */
export async function makeTombstone(w: World): Promise<string> {
  const claimed = await claimSubject(w);
  return w.repo.ensureTombstone(claimed);
}

export async function befriend(w: World, a: string, b: string): Promise<void> {
  const { lo, hi } = pair(a, b);
  await w.pool.query(`INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [lo, hi]);
}

/** Header-driven session stub: `x-test-user` becomes `request.userId`. */
export const sessionStub: preHandlerHookHandler = (request, _reply, done) => {
  const id = request.headers['x-test-user'];
  if (typeof id === 'string' && id.length > 0) request.userId = id;
  done();
};

export async function buildApp(...plugins: FastifyPluginAsync[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  for (const plugin of plugins) await app.register(plugin);
  await app.ready();
  return app;
}

export function as(userId: string): { 'x-test-user': string } {
  return { 'x-test-user': userId };
}

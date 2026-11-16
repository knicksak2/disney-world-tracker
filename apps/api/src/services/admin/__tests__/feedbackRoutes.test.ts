/**
 * Admin_Panel User Feedback section (`/admin/feedback`) through `inject`, over the REAL feedback repo on pg-mem with
 * every migration applied, posting real `application/x-www-form-urlencoded` forms and reading the rows back.
 *
 * Validates: in-app-feedback Requirements 5.1 to 5.8; Properties 9 and 11. admin-panel Requirement 20.
 */
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import Fastify, { type FastifyInstance } from 'fastify';
import type { IMemoryDb } from 'pg-mem';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DbPool } from '../../../db/pool.js';
import { buildMigratedDb, createSeeder, createTestPool, type Seeder } from '../../accountDeletion/__tests__/helpers.js';
import { createFeedbackRepo } from '../../feedback/repo.js';
import { createBasicAuthHook } from '../basicAuth.js';
import { escapeHtml } from '../html.js';
import { createAdminRepo } from '../repo.js';
import { ADMIN_SECTIONS, adminRoutes } from '../routes.js';

const AUTH = `Basic ${Buffer.from('admin:supersecretpassword').toString('base64')}`;
const SAME_ORIGIN = { authorization: AUTH, host: 'localhost:3000', origin: 'http://localhost:3000' };
const FORM = { ...SAME_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' };

let db: IMemoryDb;
let snapshot: { restore(): void };
let pool: DbPool;
let seeder: Seeder;
let app: FastifyInstance;
let alice: string;

async function buildApp(withFeedback: boolean): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  await instance.register(
    adminRoutes({
      repo: createAdminRepo({} as never, {} as never),
      basicAuth: createBasicAuthHook({ username: 'admin', password: 'supersecretpassword' }),
      ...(withFeedback ? { feedback: createFeedbackRepo(pool) } : {}),
    }),
  );
  await instance.ready();
  return instance;
}

beforeAll(() => {
  db = buildMigratedDb();
  snapshot = db.backup();
});

beforeEach(async () => {
  snapshot.restore();
  pool = createTestPool(db).pool;
  seeder = createSeeder(pool);
  alice = randomUUID();
  await seeder.insertRow('users', { id: alice, email: 'alice@example.com' });
  app = await buildApp(true);
});

afterEach(async () => {
  await app.close();
});

async function seedFeedback(over: Record<string, unknown> = {}): Promise<string> {
  const row = await seeder.insertRow('user_feedback', { user_id: alice, kind: 'bug', message: 'seeded', contact_ok: false, ...over });
  return String(row['id']);
}
async function rows(): Promise<Record<string, unknown>[]> {
  return (await pool.query(`SELECT * FROM user_feedback ORDER BY created_at, id`)).rows as Record<string, unknown>[];
}
const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const get = (url: string) => app.inject({ method: 'GET', url, headers: { authorization: AUTH } });

describe('access (Requirements 5.4, 5.6, 5.8)', () => {
  it('answers 401 without credentials on every route', async () => {
    const id = await seedFeedback();
    for (const [method, url] of [
      ['GET', '/admin/feedback'],
      ['GET', `/admin/feedback/${id}`],
      ['POST', `/admin/feedback/${id}/status`],
      ['POST', `/admin/feedback/${id}/delete`],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('refuses a cross-origin POST with 403 and changes nothing', async () => {
    const id = await seedFeedback();
    const evil = { ...FORM, origin: 'http://evil.example.com' };
    const status = await app.inject({ method: 'POST', url: `/admin/feedback/${id}/status`, headers: evil, payload: form({ status: 'resolved' }) });
    const del = await app.inject({ method: 'POST', url: `/admin/feedback/${id}/delete`, headers: evil, payload: '' });
    expect(status.statusCode).toBe(403);
    expect(del.statusCode).toBe(403);
    const [row] = await rows();
    expect(row?.['status']).toBe('new');
    expect(await rows()).toHaveLength(1);
  });

  it('sends noindex and no-store on list, detail, 404 and redirects', async () => {
    const id = await seedFeedback();
    const responses = [
      await get('/admin/feedback'),
      await get(`/admin/feedback/${id}`),
      await get(`/admin/feedback/${randomUUID()}`),
      await app.inject({ method: 'POST', url: `/admin/feedback/${id}/status`, headers: FORM, payload: form({ status: 'triaged' }) }),
    ];
    for (const res of responses) {
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.headers['cache-control']).toBe('private, no-store');
    }
  });

  it('lists the section on the dashboard when the port is supplied', async () => {
    expect(ADMIN_SECTIONS.find((s) => s.path === '/admin/feedback')).toMatchObject({ title: 'User Feedback' });
    const overview = await get('/admin');
    expect(overview.body).toContain('/admin/feedback');
    expect(overview.body).toContain('User Feedback');
  });

  it('registers no route and no dashboard entry when the port is absent', async () => {
    await app.close();
    app = await buildApp(false);
    expect((await get('/admin/feedback')).statusCode).toBe(404);
    expect(ADMIN_SECTIONS.some((s) => s.path === '/admin/feedback')).toBe(false);
    const overview = await get('/admin');
    expect(overview.body).not.toContain('/admin/feedback');
  });
});

describe('list (Requirement 5.2)', () => {
  it('defaults to status new, newest first, showing kind, status, preview and user id', async () => {
    const older = await seedFeedback({ message: 'older bug', created_at: new Date('2026-11-01T10:00:00Z') });
    const newer = await seedFeedback({ message: 'newer idea', kind: 'idea', created_at: new Date('2026-11-02T10:00:00Z') });
    await seedFeedback({ message: 'already handled', status: 'resolved' });
    const res = await get('/admin/feedback');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('newer idea');
    expect(res.body).toContain('older bug');
    expect(res.body).not.toContain('already handled');
    expect(res.body.indexOf('newer idea')).toBeLessThan(res.body.indexOf('older bug'));
    expect(res.body).toContain(`/admin/feedback/${newer}`);
    expect(res.body).toContain(`/admin/feedback/${older}`);
    expect(res.body).toContain(alice);
    expect(res.body).toContain('data-local-time');
  });

  it('filters by status and kind, and "all" shows every status', async () => {
    await seedFeedback({ message: 'a-new-bug' });
    await seedFeedback({ message: 'a-triaged-idea', kind: 'idea', status: 'triaged' });
    await seedFeedback({ message: 'a-resolved-bug', status: 'resolved' });
    const all = (await get('/admin/feedback?status=all')).body;
    expect(all).toContain('a-new-bug');
    expect(all).toContain('a-triaged-idea');
    expect(all).toContain('a-resolved-bug');
    const triaged = (await get('/admin/feedback?status=triaged')).body;
    expect(triaged).toContain('a-triaged-idea');
    expect(triaged).not.toContain('a-new-bug');
    const bugsAll = (await get('/admin/feedback?status=all&kind=bug')).body;
    expect(bugsAll).toContain('a-new-bug');
    expect(bugsAll).toContain('a-resolved-bug');
    expect(bugsAll).not.toContain('a-triaged-idea');
  });

  it('falls back to the defaults for unknown filter values', async () => {
    await seedFeedback({ message: 'visible-new' });
    const res = await get('/admin/feedback?status=bogus&kind=bogus&page=-4');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('visible-new');
  });

  it('pages at 50 rows', async () => {
    for (let i = 0; i < 51; i++) {
      await seedFeedback({ message: `row-${String(i).padStart(2, '0')}`, created_at: new Date(Date.UTC(2026, 10, 1, 0, i)) });
    }
    const first = (await get('/admin/feedback')).body;
    const second = (await get('/admin/feedback?status=new&kind=any&page=2')).body;
    expect(first).toContain('51 submissions match. Page 1 of 2.');
    expect(first).toContain('row-50');
    expect(first).not.toContain('row-00');
    expect(second).toContain('row-00');
    expect(second).not.toContain('row-50');
  });

  it('truncates a long message to a 120-character preview with an ellipsis', async () => {
    await seedFeedback({ message: `${'a'.repeat(120)}TAILMARK` });
    const body = (await get('/admin/feedback')).body;
    expect(body).toContain(`${'a'.repeat(120)}…`);
    expect(body).not.toContain('TAILMARK');
  });
});

describe('detail (Requirement 5.3)', () => {
  it('shows the full message, device info, timestamps and status actions', async () => {
    const id = await seedFeedback({
      message: 'Line one\nLine two',
      app_version: '1.4.0',
      platform: 'ios',
      os_version: '17.5',
    });
    const body = (await get(`/admin/feedback/${id}`)).body;
    expect(body).toContain('Line one\nLine two');
    expect(body).toContain('ios 17.5, app 1.4.0');
    expect(body).toContain(alice);
    expect(body).toContain('Mark Reviewed');
    expect(body).not.toContain('Triaged');
    expect(body).toContain('Mark Resolved');
    expect(body).not.toContain('Reopen');
    expect(body).toContain(`/admin/feedback/${id}/delete`);
  });

  it('says device info was not included when all three are null', async () => {
    const id = await seedFeedback();
    expect((await get(`/admin/feedback/${id}`)).body).toContain('Not included');
  });

  it('404 for an unknown id and for a non-uuid id', async () => {
    expect((await get(`/admin/feedback/${randomUUID()}`)).statusCode).toBe(404);
    expect((await get('/admin/feedback/not-a-uuid')).statusCode).toBe(404);
  });

  // Feature: in-app-feedback, Property 11: Contact email is shown to the operator only with consent
  it('Property 11: shows the contact email iff contact_ok and an email is stored, and never on the list', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.boolean(), async (contactOk, hasEmail) => {
        await pool.query(`DELETE FROM user_feedback`);
        // chk_uf_contact forbids an email without consent, so (false, true) cannot be stored.
        const email = contactOk && hasEmail ? 'consenting.user@example.com' : null;
        const id = await seedFeedback({ contact_ok: contactOk, contact_email: email });
        const detail = (await get(`/admin/feedback/${id}`)).body;
        expect(detail.includes('consenting.user@example.com')).toBe(email !== null);
        const list = (await get('/admin/feedback?status=all')).body;
        expect(list.includes('consenting.user@example.com')).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('explains when the user did not consent to be contacted', async () => {
    const id = await seedFeedback({ contact_ok: false });
    expect((await get(`/admin/feedback/${id}`)).body).toContain('did not consent');
  });
});

describe('escaping (Requirement 5.5, Property 9)', () => {
  it('renders a script payload as text on the list and the detail page', async () => {
    const payload = `<script>alert('xss')</script><img src=x onerror="alert(1)">&amp;`;
    const id = await seedFeedback({ message: payload });
    const detail = (await get(`/admin/feedback/${id}`)).body;
    const list = (await get('/admin/feedback')).body;
    for (const body of [detail, list]) {
      expect(body).not.toContain('<script>alert');
      expect(body).not.toContain('<img src=x');
      expect(body).toContain(escapeHtml(payload));
    }
  });

  it('escapes the flash message from the query string', async () => {
    const res = await get(`/admin/feedback?flash=${encodeURIComponent('<b>hi</b>')}`);
    expect(res.body).not.toContain('<b>hi</b>');
    expect(res.body).toContain('&lt;b&gt;hi&lt;/b&gt;');
  });

  // Feature: in-app-feedback, Property 9: Admin output is escaped
  it('Property 9: no stored message appears raw, and its escaped form always appears on the detail page', async () => {
    const special = fc.stringMatching(/^[<>&"' a-z]{1,40}$/);
    await fc.assert(
      fc.asyncProperty(special, async (s) => {
        await pool.query(`DELETE FROM user_feedback`);
        const message = `ZZ${s}ZZ`;
        const id = await seedFeedback({ message });
        const detail = (await get(`/admin/feedback/${id}`)).body;
        const list = (await get('/admin/feedback')).body;
        expect(detail).toContain(escapeHtml(message));
        expect(list).toContain(escapeHtml(message));
        if (escapeHtml(message) !== message) {
          expect(detail).not.toContain(message);
          expect(list).not.toContain(message);
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe('actions (Requirement 5.4), posting real urlencoded forms', () => {
  it('sets triaged, then resolved, then back to new, redirecting to the detail page with a flash', async () => {
    const id = await seedFeedback();
    for (const status of ['triaged', 'resolved', 'new']) {
      const res = await app.inject({ method: 'POST', url: `/admin/feedback/${id}/status`, headers: FORM, payload: form({ status }) });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain(`/admin/feedback/${id}?flash=`);
      expect((await rows())[0]?.['status']).toBe(status);
    }
  });

  it('shows the resulting status and flash on the redirected detail page, and a Reopen action when resolved', async () => {
    const id = await seedFeedback();
    const res = await app.inject({ method: 'POST', url: `/admin/feedback/${id}/status`, headers: FORM, payload: form({ status: 'resolved' }) });
    const page = await get(String(res.headers.location));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Marked Resolved.');
    expect(page.body).toContain('Reopen (New)');
  });

  it('rejects an unknown status with 400 and an in-page message, changing nothing', async () => {
    const id = await seedFeedback();
    const res = await app.inject({ method: 'POST', url: `/admin/feedback/${id}/status`, headers: FORM, payload: form({ status: 'closed' }) });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Unknown status.');
    expect((await rows())[0]?.['status']).toBe('new');
  });

  it('rejects a missing status field the same way', async () => {
    const id = await seedFeedback();
    const res = await app.inject({ method: 'POST', url: `/admin/feedback/${id}/status`, headers: FORM, payload: '' });
    expect(res.statusCode).toBe(400);
    expect((await rows())[0]?.['status']).toBe('new');
  });

  it('answers 404 for a status change on an unknown or malformed id', async () => {
    for (const id of [randomUUID(), 'nope']) {
      const res = await app.inject({ method: 'POST', url: `/admin/feedback/${id}/status`, headers: FORM, payload: form({ status: 'resolved' }) });
      expect(res.statusCode, id).toBe(404);
    }
  });

  it('deletes one submission, leaves the others, and reports a repeat delete as already gone', async () => {
    const id = await seedFeedback({ message: 'to delete' });
    const keep = await seedFeedback({ message: 'to keep' });
    const first = await app.inject({ method: 'POST', url: `/admin/feedback/${id}/delete`, headers: FORM, payload: '' });
    expect(first.statusCode).toBe(302);
    expect((await rows()).map((r) => r['id'])).toEqual([keep]);
    const again = await app.inject({ method: 'POST', url: `/admin/feedback/${id}/delete`, headers: FORM, payload: '' });
    expect(again.statusCode).toBe(302);
    expect(decodeURIComponent(String(again.headers.location))).toContain('no longer exists');
    expect(await rows()).toHaveLength(1);
  });
});

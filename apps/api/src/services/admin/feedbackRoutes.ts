/**
 * Admin_Panel "User Feedback" section (`/admin/feedback`; `.kiro/specs/in-app-feedback` Requirement 5, `admin-panel`
 * Requirement 20). Follows `diningPlanRoutes.ts`: Basic Auth on every route, the same-origin check on every POST,
 * `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store` on every response, every value through
 * `escapeHtml` (a message is untrusted user text), pages through `renderPage`, and a flash redirect after a POST.
 *
 * The routes run in their own child scope, which parses `application/x-www-form-urlencoded` bodies (an HTML form's
 * POST); the other admin routes are not affected. The contact email is shown only when the user consented.
 */
import {
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  type FeedbackKind,
  type FeedbackStatus,
} from '@dwt/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { previewMessage } from '../feedback/policy.js';
import type { AdminFeedbackPort, FeedbackRow } from '../feedback/repo.js';
import { escapeHtml, localTime, renderPage, table } from './html.js';
import type { AdminRoutesOptions } from './routes.js';
import { isSameOriginRequest } from './sameOrigin.js';

export const FEEDBACK_ADMIN_BASE = '/admin/feedback';
export const FEEDBACK_ADMIN_PAGE_SIZE = 50;
export const FEEDBACK_PREVIEW_CHARS = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const KIND_LABELS: Readonly<Record<FeedbackKind, string>> = { bug: 'Bug', idea: 'Idea', other: 'Other' };
const STATUS_LABELS: Readonly<Record<FeedbackStatus, string>> = { new: 'New', triaged: 'Reviewed', resolved: 'Resolved' };

function setSecurityHeaders(reply: FastifyReply): void {
  reply.header('X-Robots-Tag', 'noindex, nofollow');
  reply.header('Cache-Control', 'private, no-store');
}

function send(reply: FastifyReply, title: string, html: string, status = 200): FastifyReply {
  return reply.type('text/html; charset=utf-8').status(status).send(renderPage(title, html, FEEDBACK_ADMIN_BASE));
}

function redirect(reply: FastifyReply, path: string, flash: string): FastifyReply {
  return reply.redirect(`${path}?flash=${encodeURIComponent(flash)}`);
}

function flashBox(flash: string | undefined): string {
  return flash === undefined || flash === ''
    ? ''
    : `<div class="flash flash-success"><strong>Done:</strong> ${escapeHtml(flash)}</div>`;
}

function errorBox(message: string): string {
  return `<div class="flash flash-error" role="alert"><strong>Nothing was changed:</strong> ${escapeHtml(message)}</div>`;
}

function formOf(request: FastifyRequest): Record<string, string> {
  const body = request.body;
  if (body === null || typeof body !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  return out;
}

function isKind(value: unknown): value is FeedbackKind {
  return typeof value === 'string' && (FEEDBACK_KINDS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is FeedbackStatus {
  return typeof value === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

interface ListQuery {
  readonly status: FeedbackStatus | 'all';
  readonly kind: FeedbackKind | 'any';
  readonly page: number;
}

/** `?status=` defaults to `new`; `all` shows every status. Unknown values fall back to the defaults. */
function parseListQuery(raw: Record<string, unknown>): ListQuery {
  const status = raw.status === 'all' ? 'all' : isStatus(raw.status) ? raw.status : 'new';
  const kind = isKind(raw.kind) ? raw.kind : 'any';
  const parsedPage = typeof raw.page === 'string' ? Number.parseInt(raw.page, 10) : 1;
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 100_000 ? parsedPage : 1;
  return { status, kind, page };
}

function listHref(q: ListQuery, page: number): string {
  return `${FEEDBACK_ADMIN_BASE}?status=${q.status}&kind=${q.kind}&page=${page}`;
}

function listPage(rows: readonly FeedbackRow[], total: number, q: ListQuery, flash: string | undefined): string {
  const pages = Math.max(1, Math.ceil(total / FEEDBACK_ADMIN_PAGE_SIZE));
  const filter = `<form method="GET" action="${FEEDBACK_ADMIN_BASE}" class="filter-form">
    <label>Status
      <select name="status" class="form-input form-input-sm">
        ${option('all', 'All', q.status === 'all')}
        ${FEEDBACK_STATUSES.map((s) => option(s, STATUS_LABELS[s], q.status === s)).join('')}
      </select>
    </label>
    <label>Kind
      <select name="kind" class="form-input form-input-sm">
        ${option('any', 'Any', q.kind === 'any')}
        ${FEEDBACK_KINDS.map((k) => option(k, KIND_LABELS[k], q.kind === k)).join('')}
      </select>
    </label>
    <button type="submit" class="btn btn-sm">Filter</button>
  </form>`;
  const grid = table(rows, [
    { header: 'Received', cell: (r) => localTime(r.createdAt) },
    { header: 'Kind', cell: (r) => escapeHtml(KIND_LABELS[r.kind]) },
    { header: 'Status', cell: (r) => escapeHtml(STATUS_LABELS[r.status]) },
    {
      header: 'Message',
      cell: (r) =>
        `<a href="${FEEDBACK_ADMIN_BASE}/${escapeHtml(r.id)}">${escapeHtml(previewMessage(r.message, FEEDBACK_PREVIEW_CHARS))}</a>`,
    },
    { header: 'User', cell: (r) => `<span class="mono">${escapeHtml(r.userId)}</span>` },
  ]);
  const prev = q.page > 1 ? `<a class="btn btn-sm btn-secondary" href="${escapeHtml(listHref(q, q.page - 1))}">&larr; Newer</a>` : '';
  const next = q.page < pages ? `<a class="btn btn-sm btn-secondary" href="${escapeHtml(listHref(q, q.page + 1))}">Older &rarr;</a>` : '';
  return `${flashBox(flash)}
  <p>${total} submission${total === 1 ? '' : 's'} match. Page ${q.page} of ${pages}.</p>
  ${filter}
  ${grid}
  <p>${prev} ${next}</p>`;
}

function statusForm(id: string, status: FeedbackStatus, label: string): string {
  return `<form method="POST" action="${FEEDBACK_ADMIN_BASE}/${escapeHtml(id)}/status" style="display:inline-block; margin-right: 0.5rem;">
    <input type="hidden" name="status" value="${escapeHtml(status)}">
    <button type="submit" class="btn btn-sm">${escapeHtml(label)}</button>
  </form>`;
}

function detailPage(row: FeedbackRow, flash: string | undefined, error: string | undefined): string {
  const device =
    row.appVersion !== null || row.platform !== null || row.osVersion !== null
      ? `${escapeHtml(row.platform ?? '-')} ${escapeHtml(row.osVersion ?? '-')}, app ${escapeHtml(row.appVersion ?? '-')}`
      : 'Not included';
  const contact =
    row.contactOk && row.contactEmail !== null
      ? `Yes: <span class="mono">${escapeHtml(row.contactEmail)}</span>`
      : 'No (the user did not consent to be contacted)';
  const actions = FEEDBACK_STATUSES.filter((s) => s !== row.status)
    .map((s) => statusForm(row.id, s, s === 'new' ? 'Reopen (New)' : `Mark ${STATUS_LABELS[s]}`))
    .join('');
  return `${flashBox(flash)}${error === undefined ? '' : errorBox(error)}
  <p><a href="${FEEDBACK_ADMIN_BASE}">&larr; Back to User Feedback</a></p>
  <table class="admin-table"><tbody>
    <tr><th>Kind</th><td>${escapeHtml(KIND_LABELS[row.kind])}</td></tr>
    <tr><th>Status</th><td>${escapeHtml(STATUS_LABELS[row.status])}</td></tr>
    <tr><th>Received</th><td>${localTime(row.createdAt)}</td></tr>
    <tr><th>Status changed</th><td>${localTime(row.statusChangedAt)}</td></tr>
    <tr><th>User id</th><td><span class="mono">${escapeHtml(row.userId)}</span></td></tr>
    <tr><th>Device info</th><td>${device}</td></tr>
    <tr><th>May contact</th><td>${contact}</td></tr>
  </tbody></table>
  <h2>Message</h2>
  <pre class="mono" style="white-space: pre-wrap; word-break: break-word;">${escapeHtml(row.message)}</pre>
  <h2>Actions</h2>
  <div>${actions}
    <form method="POST" action="${FEEDBACK_ADMIN_BASE}/${escapeHtml(row.id)}/delete" style="display:inline-block;"
          onsubmit="return confirm('Delete this submission permanently?');">
      <button type="submit" class="btn btn-sm btn-secondary">Delete</button>
    </form>
  </div>`;
}

export async function registerFeedbackRoutes(fastify: FastifyInstance, options: AdminRoutesOptions): Promise<void> {
  if (!options.feedback) return;
  const port: AdminFeedbackPort = options.feedback;

  await fastify.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(typeof body === 'string' ? body : body.toString('utf8'))));
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    const requireSameOrigin = async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isSameOriginRequest(request.headers)) {
        setSecurityHeaders(reply);
        return reply.status(403).send({ error: 'Forbidden', message: 'Cross-origin request refused' });
      }
    };
    const post = { preHandler: [options.basicAuth, requireSameOrigin] };
    const get = { preHandler: options.basicAuth };

    /** An unexpected error is an in-page message; the details go to the server log only (never the message text). */
    async function safely(reply: FastifyReply, title: string, fn: () => Promise<FastifyReply>): Promise<FastifyReply> {
      setSecurityHeaders(reply);
      try {
        return await fn();
      } catch (err) {
        reply.log.error({ errName: err instanceof Error ? err.name : 'unknown', section: title }, 'admin feedback action failed');
        return send(
          reply,
          `Error - ${title}`,
          `<div class="error-box"><h2>${escapeHtml(title)}</h2><p>Something went wrong; nothing more was changed. The details are in the server log.</p><p><a href="${FEEDBACK_ADMIN_BASE}">&larr; Back to User Feedback</a></p></div>`,
          500,
        );
      }
    }

    function notFound(reply: FastifyReply): FastifyReply {
      return send(
        reply,
        'User Feedback',
        `<div class="error-box"><p>That submission no longer exists.</p><p><a href="${FEEDBACK_ADMIN_BASE}">&larr; Back to User Feedback</a></p></div>`,
        404,
      );
    }

    scope.get(FEEDBACK_ADMIN_BASE, get, async (request, reply) =>
      safely(reply, 'User Feedback', async () => {
        const raw = request.query as Record<string, unknown>;
        const q = parseListQuery(raw);
        const { rows, total } = await port.list({
          ...(q.status === 'all' ? {} : { status: q.status }),
          ...(q.kind === 'any' ? {} : { kind: q.kind }),
          limit: FEEDBACK_ADMIN_PAGE_SIZE,
          offset: (q.page - 1) * FEEDBACK_ADMIN_PAGE_SIZE,
        });
        return send(reply, 'User Feedback', listPage(rows, total, q, typeof raw.flash === 'string' ? raw.flash : undefined));
      }),
    );

    scope.get(`${FEEDBACK_ADMIN_BASE}/:id`, get, async (request, reply) =>
      safely(reply, 'User Feedback', async () => {
        const { id } = request.params as { id: string };
        const row = UUID.test(id) ? await port.get(id) : null;
        if (row === null) return notFound(reply);
        const flash = (request.query as { flash?: unknown }).flash;
        return send(reply, 'User Feedback', detailPage(row, typeof flash === 'string' ? flash : undefined, undefined));
      }),
    );

    scope.post(`${FEEDBACK_ADMIN_BASE}/:id/status`, post, async (request, reply) =>
      safely(reply, 'User Feedback', async () => {
        const { id } = request.params as { id: string };
        const status = formOf(request).status;
        const row = UUID.test(id) ? await port.get(id) : null;
        if (row === null) return notFound(reply);
        if (!isStatus(status)) {
          return send(reply, 'User Feedback', detailPage(row, undefined, 'Unknown status.'), 400);
        }
        const changed = await port.setStatus(id, status, new Date());
        if (!changed) return notFound(reply);
        return redirect(reply, `${FEEDBACK_ADMIN_BASE}/${id}`, `Marked ${STATUS_LABELS[status]}.`);
      }),
    );

    scope.post(`${FEEDBACK_ADMIN_BASE}/:id/delete`, post, async (request, reply) =>
      safely(reply, 'User Feedback', async () => {
        const { id } = request.params as { id: string };
        const deleted = UUID.test(id) && (await port.remove(id));
        return redirect(reply, FEEDBACK_ADMIN_BASE, deleted ? 'Submission deleted.' : 'That submission no longer exists.');
      }),
    );
  });
}

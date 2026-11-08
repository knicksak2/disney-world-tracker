/**
 * Admin Panel Hidden Mickeys Review & Management routes (Task 7.2).
 *
 * Implements:
 *  - GET /admin/mickeys: index page with 5 sections (Requirement 8.1, 8.8, 8.9, 15.5):
 *      1. Pending submissions (oldest first, with Source, text_screen marker, experience, submitter)
 *      2. Soft-hidden entries or entries with open reports (Official first)
 *      3. Ready to promote: Community Verified community entries
 *      4. Confidence label 'possibly_removed' approved entries
 *      5. Inactive experience groups (read-only advisory prompt per Requirement 8.9)
 *  - GET /admin/mickeys/:id: detail page with text layers, source, official, submitter, same-experience duplicates, reports, and actions
 *  - POST actions: approve, reject, edit, retire, restore, promote, dismiss-reports, ban, unban
 *  - Security headers: X-Robots-Tag: noindex, nofollow, Cache-Control: private, no-store (Requirement 8.7, 15.4)
 *  - CSRF: requireSameOrigin on mutating POST actions
 *
 * Validates: Requirements 1.3, 7.6, 8.1 - 8.9, 15.4, 15.5, Properties 11, 14, 20, 22
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { escapeHtml, explainerBanner, localTime, renderPage, table } from './html.js';
import type { AdminRoutesOptions } from './routes.js';
import { isSameOriginRequest } from './sameOrigin.js';
import { AdminMickeyService } from '../mickeys/adminService.js';
import {
  stillThereConfidence,
  confidenceLabel,
} from '../mickeys/domain/stillThere.js';
import {
  type MickeyZone,
  type MickeyDifficulty,
  MICKEY_ZONES,
  MICKEY_DIFFICULTIES,
} from '@dwt/shared';

export async function registerMickeyRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions,
): Promise<void> {
  const requireSameOrigin = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (!isSameOriginRequest(request.headers)) {
      reply.header('X-Robots-Tag', 'noindex, nofollow');
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Cross-origin request refused',
      });
    }
  };

  function setSecurityHeaders(reply: FastifyReply): void {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    reply.header('Cache-Control', 'private, no-store');
  }

  const pool = options.pool ?? (options.repo as unknown as { pool: import('../../db/pool.js').DbPool }).pool;
  const adminService = options.mickeys ?? new AdminMickeyService({ pool });

  // ---------------------------------------------------------------------------
  // 1. GET /admin/mickeys (Requirement 8.1, 8.8, 8.9)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/admin/mickeys',
    { preHandler: options.basicAuth },
    async (_request, reply) => {
      setSecurityHeaders(reply);

      // Section 1: Pending submissions (oldest first)
      const pendingRes = await pool.query<{
        id: string;
        experience_id: string;
        experience_name: string;
        source: string;
        text_screen: string;
        clue_1: string;
        zone: string;
        difficulty: string;
        created_at: Date;
        submitter_name: string | null;
        submitter_id: string | null;
      }>(
        `SELECT hm.id, hm.experience_id, e.name AS experience_name, hm.source,
                hm.text_screen, hm.clue_1, hm.zone, hm.difficulty, hm.created_at,
                p.display_name AS submitter_name, hm.submitter_id
           FROM hidden_mickeys hm
           JOIN experiences e ON e.id = hm.experience_id
           LEFT JOIN profile_identity p ON p.user_id = hm.submitter_id
          WHERE hm.status = 'pending'
          ORDER BY hm.created_at ASC`,
      );

      // Section 2: Hidden entries or entries with open reports (Official first)
      const reportsRes = await pool.query<{
        id: string;
        experience_id: string;
        experience_name: string;
        official: boolean;
        status: string;
        hidden_reason: string | null;
        clue_1: string;
        total_reports: number;
        counted_reports: number;
        report_reasons: string[] | null;
      }>(
        `SELECT hm.id, hm.experience_id, e.name AS experience_name, hm.official,
                hm.status, hm.hidden_reason, hm.clue_1,
                count(DISTINCT r.user_id)::int AS total_reports,
                count(DISTINCT CASE WHEN mp.found_at IS NOT NULL THEN r.user_id END)::int AS counted_reports,
                array_agg(DISTINCT r.reason) AS report_reasons
           FROM hidden_mickeys hm
           JOIN experiences e ON e.id = hm.experience_id
           LEFT JOIN mickey_reports r ON r.mickey_id = hm.id AND r.status = 'open'
           LEFT JOIN mickey_progress mp ON mp.user_id = r.user_id AND mp.mickey_id = hm.id
          WHERE hm.status = 'hidden' OR r.user_id IS NOT NULL
          GROUP BY hm.id, hm.experience_id, e.name, hm.official, hm.status, hm.hidden_reason, hm.clue_1
          ORDER BY hm.official DESC, total_reports DESC, hm.created_at DESC`,
      );

      // Section 3: Ready to promote (approved community with >= 3 net there votes)
      const readyRes = await pool.query<{
        id: string;
        experience_id: string;
        experience_name: string;
        park: string | null;
        clue_1: string;
        zone: string;
        difficulty: string;
        net_there: number;
      }>(
        `SELECT hm.id, hm.experience_id, e.name AS experience_name, e.park,
                hm.clue_1, hm.zone, hm.difficulty,
                COALESCE(SUM(CASE WHEN v.vote = 'there' THEN 1 WHEN v.vote = 'gone' THEN -1 ELSE 0 END), 0)::int AS net_there
           FROM hidden_mickeys hm
           JOIN experiences e ON e.id = hm.experience_id
           LEFT JOIN mickey_still_there_votes v ON v.mickey_id = hm.id AND v.user_id <> hm.submitter_id
          WHERE hm.status = 'approved' AND hm.official = FALSE
          GROUP BY hm.id, hm.experience_id, e.name, e.park, hm.clue_1, hm.zone, hm.difficulty
         HAVING COALESCE(SUM(CASE WHEN v.vote = 'there' THEN 1 WHEN v.vote = 'gone' THEN -1 ELSE 0 END), 0) >= 3
          ORDER BY net_there DESC`,
      );

      // Section 4: Possibly removed entries
      const approvedVotesRes = await pool.query<{
        id: string;
        experience_id: string;
        experience_name: string;
        official: boolean;
        clue_1: string;
        user_id: string;
        vote: 'there' | 'gone';
        voted_at: Date;
      }>(
        `SELECT hm.id, hm.experience_id, e.name AS experience_name, hm.official, hm.clue_1,
                v.user_id, v.vote, v.voted_at
           FROM hidden_mickeys hm
           JOIN experiences e ON e.id = hm.experience_id
           JOIN mickey_still_there_votes v ON v.mickey_id = hm.id
          WHERE hm.status = 'approved'`,
      );

      const votesMap = new Map<
        string,
        {
          id: string;
          experienceName: string;
          official: boolean;
          clue1: string;
          votes: Array<{ vote: 'there' | 'gone'; votedAt: Date }>;
        }
      >();
      for (const r of approvedVotesRes.rows) {
        let entry = votesMap.get(r.id);
        if (!entry) {
          entry = {
            id: r.id,
            experienceName: r.experience_name,
            official: r.official,
            clue1: r.clue_1,
            votes: [],
          };
          votesMap.set(r.id, entry);
        }
        entry.votes.push({
          vote: r.vote,
          votedAt: r.voted_at instanceof Date ? r.voted_at : new Date(r.voted_at),
        });
      }

      const possiblyRemovedItems: Array<{
        id: string;
        experienceName: string;
        official: boolean;
        clue1: string;
        goneVotes: number;
        thereVotes: number;
      }> = [];
      const now = new Date();
      for (const entry of votesMap.values()) {
        const score = stillThereConfidence(entry.votes, now);
        const label = confidenceLabel(score);
        if (label === 'possibly_removed') {
          const gone = entry.votes.filter((v) => v.vote === 'gone').length;
          const there = entry.votes.filter((v) => v.vote === 'there').length;
          possiblyRemovedItems.push({
            id: entry.id,
            experienceName: entry.experienceName,
            official: entry.official,
            clue1: entry.clue1,
            goneVotes: gone,
            thereVotes: there,
          });
        }
      }

      // Section 5 (Requirement 8.9): Approved Hidden Mickeys whose whole Experience Group has no active Experience
      const inactiveRes = await pool.query<{
        id: string;
        experience_id: string;
        experience_name: string;
        clue_1: string;
        official: boolean;
      }>(
        `WITH group_activity AS (
           SELECT
             COALESCE(a.canonical_experience_id, e.id) AS canonical_id,
             COUNT(CASE WHEN e.active = TRUE THEN 1 END)::int AS active_count
           FROM experiences e
           LEFT JOIN mickey_experience_aliases a ON a.alias_experience_id = e.id
           GROUP BY COALESCE(a.canonical_experience_id, e.id)
         )
         SELECT hm.id, hm.experience_id, e.name AS experience_name, hm.clue_1, hm.official
           FROM hidden_mickeys hm
           JOIN experiences e ON e.id = hm.experience_id
           LEFT JOIN mickey_experience_aliases a ON a.alias_experience_id = hm.experience_id
           JOIN group_activity ga ON ga.canonical_id = COALESCE(a.canonical_experience_id, hm.experience_id)
          WHERE hm.status = 'approved'
            AND ga.active_count = 0
          ORDER BY e.name ASC`,
      );

      // HTML Render
      const guideline = explainerBanner(
        'ℹ️',
        'Review Guideline',
        'A Hidden Mickey is never accepted for a location closed to guests. Backstage or cast-member-only locations must be rejected. Links and email addresses are prohibited.',
      );

      const pendingTable = table(pendingRes.rows, [
        {
          header: 'ID / Clue 1',
          cell: (r) => `
            <div><a href="/admin/mickeys/${escapeHtml(r.id)}"><strong>${escapeHtml(r.clue_1)}</strong></a></div>
            <div class="mono text-muted" style="font-size:0.75rem;">${escapeHtml(r.id)}</div>
          `,
        },
        { header: 'Experience', cell: (r) => escapeHtml(r.experience_name) },
        {
          header: 'Zone / Difficulty',
          cell: (r) => `<span class="badge badge-info">${escapeHtml(r.zone)} · ${escapeHtml(r.difficulty)}</span>`,
        },
        {
          header: 'Screening',
          cell: (r) => {
            const cls = r.text_screen === 'pass' ? 'badge-success' : r.text_screen === 'unscreened' ? 'badge-warning' : 'badge-danger';
            return `<span class="badge ${cls}">${escapeHtml(r.text_screen)}</span>`;
          },
        },
        {
          header: 'Submitter',
          cell: (r) => `<div>${escapeHtml(r.submitter_name ?? 'Anonymous')}</div><div class="mono text-muted" style="font-size:0.7rem;">${escapeHtml(r.submitter_id ?? '')}</div>`,
        },
        { header: 'Submitted', cell: (r) => localTime(r.created_at) },
        {
          header: 'Actions',
          cell: (r) => `
            <a href="/admin/mickeys/${escapeHtml(r.id)}" class="btn btn-sm btn-primary">Review</a>
          `,
        },
      ]);

      const reportsTable = table(reportsRes.rows, [
        {
          header: 'ID / Clue 1',
          cell: (r) => `
            <div><a href="/admin/mickeys/${escapeHtml(r.id)}"><strong>${escapeHtml(r.clue_1)}</strong></a></div>
            <div class="mono text-muted" style="font-size:0.75rem;">${escapeHtml(r.id)}</div>
          `,
        },
        { header: 'Experience', cell: (r) => escapeHtml(r.experience_name) },
        {
          header: 'Type',
          cell: (r) => (r.official ? '<span class="badge badge-primary">Official</span>' : '<span class="badge badge-secondary">Community</span>'),
        },
        {
          header: 'Status',
          cell: (r) => `<span class="badge ${r.status === 'hidden' ? 'badge-danger' : 'badge-warning'}">${escapeHtml(r.status)}${r.hidden_reason ? ` (${escapeHtml(r.hidden_reason)})` : ''}</span>`,
        },
        {
          header: 'Reports',
          cell: (r) => `
            <div><strong>${r.total_reports} total</strong> (${r.counted_reports} counted)</div>
            <div class="text-muted" style="font-size:0.75rem;">${escapeHtml((r.report_reasons ?? []).join(', '))}</div>
          `,
        },
        {
          header: 'Actions',
          cell: (r) => `
            <a href="/admin/mickeys/${escapeHtml(r.id)}" class="btn btn-sm btn-outline">Review</a>
          `,
        },
      ]);

      const readyTable = table(readyRes.rows, [
        {
          header: 'ID / Clue 1',
          cell: (r) => `
            <div><a href="/admin/mickeys/${escapeHtml(r.id)}"><strong>${escapeHtml(r.clue_1)}</strong></a></div>
            <div class="mono text-muted" style="font-size:0.75rem;">${escapeHtml(r.id)}</div>
          `,
        },
        { header: 'Experience', cell: (r) => escapeHtml(r.experience_name) },
        { header: 'Park', cell: (r) => escapeHtml(r.park ?? 'Resort') },
        {
          header: 'Community Net Votes',
          cell: (r) => `<span class="badge badge-success">+${r.net_there} there</span>`,
        },
        {
          header: 'Actions',
          cell: (r) => `
            <a href="/admin/mickeys/${escapeHtml(r.id)}" class="btn btn-sm btn-primary">Promote</a>
          `,
        },
      ]);

      const removedTable = table(possiblyRemovedItems, [
        {
          header: 'ID / Clue 1',
          cell: (r) => `
            <div><a href="/admin/mickeys/${escapeHtml(r.id)}"><strong>${escapeHtml(r.clue1)}</strong></a></div>
            <div class="mono text-muted" style="font-size:0.75rem;">${escapeHtml(r.id)}</div>
          `,
        },
        { header: 'Experience', cell: (r) => escapeHtml(r.experienceName) },
        {
          header: 'Type',
          cell: (r) => (r.official ? '<span class="badge badge-primary">Official</span>' : '<span class="badge badge-secondary">Community</span>'),
        },
        {
          header: 'Votes',
          cell: (r) => `<span class="badge badge-warning">${r.goneVotes} gone vs ${r.thereVotes} there</span>`,
        },
        {
          header: 'Actions',
          cell: (r) => `<a href="/admin/mickeys/${escapeHtml(r.id)}" class="btn btn-sm btn-outline">Inspect</a>`,
        },
      ]);

      const inactiveTable = table(inactiveRes.rows, [
        {
          header: 'ID / Clue 1',
          cell: (r) => `
            <div><a href="/admin/mickeys/${escapeHtml(r.id)}"><strong>${escapeHtml(r.clue_1)}</strong></a></div>
            <div class="mono text-muted" style="font-size:0.75rem;">${escapeHtml(r.id)}</div>
          `,
        },
        { header: 'Experience', cell: (r) => `<strong>${escapeHtml(r.experience_name)}</strong> <span class="badge badge-danger">Inactive Ride</span>` },
        {
          header: 'Type',
          cell: (r) => (r.official ? '<span class="badge badge-primary">Official</span>' : '<span class="badge badge-secondary">Community</span>'),
        },
        {
          header: 'Actions',
          cell: (r) => `<a href="/admin/mickeys/${escapeHtml(r.id)}" class="btn btn-sm btn-outline">View / Retire</a>`,
        },
      ]);

      const bodyHtml = `
        <div class="content-section">
          <h2>Hidden Mickeys Operator Queue</h2>
          ${guideline}

          <h3 style="margin-top: 1.5rem;">1. Pending Submissions (${pendingRes.rows.length})</h3>
          <p class="text-muted">Awaiting operator review before publishing to park visitors.</p>
          ${pendingRes.rows.length === 0 ? '<p class="text-muted">No pending submissions.</p>' : pendingTable}

          <h3 style="margin-top: 2rem;">2. Open Reports & Soft-Hidden Mickeys (${reportsRes.rows.length})</h3>
          <p class="text-muted">Official entries listed first. Three counted user reports auto-hide community entries; official entries require operator action.</p>
          ${reportsRes.rows.length === 0 ? '<p class="text-muted">No reported or hidden entries.</p>' : reportsTable}

          <h3 style="margin-top: 2rem;">3. Ready to Promote to Official (${readyRes.rows.length})</h3>
          <p class="text-muted">Approved community entries with 3+ net 'still there' votes. Promoting expands official park hunt totals.</p>
          ${readyRes.rows.length === 0 ? '<p class="text-muted">No community entries currently ready for promotion.</p>' : readyTable}

          <h3 style="margin-top: 2rem;">4. Possibly Removed Badges (${possiblyRemovedItems.length})</h3>
          <p class="text-muted">Entries flagged by recent visitor consensus as possibly removed. Does not reduce park totals.</p>
          ${possiblyRemovedItems.length === 0 ? '<p class="text-muted">No entries currently flagged as possibly removed.</p>' : removedTable}

          <h3 style="margin-top: 2rem;">5. Inactive Experience Group Advisories (${inactiveRes.rows.length})</h3>
          <div class="alert alert-info">
            <strong>Read-only advisory list:</strong> The hunt service never automatically retires, hides, or changes any Hidden Mickey due to an Experience's active flag (Requirement 8.9, 16.4). If an attraction is permanently closed, review and manually retire entries below.
          </div>
          ${inactiveRes.rows.length === 0 ? '<p class="text-muted">All approved entries have active attractions.</p>' : inactiveTable}
        </div>
      `;

      const html = renderPage('Hidden Mickeys Operator Queue', bodyHtml, '/admin/mickeys');
      reply.type('text/html; charset=utf-8').status(200).send(html);
    },
  );

  // ---------------------------------------------------------------------------
  // 2. GET /admin/mickeys/:id (Requirement 8.2)
  // ---------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    '/admin/mickeys/:id',
    { preHandler: options.basicAuth },
    async (request, reply) => {
      setSecurityHeaders(reply);
      const { id } = request.params;

      const mRes = await pool.query<{
        id: string;
        experience_id: string;
        experience_name: string;
        park: string | null;
        land: string | null;
        zone: MickeyZone;
        difficulty: MickeyDifficulty;
        clue_1: string;
        clue_2: string;
        reveal: string;
        official: boolean;
        source: string;
        status: string;
        hidden_reason: string | null;
        review_note: string | null;
        text_screen: string;
        submitter_id: string | null;
        submitter_name: string | null;
        created_at: Date;
        promoted_at: Date | null;
      }>(
        `SELECT hm.id, hm.experience_id, e.name AS experience_name, e.park, e.land,
                hm.zone, hm.difficulty, hm.clue_1, hm.clue_2, hm.reveal,
                hm.official, hm.source, hm.status, hm.hidden_reason, hm.review_note,
                hm.text_screen, hm.submitter_id, p.display_name AS submitter_name,
                hm.created_at, hm.promoted_at
           FROM hidden_mickeys hm
           JOIN experiences e ON e.id = hm.experience_id
           LEFT JOIN profile_identity p ON p.user_id = hm.submitter_id
          WHERE hm.id = $1`,
        [id],
      );

      const mickey = mRes.rows[0];
      if (!mickey) {
        return reply.status(404).send('Hidden Mickey not found');
      }

      // Check submitter ban status
      let isSubmitterBanned = false;
      if (mickey.submitter_id) {
        const banCheck = await pool.query(
          `SELECT 1 FROM mickey_submission_bans WHERE user_id = $1`,
          [mickey.submitter_id],
        );
        isSubmitterBanned = banCheck.rows.length > 0;
      }

      // Same-Experience approved duplicates (Requirement 8.2)
      const dupsRes = await pool.query<{
        id: string;
        clue_1: string;
        zone: string;
        difficulty: string;
        official: boolean;
      }>(
        `SELECT id, clue_1, zone, difficulty, official
           FROM hidden_mickeys
          WHERE experience_id = $1 AND id <> $2 AND status = 'approved'`,
        [mickey.experience_id, id],
      );

      // Reports for this Mickey (Requirement 8.2)
      const reportsRes = await pool.query<{
        user_id: string;
        reason: string;
        note: string | null;
        status: string;
        created_at: Date;
        reporter_name: string | null;
        is_counted: boolean;
      }>(
        `SELECT r.user_id, r.reason, r.note, r.status, r.created_at,
                p.display_name AS reporter_name,
                CASE WHEN mp.found_at IS NOT NULL THEN TRUE ELSE FALSE END AS is_counted
           FROM mickey_reports r
           LEFT JOIN profile_identity p ON p.user_id = r.user_id
           LEFT JOIN mickey_progress mp ON mp.user_id = r.user_id AND mp.mickey_id = r.mickey_id
          WHERE r.mickey_id = $1
          ORDER BY r.created_at DESC`,
        [id],
      );

      const dupsTable = table(dupsRes.rows, [
        {
          header: 'Clue 1',
          cell: (r) => `<a href="/admin/mickeys/${escapeHtml(r.id)}"><strong>${escapeHtml(r.clue_1)}</strong></a>`,
        },
        { header: 'Zone', cell: (r) => escapeHtml(r.zone) },
        { header: 'Difficulty', cell: (r) => escapeHtml(r.difficulty) },
        {
          header: 'Type',
          cell: (r) => (r.official ? '<span class="badge badge-primary">Official</span>' : '<span class="badge badge-secondary">Community</span>'),
        },
      ]);

      const reportsTable = table(reportsRes.rows, [
        { header: 'Reporter', cell: (r) => escapeHtml(r.reporter_name ?? r.user_id) },
        {
          header: 'Reason',
          cell: (r) => `<span class="badge badge-warning">${escapeHtml(r.reason)}</span>`,
        },
        { header: 'Note', cell: (r) => escapeHtml(r.note ?? '-') },
        {
          header: 'Counted?',
          cell: (r) => (r.is_counted ? '<span class="badge badge-success">Counted (has Find)</span>' : '<span class="badge badge-secondary">Uncounted</span>'),
        },
        { header: 'Status', cell: (r) => escapeHtml(r.status) },
        { header: 'Reported', cell: (r) => localTime(r.created_at) },
      ]);

      const bodyHtml = `
        <div class="content-section">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h2>Hidden Mickey: ${escapeHtml(mickey.clue_1)}</h2>
            <a href="/admin/mickeys" class="btn btn-outline">&larr; Back to Queue</a>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; margin-top: 1rem;">
            <div>
              <div class="card" style="padding: 1rem; margin-bottom: 1.5rem;">
                <h3>Clues & Reveal</h3>
                <p><strong>Clue 1:</strong> ${escapeHtml(mickey.clue_1)}</p>
                <p><strong>Clue 2:</strong> ${escapeHtml(mickey.clue_2)}</p>
                <p><strong>Reveal:</strong> ${escapeHtml(mickey.reveal)}</p>
                <div style="margin-top: 0.5rem;">
                  <span class="badge badge-info">${escapeHtml(mickey.zone)}</span>
                  <span class="badge badge-info">${escapeHtml(mickey.difficulty)}</span>
                </div>
              </div>

              <div class="card" style="padding: 1rem; margin-bottom: 1.5rem;">
                <h3>Edit Text & Classification</h3>
                <form method="POST" action="/admin/mickeys/${escapeHtml(mickey.id)}/edit">
                  <div style="margin-bottom: 0.75rem;">
                    <label><strong>Clue 1:</strong></label>
                    <input type="text" name="clue1" value="${escapeHtml(mickey.clue_1)}" class="form-control" style="width:100%;" required />
                  </div>
                  <div style="margin-bottom: 0.75rem;">
                    <label><strong>Clue 2:</strong></label>
                    <input type="text" name="clue2" value="${escapeHtml(mickey.clue_2)}" class="form-control" style="width:100%;" required />
                  </div>
                  <div style="margin-bottom: 0.75rem;">
                    <label><strong>Reveal:</strong></label>
                    <textarea name="reveal" class="form-control" style="width:100%;" rows="2" required>${escapeHtml(mickey.reveal)}</textarea>
                  </div>
                  <div style="display: flex; gap: 1rem; margin-bottom: 0.75rem;">
                    <div>
                      <label><strong>Zone:</strong></label>
                      <select name="zone" class="form-control">
                        ${MICKEY_ZONES.map((z) => `<option value="${z}" ${z === mickey.zone ? 'selected' : ''}>${z}</option>`).join('')}
                      </select>
                    </div>
                    <div>
                      <label><strong>Difficulty:</strong></label>
                      <select name="difficulty" class="form-control">
                        ${MICKEY_DIFFICULTIES.map((d) => `<option value="${d}" ${d === mickey.difficulty ? 'selected' : ''}>${d}</option>`).join('')}
                      </select>
                    </div>
                  </div>
                  <button type="submit" class="btn btn-sm btn-primary">Save Changes</button>
                </form>
              </div>

              <div class="card" style="padding: 1rem; margin-bottom: 1.5rem;">
                <h3>Same-Experience Approved Mickeys (${dupsRes.rows.length})</h3>
                <p class="text-muted">Check for duplicate submissions on ${escapeHtml(mickey.experience_name)}.</p>
                ${dupsRes.rows.length === 0 ? '<p class="text-muted">No other approved entries for this attraction.</p>' : dupsTable}
              </div>

              <div class="card" style="padding: 1rem;">
                <h3>Reports (${reportsRes.rows.length})</h3>
                ${reportsRes.rows.length === 0 ? '<p class="text-muted">No reports submitted.</p>' : reportsTable}
                ${reportsRes.rows.some((r) => r.status === 'open') ? `
                  <form method="POST" action="/admin/mickeys/${escapeHtml(mickey.id)}/dismiss-reports" style="margin-top: 0.75rem;">
                    <button type="submit" class="btn btn-sm btn-outline">Dismiss All Open Reports</button>
                  </form>
                ` : ''}
              </div>
            </div>

            <div>
              <div class="card" style="padding: 1rem; margin-bottom: 1.5rem;">
                <h3>Status & Metadata</h3>
                <p><strong>Status:</strong> <span class="badge ${mickey.status === 'approved' ? 'badge-success' : mickey.status === 'pending' ? 'badge-warning' : 'badge-danger'}">${escapeHtml(mickey.status)}</span></p>
                ${mickey.hidden_reason ? `<p><strong>Hidden Reason:</strong> ${escapeHtml(mickey.hidden_reason)}</p>` : ''}
                <p><strong>Type:</strong> ${mickey.official ? '<span class="badge badge-primary">Official</span>' : '<span class="badge badge-secondary">Community</span>'}</p>
                <p><strong>Source:</strong> ${escapeHtml(mickey.source)}</p>
                <p><strong>Text Screen:</strong> ${escapeHtml(mickey.text_screen)}</p>
                <p><strong>Attraction:</strong> ${escapeHtml(mickey.experience_name)}</p>
                <p><strong>Park / Land:</strong> ${escapeHtml(mickey.park ?? 'Resort')} / ${escapeHtml(mickey.land ?? 'General')}</p>
                <p><strong>Created:</strong> ${localTime(mickey.created_at)}</p>
                ${mickey.promoted_at ? `<p><strong>Promoted:</strong> ${localTime(mickey.promoted_at)}</p>` : ''}
                ${mickey.review_note ? `<p><strong>Review Note:</strong> ${escapeHtml(mickey.review_note)}</p>` : ''}
              </div>

              <div class="card" style="padding: 1rem; margin-bottom: 1.5rem;">
                <h3>Submitter</h3>
                <p><strong>User:</strong> ${escapeHtml(mickey.submitter_name ?? 'Anonymous')}</p>
                <p class="mono text-muted" style="font-size:0.75rem;">${escapeHtml(mickey.submitter_id ?? 'None (Seed)')}</p>
                ${mickey.submitter_id ? `
                  <div style="margin-top: 0.75rem;">
                    ${isSubmitterBanned ? `
                      <span class="badge badge-danger" style="margin-bottom:0.5rem; display:inline-block;">Banned</span>
                      <form method="POST" action="/admin/mickeys/unban">
                        <input type="hidden" name="userId" value="${escapeHtml(mickey.submitter_id)}" />
                        <button type="submit" class="btn btn-sm btn-outline">Unban Submitter</button>
                      </form>
                    ` : `
                      <form method="POST" action="/admin/mickeys/ban">
                        <input type="hidden" name="userId" value="${escapeHtml(mickey.submitter_id)}" />
                        <input type="text" name="reason" placeholder="Reason for ban" class="form-control" style="margin-bottom:0.5rem;" />
                        <button type="submit" class="btn btn-sm btn-danger">Ban Submitter</button>
                      </form>
                    `}
                  </div>
                ` : ''}
              </div>

              <div class="card" style="padding: 1rem;">
                <h3>Moderation Actions</h3>
                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                  ${mickey.status === 'pending' ? `
                    <form method="POST" action="/admin/mickeys/${escapeHtml(mickey.id)}/approve">
                      <button type="submit" class="btn btn-success" style="width:100%;">Approve</button>
                    </form>
                    <form method="POST" action="/admin/mickeys/${escapeHtml(mickey.id)}/reject">
                      <input type="text" name="reviewNote" placeholder="Rejection note (up to 300 chars)" class="form-control" style="margin-bottom:0.5rem;" />
                      <button type="submit" class="btn btn-danger" style="width:100%;">Reject</button>
                    </form>
                  ` : ''}

                  ${mickey.status === 'approved' && !mickey.official ? `
                    <form method="POST" action="/admin/mickeys/${escapeHtml(mickey.id)}/promote">
                      <div class="alert alert-info" style="font-size:0.8rem; padding: 0.5rem;">
                        Promoting will permanently add this Mickey to the Official hunt and increase the <strong>${escapeHtml(mickey.park ?? 'resort')}</strong> Official total by 1 for all explorers.
                      </div>
                      <button type="submit" class="btn btn-primary" style="width:100%;">Promote to Official</button>
                    </form>
                  ` : ''}

                  ${mickey.status === 'approved' ? `
                    <form method="POST" action="/admin/mickeys/${escapeHtml(mickey.id)}/retire">
                      <button type="submit" class="btn btn-warning" style="width:100%;">Retire Mickey</button>
                    </form>
                  ` : ''}

                  ${mickey.status === 'retired' || mickey.status === 'hidden' ? `
                    <form method="POST" action="/admin/mickeys/${escapeHtml(mickey.id)}/restore">
                      <button type="submit" class="btn btn-secondary" style="width:100%;">Restore to Approved</button>
                    </form>
                  ` : ''}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      const html = renderPage(`Review Mickey - ${mickey.clue_1}`, bodyHtml, '/admin/mickeys');
      reply.type('text/html; charset=utf-8').status(200).send(html);
    },
  );

  // ---------------------------------------------------------------------------
  // 3. POST Mutations (Requirement 8.3, 8.4, 8.6, 8.7)
  // ---------------------------------------------------------------------------

  fastify.post<{ Params: { id: string } }>(
    '/admin/mickeys/:id/approve',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      await adminService.approve(request.params.id);
      if (request.headers.accept?.includes('application/json')) {
        return reply.status(200).send({ ok: true });
      }
      return reply.redirect(303, `/admin/mickeys/${request.params.id}`);
    },
  );

  fastify.post<{ Params: { id: string }; Body: { reviewNote?: string } }>(
    '/admin/mickeys/:id/reject',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      const note = (request.body as { reviewNote?: string } | undefined)?.reviewNote;
      await adminService.reject(request.params.id, note);
      if (request.headers.accept?.includes('application/json')) {
        return reply.status(200).send({ ok: true });
      }
      return reply.redirect(303, `/admin/mickeys/${request.params.id}`);
    },
  );

  fastify.post<{
    Params: { id: string };
    Body: { clue1: string; clue2: string; reveal: string; zone: MickeyZone; difficulty: MickeyDifficulty };
  }>(
    '/admin/mickeys/:id/edit',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      const body = request.body as {
        clue1: string;
        clue2: string;
        reveal: string;
        zone: MickeyZone;
        difficulty: MickeyDifficulty;
      };
      await adminService.edit(request.params.id, body);
      if (request.headers.accept?.includes('application/json')) {
        return reply.status(200).send({ ok: true });
      }
      return reply.redirect(303, `/admin/mickeys/${request.params.id}`);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    '/admin/mickeys/:id/retire',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      await adminService.retire(request.params.id);
      if (request.headers.accept?.includes('application/json')) {
        return reply.status(200).send({ ok: true });
      }
      return reply.redirect(303, `/admin/mickeys/${request.params.id}`);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    '/admin/mickeys/:id/restore',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      await adminService.restore(request.params.id);
      if (request.headers.accept?.includes('application/json')) {
        return reply.status(200).send({ ok: true });
      }
      return reply.redirect(303, `/admin/mickeys/${request.params.id}`);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    '/admin/mickeys/:id/promote',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      const res = await adminService.promote(request.params.id);
      if (request.headers.accept?.includes('application/json')) {
        return reply.status(200).send({ ok: true, park: res.park });
      }
      return reply.redirect(303, `/admin/mickeys/${request.params.id}`);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    '/admin/mickeys/:id/dismiss-reports',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      await adminService.dismissReports(request.params.id);
      if (request.headers.accept?.includes('application/json')) {
        return reply.status(200).send({ ok: true });
      }
      return reply.redirect(303, `/admin/mickeys/${request.params.id}`);
    },
  );

  fastify.post<{ Body: { userId: string; reason?: string } }>(
    '/admin/mickeys/ban',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      const { userId, reason } = request.body as { userId: string; reason?: string };
      await adminService.banUser(userId, reason);
      if (request.headers.accept?.includes('application/json')) {
        return reply.status(200).send({ ok: true });
      }
      return reply.redirect(303, '/admin/mickeys');
    },
  );

  fastify.post<{ Body: { userId: string } }>(
    '/admin/mickeys/unban',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      const { userId } = request.body as { userId: string };
      await adminService.unbanUser(userId);
      if (request.headers.accept?.includes('application/json')) {
        return reply.status(200).send({ ok: true });
      }
      return reply.redirect(303, '/admin/mickeys');
    },
  );
}

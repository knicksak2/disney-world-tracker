/**
 * Admin Panel Photo Review Queue routes.
 *
 * Implements: Task 10.2, Task 10.3
 * Validates: Requirements 8.12, 9.8, 9.9, 18.1, 18.2, 18.3, 18.4, 18.5,
 *            18.6, 18.7, 18.8, 18.9, 18.10, 18.11, 18.12, 21.1
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { escapeHtml, explainerBanner, localTime, renderPage, table } from './html.js';
import type { AdminRoutesOptions } from './routes.js';
import { isSameOriginRequest } from './sameOrigin.js';
import { readKeysFor } from '../photos/domain/accessPolicy.js';
import type { PhotoStatus } from '@dwt/shared';

const PHOTOS_ADMIN_URL_TTL_SECONDS = 300;

export async function registerPhotoRoutes(
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

  // ---------------------------------------------------------------------------
  // GET /admin/photos: Photo review queue and 14-day usage
  // ---------------------------------------------------------------------------
  fastify.get(
    '/admin/photos',
    { preHandler: options.basicAuth },
    async (_request, reply) => {
      setSecurityHeaders(reply);

      const queue = await options.repo.listPhotoQueue();
      const usage = await options.repo.getPhotoUsage(14);
      const photosEnabled = options.photos !== undefined;

      // Presign URLs for each photo in the queue
      const itemsWithUrls = await Promise.all(
        queue.map(async (item) => {
          let thumbUrl: string | undefined;
          let fullUrl: string | undefined;

          if (photosEnabled && options.photos) {
            const keys = readKeysFor(
              { status: item.status as PhotoStatus, viewer: 'admin' },
              item.id,
            );
            const thumbKey = keys.thumb ?? keys.uploadThumb;
            const fullKey = keys.full ?? keys.uploadFull;

            if (thumbKey) {
              try {
                thumbUrl = await options.photos.presignGet(
                  thumbKey,
                  PHOTOS_ADMIN_URL_TTL_SECONDS,
                );
              } catch {
                // Non-fatal if single presign fails
              }
            }
            if (fullKey) {
              try {
                fullUrl = await options.photos.presignGet(
                  fullKey,
                  PHOTOS_ADMIN_URL_TTL_SECONDS,
                );
              } catch {
                // Non-fatal
              }
            }
          }

          return { ...item, thumbUrl, fullUrl };
        }),
      );

      const queueTable = table(itemsWithUrls, [
        {
          header: 'Preview',
          cell: (r) => {
            if (!photosEnabled) {
              return '<span class="text-muted">(disabled)</span>';
            }
            if (r.thumbUrl) {
              const fullLink = r.fullUrl ? `<br/><a href="${escapeHtml(r.fullUrl)}" target="_blank" rel="noopener noreferrer" style="font-size:0.75rem;">Full Image</a>` : '';
              return `<img src="${escapeHtml(r.thumbUrl)}" alt="Thumbnail" style="width: 64px; height: 64px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border);" />${fullLink}`;
            }
            return '<span class="text-muted">(no thumb)</span>';
          },
        },
        {
          header: 'ID / Target',
          cell: (r) => `
            <div class="mono" style="font-size: 0.8rem;">${escapeHtml(r.id)}</div>
            <div class="text-muted" style="font-size: 0.75rem;">Target: <strong>${escapeHtml(r.targetKind)}</strong></div>
          `,
        },
        {
          header: 'Status',
          cell: (r) => {
            let badgeClass = 'badge-info';
            if (r.status === 'hidden') badgeClass = 'badge-warning';
            if (r.status === 'needs_review') badgeClass = 'badge-danger';
            return `<span class="badge ${badgeClass}">${escapeHtml(r.status)}</span>`;
          },
        },
        {
          header: 'Uploader',
          cell: (r) => `
            <div><strong>${escapeHtml(r.uploaderName ?? 'Anonymous')}</strong></div>
            <div class="mono text-muted" style="font-size: 0.7rem;">${escapeHtml(r.ownerId ?? 'null')}</div>
          `,
        },
        {
          header: 'Reports',
          cell: (r) => {
            if (r.reportCount > 0) {
              return `<span class="badge badge-warning">⚠ ${escapeHtml(r.reportCount)} (${escapeHtml(r.reportReasons.join(', '))})</span>`;
            }
            return '<span class="text-muted">0</span>';
          },
        },
        {
          header: 'Vision',
          cell: (r) => {
            if (!r.visionFields) {
              return '<span class="text-muted">-</span>';
            }
            return `<pre style="font-size: 0.7rem; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: pre-wrap;">${escapeHtml(JSON.stringify(r.visionFields, null, 1))}</pre>`;
          },
        },
        {
          header: 'Created',
          cell: (r) => `<span style="font-size: 0.75rem;">${localTime(r.createdAt)}</span>`,
        },
        {
          header: 'Actions',
          cell: (r) => {
            const buttons: string[] = [];

            if (r.status === 'needs_review') {
              buttons.push(`
                <form method="POST" action="/admin/photos/${escapeHtml(r.id)}/approve" style="display:inline-block; margin: 2px;">
                  <button type="submit" class="btn btn-sm btn-primary">Approve</button>
                </form>
              `);
            }

            if (r.status === 'hidden') {
              buttons.push(`
                <form method="POST" action="/admin/photos/${escapeHtml(r.id)}/restore" style="display:inline-block; margin: 2px;">
                  <button type="submit" class="btn btn-sm btn-secondary">Restore</button>
                </form>
              `);
            }

            buttons.push(`
              <form method="POST" action="/admin/photos/${escapeHtml(r.id)}/remove" style="display:inline-block; margin: 2px;">
                <button type="submit" class="btn btn-sm btn-danger">Remove</button>
              </form>
            `);

            if (r.reportCount > 0) {
              buttons.push(`
                <form method="POST" action="/admin/photos/${escapeHtml(r.id)}/dismiss-reports" style="display:inline-block; margin: 2px;">
                  <button type="submit" class="btn btn-sm btn-outline">Dismiss Reports</button>
                </form>
              `);
            }

            return `<div style="display: flex; flex-direction: column; gap: 4px;">${buttons.join('')}</div>`;
          },
        },
      ]);

      const usageTable = table(usage, [
        {
          header: 'Day (UTC)',
          cell: (r) => `<span class="mono">${escapeHtml(typeof r.day === 'string' ? r.day : (r.day as Date).toISOString().split('T')[0])}</span>`,
        },
        { header: 'Uploads', cell: (r) => escapeHtml(r.uploads) },
        { header: 'Bytes', cell: (r) => escapeHtml(r.uploadBytes.toLocaleString()) },
        { header: 'Harm Calls', cell: (r) => escapeHtml(r.harmCalls) },
        { header: 'Vision Calls', cell: (r) => escapeHtml(r.visionCalls) },
        {
          header: 'Tokens (Prompt/Output)',
          cell: (r) => `<span class="mono">${escapeHtml(r.visionPromptTokens)} / ${escapeHtml(r.visionOutputTokens)}</span>`,
        },
        { header: 'Rejections', cell: (r) => escapeHtml(r.rejections) },
        { header: 'Needs Review', cell: (r) => escapeHtml(r.needsReview) },
        { header: 'Exif Present', cell: (r) => escapeHtml(r.exifPresent) },
      ]);

      const disabledNotice = !photosEnabled
        ? `
          <div class="card" style="background: var(--warning-bg); border: 1px solid var(--warning-border); margin-bottom: 1.5rem;">
            <p style="color: var(--warning-text); font-weight: 600;">Photos are disabled; thumbnails unavailable</p>
            <p class="text-muted" style="font-size: 0.85rem; margin-top: 0.25rem;">Object store access is disabled. Queue review operates in read-only mode for thumbnails; approve action is refused.</p>
          </div>
        `
        : '';

      const bodyHtml = `
        ${explainerBanner(
          '📸',
          'Photo Review Queue & Moderation',
          'Review flagged photos with open reports, hidden photos, and items requiring operator verdict. Remove offending content, uphold reports, or restore hidden photos.',
        )}
        ${disabledNotice}
        <div class="card">
          <h2>Review Queue (${queue.length})</h2>
          ${queueTable}
        </div>
        <div class="card" style="margin-top: 2rem;">
          <h2>Photo Usage (Trailing 14 Days)</h2>
          <p class="text-muted" style="font-size: 0.85rem; margin-bottom: 0.75rem;">
            Daily rollups from <code>photo_usage_daily</code> tracking storage, harm evaluation calls, vision tokens, rejections, and review queue entries.
          </p>
          ${usageTable}
        </div>
      `;

      const html = renderPage('Photo Review Queue', bodyHtml, '/admin/photos');
      return reply.type('text/html; charset=utf-8').status(200).send(html);
    },
  );

  // ---------------------------------------------------------------------------
  // Helper to render removal confirmation page
  // ---------------------------------------------------------------------------
  async function renderRemovalConfirmation(
    photoId: string,
    reply: FastifyReply,
    isRedirectResponse = false,
  ): Promise<void> {
    setSecurityHeaders(reply);
    const strikes = await options.repo.getUploaderStrikes(photoId);

    const confirmationHtml = `
      ${explainerBanner(
        '🗑️',
        'Photo Removal Confirmed',
        'The photo was deleted and its reports upheld. You can now optionally ban the uploader.',
      )}
      <div class="card">
        <h2>Photo Removed Successfully</h2>
        <p style="margin-bottom: 1rem;">Photo ID: <code>${escapeHtml(photoId)}</code></p>
        
        <div style="margin: 1.5rem 0; padding: 1rem; background: var(--card-elevated); border-radius: 6px; border: 1px solid var(--border);">
          <div style="font-size: 1.1rem; font-weight: 600; color: var(--warning-text);">
            Uploader Strikes: <span class="badge badge-warning">${escapeHtml(strikes)}</span>
          </div>
          <p class="text-muted" style="font-size: 0.85rem; margin-top: 0.25rem;">
            Total distinct photos removed for this uploader (upheld_count): <strong>${escapeHtml(strikes)}</strong>.
          </p>
        </div>

        <div style="display: flex; gap: 1rem; align-items: center; margin-top: 1.5rem;">
          <form method="POST" action="/admin/photos/${escapeHtml(photoId)}/ban-uploader" style="display:inline;">
            <input type="hidden" name="reason" value="Operator removal" />
            <button type="submit" class="btn btn-danger">Ban uploader</button>
          </form>
          <a href="/admin/photos" class="btn btn-secondary">&larr; Return to Photo Queue</a>
        </div>
      </div>
    `;

    const html = renderPage('Photo Removal Confirmation', confirmationHtml, '/admin/photos');

    if (isRedirectResponse) {
      reply
        .header('Location', `/admin/photos/${encodeURIComponent(photoId)}/removed`)
        .status(303)
        .type('text/html; charset=utf-8')
        .send(html);
    } else {
      reply.status(200).type('text/html; charset=utf-8').send(html);
    }
  }

  // ---------------------------------------------------------------------------
  // GET /admin/photos/:id/removed: Confirmation page target
  // ---------------------------------------------------------------------------
  fastify.get(
    '/admin/photos/:id/removed',
    { preHandler: options.basicAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return renderRemovalConfirmation(id, reply, false);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /admin/photos/:id/approve: Operator approves a needs_review photo
  // ---------------------------------------------------------------------------
  fastify.post(
    '/admin/photos/:id/approve',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      const { id } = request.params as { id: string };

      if (!options.photos) {
        return reply.status(400).type('text/html; charset=utf-8').send(
          renderPage(
            'Action Refused',
            `<div class="card">
              <h2>Photos are disabled; thumbnails unavailable</h2>
              <p>Cannot approve photo because photos service is disabled.</p>
              <p style="margin-top: 1rem;"><a href="/admin/photos">&larr; Return to Photo Queue</a></p>
            </div>`,
            '/admin/photos',
          ),
        );
      }

      const res = await options.photos.operatorApprove(id);
      const success = typeof res === 'boolean' ? res : res.success;
      if (!success) {
        return reply.status(400).type('text/html; charset=utf-8').send(
          renderPage(
            'Approval Failed',
            `<div class="card">
              <h2>Approval Failed</h2>
              <p>Photo ${escapeHtml(id)} could not be approved (invalid image or state changed).</p>
              <p style="margin-top: 1rem;"><a href="/admin/photos">&larr; Return to Photo Queue</a></p>
            </div>`,
            '/admin/photos',
          ),
        );
      }

      return reply.redirect('/admin/photos', 303);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /admin/photos/:id/restore: Restore a hidden photo to approved
  // ---------------------------------------------------------------------------
  fastify.post(
    '/admin/photos/:id/restore',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      const { id } = request.params as { id: string };
      await options.repo.restorePhoto(id);
      return reply.redirect('/admin/photos', 303);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /admin/photos/:id/remove: Remove a photo, uphold reports, increment strike
  // ---------------------------------------------------------------------------
  fastify.post(
    '/admin/photos/:id/remove',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await options.repo.removePhoto(id);
      return renderRemovalConfirmation(id, reply, true);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /admin/photos/:id/dismiss-reports: Dismiss all open reports on photo
  // ---------------------------------------------------------------------------
  fastify.post(
    '/admin/photos/:id/dismiss-reports',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      const { id } = request.params as { id: string };
      await options.repo.dismissPhotoReports(id);
      return reply.redirect('/admin/photos', 303);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /admin/photos/:id/ban-uploader: Ban the uploader of a photo
  // ---------------------------------------------------------------------------
  fastify.post(
    '/admin/photos/:id/ban-uploader',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (request, reply) => {
      setSecurityHeaders(reply);
      const { id } = request.params as { id: string };
      const body = (request.body as { reason?: string } | undefined) ?? {};
      await options.repo.banUploader(id, body.reason ?? 'Operator removal');

      const bodyHtml = `
        <div class="card">
          <h2>Uploader Banned Successfully</h2>
          <p>The uploader of photo <code>${escapeHtml(id)}</code> has been banned from photo uploads.</p>
          <p style="margin-top: 1rem;"><a href="/admin/photos">&larr; Return to Photo Queue</a></p>
        </div>
      `;
      const html = renderPage('Uploader Banned', bodyHtml, '/admin/photos');
      return reply.status(303).header('Location', '/admin/photos').type('text/html; charset=utf-8').send(html);
    },
  );
}

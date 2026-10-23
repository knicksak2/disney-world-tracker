/**
 * RecapShareGate — resolves access and Friendship verification for tripSummary recap shares.
 *
 * Implements: Task 21.3, Task 21.4
 * Validates: Requirements 15.3, 15.14, 15.15, 15.20, 16.8, decisions D25, D33
 */

import type { DbPool } from '../../db/pool.js';
import { pair as canonicalPair } from '../friends/canonicalPair.js';
import type { RecapShareAccess, RecapShareGate, TripShareFacts } from './ports.js';
import type { TripSummarySharePayload } from '@dwt/shared';

export interface TripRecapGateOptions {
  readonly pool: DbPool;
  readonly tripShareFacts: TripShareFacts;
}

export class DefaultRecapShareGate implements RecapShareGate {
  private readonly pool: DbPool;
  private readonly facts: TripShareFacts;

  constructor(options: TripRecapGateOptions) {
    this.pool = options.pool;
    this.facts = options.tripShareFacts;
  }

  async resolve(shareId: string, recipientId: string): Promise<RecapShareAccess | null> {
    // 1. One query joining share_recipients and shares (caller is recipient, not deleted, tripSummary)
    const shareRes = await this.pool.query<{
      sender_id: string;
      payload_snapshot: TripSummarySharePayload;
    }>(
      `SELECT s.sender_id, s.payload_snapshot
         FROM share_recipients sr
         JOIN shares s ON s.id = sr.share_id
        WHERE sr.share_id = $1
          AND sr.recipient_id = $2
          AND sr.recipient_deleted_at IS NULL
          AND s.payload_kind = 'tripSummary'`,
      [shareId, recipientId],
    );

    if (shareRes.rows.length === 0) {
      return null;
    }

    const row = shareRes.rows[0];
    if (!row) return null;
    const sharerId = row.sender_id;

    if (sharerId === recipientId) {
      return null;
    }

    // Friendship re-check (D25, R15.14): one primary-key lookup in friendships through canonicalPair
    let lo: string;
    let hi: string;
    try {
      const pair = canonicalPair(sharerId, recipientId);
      lo = pair.lo;
      hi = pair.hi;
    } catch {
      return null;
    }

    const friendRes = await this.pool.query<{ exists: number }>(
      `SELECT 1 as exists FROM active_friendships WHERE user_lo_id = $1 AND user_hi_id = $2`,
      [lo, hi],
    );

    if (friendRes.rows.length === 0) {
      return null;
    }

    const payload = row.payload_snapshot;
    const tripId = payload.tripId;
    const includePhotos = payload.includePhotos ?? true;

    // Check if trip exists and sharer is still a member
    const isMember = await this.facts.isMember(sharerId, tripId);
    const tripName = await this.facts.tripName(tripId);
    const tripAvailable = isMember && tripName !== null;

    return {
      tripId,
      sharerId,
      includePhotos,
      tripAvailable,
      tripName: tripName ?? payload.tripName,
      sharerDisplayName: payload.sharerDisplayName,
    };
  }
}

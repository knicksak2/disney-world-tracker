/**
 * Pin Showcase repository (Feature: pin-collection, Requirement 24).
 *
 * Implements persistence and invariants for custom pin showcase cork-boards:
 *   - Ownership gate: placement requires a claimed pin (Property 18)
 *   - Capacity bound: maximum SHOWCASE_MAX_PINS (24) pins (Property 20)
 *   - Non-overlap enforcement: minimum distance SHOWCASE_MIN_PIN_CLEARANCE (Property 22)
 *   - Idempotent upsert & z-index top-stacking (Property 19)
 *   - Read isolation: owner gets unplaced claimed pins; friend read omits unplaced (Property 21)
 */

import {
  overlapsAnyOtherPin,
  placementToReferencePx,
  SHOWCASE_MAX_PINS,
  SHOWCASE_MIN_PIN_CLEARANCE,
  SHOWCASE_REFERENCE_SIZE,
  type PinShowcaseDTO,
  type PinShowcasePlacementDTO,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';

export interface PinShowcaseRepoConfig {
  readonly maxPins?: number;
  readonly minClearance?: number;
  readonly referenceSize?: { readonly width: number; readonly height: number };
}

export interface PinShowcaseRepo {
  getShowcase(userId: string): Promise<PinShowcaseDTO>;
  getFriendShowcase(userId: string): Promise<PinShowcaseDTO>;
  placePin(
    userId: string,
    pinId: string,
    posX: number,
    posY: number,
  ): Promise<PinShowcasePlacementDTO>;
  removePin(userId: string, pinId: string): Promise<void>;
}

interface RawPlacementRow {
  pin_id: string;
  pos_x: number | string;
  pos_y: number | string;
  z_index: number | string;
}

export function createPinShowcaseRepo(
  pool: DbPool,
  config: PinShowcaseRepoConfig = {},
): PinShowcaseRepo {
  const maxPins = config.maxPins ?? SHOWCASE_MAX_PINS;
  const minClearance = config.minClearance ?? SHOWCASE_MIN_PIN_CLEARANCE;
  const referenceSize = config.referenceSize ?? SHOWCASE_REFERENCE_SIZE;

  async function getShowcase(userId: string): Promise<PinShowcaseDTO> {
    const placementsResult = await pool.query<RawPlacementRow>(
      `SELECT pin_id, pos_x, pos_y, z_index
       FROM pin_showcase_placements
       WHERE user_id = $1
       ORDER BY z_index ASC, placed_at ASC`,
      [userId],
    );

    const placements: PinShowcasePlacementDTO[] = placementsResult.rows.map((r) => ({
      pinId: r.pin_id,
      posX: Number(r.pos_x),
      posY: Number(r.pos_y),
      zIndex: Number(r.z_index),
    }));

    const claimedResult = await pool.query<{ pin_id: string }>(
      `SELECT pin_id
       FROM user_pins
       WHERE user_id = $1 AND claimed_at IS NOT NULL
       ORDER BY awarded_at ASC`,
      [userId],
    );

    const placedSet = new Set(placements.map((p) => p.pinId));
    const unplaced = claimedResult.rows
      .map((r) => r.pin_id)
      .filter((id) => !placedSet.has(id));

    return {
      ownerId: userId,
      placements,
      unplaced,
    };
  }

  async function getFriendShowcase(userId: string): Promise<PinShowcaseDTO> {
    const placementsResult = await pool.query<RawPlacementRow>(
      `SELECT pin_id, pos_x, pos_y, z_index
       FROM pin_showcase_placements
       WHERE user_id = $1
       ORDER BY z_index ASC, placed_at ASC`,
      [userId],
    );

    const placements: PinShowcasePlacementDTO[] = placementsResult.rows.map((r) => ({
      pinId: r.pin_id,
      posX: Number(r.pos_x),
      posY: Number(r.pos_y),
      zIndex: Number(r.z_index),
    }));

    return {
      ownerId: userId,
      placements,
    };
  }

  async function placePin(
    userId: string,
    pinId: string,
    posX: number,
    posY: number,
  ): Promise<PinShowcasePlacementDTO> {
    // 1. Ownership check (Requirement 24.1, Property 18): pin must be claimed by caller.
    const claimCheck = await pool.query<{ claimed_at: unknown }>(
      `SELECT claimed_at FROM user_pins WHERE user_id = $1 AND pin_id = $2`,
      [userId, pinId],
    );

    if (claimCheck.rows.length === 0 || claimCheck.rows[0]?.claimed_at == null) {
      throw new AppError('pin_not_eligible', `Pin "${pinId}" is not claimed by user`);
    }

    // 2. Read existing placements for this user.
    const existingResult = await pool.query<RawPlacementRow>(
      `SELECT pin_id, pos_x, pos_y, z_index
       FROM pin_showcase_placements
       WHERE user_id = $1`,
      [userId],
    );
    const existingRows = existingResult.rows;
    const isAlreadyPlaced = existingRows.some((p) => p.pin_id === pinId);

    // 3. Capacity check (Requirement 24.5, Property 20).
    if (!isAlreadyPlaced && existingRows.length >= maxPins) {
      throw new AppError('showcase_full', `Showcase capacity of ${maxPins} pins reached`);
    }

    // 4. Overlap check (Requirement 24.11, Property 22).
    const candidatePx = placementToReferencePx({ posX, posY }, referenceSize);
    const existingPx = existingRows.map((p) => ({
      pinId: p.pin_id,
      ...placementToReferencePx(
        { posX: Number(p.pos_x), posY: Number(p.pos_y) },
        referenceSize,
      ),
    }));

    if (
      overlapsAnyOtherPin(
        { pinId, x: candidatePx.x, y: candidatePx.y },
        existingPx,
        minClearance,
      )
    ) {
      throw new AppError(
        'showcase_position_overlap',
        'Placement overlaps another pin within minimum clearance',
      );
    }

    // 5. Stacking order: top of stack (design.md line 1110-1112).
    const maxZ = existingRows.reduce((max, p) => Math.max(max, Number(p.z_index)), -1);
    const nextZ = maxZ + 1;

    // 6. Upsert placement (Property 19).
    const upsertResult = await pool.query<RawPlacementRow>(
      `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y, z_index, placed_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, pin_id) DO UPDATE
       SET pos_x = EXCLUDED.pos_x,
           pos_y = EXCLUDED.pos_y,
           z_index = EXCLUDED.z_index,
           placed_at = EXCLUDED.placed_at
       RETURNING pin_id, pos_x, pos_y, z_index`,
      [userId, pinId, posX, posY, nextZ],
    );

    const placedRow = upsertResult.rows[0];
    if (!placedRow) {
      throw new AppError('internal_error', 'Failed to persist showcase placement');
    }

    return {
      pinId: placedRow.pin_id,
      posX: Number(placedRow.pos_x),
      posY: Number(placedRow.pos_y),
      zIndex: Number(placedRow.z_index),
    };
  }

  async function removePin(userId: string, pinId: string): Promise<void> {
    await pool.query(
      `DELETE FROM pin_showcase_placements WHERE user_id = $1 AND pin_id = $2`,
      [userId, pinId],
    );
  }

  return {
    getShowcase,
    getFriendShowcase,
    placePin,
    removePin,
  };
}

/**
 * Unit tests for Experience List schemas and error catalog.
 *
 * Direct structural port of `FoodList.test.ts`'s coverage — same shape of
 * assertions, adapted to the Experience_List entity's fields
 * (`experienceId`/`park`/`category` instead of `foodItemId`/no
 * `isChecklist`/`gotten`/`rating`).
 *
 * Covers valid and invalid cases for:
 *   - `experienceListNameSchema`
 *   - `createExperienceListInputSchema`
 *   - `updateExperienceListInputSchema`
 *   - `addExperienceListItemInputSchema`
 *   - `reorderExperienceListItemsInputSchema`
 *   - `shareExperienceListInputSchema`
 *   - `experienceListItemSchema`
 *   - `experienceListSchema`
 *   - `experienceListDetailSchema`
 *   - `experienceListShareSchema`
 *   - `experienceListCollectionSchema`
 *   - `experienceListDiscoveryPageSchema`
 *   - Experience list error codes and status mappings
 *
 * Validates: Requirements 1.2, 1.5, 2.2, 2.3, 2.6, 2.7, 2.9, 4.2, 6.6
 */

import { describe, expect, it } from 'vitest';

import { ERROR_CODES, errorCodeToHttpStatus } from '../../errors.js';
import {
  addExperienceListItemInputSchema,
  createExperienceListInputSchema,
  experienceListCollectionSchema,
  experienceListDetailSchema,
  experienceListDiscoveryPageSchema,
  experienceListItemSchema,
  experienceListNameSchema,
  experienceListRoleSchema,
  experienceListSchema,
  experienceListShareRoleSchema,
  experienceListShareSchema,
  experienceListVisibilitySchema,
  reorderExperienceListItemsInputSchema,
  shareExperienceListInputSchema,
  updateExperienceListInputSchema,
} from '../ExperienceList.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const UUID_D = '44444444-4444-4444-8444-444444444444';

describe('experienceListNameSchema', () => {
  it('accepts valid 1-100 character names and trims whitespace', () => {
    expect(experienceListNameSchema.parse('  Thrill Rides  ')).toBe('Thrill Rides');
    expect(experienceListNameSchema.parse('A')).toBe('A');
    expect(experienceListNameSchema.parse('A'.repeat(100))).toBe('A'.repeat(100));
  });

  it('rejects empty, whitespace-only, or oversized names', () => {
    expect(() => experienceListNameSchema.parse('')).toThrow();
    expect(() => experienceListNameSchema.parse('   ')).toThrow();
    expect(() => experienceListNameSchema.parse('A'.repeat(101))).toThrow();
  });
});

describe('experienceList enum schemas', () => {
  it('parses valid visibility values', () => {
    expect(experienceListVisibilitySchema.parse('private')).toBe('private');
    expect(experienceListVisibilitySchema.parse('public')).toBe('public');
    expect(() => experienceListVisibilitySchema.parse('hidden')).toThrow();
  });

  it('parses valid role values', () => {
    expect(experienceListRoleSchema.parse('owner')).toBe('owner');
    expect(experienceListRoleSchema.parse('editor')).toBe('editor');
    expect(experienceListRoleSchema.parse('viewer')).toBe('viewer');
    expect(() => experienceListRoleSchema.parse('admin')).toThrow();
  });

  it('parses valid share role values', () => {
    expect(experienceListShareRoleSchema.parse('editor')).toBe('editor');
    expect(experienceListShareRoleSchema.parse('viewer')).toBe('viewer');
    expect(() => experienceListShareRoleSchema.parse('owner')).toThrow();
  });
});

describe('createExperienceListInputSchema', () => {
  it('accepts valid name with visibility omitted', () => {
    const res = createExperienceListInputSchema.safeParse({ name: 'Must Do' });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.visibility).toBeUndefined();
    }
  });

  it('accepts valid name with visibility private and public', () => {
    const priv = createExperienceListInputSchema.safeParse({
      name: 'Must Do',
      visibility: 'private',
    });
    expect(priv.success).toBe(true);

    const pub = createExperienceListInputSchema.safeParse({
      name: 'Must Do',
      visibility: 'public',
    });
    expect(pub.success).toBe(true);
  });

  it('rejects invalid visibility value', () => {
    const res = createExperienceListInputSchema.safeParse({
      name: 'Must Do',
      visibility: 'unlisted',
    });
    expect(res.success).toBe(false);
  });

  it('rejects empty name, oversized name, and extra fields', () => {
    expect(createExperienceListInputSchema.safeParse({ name: '' }).success).toBe(false);
    expect(
      createExperienceListInputSchema.safeParse({ name: 'A'.repeat(101) }).success,
    ).toBe(false);
    expect(
      createExperienceListInputSchema.safeParse({ name: 'Valid', extra: true }).success,
    ).toBe(false);
  });
});

describe('updateExperienceListInputSchema', () => {
  it('accepts optional name, visibility, and pinned', () => {
    expect(updateExperienceListInputSchema.safeParse({}).success).toBe(true);
    expect(updateExperienceListInputSchema.safeParse({ name: 'New Name' }).success).toBe(true);
    expect(updateExperienceListInputSchema.safeParse({ visibility: 'public' }).success).toBe(true);
    expect(updateExperienceListInputSchema.safeParse({ pinned: true }).success).toBe(true);
    expect(updateExperienceListInputSchema.safeParse({ pinned: false }).success).toBe(true);
    expect(
      updateExperienceListInputSchema.safeParse({
        name: 'New Name',
        visibility: 'private',
        pinned: true,
      }).success,
    ).toBe(true);
  });

  it('rejects invalid visibility, empty/oversized name, and non-boolean pinned', () => {
    expect(updateExperienceListInputSchema.safeParse({ visibility: 'unlisted' }).success).toBe(
      false,
    );
    expect(updateExperienceListInputSchema.safeParse({ name: '' }).success).toBe(false);
    expect(
      updateExperienceListInputSchema.safeParse({ name: 'A'.repeat(101) }).success,
    ).toBe(false);
    expect(updateExperienceListInputSchema.safeParse({ pinned: 'yes' }).success).toBe(false);
  });
});

describe('addExperienceListItemInputSchema and reorderExperienceListItemsInputSchema', () => {
  it('validates addExperienceListItemInputSchema', () => {
    expect(addExperienceListItemInputSchema.safeParse({ experienceId: UUID_A }).success).toBe(
      true,
    );
    expect(
      addExperienceListItemInputSchema.safeParse({ experienceId: 'not-uuid' }).success,
    ).toBe(false);
  });

  it('validates reorderExperienceListItemsInputSchema', () => {
    expect(
      reorderExperienceListItemsInputSchema.safeParse({
        experienceIds: [UUID_A, UUID_B],
        expectedVersion: 3,
      }).success,
    ).toBe(true);

    // expectedVersion of 0 is valid (a brand-new list's initial version).
    expect(
      reorderExperienceListItemsInputSchema.safeParse({
        experienceIds: [UUID_A],
        expectedVersion: 0,
      }).success,
    ).toBe(true);
  });

  it('rejects a negative expectedVersion', () => {
    expect(
      reorderExperienceListItemsInputSchema.safeParse({
        experienceIds: [UUID_A],
        expectedVersion: -1,
      }).success,
    ).toBe(false);
  });

  it('rejects a non-integer expectedVersion and a non-uuid experienceIds entry', () => {
    expect(
      reorderExperienceListItemsInputSchema.safeParse({
        experienceIds: [UUID_A],
        expectedVersion: 1.5,
      }).success,
    ).toBe(false);

    expect(
      reorderExperienceListItemsInputSchema.safeParse({
        experienceIds: ['not-uuid'],
        expectedVersion: 0,
      }).success,
    ).toBe(false);
  });
});

describe('shareExperienceListInputSchema and experienceListShareSchema', () => {
  it('validates shareExperienceListInputSchema with viewer and editor roles', () => {
    expect(
      shareExperienceListInputSchema.safeParse({
        recipientId: UUID_A,
        role: 'viewer',
      }).success,
    ).toBe(true);

    expect(
      shareExperienceListInputSchema.safeParse({
        recipientId: UUID_A,
        role: 'editor',
      }).success,
    ).toBe(true);

    expect(
      shareExperienceListInputSchema.safeParse({
        recipientId: UUID_A,
        role: 'owner',
      }).success,
    ).toBe(false);
  });

  it('validates experienceListShareSchema', () => {
    expect(
      experienceListShareSchema.safeParse({
        recipientId: UUID_A,
        recipientDisplayName: 'Alex',
        role: 'editor',
        sharedAt: '2026-06-15T12:00:00Z',
      }).success,
    ).toBe(true);
  });
});

describe('experienceListItemSchema and experienceListDetailSchema', () => {
  const sampleItem = {
    experienceId: UUID_A,
    name: 'Space Mountain',
    park: 'Magic Kingdom' as const,
    category: 'Ride' as const,
    position: 0,
    addedByUserId: UUID_C,
    addedByDisplayName: 'Jordan',
  };

  const sampleList = {
    id: UUID_A,
    ownerId: UUID_B,
    ownerDisplayName: 'Jordan',
    name: 'Thrill Rides',
    visibility: 'public' as const,
    likeCount: 5,
    itemCount: 1,
    createdAt: '2026-06-15T12:00:00Z',
    updatedAt: '2026-06-15T12:00:00Z',
    pinnedAt: null,
  };

  it('validates experienceListItemSchema, including a null park and null attribution', () => {
    expect(experienceListItemSchema.safeParse(sampleItem).success).toBe(true);
    expect(
      experienceListItemSchema.safeParse({ ...sampleItem, park: null }).success,
    ).toBe(true);
    expect(
      experienceListItemSchema.safeParse({
        ...sampleItem,
        addedByUserId: null,
        addedByDisplayName: null,
      }).success,
    ).toBe(true);
  });

  it('rejects an invalid category on experienceListItemSchema', () => {
    expect(
      experienceListItemSchema.safeParse({ ...sampleItem, category: 'NotACategory' }).success,
    ).toBe(false);
  });

  it('validates experienceListSchema', () => {
    expect(experienceListSchema.safeParse(sampleList).success).toBe(true);
  });

  // Feature: list-pinning — pinnedAt accepts null (unpinned) or an ISO timestamp (pinned)
  it('validates experienceListSchema pinnedAt: null, a valid ISO timestamp, and rejects a non-timestamp string', () => {
    expect(experienceListSchema.safeParse({ ...sampleList, pinnedAt: null }).success).toBe(true);
    expect(
      experienceListSchema.safeParse({ ...sampleList, pinnedAt: '2026-09-20T08:00:00Z' }).success,
    ).toBe(true);
    expect(
      experienceListSchema.safeParse({ ...sampleList, pinnedAt: 'not-a-timestamp' }).success,
    ).toBe(false);
  });

  it('rejects a negative likeCount or itemCount on experienceListSchema', () => {
    expect(
      experienceListSchema.safeParse({ ...sampleList, likeCount: -1 }).success,
    ).toBe(false);
    expect(
      experienceListSchema.safeParse({ ...sampleList, itemCount: -1 }).success,
    ).toBe(false);
  });

  it('validates experienceListDetailSchema', () => {
    const detail = {
      ...sampleList,
      liked: true,
      saved: false,
      version: 2,
      myRole: 'owner' as const,
      items: [sampleItem],
    };
    expect(experienceListDetailSchema.safeParse(detail).success).toBe(true);
  });

  it('rejects an invalid role in experienceListDetailSchema', () => {
    const detail = {
      ...sampleList,
      liked: true,
      saved: false,
      version: 2,
      myRole: 'admin',
      items: [sampleItem],
    };
    expect(experienceListDetailSchema.safeParse(detail).success).toBe(false);
  });
});

describe('experienceListCollectionSchema and experienceListDiscoveryPageSchema', () => {
  const sampleList = {
    id: UUID_A,
    ownerId: UUID_B,
    ownerDisplayName: 'Jordan',
    name: 'Thrill Rides',
    visibility: 'public' as const,
    likeCount: 5,
    itemCount: 1,
    createdAt: '2026-06-15T12:00:00Z',
    updatedAt: '2026-06-15T12:00:00Z',
    pinnedAt: null,
  };

  it('validates collection with available and unavailable saved items', () => {
    const res = experienceListCollectionSchema.safeParse({
      owned: [sampleList],
      saved: [
        { ...sampleList, available: true },
        { available: false, experienceListId: UUID_D },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('rejects a saved entry missing the discriminant', () => {
    const res = experienceListCollectionSchema.safeParse({
      owned: [sampleList],
      saved: [{ experienceListId: UUID_D }],
    });
    expect(res.success).toBe(false);
  });

  it('validates discovery page with items and cursor', () => {
    expect(
      experienceListDiscoveryPageSchema.safeParse({
        items: [sampleList],
        nextCursor: 'base64cursor==',
      }).success,
    ).toBe(true);

    expect(
      experienceListDiscoveryPageSchema.safeParse({
        items: [],
        nextCursor: null,
      }).success,
    ).toBe(true);
  });
});

describe('experience-lists error catalog codes', () => {
  it('contains all required error codes mapped to expected HTTP statuses', () => {
    const expected = [
      { code: 'experience_list_not_found', status: 404 },
      { code: 'experience_list_edit_forbidden', status: 403 },
      { code: 'experience_list_item_duplicate', status: 409 },
      { code: 'experience_not_found', status: 404 },
      { code: 'experience_list_dining_ineligible', status: 400 },
      { code: 'experience_list_reorder_mismatch', status: 400 },
      { code: 'experience_list_stale_write', status: 409 },
      { code: 'experience_list_share_not_friend', status: 403 },
      { code: 'experience_list_save_self', status: 400 },
    ] as const;

    for (const { code, status } of expected) {
      expect(ERROR_CODES).toContain(code);
      expect(errorCodeToHttpStatus[code]).toBe(status);
    }
  });
});

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  PACKING_CATEGORIES,
  bookingSettingsUpdateSchema,
  packingItemCreateSchema,
  packingItemPackedSchema,
  packingItemUpdateSchema,
  reminderMuteSchema,
  windowDoneParamsSchema,
  windowDoneSchema,
} from '../index.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const VALID_DATE = '2025-06-01';
const NUM_RUNS = 100;

describe('Trip booking schemas unit tests (R2.11, R5.4, R9.13, R11.2, R11.7, R12.3, R15.1, R15.6)', () => {
  describe('bookingSettingsUpdateSchema', () => {
    it('accepts valid stayType, timing, and checkInOverride', () => {
      expect(bookingSettingsUpdateSchema.safeParse({ stayType: 'resort' }).success).toBe(true);
      expect(bookingSettingsUpdateSchema.safeParse({ stayType: null }).success).toBe(true);
      expect(bookingSettingsUpdateSchema.safeParse({ lightningLaneTiming: 'seven_day' }).success).toBe(true);
      expect(bookingSettingsUpdateSchema.safeParse({ lightningLaneTiming: null }).success).toBe(true);
      expect(bookingSettingsUpdateSchema.safeParse({ checkInOverride: VALID_DATE }).success).toBe(true);
      expect(bookingSettingsUpdateSchema.safeParse({ checkInOverride: null }).success).toBe(true);
      expect(
        bookingSettingsUpdateSchema.safeParse({
          stayType: 'partner_hotel',
          lightningLaneTiming: 'three_day',
          checkInOverride: VALID_DATE,
        }).success,
      ).toBe(true);
    });

    it('rejects empty object (at least one key required)', () => {
      const res = bookingSettingsUpdateSchema.safeParse({});
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toBe('trip_validation_failed');
      }
    });

    it('rejects invalid vocabulary values or malformed dates', () => {
      expect(bookingSettingsUpdateSchema.safeParse({ stayType: 'invalid' }).success).toBe(false);
      expect(bookingSettingsUpdateSchema.safeParse({ lightningLaneTiming: 'invalid' }).success).toBe(false);
      expect(bookingSettingsUpdateSchema.safeParse({ checkInOverride: 'invalid-date' }).success).toBe(false);
    });

    it('rejects unrecognized keys due to strict mode', () => {
      expect(
        bookingSettingsUpdateSchema.safeParse({
          stayType: 'resort',
          extra: 'unexpected',
        }).success,
      ).toBe(false);
    });
  });

  describe('windowDoneSchema', () => {
    it('accepts valid boolean done', () => {
      expect(windowDoneSchema.safeParse({ done: true }).success).toBe(true);
      expect(windowDoneSchema.safeParse({ done: false }).success).toBe(true);
    });

    it('rejects non-boolean done, missing done, or extra keys', () => {
      expect(windowDoneSchema.safeParse({ done: 'yes' }).success).toBe(false);
      expect(windowDoneSchema.safeParse({}).success).toBe(false);
      expect(windowDoneSchema.safeParse({ done: true, extra: 1 }).success).toBe(false);
    });
  });

  describe('reminderMuteSchema', () => {
    it('accepts valid boolean muted', () => {
      expect(reminderMuteSchema.safeParse({ muted: true }).success).toBe(true);
      expect(reminderMuteSchema.safeParse({ muted: false }).success).toBe(true);
    });

    it('rejects non-boolean muted or missing muted', () => {
      expect(reminderMuteSchema.safeParse({ muted: 'yes' }).success).toBe(false);
      expect(reminderMuteSchema.safeParse({}).success).toBe(false);
    });

    it('rejects smuggled userId key (R12.3 groundwork)', () => {
      const res = reminderMuteSchema.safeParse({ muted: true, userId: VALID_UUID });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toBe('trip_validation_failed');
      }
    });
  });

  describe('windowDoneParamsSchema', () => {
    it('accepts valid id, kind, and dropOn', () => {
      expect(
        windowDoneParamsSchema.safeParse({
          id: VALID_UUID,
          kind: 'dining',
          dropOn: VALID_DATE,
        }).success,
      ).toBe(true);
      expect(
        windowDoneParamsSchema.safeParse({
          id: VALID_UUID,
          kind: 'lightning_lane',
          dropOn: VALID_DATE,
        }).success,
      ).toBe(true);
    });

    it('rejects invalid uuid, unknown kind, or malformed dropOn', () => {
      expect(
        windowDoneParamsSchema.safeParse({
          id: 'not-a-uuid',
          kind: 'dining',
          dropOn: VALID_DATE,
        }).success,
      ).toBe(false);
      expect(
        windowDoneParamsSchema.safeParse({
          id: VALID_UUID,
          kind: 'other_kind',
          dropOn: VALID_DATE,
        }).success,
      ).toBe(false);
      expect(
        windowDoneParamsSchema.safeParse({
          id: VALID_UUID,
          kind: 'dining',
          dropOn: '2025-02-30',
        }).success,
      ).toBe(false);
    });
  });

  describe('packingItemPackedSchema', () => {
    it('accepts valid boolean packed', () => {
      expect(packingItemPackedSchema.safeParse({ packed: true }).success).toBe(true);
      expect(packingItemPackedSchema.safeParse({ packed: false }).success).toBe(true);
    });

    it('rejects non-boolean packed or extra keys', () => {
      expect(packingItemPackedSchema.safeParse({ packed: 'true' }).success).toBe(false);
      expect(packingItemPackedSchema.safeParse({}).success).toBe(false);
      expect(packingItemPackedSchema.safeParse({ packed: true, extra: 1 }).success).toBe(false);
    });
  });

  describe('packingItemCreateSchema & packingItemUpdateSchema unit cases', () => {
    it('accepts valid packingItemCreateSchema inputs', () => {
      expect(
        packingItemCreateSchema.safeParse({
          name: 'Toothbrush',
          category: 'toiletries',
        }).success,
      ).toBe(true);
      expect(
        packingItemCreateSchema.safeParse({
          name: 'Sunscreen',
          category: 'toiletries',
          quantity: 2,
          assigneeId: VALID_UUID,
        }).success,
      ).toBe(true);
      expect(
        packingItemCreateSchema.safeParse({
          name: 'Sunscreen',
          category: 'toiletries',
          assigneeId: null,
        }).success,
      ).toBe(true);
    });

    it('rejects empty or whitespace-only name on create', () => {
      expect(packingItemCreateSchema.safeParse({ name: '', category: 'clothing' }).success).toBe(false);
      expect(packingItemCreateSchema.safeParse({ name: '   ', category: 'clothing' }).success).toBe(false);
    });

    it('accepts valid packingItemUpdateSchema inputs', () => {
      expect(packingItemUpdateSchema.safeParse({ name: 'New name' }).success).toBe(true);
      expect(packingItemUpdateSchema.safeParse({ category: 'park_gear' }).success).toBe(true);
      expect(packingItemUpdateSchema.safeParse({ quantity: 5 }).success).toBe(true);
      expect(packingItemUpdateSchema.safeParse({ assigneeId: null }).success).toBe(true);
    });

    it('rejects empty packingItemUpdateSchema (at least one key required)', () => {
      expect(packingItemUpdateSchema.safeParse({}).success).toBe(false);
    });
  });
});

describe('Property 29: Packing input schemas (R11.2, R11.7, R13.6, R13.12, R15.1, R15.6)', () => {
  const nameBoundaryArb = fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.constant('a'),
    fc.constant('   a   '),
    fc.constant('a'.repeat(80)),
    fc.constant('   ' + 'a'.repeat(80) + '   '),
    fc.constant('a'.repeat(81)),
    fc.string({ maxLength: 90 }),
  );

  const quantityArb = fc.oneof(
    fc.constant(undefined),
    fc.constant(0),
    fc.constant(1),
    fc.constant(99),
    fc.constant(100),
    fc.constant(1.5),
    fc.integer({ min: -5, max: 105 }),
  );

  const categoryArb = fc.oneof(
    fc.constantFrom(...PACKING_CATEGORIES),
    fc.constant('not_a_category'),
    fc.constant(''),
  );

  const hasExtraKeyArb = fc.boolean();

  // Feature: trip-booking-timeline, Property 29: Packing input accepted exactly when it satisfies the schema
  it('// Feature: trip-booking-timeline, Property 29: Packing input accepted exactly when it satisfies the schema', () => {
    fc.assert(
      fc.property(
        nameBoundaryArb,
        categoryArb,
        quantityArb,
        hasExtraKeyArb,
        (name, category, quantity, hasExtraKey) => {
          const trimmedName = name.trim();
          const isNameValid = trimmedName.length >= 1 && trimmedName.length <= 80;
          const isCategoryValid = (PACKING_CATEGORIES as readonly string[]).includes(category);
          const isQuantityValid =
            quantity === undefined ||
            (Number.isInteger(quantity) && quantity >= 1 && quantity <= 99);
          const shouldPassCreate =
            isNameValid && isCategoryValid && isQuantityValid && !hasExtraKey;

          const createPayload: Record<string, unknown> = {
            name,
            category,
          };
          if (quantity !== undefined) createPayload.quantity = quantity;
          if (hasExtraKey) createPayload.extraField = 'bad';

          const createResult = packingItemCreateSchema.safeParse(createPayload);
          expect(createResult.success).toBe(shouldPassCreate);
          if (createResult.success) {
            expect(createResult.data.name).toBe(trimmedName);
            expect(createResult.data.category).toBe(category);
          }

          // Test update schema
          const updatePayload: Record<string, unknown> = {};
          if (name !== '') updatePayload.name = name;
          if (category !== '') updatePayload.category = category;
          if (quantity !== undefined) updatePayload.quantity = quantity;
          if (hasExtraKey) updatePayload.extraField = 'bad';

          const updateHasKey =
            updatePayload.name !== undefined ||
            updatePayload.category !== undefined ||
            updatePayload.quantity !== undefined;

          const isUpdateNameValid =
            updatePayload.name === undefined ||
            (typeof updatePayload.name === 'string' &&
              updatePayload.name.trim().length >= 1 &&
              updatePayload.name.trim().length <= 80);
          const isUpdateCategoryValid =
            updatePayload.category === undefined ||
            (PACKING_CATEGORIES as readonly string[]).includes(updatePayload.category as string);
          const isUpdateQuantityValid =
            updatePayload.quantity === undefined ||
            (Number.isInteger(updatePayload.quantity) &&
              (updatePayload.quantity as number) >= 1 &&
              (updatePayload.quantity as number) <= 99);

          const shouldPassUpdate =
            updateHasKey &&
            isUpdateNameValid &&
            isUpdateCategoryValid &&
            isUpdateQuantityValid &&
            !hasExtraKey;

          const updateResult = packingItemUpdateSchema.safeParse(updatePayload);
          expect(updateResult.success).toBe(shouldPassUpdate);
          if (updateResult.success && updateResult.data.name !== undefined) {
            expect(updateResult.data.name).toBe((updatePayload.name as string).trim());
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

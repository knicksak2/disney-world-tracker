// Feature: photo-uploads, Property 39: experience photo strip client model
//
// Validates: Requirement 27.2, 27.3, 27.7, 27.8
// Client half: at most max items, input order preserved, non-empty label with 'Dish' fallback,
// visible false exactly when empty, no input mutation.

import fc from 'fast-check';
import { buildStripModel } from '../experiencePhotoStrip.pure';
import { PHOTO_STRIP_BLANK_DISH_LABEL } from '../constants';

const restaurantFoodPhotoArbitrary = fc.record({
  id: fc.uuid(),
  foodItemId: fc.uuid(),
  thumbUrl: fc.webUrl(),
  url: fc.webUrl(),
  width: fc.integer({ min: 100, max: 4000 }),
  height: fc.integer({ min: 100, max: 4000 }),
  createdDay: fc.constant('2026-10-18'),
  foodItemName: fc.oneof(
    fc.string({ minLength: 0, maxLength: 50 }),
    fc.constant(''),
    fc.constant('   '),
    fc.constant('\t\n'),
    fc.lorem({ maxCount: 4 })
  ),
  uploader: fc.constant(null),
  mine: fc.boolean(),
});

describe('Property 39: Experience Photo Strip Client Model', () => {
  it('preserves order, caps at max, applies Dish fallback, computes visibility, and never mutates input', () => {
    fc.assert(
      fc.property(
        fc.array(restaurantFoodPhotoArbitrary, { minLength: 0, maxLength: 30 }),
        fc.integer({ min: -5, max: 35 }),
        (inputPhotos, max) => {
          // Take deep snapshot to verify immutability
          const snapshot = JSON.stringify(inputPhotos);

          const model = buildStripModel(inputPhotos, max);

          // 1. Never mutates input
          expect(JSON.stringify(inputPhotos)).toBe(snapshot);

          const expectedCount = max <= 0 ? 0 : Math.min(inputPhotos.length, max);

          // 2. Length is at most max (and equals min(len, max))
          expect(model.items.length).toBe(expectedCount);

          // 3. visible false exactly when items are empty
          expect(model.visible).toBe(expectedCount > 0);

          // 4. Input order is strictly preserved
          for (let i = 0; i < model.items.length; i++) {
            const modelItem = model.items[i]!;
            const originalItem = inputPhotos[i]!;
            expect(modelItem.photoId).toBe(originalItem.id);
            expect(modelItem.foodItemId).toBe(originalItem.foodItemId);
            expect(modelItem.thumbUrl).toBe(originalItem.thumbUrl);
            expect(modelItem.photo).toBe(originalItem);

            // 5. Non-empty label with 'Dish' fallback
            expect(modelItem.label.length).toBeGreaterThan(0);
            const trimmedName = originalItem.foodItemName ? originalItem.foodItemName.trim() : '';
            if (trimmedName.length > 0) {
              expect(modelItem.label).toBe(trimmedName);
            } else {
              expect(modelItem.label).toBe(PHOTO_STRIP_BLANK_DISH_LABEL);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

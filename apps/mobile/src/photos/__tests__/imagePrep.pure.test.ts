import fc from 'fast-check';
import {
  planResize,
  MAX_FULL_DIMENSION,
  MAX_THUMB_DIMENSION,
} from '../imagePrep.pure';

// Feature: photo-uploads, Property 24: Client resize plan
describe('planResize (Property 24 & unit examples)', () => {
  it('Property 24: full long edge <= 1280, thumb long edge <= 320, never enlarges, preserves aspect ratio', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8000 }),
        fc.integer({ min: 1, max: 8000 }),
        (width, height) => {
          const plan = planResize(width, height);

          // Full checks
          const fullMax = Math.max(plan.full.width, plan.full.height);
          expect(fullMax).toBeLessThanOrEqual(MAX_FULL_DIMENSION);
          expect(plan.full.width).toBeLessThanOrEqual(width);
          expect(plan.full.height).toBeLessThanOrEqual(height);

          // Thumb checks
          const thumbMax = Math.max(plan.thumb.width, plan.thumb.height);
          expect(thumbMax).toBeLessThanOrEqual(MAX_THUMB_DIMENSION);
          expect(plan.thumb.width).toBeLessThanOrEqual(width);
          expect(plan.thumb.height).toBeLessThanOrEqual(height);

          // Not enlarged if already within limit
          if (Math.max(width, height) <= MAX_FULL_DIMENSION) {
            expect(plan.full.width).toBe(width);
            expect(plan.full.height).toBe(height);
          }
          if (Math.max(width, height) <= MAX_THUMB_DIMENSION) {
            expect(plan.thumb.width).toBe(width);
            expect(plan.thumb.height).toBe(height);
          }

          // Aspect ratio preserved within rounding error
          const originalAspect = width / height;
          const fullAspect = plan.full.width / plan.full.height;
          const thumbAspect = plan.thumb.width / plan.thumb.height;

          // For dimensions >= 5, relative aspect ratio error is within rounding (< 15%)
          if (Math.min(plan.full.width, plan.full.height) >= 5) {
            const relDiff = Math.abs(fullAspect - originalAspect) / originalAspect;
            expect(relDiff).toBeLessThan(0.15);
          }
          if (Math.min(plan.thumb.width, plan.thumb.height) >= 5) {
            const relDiff = Math.abs(thumbAspect - originalAspect) / originalAspect;
            expect(relDiff).toBeLessThan(0.15);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  describe('concrete examples', () => {
    it('handles landscape image larger than limit (e.g. 2560x1440)', () => {
      const plan = planResize(2560, 1440);
      expect(plan.full.width).toBe(1280);
      expect(plan.full.height).toBe(720);
      expect(plan.thumb.width).toBe(320);
      expect(plan.thumb.height).toBe(180);
    });

    it('handles portrait image larger than limit (e.g. 1080x1920)', () => {
      const plan = planResize(1080, 1920);
      expect(plan.full.height).toBe(1280);
      expect(plan.full.width).toBe(720);
      expect(plan.thumb.height).toBe(320);
      expect(plan.thumb.width).toBe(180);
    });

    it('handles exact limit image (1280x720)', () => {
      const plan = planResize(1280, 720);
      expect(plan.full.width).toBe(1280);
      expect(plan.full.height).toBe(720);
      expect(plan.thumb.width).toBe(320);
      expect(plan.thumb.height).toBe(180);
    });

    it('handles exact thumbnail limit image (320x240)', () => {
      const plan = planResize(320, 240);
      expect(plan.full.width).toBe(320);
      expect(plan.full.height).toBe(240);
      expect(plan.thumb.width).toBe(320);
      expect(plan.thumb.height).toBe(240);
    });

    it('handles tiny image smaller than thumbnail limit (e.g. 150x100)', () => {
      const plan = planResize(150, 100);
      // Never upscaled
      expect(plan.full.width).toBe(150);
      expect(plan.full.height).toBe(100);
      expect(plan.thumb.width).toBe(150);
      expect(plan.thumb.height).toBe(100);
    });

    it('handles 1x1 image without crashing', () => {
      const plan = planResize(1, 1);
      expect(plan.full.width).toBe(1);
      expect(plan.full.height).toBe(1);
      expect(plan.thumb.width).toBe(1);
      expect(plan.thumb.height).toBe(1);
    });
  });
});

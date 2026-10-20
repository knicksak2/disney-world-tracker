import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeVisionVerdict,
  parseVisionFields,
  DEFAULT_VISION_THRESHOLDS,
  type VisionFields,
  type VisionThresholds,
  type VisionRejectReason,
} from '../visionVerdict.js';
import { rejectionMessage } from '../rejectionCopy.js';
import { PHOTO_REJECT_REASONS } from '@dwt/shared';

function oracleVisionVerdict(f: VisionFields, t: VisionThresholds) {
  const notFood = !f.isFoodOrDrink || f.foodConfidence < t.minFoodConfidence;
  const faceVisible = f.prominentFaceCount > t.maxProminentFaces || f.minorFaceVisible;
  const tooMuchText = f.textFraction > t.maxTextFraction;

  const reasons: VisionRejectReason[] = [];
  if (faceVisible) reasons.push('face_visible');
  if (notFood) reasons.push('not_food');
  if (tooMuchText) reasons.push('too_much_text');

  if (reasons.length === 0) {
    return { decision: 'accept' as const };
  }
  return {
    decision: 'reject' as const,
    reasons,
    primary: reasons[0],
  };
}

const visionFieldsArb = fc.record({
  description: fc.string(),
  isFoodOrDrink: fc.boolean(),
  foodConfidence: fc.double({ min: 0, max: 1, noNaN: true }),
  prominentFaceCount: fc.integer({ min: 0, max: 50 }),
  minorFaceVisible: fc.boolean(),
  anyPersonPartVisible: fc.boolean(),
  largeText: fc.boolean(),
  textFraction: fc.double({ min: 0, max: 1, noNaN: true }),
  textSeen: fc.string(),
});

const visionThresholdsArb = fc.record({
  minFoodConfidence: fc.double({ min: 0.1, max: 0.95, noNaN: true }),
  maxProminentFaces: fc.integer({ min: 0, max: 5 }),
  maxTextFraction: fc.double({ min: 0.05, max: 0.9, noNaN: true }),
});

describe('visionVerdict scenarios', () => {
  it('accepts standard dish photo', () => {
    const fields: VisionFields = {
      description: 'Mickey waffle on a plate',
      isFoodOrDrink: true,
      foodConfidence: 0.95,
      prominentFaceCount: 0,
      minorFaceVisible: false,
      anyPersonPartVisible: false,
      largeText: false,
      textFraction: 0.05,
      textSeen: '',
    };
    expect(computeVisionVerdict(fields, DEFAULT_VISION_THRESHOLDS)).toEqual({ decision: 'accept' });
  });

  it('accepts with hand/arm and branded packaging text within threshold', () => {
    const fields: VisionFields = {
      description: 'Hand holding a dole whip cup with text on the cup',
      isFoodOrDrink: true,
      foodConfidence: 0.9,
      prominentFaceCount: 0,
      minorFaceVisible: false,
      anyPersonPartVisible: true,
      largeText: false,
      textFraction: 0.15,
      textSeen: 'DOLE WHIP',
    };
    expect(computeVisionVerdict(fields, DEFAULT_VISION_THRESHOLDS)).toEqual({ decision: 'accept' });
  });

  it('rejects receipt as not_food with too_much_text also listed, primary not_food', () => {
    const fields: VisionFields = {
      description: 'Paper receipt from restaurant',
      isFoodOrDrink: false,
      foodConfidence: 0.05,
      prominentFaceCount: 0,
      minorFaceVisible: false,
      anyPersonPartVisible: false,
      largeText: true,
      textFraction: 0.85,
      textSeen: 'TOTAL $42.50 THANK YOU',
    };
    expect(computeVisionVerdict(fields, DEFAULT_VISION_THRESHOLDS)).toEqual({
      decision: 'reject',
      reasons: ['not_food', 'too_much_text'],
      primary: 'not_food',
    });
  });

  it('rejects child face as face_visible', () => {
    const fields: VisionFields = {
      description: 'Child smiling eating ice cream',
      isFoodOrDrink: true,
      foodConfidence: 0.8,
      prominentFaceCount: 1,
      minorFaceVisible: true,
      anyPersonPartVisible: true,
      largeText: false,
      textFraction: 0.02,
      textSeen: '',
    };
    expect(computeVisionVerdict(fields, DEFAULT_VISION_THRESHOLDS)).toEqual({
      decision: 'reject',
      reasons: ['face_visible'],
      primary: 'face_visible',
    });
  });

  it('rejects minor face even with prominentFaceCount = 0', () => {
    const fields: VisionFields = {
      description: 'Background child face',
      isFoodOrDrink: true,
      foodConfidence: 0.85,
      prominentFaceCount: 0,
      minorFaceVisible: true,
      anyPersonPartVisible: false,
      largeText: false,
      textFraction: 0.01,
      textSeen: '',
    };
    expect(computeVisionVerdict(fields, DEFAULT_VISION_THRESHOLDS)).toEqual({
      decision: 'reject',
      reasons: ['face_visible'],
      primary: 'face_visible',
    });
  });

  it('rejects all 3 tripped with face_visible primary', () => {
    const fields: VisionFields = {
      description: 'Selfie with menu in park',
      isFoodOrDrink: false,
      foodConfidence: 0.1,
      prominentFaceCount: 1,
      minorFaceVisible: false,
      anyPersonPartVisible: true,
      largeText: true,
      textFraction: 0.6,
      textSeen: 'MENU ITEMS',
    };
    expect(computeVisionVerdict(fields, DEFAULT_VISION_THRESHOLDS)).toEqual({
      decision: 'reject',
      reasons: ['face_visible', 'not_food', 'too_much_text'],
      primary: 'face_visible',
    });
  });

  it('rejects too_much_text when only text threshold is exceeded', () => {
    const fields: VisionFields = {
      description: 'Food plate mostly covered by printed flyer',
      isFoodOrDrink: true,
      foodConfidence: 0.85,
      prominentFaceCount: 0,
      minorFaceVisible: false,
      anyPersonPartVisible: false,
      largeText: true,
      textFraction: 0.35,
      textSeen: 'SPECIAL OFFER TODAY ONLY',
    };
    expect(computeVisionVerdict(fields, DEFAULT_VISION_THRESHOLDS)).toEqual({
      decision: 'reject',
      reasons: ['too_much_text'],
      primary: 'too_much_text',
    });
  });
});

describe('visionVerdict properties', () => {
  // Feature: photo-uploads, Property 1: Vision verdict is a pure, deterministic function of the fields and thresholds
  it('Property 1: Vision verdict is a pure, deterministic function of the fields and thresholds', () => {
    fc.assert(
      fc.property(visionFieldsArb, visionThresholdsArb, (f, t) => {
        const v1 = computeVisionVerdict(f, t);
        const v2 = computeVisionVerdict(f, t);
        expect(v1).toEqual(v2);

        const oracle = oracleVisionVerdict(f, t);
        expect(v1).toEqual(oracle);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: photo-uploads, Property 2: Body parts alone never reject, and large_text is never read
  it('Property 2: Body parts alone never reject, and large_text is never read', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.double({ min: 0.6, max: 1.0, noNaN: true }),
        fc.double({ min: 0, max: 0.25, noNaN: true }),
        fc.string(),
        fc.boolean(),
        fc.boolean(),
        (desc, conf, textFrac, textSeen, anyPersonPart, largeText) => {
          const fields: VisionFields = {
            description: desc,
            isFoodOrDrink: true,
            foodConfidence: conf,
            prominentFaceCount: 0,
            minorFaceVisible: false,
            anyPersonPartVisible: anyPersonPart,
            largeText,
            textFraction: textFrac,
            textSeen,
          };
          const verdict = computeVisionVerdict(fields, DEFAULT_VISION_THRESHOLDS);
          expect(verdict).toEqual({ decision: 'accept' });

          const flipped: VisionFields = {
            ...fields,
            anyPersonPartVisible: !anyPersonPart,
            largeText: !largeText,
          };
          const flippedVerdict = computeVisionVerdict(flipped, DEFAULT_VISION_THRESHOLDS);
          expect(flippedVerdict).toEqual(verdict);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: photo-uploads, Property 3: Verdict monotonicity
  it('Property 3: Verdict monotonicity', () => {
    fc.assert(
      fc.property(visionFieldsArb, visionThresholdsArb, (f, t) => {
        // Any minorFaceVisible = true must reject with face_visible
        const withMinorFace: VisionFields = { ...f, minorFaceVisible: true };
        const verdictMinor = computeVisionVerdict(withMinorFace, t);
        expect(verdictMinor.decision).toBe('reject');
        if (verdictMinor.decision === 'reject') {
          expect(verdictMinor.reasons).toContain('face_visible');
        }

        // Monotonic changes cannot turn reject into accept
        const baseVerdict = computeVisionVerdict(f, t);
        const worseFields: VisionFields = {
          ...f,
          textFraction: Math.min(1, f.textFraction + 0.1),
          foodConfidence: Math.max(0, f.foodConfidence - 0.1),
          prominentFaceCount: f.prominentFaceCount + 1,
          minorFaceVisible: f.minorFaceVisible || false,
        };
        const worseVerdict = computeVisionVerdict(worseFields, t);
        if (baseVerdict.decision === 'reject') {
          expect(worseVerdict.decision).toBe('reject');
          if (worseVerdict.decision === 'reject') {
            for (const r of baseVerdict.reasons) {
              expect(worseVerdict.reasons).toContain(r);
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: photo-uploads, Property 4: Rejection copy is independent of model text
  it('Property 4: Rejection copy is independent of model text', () => {
    fc.assert(
      fc.property(
        visionFieldsArb,
        visionThresholdsArb,
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (f, t, desc2, textSeen2) => {
          const f2: VisionFields = { ...f, description: desc2, textSeen: textSeen2 };
          const v1 = computeVisionVerdict(f, t);
          const v2 = computeVisionVerdict(f2, t);
          expect(v1).toEqual(v2);

          if (v1.decision === 'reject') {
            const msg = rejectionMessage(v1.primary);
            expect(typeof msg).toBe('string');
            expect(msg.length).toBeGreaterThan(0);
            if (f.description.length > 5) {
              expect(msg).not.toContain(f.description);
            }
            if (f.textSeen.length > 5) {
              expect(msg).not.toContain(f.textSeen);
            }
          }
        }
      ),
      { numRuns: 100 }
    );

    // Also assert every PhotoRejectReason has a non-empty message in copy table
    for (const reason of PHOTO_REJECT_REASONS) {
      const msg = rejectionMessage(reason);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  // Feature: photo-uploads, Property 5: Parsing rejects malformed model output instead of guessing
  it('Property 5: Parsing rejects malformed model output instead of guessing', () => {
    fc.assert(
      fc.property(
        fc.record({
          description: fc.string(),
          isFoodOrDrink: fc.boolean(),
          foodConfidence: fc.double({ min: 0, max: 1, noNaN: true }),
          prominentFaceCount: fc.integer({ min: 0, max: 50 }),
          minorFaceVisible: fc.boolean(),
          anyPersonPartVisible: fc.boolean(),
          largeText: fc.boolean(),
          textFraction: fc.double({ min: 0, max: 1, noNaN: true }),
          textSeen: fc.string(),
        }),
        (valid) => {
          const parsed = parseVisionFields(valid);
          expect(parsed.ok).toBe(true);
          if (parsed.ok) {
            expect(parsed.fields.description).toBe(valid.description.slice(0, 300));
            expect(parsed.fields.textSeen).toBe(valid.textSeen.slice(0, 200));
            expect(parsed.fields.isFoodOrDrink).toBe(valid.isFoodOrDrink);
            expect(parsed.fields.foodConfidence).toBe(valid.foodConfidence);
            expect(parsed.fields.prominentFaceCount).toBe(valid.prominentFaceCount);
            expect(parsed.fields.minorFaceVisible).toBe(valid.minorFaceVisible);
            expect(parsed.fields.anyPersonPartVisible).toBe(valid.anyPersonPartVisible);
            expect(parsed.fields.largeText).toBe(valid.largeText);
            expect(parsed.fields.textFraction).toBe(valid.textFraction);
          }
        }
      ),
      { numRuns: 100 }
    );

    // Malformed cases
    expect(parseVisionFields(null)).toEqual({ ok: false });
    expect(parseVisionFields('not an object')).toEqual({ ok: false });
    expect(parseVisionFields({})).toEqual({ ok: false });
    expect(
      parseVisionFields({
        description: 'valid',
        isFoodOrDrink: 'yes', // wrong type
        foodConfidence: 0.8,
        prominentFaceCount: 0,
        minorFaceVisible: false,
        anyPersonPartVisible: false,
        largeText: false,
        textFraction: 0.1,
        textSeen: '',
      })
    ).toEqual({ ok: false });
    expect(
      parseVisionFields({
        description: 'valid',
        isFoodOrDrink: true,
        foodConfidence: 1.5, // > 1
        prominentFaceCount: 0,
        minorFaceVisible: false,
        anyPersonPartVisible: false,
        largeText: false,
        textFraction: 0.1,
        textSeen: '',
      })
    ).toEqual({ ok: false });
    expect(
      parseVisionFields({
        description: 'valid',
        isFoodOrDrink: true,
        foodConfidence: NaN, // non-finite
        prominentFaceCount: 0,
        minorFaceVisible: false,
        anyPersonPartVisible: false,
        largeText: false,
        textFraction: 0.1,
        textSeen: '',
      })
    ).toEqual({ ok: false });
    expect(
      parseVisionFields({
        description: 'valid',
        isFoodOrDrink: true,
        foodConfidence: 0.5,
        prominentFaceCount: -1, // negative
        minorFaceVisible: false,
        anyPersonPartVisible: false,
        largeText: false,
        textFraction: 0.1,
        textSeen: '',
      })
    ).toEqual({ ok: false });
    expect(
      parseVisionFields({
        description: 'valid',
        isFoodOrDrink: true,
        foodConfidence: 0.5,
        prominentFaceCount: 2.5, // non-integer
        minorFaceVisible: false,
        anyPersonPartVisible: false,
        largeText: false,
        textFraction: 0.1,
        textSeen: '',
      })
    ).toEqual({ ok: false });
    expect(
      parseVisionFields({
        description: 'valid',
        isFoodOrDrink: true,
        foodConfidence: 0.5,
        prominentFaceCount: 0,
        minorFaceVisible: false,
        anyPersonPartVisible: false,
        largeText: false,
        textFraction: -0.1, // < 0
        textSeen: '',
      })
    ).toEqual({ ok: false });
  });
});

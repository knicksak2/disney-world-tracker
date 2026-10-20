import { z } from 'zod';

export interface VisionFields {
  description: string;
  isFoodOrDrink: boolean;
  foodConfidence: number;
  prominentFaceCount: number;
  minorFaceVisible: boolean;
  anyPersonPartVisible: boolean;
  largeText: boolean;
  textFraction: number;
  textSeen: string;
}

export interface VisionThresholds {
  minFoodConfidence: number;
  maxProminentFaces: number;
  maxTextFraction: number;
}

export const DEFAULT_VISION_THRESHOLDS: VisionThresholds = {
  minFoodConfidence: 0.6,
  maxProminentFaces: 0,
  maxTextFraction: 0.25,
} as const;

export type VisionRejectReason = 'face_visible' | 'not_food' | 'too_much_text';

export type VisionVerdict =
  | { decision: 'accept' }
  | { decision: 'reject'; reasons: readonly VisionRejectReason[]; primary: VisionRejectReason };

export function computeVisionVerdict(f: VisionFields, t: VisionThresholds): VisionVerdict {
  const notFood = !f.isFoodOrDrink || f.foodConfidence < t.minFoodConfidence;
  const faceVisible = f.prominentFaceCount > t.maxProminentFaces || f.minorFaceVisible;
  const tooMuchText = f.textFraction > t.maxTextFraction;

  const reasons: VisionRejectReason[] = [];
  if (faceVisible) reasons.push('face_visible');
  if (notFood) reasons.push('not_food');
  if (tooMuchText) reasons.push('too_much_text');

  const primary = reasons[0];
  if (!primary) {
    return { decision: 'accept' };
  }
  return {
    decision: 'reject',
    reasons,
    primary,
  };
}

const rawVisionFieldsSchema = z.object({
  description: z.string(),
  isFoodOrDrink: z.boolean(),
  foodConfidence: z.number().finite().min(0).max(1),
  prominentFaceCount: z.number().int().min(0).max(50),
  minorFaceVisible: z.boolean(),
  anyPersonPartVisible: z.boolean(),
  largeText: z.boolean(),
  textFraction: z.number().finite().min(0).max(1),
  textSeen: z.string(),
});

function normalizeRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;
  if ('isFoodOrDrink' in r || 'foodConfidence' in r || 'prominentFaceCount' in r) {
    return r;
  }
  if ('is_food_or_drink' in r || 'food_confidence' in r || 'prominent_face_count' in r) {
    return {
      description: r.description,
      isFoodOrDrink: r.is_food_or_drink,
      foodConfidence: r.food_confidence,
      prominentFaceCount: r.prominent_face_count,
      minorFaceVisible: r.minor_face_visible,
      anyPersonPartVisible: r.any_person_part_visible,
      largeText: r.large_text,
      textFraction: r.text_fraction,
      textSeen: r.text_seen,
    };
  }
  return r;
}

export function parseVisionFields(raw: unknown): { ok: true; fields: VisionFields } | { ok: false } {
  const parsed = rawVisionFieldsSchema.safeParse(normalizeRaw(raw));
  if (!parsed.success) {
    return { ok: false };
  }
  return {
    ok: true,
    fields: {
      description: parsed.data.description.slice(0, 300),
      isFoodOrDrink: parsed.data.isFoodOrDrink,
      foodConfidence: parsed.data.foodConfidence,
      prominentFaceCount: parsed.data.prominentFaceCount,
      minorFaceVisible: parsed.data.minorFaceVisible,
      anyPersonPartVisible: parsed.data.anyPersonPartVisible,
      largeText: parsed.data.largeText,
      textFraction: parsed.data.textFraction,
      textSeen: parsed.data.textSeen.slice(0, 200),
    },
  };
}

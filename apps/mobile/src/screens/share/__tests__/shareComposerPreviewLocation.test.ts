// Feature: social-sharing-loop, Property 2a: Composer preview falls back from
// Park to Resort_Area, never rendering a blank location
//
// Validates: Requirements 2.3
//
// Bug: `ShareComposerScreen`'s `experience` preview line concatenated
// `params.park` directly (`{params.park} · {category}`). `park` is `null` for
// a Resort's own representing row (it has no owning Park —
// experience-detail-redesign R4.14/R4.15), so sharing a Resort rendered the
// literal preview text "null · Resort" instead of a real location.
// `resolveExperiencePreviewLocation` is the pure core the preview's `<Text>`
// now calls; it is tested directly here rather than through a full screen
// render (the screen has no existing render harness and this behavior is a
// pure string-projection with no I/O).

import type { ExperienceCategory, Park } from '@dwt/shared';
import { resolveExperiencePreviewLocation, type ExperiencePreviewParams } from '../ShareComposerScreen';

function makeParams(
  overrides: Partial<ExperiencePreviewParams>,
): ExperiencePreviewParams {
  return {
    kind: 'experience',
    experienceId: 'exp-1',
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom',
    category: 'Ride' as ExperienceCategory,
    ...overrides,
  };
}

describe('resolveExperiencePreviewLocation (Property 2a, R2.3)', () => {
  test('a non-Resort Experience with a Park renders "Park · " as the location prefix', () => {
    const params = makeParams({ park: 'Magic Kingdom' as Park });
    expect(resolveExperiencePreviewLocation(params)).toBe('Magic Kingdom \u00b7 ');
  });

  test('a Resort Experience (park === null) falls back to resortArea', () => {
    const params = makeParams({
      park: null,
      resortArea: 'Animal Kingdom Resort Area',
      category: 'Resort' as ExperienceCategory,
    });
    expect(resolveExperiencePreviewLocation(params)).toBe(
      'Animal Kingdom Resort Area \u00b7 ',
    );
  });

  test('a Resort Experience with no resortArea omits the location segment entirely, not "null"', () => {
    const params = makeParams({
      park: null,
      category: 'Resort' as ExperienceCategory,
    });
    const result = resolveExperiencePreviewLocation(params);
    expect(result).toBe('');
    expect(result).not.toContain('null');
    expect(result).not.toContain('undefined');
  });

  test('a Resort Experience with a whitespace-only resortArea also omits the location segment', () => {
    const params = makeParams({
      park: null,
      resortArea: '   ',
      category: 'Resort' as ExperienceCategory,
    });
    expect(resolveExperiencePreviewLocation(params)).toBe('');
  });

  test('a Resort Experience with a null resortArea also omits the location segment', () => {
    const params = makeParams({
      park: null,
      resortArea: null,
      category: 'Resort' as ExperienceCategory,
    });
    expect(resolveExperiencePreviewLocation(params)).toBe('');
  });
});

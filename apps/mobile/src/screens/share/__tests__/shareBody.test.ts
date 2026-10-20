/**
 * Tests for buildShareCreateBody (Task 16.16).
 *
 * Validates: Requirements 24.12, 24.14; Property 23
 */

import { buildShareCreateBody, type IncludeToggles } from '../shareBody';
import type { ShareComposerParams } from '../../../navigation/RootNavigator';

describe('buildShareCreateBody (Task 16.16)', () => {
  const allTogglesOn: IncludeToggles = { includeRating: true, includeNote: true };
  const allTogglesOff: IncludeToggles = { includeRating: false, includeNote: false };

  it('composes pinShowcase share body with no snapshot or rating/note fields (R24.12, R24.14)', () => {
    const params: ShareComposerParams = { kind: 'pinShowcase' };
    const recipients = ['friend-1', 'friend-2'];

    const bodyOn = buildShareCreateBody(params, allTogglesOn, recipients);
    expect(bodyOn).toEqual({
      kind: 'pinShowcase',
      recipientIds: recipients,
    });
    // Ensure no snapshot or extraneous fields exist
    expect(Object.keys(bodyOn).sort()).toEqual(['kind', 'recipientIds'].sort());

    const bodyOff = buildShareCreateBody(params, allTogglesOff, recipients);
    expect(bodyOff).toEqual({
      kind: 'pinShowcase',
      recipientIds: recipients,
    });
  });

  it('composes tripSummary body as a pointer with includePhotos defaulting to true and no sharerId (photo-uploads R15.2, R15.8)', () => {
    const params: ShareComposerParams = {
      kind: 'tripSummary',
      tripId: 'trip-1',
      tripName: 'Fall 2026',
    };
    const recipients = ['friend-1', 'friend-2'];

    // Rating/Note toggles are irrelevant to this kind; includePhotos omitted means on.
    const body = buildShareCreateBody(params, { includeRating: false, includeNote: false }, recipients);
    expect(body).toEqual({
      kind: 'tripSummary',
      tripId: 'trip-1',
      recipientIds: recipients,
      includePhotos: true,
    });
    expect(Object.keys(body).sort()).toEqual(['includePhotos', 'kind', 'recipientIds', 'tripId']);
    expect(body).not.toHaveProperty('sharerId');
    expect(body).not.toHaveProperty('tripName');
  });

  it('composes tripSummary body with includePhotos false when the toggle is off (photo-uploads R15.8)', () => {
    const params: ShareComposerParams = {
      kind: 'tripSummary',
      tripId: 'trip-1',
      tripName: 'Fall 2026',
    };
    const body = buildShareCreateBody(
      params,
      { includeRating: true, includeNote: true, includePhotos: false },
      ['friend-1'],
    );
    expect(body).toEqual({
      kind: 'tripSummary',
      tripId: 'trip-1',
      recipientIds: ['friend-1'],
      includePhotos: false,
    });
  });

  it('composes progress share body with stats snapshot (R2.8)', () => {
    const params: ShareComposerParams = {
      kind: 'progress',
      overallPercent: 42.5,
      perParkPercent: { 'Magic Kingdom': 50 },
      perCategoryPercent: { Ride: 60 },
    };
    const recipients = ['friend-1'];

    const body = buildShareCreateBody(params, allTogglesOn, recipients);
    expect(body).toEqual({
      kind: 'progress',
      recipientIds: recipients,
      statsSnapshot: {
        overallPercent: 42.5,
        perParkPercent: { 'Magic Kingdom': 50 },
        perCategoryPercent: { Ride: 60 },
      },
    });
  });

  it('composes experience share body respecting toggles (R2.8)', () => {
    const params: ShareComposerParams = {
      kind: 'experience',
      experienceId: 'exp-123',
      experienceName: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
      rating: 9,
      note: 'Loved the launch!',
    };
    const recipients = ['friend-1'];

    const body = buildShareCreateBody(params, allTogglesOn, recipients);
    expect(body).toEqual({
      kind: 'experience',
      experienceId: 'exp-123',
      recipientIds: recipients,
      rating: 9,
      includeRating: true,
      note: 'Loved the launch!',
    });

    const bodyNoToggles = buildShareCreateBody(params, allTogglesOff, recipients);
    expect(bodyNoToggles).toEqual({
      kind: 'experience',
      experienceId: 'exp-123',
      recipientIds: recipients,
    });
  });
});

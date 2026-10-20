/**
 * Tests for Phase 2 contracts: tripSummary share payload, inbox schemas,
 * TripRecap DTO shapes, photoReport and blockCreate schemas, and TripFeedItemDTO.
 *
 * Validates: Requirements 14.4, 14.7, 15.2, 15.9, 15.16, 15.19, 15.20, 16.8
 */

import { describe, expect, it } from 'vitest';
import {
  tripSummarySharePayloadSchema,
  tripSummaryShareInputSchema,
  sharePayloadSchema,
  inboxItemSchema,
  inboxResponseSchema,
  photoReportSchema,
  blockCreateSchema,
  type TripSummarySharePayload,
  type TripRecapSuperlativeDTO,
  type TripRecapFiguresDTO,
  type TripRecapTopRatedDTO,
  type TripRecapDTO,
  type TripRecapPhotosDTO,
  type TripFeedItemDTO,
} from '../index.js';

const UUID_1 = '00000000-0000-4000-8000-000000000001';
const UUID_2 = '00000000-0000-4000-8000-000000000002';
const UUID_3 = '00000000-0000-4000-8000-000000000003';

describe('Phase 2 Contracts: tripSummary Share Schemas & DTOs', () => {
  it('tripSummarySharePayloadSchema accepts valid 5-key payload', () => {
    const valid = {
      kind: 'tripSummary',
      tripId: UUID_1,
      tripName: 'Disney Fall 2026',
      sharerDisplayName: 'Alice',
      includePhotos: true,
    };
    const parsed = tripSummarySharePayloadSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  it('tripSummarySharePayloadSchema accepts includePhotos: false', () => {
    const valid = {
      kind: 'tripSummary',
      tripId: UUID_1,
      tripName: 'Disney Fall 2026',
      sharerDisplayName: 'Alice',
      includePhotos: false,
    };
    const parsed = tripSummarySharePayloadSchema.parse(valid);
    expect(parsed.includePhotos).toBe(false);
  });

  it('tripSummarySharePayloadSchema rejects extra keys, including sharerId and summary', () => {
    const withSharerId = {
      kind: 'tripSummary',
      tripId: UUID_1,
      tripName: 'Disney Fall 2026',
      sharerDisplayName: 'Alice',
      includePhotos: true,
      sharerId: UUID_2,
    };
    expect(() => tripSummarySharePayloadSchema.parse(withSharerId)).toThrow();

    const withSummary = {
      kind: 'tripSummary',
      tripId: UUID_1,
      tripName: 'Disney Fall 2026',
      sharerDisplayName: 'Alice',
      includePhotos: true,
      summary: {},
    };
    expect(() => tripSummarySharePayloadSchema.parse(withSummary)).toThrow();
  });

  it('tripSummarySharePayloadSchema rejects missing includePhotos', () => {
    const missingIncludePhotos = {
      kind: 'tripSummary',
      tripId: UUID_1,
      tripName: 'Disney Fall 2026',
      sharerDisplayName: 'Alice',
    };
    expect(() => tripSummarySharePayloadSchema.parse(missingIncludePhotos)).toThrow();
  });

  it('tripSummaryShareInputSchema defaults includePhotos to true', () => {
    const input = {
      kind: 'tripSummary',
      recipientIds: [UUID_2],
      tripId: UUID_1,
    };
    const parsed = tripSummaryShareInputSchema.parse(input);
    expect(parsed.includePhotos).toBe(true);
    expect(parsed.tripId).toBe(UUID_1);
    expect(parsed.recipientIds).toEqual([UUID_2]);
  });

  it('tripSummaryShareInputSchema accepts explicit includePhotos: false', () => {
    const input = {
      kind: 'tripSummary',
      recipientIds: [UUID_2],
      tripId: UUID_1,
      includePhotos: false,
    };
    const parsed = tripSummaryShareInputSchema.parse(input);
    expect(parsed.includePhotos).toBe(false);
  });

  it('sharePayloadSchema accepts tripSummary payload', () => {
    const valid = {
      kind: 'tripSummary',
      tripId: UUID_1,
      tripName: 'Disney Fall 2026',
      sharerDisplayName: 'Alice',
      includePhotos: true,
    };
    const parsed = sharePayloadSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  it('inboxItemSchema and inboxResponseSchema accept a tripSummary item', () => {
    const inboxItem = {
      shareId: UUID_3,
      read: false,
      senderId: UUID_1,
      senderDisplayName: 'Alice',
      payloadKind: 'tripSummary',
      payload: {
        kind: 'tripSummary',
        tripId: UUID_2,
        tripName: 'Disney Fall 2026',
        sharerDisplayName: 'Alice',
        includePhotos: true,
      },
      sentAt: '2026-10-18T12:00:00.000Z',
      myReaction: null,
    };

    const parsedItem = inboxItemSchema.parse(inboxItem);
    expect(parsedItem.payloadKind).toBe('tripSummary');

    const inboxResponse = {
      unread: 1,
      items: [inboxItem],
    };
    const parsedResponse = inboxResponseSchema.parse(inboxResponse);
    expect(parsedResponse.items).toHaveLength(1);
    expect(parsedResponse.items[0]?.payloadKind).toBe('tripSummary');
  });

  it('type-level check: forbidden keys on TripSummarySharePayload', () => {
    type HasSummary = 'summary' extends keyof TripSummarySharePayload ? true : false;
    type HasSnapshot = 'snapshot' extends keyof TripSummarySharePayload ? true : false;
    type HasUrl = 'url' extends keyof TripSummarySharePayload ? true : false;
    type HasSharerId = 'sharerId' extends keyof TripSummarySharePayload ? true : false;
    type HasIncludeInSummary = 'includeInSummary' extends keyof TripSummarySharePayload ? true : false;

    const noSummary: HasSummary = false;
    const noSnapshot: HasSnapshot = false;
    const noUrl: HasUrl = false;
    const noSharerId: HasSharerId = false;
    const noIncludeInSummary: HasIncludeInSummary = false;

    expect(noSummary).toBe(false);
    expect(noSnapshot).toBe(false);
    expect(noUrl).toBe(false);
    expect(noSharerId).toBe(false);
    expect(noIncludeInSummary).toBe(false);
  });

  it('type-level check: forbidden keys on TripRecapSuperlativeDTO and TripRecapFiguresDTO, and TripRecapDTO.recap is nullable', () => {
    type SupHasMemberId = 'memberId' extends keyof TripRecapSuperlativeDTO ? true : false;
    type SupHasUserId = 'userId' extends keyof TripRecapSuperlativeDTO ? true : false;
    type SupHasActorId = 'actor_id' extends keyof TripRecapSuperlativeDTO ? true : false;

    type FigHasMemberId = 'memberId' extends keyof TripRecapFiguresDTO ? true : false;
    type FigHasPerMember = 'perMember' extends keyof TripRecapFiguresDTO ? true : false;
    type FigHasUserId = 'userId' extends keyof TripRecapFiguresDTO ? true : false;

    const supNoMemberId: SupHasMemberId = false;
    const supNoUserId: SupHasUserId = false;
    const supNoActorId: SupHasActorId = false;

    const figNoMemberId: FigHasMemberId = false;
    const figNoPerMember: FigHasPerMember = false;
    const figNoUserId: FigHasUserId = false;

    expect(supNoMemberId).toBe(false);
    expect(supNoUserId).toBe(false);
    expect(supNoActorId).toBe(false);
    expect(figNoMemberId).toBe(false);
    expect(figNoPerMember).toBe(false);
    expect(figNoUserId).toBe(false);

    // TripRecapDTO.recap is nullable
    const recapWithNull: TripRecapDTO = {
      tripId: UUID_1,
      tripName: 'Disney Fall 2026',
      sharerDisplayName: 'Alice',
      recap: null,
      photos: { access: 'unavailable', photos: [] },
    };
    expect(recapWithNull.recap).toBeNull();
  });

  // Feature: photo-uploads, Property 43: Recap aggregate-only boundary (decision D34, R15.21)
  it('type-level check: TripRecapFiguresDTO and TripRecapTopRatedDTO carry exactly the D34 allowlist', () => {
    // `Record<keyof T, true>` fails to compile when a key is added to or removed from the DTO,
    // so a new field cannot reach a recipient without editing this list (and Requirement 15.21).
    const figureKeys: Record<keyof TripRecapFiguresDTO, true> = {
      distinctExperienceCount: true,
      parksExploredCount: true,
      plannedCompletedCount: true,
      plannedTotalCount: true,
      superlatives: true,
      topRated: true,
      totalCompletionsCount: true,
      totalRatingsCount: true,
    };
    const rowKeys: Record<keyof TripRecapTopRatedDTO, true> = {
      category: true,
      experienceName: true,
      imageUrl: true,
      meanRating: true,
      park: true,
      ratingCount: true,
    };
    expect(Object.keys(figureKeys).sort()).toEqual([
      'distinctExperienceCount',
      'parksExploredCount',
      'plannedCompletedCount',
      'plannedTotalCount',
      'superlatives',
      'topRated',
      'totalCompletionsCount',
      'totalRatingsCount',
    ]);
    expect(Object.keys(rowKeys).sort()).toEqual([
      'category',
      'experienceName',
      'imageUrl',
      'meanRating',
      'park',
      'ratingCount',
    ]);

    // Forbidden per-member / identifier keys stay absent from both shapes.
    type Forbidden =
      | 'memberId'
      | 'userId'
      | 'actor_id'
      | 'perMember'
      | 'experienceId'
      | 'logEntryCount'
      | 'confirmedTagCount'
      | 'totalCompletedCount'
      | 'topRatedExperienceName'
      | 'topRating'
      | 'avatarPreset';
    type FigureLeak = Extract<keyof TripRecapFiguresDTO, Forbidden>;
    type RowLeak = Extract<keyof TripRecapTopRatedDTO, Forbidden>;
    const noFigureLeak: [FigureLeak] extends [never] ? true : false = true;
    const noRowLeak: [RowLeak] extends [never] ? true : false = true;
    expect(noFigureLeak).toBe(true);
    expect(noRowLeak).toBe(true);
  });

  it('TripRecapDTO accepts a full recap (catalog fields present) and a minimal one (row without them)', () => {
    const full: TripRecapDTO = {
      tripId: UUID_1,
      tripName: 'Disney Fall 2026',
      sharerDisplayName: 'Alice',
      recap: {
        distinctExperienceCount: 12,
        plannedCompletedCount: 7,
        plannedTotalCount: 9,
        totalCompletionsCount: 31,
        totalRatingsCount: 18,
        parksExploredCount: 3,
        superlatives: [],
        topRated: [
          {
            experienceName: 'Space Mountain',
            meanRating: 9.5,
            ratingCount: 4,
            park: 'Magic Kingdom',
            category: 'Ride',
            imageUrl: 'https://img.example.test/space.jpg',
          },
        ],
      },
      photos: { access: 'not_included', photos: [] },
    };
    const minimal: TripRecapDTO = {
      ...full,
      recap: {
        ...full.recap!,
        topRated: [{ experienceName: 'Dumbo', meanRating: 7, ratingCount: 1 }],
      },
    };
    expect(full.recap?.topRated[0]?.park).toBe('Magic Kingdom');
    expect(Object.keys(minimal.recap?.topRated[0] ?? {}).sort()).toEqual([
      'experienceName',
      'meanRating',
      'ratingCount',
    ]);
  });

  it('TripRecapPhotosDTO (D35) has exactly the keys access, nextCursor, photos and carries SharedSummaryPhotoDTO items', () => {
    const dto: TripRecapPhotosDTO = {
      access: 'granted',
      photos: [
        {
          id: UUID_2,
          thumbUrl: 'https://store.example.test/p/x/thumb.jpg',
          url: 'https://store.example.test/p/x/full.jpg',
          width: 800,
          height: 600,
          sortAt: '2026-10-19T14:00:00.000Z',
        },
      ],
      nextCursor: null,
    };
    expect(Object.keys(dto).sort()).toEqual(['access', 'nextCursor', 'photos']);
    expect(Object.keys(dto.photos[0] ?? {}).sort()).toEqual([
      'height',
      'id',
      'sortAt',
      'thumbUrl',
      'url',
      'width',
    ]);
    const empty: TripRecapPhotosDTO = { access: 'unavailable', photos: [], nextCursor: null };
    expect(empty.nextCursor).toBeNull();
  });

  it('photoReportSchema accepts shareId and validates', () => {
    const withShare = {
      reason: 'inappropriate',
      note: 'Shows something wrong',
      shareId: UUID_1,
    };
    const parsed = photoReportSchema.parse(withShare);
    expect(parsed.shareId).toBe(UUID_1);

    const withoutShare = {
      reason: 'spam',
    };
    const parsed2 = photoReportSchema.parse(withoutShare);
    expect(parsed2.shareId).toBeUndefined();
  });

  it('blockCreateSchema accepts shareId for photoId variant and rejects alongside userId', () => {
    const photoWithShare = {
      photoId: UUID_1,
      shareId: UUID_2,
    };
    expect(blockCreateSchema.parse(photoWithShare)).toEqual(photoWithShare);

    const photoOnly = {
      photoId: UUID_1,
    };
    expect(blockCreateSchema.parse(photoOnly)).toEqual(photoOnly);

    const userOnly = {
      userId: UUID_1,
    };
    expect(blockCreateSchema.parse(userOnly)).toEqual(userOnly);

    // Rejects shareId alongside userId
    const userWithShare = {
      userId: UUID_1,
      shareId: UUID_2,
    };
    expect(() => blockCreateSchema.parse(userWithShare)).toThrow();

    // Rejects both userId and photoId
    const bothUserAndPhoto = {
      userId: UUID_1,
      photoId: UUID_2,
    };
    expect(() => blockCreateSchema.parse(bothUserAndPhoto)).toThrow();
  });

  it('TripFeedItemDTO works with and without photos/mine', () => {
    // Existing fixture without photos/mine
    const legacyItem: TripFeedItemDTO = {
      id: UUID_1,
      type: 'trip_created',
      createdAt: '2026-10-18T10:00:00.000Z',
      actorDisplayName: 'Alice',
      actorAvatarPreset: 'mickey',
      metadata: {},
      reactions: [],
      comments: [],
    };
    expect(legacyItem.photos).toBeUndefined();
    expect(legacyItem.mine).toBeUndefined();

    // New member_post item with photos and mine
    const postItem: TripFeedItemDTO = {
      id: UUID_3,
      type: 'member_post',
      createdAt: '2026-10-18T11:00:00.000Z',
      actorDisplayName: 'Bob',
      actorAvatarPreset: 'minnie',
      metadata: { caption: 'Great lunch!' },
      reactions: [],
      comments: [],
      mine: true,
      photos: [
        {
          photoId: UUID_1,
          state: 'ready',
          mine: true,
          status: 'approved',
          url: 'https://cdn.example.com/p/1.jpg',
          thumbUrl: 'https://cdn.example.com/p/1_thumb.jpg',
          width: 1280,
          height: 960,
        },
      ],
    };
    expect(postItem.mine).toBe(true);
    expect(postItem.photos).toHaveLength(1);
    expect(postItem.photos?.[0]?.state).toBe('ready');
  });
});

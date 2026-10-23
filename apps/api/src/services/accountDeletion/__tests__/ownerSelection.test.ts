import { describe, expect, it } from 'vitest';

import { planTripResolution, selectNewOwner, type TripMemberFact } from '../ownerSelection.js';

const m = (
  userId: string,
  role: 'organizer' | 'member',
  joined: string,
  state: TripMemberFact['state'] = 'active',
): TripMemberFact => ({ userId, role, joinedAt: new Date(joined), state });

describe('selectNewOwner', () => {
  it('returns null when the excluded user is the only member', () => {
    expect(selectNewOwner([m('a', 'organizer', '2026-01-01')], 'a')).toBeNull();
  });

  it('returns null for an empty member list', () => {
    expect(selectNewOwner([], 'a')).toBeNull();
  });

  it('ignores purging and tombstone members', () => {
    const members = [
      m('a', 'organizer', '2026-01-01'),
      m('b', 'organizer', '2026-01-02', 'purging'),
      m('c', 'member', '2026-01-03', 'tombstone'),
    ];
    expect(selectNewOwner(members, 'a')).toBeNull();
  });

  it('prefers an organizer over a member, whatever the join time', () => {
    const members = [
      m('a', 'organizer', '2026-01-01'),
      m('early-member', 'member', '2026-01-02'),
      m('late-organizer', 'organizer', '2026-03-01'),
    ];
    expect(selectNewOwner(members, 'a')?.userId).toBe('late-organizer');
  });

  it('breaks a role tie by earliest joinedAt, then by lowest userId', () => {
    const byTime = [
      m('a', 'organizer', '2026-01-01'),
      m('x', 'member', '2026-02-02'),
      m('y', 'member', '2026-02-01'),
    ];
    expect(selectNewOwner(byTime, 'a')?.userId).toBe('y');

    const byId = [
      m('a', 'organizer', '2026-01-01'),
      m('z', 'member', '2026-02-01'),
      m('b', 'member', '2026-02-01'),
    ];
    expect(selectNewOwner(byId, 'a')?.userId).toBe('b');
  });

  it('prefers an active member over a pending organizer', () => {
    const members = [
      m('a', 'organizer', '2026-01-01'),
      m('pending-organizer', 'organizer', '2026-01-02', 'pending_deletion'),
      m('active-member', 'member', '2026-05-01'),
    ];
    expect(selectNewOwner(members, 'a')?.userId).toBe('active-member');
  });

  it('falls back to a pending_deletion member only when nobody is active', () => {
    const members = [
      m('a', 'organizer', '2026-01-01'),
      m('p1', 'member', '2026-02-01', 'pending_deletion'),
      m('p2', 'organizer', '2026-03-01', 'pending_deletion'),
    ];
    expect(selectNewOwner(members, 'a')?.userId).toBe('p2');
  });
});

describe('planTripResolution', () => {
  it('deletes the trip when the purged user is the sole member', () => {
    expect(
      planTripResolution({
        purgedUserId: 'a',
        creatorId: 'a',
        members: [m('a', 'organizer', '2026-01-01')],
      }),
    ).toEqual({ kind: 'delete_trip' });
  });

  it('deletes the trip when every other member is already purging', () => {
    expect(
      planTripResolution({
        purgedUserId: 'a',
        creatorId: 'a',
        members: [m('a', 'organizer', '2026-01-01'), m('b', 'member', '2026-01-02', 'purging')],
      }),
    ).toEqual({ kind: 'delete_trip' });
  });

  it('transfers creator and promotes a member owner when the creator is purged', () => {
    const plan = planTripResolution({
      purgedUserId: 'a',
      creatorId: 'a',
      members: [m('a', 'organizer', '2026-01-01'), m('b', 'member', '2026-01-02')],
    });
    expect(plan).toEqual({
      kind: 'keep_trip',
      newCreatorId: 'b',
      promoteUserId: 'b',
      removeMembership: true,
    });
  });

  it('does not promote an owner who is already an organizer', () => {
    const plan = planTripResolution({
      purgedUserId: 'a',
      creatorId: 'a',
      members: [m('a', 'organizer', '2026-01-01'), m('b', 'organizer', '2026-01-02')],
    });
    expect(plan).toEqual({
      kind: 'keep_trip',
      newCreatorId: 'b',
      promoteUserId: null,
      removeMembership: true,
    });
  });

  it('keeps the creator and does not promote when another organizer remains', () => {
    const plan = planTripResolution({
      purgedUserId: 'b',
      creatorId: 'a',
      members: [
        m('a', 'organizer', '2026-01-01'),
        m('b', 'member', '2026-01-02'),
        m('c', 'member', '2026-01-03'),
      ],
    });
    expect(plan).toEqual({
      kind: 'keep_trip',
      newCreatorId: null,
      promoteUserId: null,
      removeMembership: true,
    });
  });

  it('promotes the owner when the purged user is the last non-purging organizer (not the creator)', () => {
    const plan = planTripResolution({
      purgedUserId: 'b',
      creatorId: 'a',
      members: [
        m('a', 'member', '2026-01-01'),
        m('b', 'organizer', '2026-01-02'),
        m('c', 'member', '2026-01-03'),
      ],
    });
    expect(plan).toMatchObject({ kind: 'keep_trip', newCreatorId: null, promoteUserId: 'a' });
  });

  it('counts a purging organizer as gone when deciding whether a promotion is needed', () => {
    const plan = planTripResolution({
      purgedUserId: 'b',
      creatorId: 'a',
      members: [
        m('a', 'member', '2026-01-01'),
        m('b', 'organizer', '2026-01-02'),
        m('c', 'organizer', '2026-01-03', 'purging'),
      ],
    });
    expect(plan).toMatchObject({ kind: 'keep_trip', promoteUserId: 'a' });
  });

  it('handles a creator who already left: the creator is replaced and nothing is removed', () => {
    const plan = planTripResolution({
      purgedUserId: 'gone',
      creatorId: 'gone',
      members: [m('x', 'organizer', '2026-01-01'), m('y', 'member', '2026-01-02')],
    });
    expect(plan).toEqual({
      kind: 'keep_trip',
      newCreatorId: 'x',
      promoteUserId: null,
      removeMembership: false,
    });
  });

  it('reports removeMembership false for a purged user who is neither member nor creator', () => {
    const plan = planTripResolution({
      purgedUserId: 'outsider',
      creatorId: 'a',
      members: [m('a', 'organizer', '2026-01-01')],
    });
    expect(plan).toEqual({
      kind: 'keep_trip',
      newCreatorId: null,
      promoteUserId: null,
      removeMembership: false,
    });
  });
});

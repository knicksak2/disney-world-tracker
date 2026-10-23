import { describe, expect, it } from 'vitest';

import {
  ACTIVE_FRIENDSHIPS_VIEW,
  ACTIVE_TRIP_MEMBERSHIPS_VIEW,
  ACTIVE_USER_SQL,
  PROFILE_IDENTITY_VIEW,
  VISIBILITY_VIEWS,
} from '../visibility.js';

describe('ACTIVE_USER_SQL', () => {
  it("emits the alias-qualified active predicate", () => {
    expect(ACTIVE_USER_SQL('u')).toBe("u.deletion_state = 'active'");
    expect(ACTIVE_USER_SQL('requester_user')).toContain("deletion_state = 'active'");
  });

  it('rejects an alias that is not a plain identifier (no injection through the alias)', () => {
    for (const bad of ['', 'u; DROP TABLE users', "u' OR '1'='1", 'a.b', '1u', 'u u']) {
      expect(() => ACTIVE_USER_SQL(bad), bad).toThrow(RangeError);
    }
  });
});

describe('visibility views', () => {
  it('names the three views created by migration 0064', () => {
    expect(PROFILE_IDENTITY_VIEW).toBe('profile_identity');
    expect(ACTIVE_FRIENDSHIPS_VIEW).toBe('active_friendships');
    expect(ACTIVE_TRIP_MEMBERSHIPS_VIEW).toBe('active_trip_memberships');
    expect([...VISIBILITY_VIEWS]).toEqual(['profile_identity', 'active_friendships', 'active_trip_memberships']);
  });
});

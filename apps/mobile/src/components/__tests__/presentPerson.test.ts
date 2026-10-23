/**
 * `presentPerson` and friends (account-deletion R6.4; tasks.md 14.4).
 */

import { DELETED_USER_DISPLAY_NAME } from '@dwt/shared';

import { generatePlaceholderId } from '../../../../api/src/services/accountDeletion/placeholderId';
import { involvesDeletedUser, presentPerson, withDeletedUserNames } from '../presentPerson';

const DELETED_ID = generatePlaceholderId(() => new Uint8Array(16).map((_, i) => (i * 29 + 3) % 256));
const REAL_ID = '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

describe('presentPerson', () => {
  it('an ordinary person is tappable and labelled with their own name', () => {
    expect(presentPerson(REAL_ID, 'Minnie Mouse')).toEqual({
      tappable: true,
      accessibilityLabel: 'Minnie Mouse',
    });
  });

  it('a placeholder is not tappable and its label includes "Deleted user"', () => {
    const p = presentPerson(DELETED_ID, DELETED_USER_DISPLAY_NAME);
    expect(p.tappable).toBe(false);
    expect(p.accessibilityLabel).toContain('Deleted user');
  });

  it('decides from the id, never from the name: a person literally named "Deleted user" stays tappable', () => {
    expect(presentPerson(REAL_ID, DELETED_USER_DISPLAY_NAME).tappable).toBe(true);
  });

  it('a placeholder never leaks the name the server sent into its label', () => {
    expect(presentPerson(DELETED_ID, 'Some Stale Real Name').accessibilityLabel).toBe(
      'Deleted user',
    );
  });
});

describe('involvesDeletedUser', () => {
  it('is true when any id is a placeholder, false otherwise', () => {
    expect(involvesDeletedUser(REAL_ID, DELETED_ID)).toBe(true);
    expect(involvesDeletedUser(DELETED_ID, REAL_ID)).toBe(true);
    expect(involvesDeletedUser(REAL_ID, 'another-real-id')).toBe(false);
    expect(involvesDeletedUser()).toBe(false);
  });
});

describe('withDeletedUserNames', () => {
  it('names placeholder ids found in the data, keeps roster names, ignores unknown ordinary ids, and does not mutate the input', () => {
    const roster = new Map([[REAL_ID, 'Minnie Mouse']]);
    const next = withDeletedUserNames(roster, [DELETED_ID, REAL_ID, 'guest-or-unknown']);

    expect(next.get(DELETED_ID)).toBe('Deleted user');
    expect(next.get(REAL_ID)).toBe('Minnie Mouse');
    expect(next.has('guest-or-unknown')).toBe(false);
    expect(roster.has(DELETED_ID)).toBe(false);
  });
});

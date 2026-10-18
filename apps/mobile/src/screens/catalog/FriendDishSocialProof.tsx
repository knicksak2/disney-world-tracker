/**
 * FriendDishSocialProof — inline social proof chip for menu and picker rows (Phase 2).
 *
 * Requirements: 15.3, 15.4, 15.5, 16.2, 17.1, 17.3, 18.1
 */

import React from 'react';
import { Text, View } from 'react-native';

import {
  isAvatarPresetId,
  type FriendDishSocialProofDTO,
} from '@dwt/shared';

import { renderAvatarPreset } from '../../avatars/AvatarPresets';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import {
  describeSocialProof,
  formatAverageRating,
} from '../friends/foodRatingFormat';

export interface FriendDishSocialProofProps {
  readonly proof: FriendDishSocialProofDTO;
  readonly foodItemName?: string | undefined;
  readonly testID?: string | undefined;
}

/**
 * Format summary text such as "Sam and 2 friends · 8.5/10" or "Sam · 8.5/10".
 */
export function formatSocialProofText(
  friendCount: number,
  firstFriendName: string,
  averageRating: number,
): string {
  const ratingText = `${formatAverageRating(averageRating)}/10`;
  if (friendCount <= 1) {
    return `${firstFriendName} · ${ratingText}`;
  }
  const otherCount = friendCount - 1;
  const friendWord = otherCount === 1 ? 'friend' : 'friends';
  return `${firstFriendName} and ${otherCount} ${friendWord} · ${ratingText}`;
}

export default function FriendDishSocialProof({
  proof,
  foodItemName,
  testID,
}: FriendDishSocialProofProps): JSX.Element | null {
  const styles = useStyles();
  useAppTheme(); // subscribed for theme switches

  // If there are no rated logs or no friends, do not render
  if (proof.friends.length === 0 || proof.friendCount === 0) {
    return null;
  }

  const displayedFriends = proof.friends.slice(0, 3);
  const overflowCount = proof.friendCount - displayedFriends.length;
  const firstFriend = displayedFriends[0]!;
  const summaryText = formatSocialProofText(
    proof.friendCount,
    firstFriend.displayName,
    proof.friendsAverageRating,
  );

  const a11yLabel = describeSocialProof({
    foodItemName,
    friendsAverageRating: proof.friendsAverageRating,
    friendCount: proof.friendCount,
    friends: proof.friends,
  });

  const chipTestId = testID ?? `friend-dish-social-proof-${proof.foodItemId}`;

  return (
    <View
      style={styles.container}
      testID={chipTestId}
      accessible={true}
      accessibilityRole="summary"
      accessibilityLabel={a11yLabel}
    >
      <View style={styles.avatarCluster} testID={`${chipTestId}-avatars`}>
        {displayedFriends.map((friend, idx) => {
          const hasPreset = isAvatarPresetId(friend.avatarPreset);
          return (
            <View
              key={friend.friendId}
              style={[styles.avatarItem, idx > 0 && styles.avatarOverlap]}
              testID={`${chipTestId}-avatar-${friend.friendId}`}
            >
              {hasPreset ? (
                renderAvatarPreset(friend.avatarPreset, 20)
              ) : (
                <Text style={styles.avatarInitials} numberOfLines={1}>
                  {friend.displayName.slice(0, 1).toUpperCase()}
                </Text>
              )}
            </View>
          );
        })}
        {overflowCount > 0 ? (
          <View
            style={[styles.overflowBadge, styles.avatarOverlap]}
            testID={`${chipTestId}-overflow`}
          >
            <Text style={styles.overflowText}>+{overflowCount}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.summaryText} numberOfLines={1}>
        {summaryText}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 3,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  avatarCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarItem: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: t.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.color.border,
    overflow: 'hidden',
  },
  avatarOverlap: {
    marginLeft: -6,
  },
  avatarInitials: {
    ...t.typography.meta,
    fontSize: 10,
    fontWeight: '700',
    color: t.color.primaryFg,
    textAlign: 'center',
  },
  overflowBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: t.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.color.border,
  },
  overflowText: {
    ...t.typography.meta,
    fontSize: 9,
    fontWeight: '700',
    color: t.color.textSecondary,
    textAlign: 'center',
  },
  summaryText: {
    ...t.typography.meta,
    fontSize: 12,
    fontWeight: '500',
    color: t.color.textSecondary,
  },
}));

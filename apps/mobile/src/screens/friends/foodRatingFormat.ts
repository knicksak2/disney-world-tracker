/**
 * Pure display formatting and accessibility label helpers for Friend Food Ratings.
 *
 * Requirements: 4.5, 16.2, 16.3, 17.1, 17.3
 */

export interface DishRatingLabelInput {
  readonly foodItemName: string;
  readonly averageRating: number | null;
  readonly logCount: number;
}

export interface SocialProofLabelInput {
  readonly foodItemName?: string | undefined;
  readonly friendsAverageRating: number;
  readonly friendCount: number;
  readonly friends: readonly { readonly displayName: string }[];
}

/**
 * Display-only rating formatter (R16.2). Formats to one decimal place.
 * Never fed back into any sorting, comparison, aggregation or network request.
 */
export function formatAverageRating(avg: number): string {
  if (!Number.isFinite(avg)) {
    return '';
  }
  return avg.toFixed(1);
}

/**
 * Human-friendly log count text (e.g. "Logged 1 time", "Logged 3 times").
 */
export function logCountText(n: number): string {
  return n === 1 ? 'Logged 1 time' : `Logged ${n} times`;
}

/**
 * Accessibility label builder for dish rows and Highlights cards (R17.3).
 * States dish name, rating as text out of 10 (or "not rated"), and log count.
 */
export function describeDishRating(d: DishRatingLabelInput): string {
  const ratingText =
    d.averageRating !== null
      ? `${formatAverageRating(d.averageRating)} out of 10`
      : 'not rated';
  return `${d.foodItemName}, ${ratingText}, ${logCountText(d.logCount)}`;
}

/**
 * Accessibility label builder for Social_Proof inline chips (R17.3).
 * States dish name (if provided), friends' average rating out of 10, friends' names, and friend count.
 */
export function describeSocialProof(p: SocialProofLabelInput): string {
  const ratingText = `${formatAverageRating(p.friendsAverageRating)} out of 10`;
  const names = p.friends.map((f) => f.displayName).join(', ');
  const countText = p.friendCount === 1 ? '1 friend' : `${p.friendCount} friends`;
  const friendsSummary = names.length > 0 ? `${names} (${countText})` : countText;
  const dishPrefix = p.foodItemName ? `${p.foodItemName}, ` : '';
  return `${dishPrefix}${ratingText} by ${friendsSummary}`;
}

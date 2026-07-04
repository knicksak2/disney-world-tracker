/**
 * Inbox DTOs (recipient view).
 *
 * The reworked `Sharing_Service.listInbox` projection discloses, for every
 * non-deleted delivered `Share`, the sender identity, the `Share_Payload`, the
 * delivery timestamp, and the recipient's own per-recipient `Read_State` —
 * regardless of that `Read_State` (R4.1, R6.2). The `recipient_id = $1`
 * predicate remains the privacy boundary (R6.1), so the shape here is always
 * the recipient's own view of a Share delivered to them.
 *
 * `InboxItemDTO` mirrors one row of that projection; `InboxResponse` wraps the
 * list together with the derived unread count. Neither adds a new required
 * request parameter to the existing `GET /me/inbox` contract (R6.6).
 *
 * Validates: Requirements 4.1, 6.2, 6.6
 */

import type { SharePayloadKind, ShareReactionValue } from '../enums.js';
import type { SharePayload } from './Share.js';

/**
 * One delivered `Share` as seen by its recipient.
 *
 * - `read` is the per-recipient `Read_State` (`opened_at IS NOT NULL`); it
 *   drives only the unread count and never gates disclosure (R6.2).
 * - `senderId` / `senderDisplayName` are always disclosed to the recipient
 *   (R4.1, R6.2), the latter joined from `profiles`.
 * - `payload` is the delivery-time snapshot, discriminated by `payloadKind`.
 * - `myReaction` is the recipient's own `Share_Reaction` for this Share, drawn
 *   from the closed `Reaction_Vocabulary`, or `null` when they have not
 *   reacted (R11.2, R11.3).
 */
export interface InboxItemDTO {
  readonly shareId: string;
  readonly read: boolean;
  readonly senderId: string;
  readonly senderDisplayName: string;
  readonly payloadKind: SharePayloadKind;
  readonly payload: SharePayload;
  readonly sentAt: string;
  readonly myReaction: ShareReactionValue | null;
}

/**
 * Response body for `GET /me/inbox`.
 *
 * `unread` is the count of `items` whose `read` is `false`; `items` is the
 * recipient's delivered, non-deleted Shares.
 */
export interface InboxResponse {
  readonly unread: number;
  readonly items: ReadonlyArray<InboxItemDTO>;
}

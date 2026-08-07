/**
 * Trip_Service — Postgres persistence and transactional operations.
 *
 * This is the single point of contact between the Trip routes and the Trip
 * tables created by `migrations/0015_trips.sql`. It is built up one concern at
 * a time across the implementation plan: this first slice implements the Trip
 * lifecycle (create / read / edit / delete, task 5.1). Later tasks add invites,
 * membership management, the Planned_List, the Shared_Log with confirmable
 * rode-with tags, the Trip_Feed, and the derived reads to this same file.
 *
 * Construction follows the established repo pattern: a `createTripRepo(pool,
 * deps)` factory closes the pool and its injected dependencies into a small
 * context object that every handler receives. The dependencies are the
 * existing Tracking_Service completion and rating repos — the Trip_Service
 * never copies canonical Completions/Ratings, it delegates those writes to the
 * canonical repos so the single-source-of-truth and the existing
 * `RatingChanged` propagation are reused unchanged (design decision 2; R12.1).
 * The lifecycle operations below do not yet need those dependencies; they are
 * accepted now so task 13.2 can wire them and the later log/confirm operations
 * can use them without changing the factory shape.
 *
 * Key lifecycle behaviours:
 *   - `createTrip` inserts the Trip, the creator's `organizer` membership, and
 *     the `trip_created` feed item in one transaction, then returns the Trip
 *     with its derived status (R1.1, R1.2, R1.3, R1.9, R1.10).
 *   - `getTripForMember` reads a Trip and joins the derived `Trip_Status` at
 *     read time from the two stored dates and the WDW calendar date (R2, R3.1).
 *   - `editTrip` touches only the fields the caller supplied, re-checking the
 *     `end >= start` invariant against the merged (supplied + stored) dates
 *     (R3.1, R3.6).
 *   - `deleteTrip` removes the Trip; every child table cascades via
 *     `ON DELETE CASCADE`, and the canonical `completions` / `ratings` /
 *     `notes` tables are never referenced, so canonical Tracking data always
 *     survives (R3.7, R3.10).
 *
 * Trip_Status is never stored (R2.5): it is always derived here at read time
 * via {@link deriveTripStatus} and {@link wdwToday}, so it can never drift.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.9, 1.10, 3.1, 3.7, 3.10
 */

import type {
  Park,
  PlannedItemAddInput,
  PlannedItemEditInput,
  PlannedItemDTO,
  PendingRodeWithTagDTO,
  TripCommentDTO,
  TripCreateInput,
  TripDTO,
  TripEditInput,
  TripFeedItemDTO,
  TripFeedTargetType,
  TripIncomingInviteDTO,
  TripInviteDTO,
  TripLogEntryCreateInput,
  TripLogEntryDTO,
  TripMemberDTO,
  TripPendingInviteDTO,
  TripReactionSummary,
  TripReactionValue,
  TripResortDTO,
  TripSummaryDTO,
  RodeWithTagState,
} from '@dwt/shared';
import { tripReactionValueSchema } from '@dwt/shared';
import type { PoolClient } from 'pg';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { pair as canonicalPair } from '../friends/canonicalPair.js';
import type { CompletionRepo } from '../tracking/completion/repo.js';
import type { RatingRepo } from '../tracking/rating/repo.js';
import { orderFeed } from './feedOrder.js';
import {
  type Membership,
  type TripRole,
  violatesLastOrganizer,
} from './permissions.js';
import { deriveTripSummary } from './summary.js';
import { deriveTripStatus } from './tripStatus.js';
import { groupTripsByStatus, type TripStatusGroup } from './tripsList.js';
import { wdwToday } from './wdwClock.js';

/** Postgres SQLSTATE for a `unique_violation` on an INSERT. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Maximum number of Planned_Items a single Trip's Planned_List may hold (R9.5).
 * Adding to a list that already holds this many items is rejected with
 * `trip_planned_limit`.
 */
const PLANNED_ITEM_LIMIT = 500;

/**
 * Default IANA time zone used to stamp the logging Member's canonical
 * Completion when the caller does not supply one (see
 * {@link LogCompletionInput.userTz}). A Trip is a Walt Disney World visit, so
 * the WDW local zone is the sensible default the mobile picker relies on when
 * it sends only `experienceId` / `rodeWith` / `rating`.
 */
const DEFAULT_LOG_USER_TZ = 'America/New_York';

// ---------------------------------------------------------------------------
// Dependencies + context
// ---------------------------------------------------------------------------

/**
 * Canonical Tracking_Service repos the Trip_Service delegates to so it never
 * holds Trip-local copies of Completions or Ratings (design decision 2, R12.1,
 * R3.10). Injected at construction; wired in `composeServices.ts` (task 13.2).
 * The lifecycle operations do not use these yet — the Shared_Log and
 * rode-with-tag operations added by later tasks will.
 */
export interface TripRepoDeps {
  /** Canonical Completion repo (`completions` table) for trickle-down writes. */
  readonly completions: CompletionRepo;
  /** Canonical Rating repo (`ratings` table) that emits `RatingChanged`. */
  readonly ratings: RatingRepo;
}

/**
 * Internal per-repo context handed to every handler. Bundles the pool with the
 * injected canonical repos so handlers take a single argument and new
 * operations can reach any dependency without widening their signatures.
 */
interface TripRepoContext {
  readonly pool: DbPool;
  readonly completions: CompletionRepo;
  readonly ratings: RatingRepo;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Identity of a freshly created `pending` Trip_Invite, returned by
 * {@link TripRepo.sendInvite}. It carries exactly the fields the route needs
 * to dispatch the `TripInviteCreatedNotice` on the background notification port
 * after commit (task 6.4; R6.6, R6.7).
 */
export interface CreatedInvite {
  readonly inviteId: string;
  readonly tripId: string;
  readonly inviterId: string;
  readonly inviteeId: string;
}

/**
 * Identity of a freshly created Trip_Comment, returned by
 * {@link TripRepo.addComment}. The Trip_Comment read projection is not needed
 * by any current caller (the mobile feed re-reads the feed), so only the new
 * comment's identity is surfaced — mirroring the minimal identity returned by
 * the invite/tag operations.
 */
export interface CreatedComment {
  readonly commentId: string;
}

/**
 * Outcome of a departure ({@link TripRepo.removeMember} /
 * {@link TripRepo.leaveTrip}). `tripDeleted` is `true` only when the departing
 * Member was the sole Trip_Member, in which case the whole Trip is cascade-
 * deleted (R5.7); otherwise the Member is removed and the Trip lives on.
 */
export interface TripDeparture {
  readonly tripDeleted: boolean;
}

/**
 * Input to {@link TripRepo.logCompletion}. Extends the shared
 * `TripLogEntryCreateInput` (the `experienceId` / `rodeWith` / optional
 * `rating` the mobile picker sends) with the two fields the canonical
 * Completion `mark` requires — the calendar date the Experience was completed
 * and the IANA time zone that date was captured in.
 *
 * Both are optional so the mobile log picker, which sends only
 * `experienceId` / `rodeWith` / `rating`, does not have to compute them:
 * `completedOn` defaults to the current WDW calendar date and `userTz` to
 * {@link DEFAULT_LOG_USER_TZ}. A caller with a real device clock/zone (or a
 * back-dated entry) may supply either explicitly.
 */
export interface LogCompletionInput extends TripLogEntryCreateInput {
  /** Calendar date `YYYY-MM-DD` the Completion happened; defaults to WDW today. */
  readonly completedOn?: string;
  /** IANA time zone the `completedOn` date was captured in; defaults to WDW. */
  readonly userTz?: string;
}

/**
 * A `pending` Rode_With_Tag created by {@link TripRepo.logCompletion}, returned
 * so the route can dispatch a `RodeWithTagCreatedNotice` per tag on the
 * background notification port after the transaction commits (R10.8).
 */
export interface CreatedRodeWithTag {
  readonly tagId: string;
  readonly taggedMemberId: string;
}

/**
 * Outcome of {@link TripRepo.logCompletion}: the created Trip_Log_Entry's id
 * and the `pending` Rode_With_Tags it created. The route uses `pendingTags` to
 * fire one `RodeWithTagCreatedNotice` per Tagged_Member after commit (R10.8).
 */
export interface LoggedCompletion {
  readonly logEntryId: string;
  readonly pendingTags: readonly CreatedRodeWithTag[];
}

/**
 * Optional overrides for {@link TripRepo.confirmRodeWithTag} that control how
 * the Tagged_Member's canonical Completion is stamped when it must be created.
 *
 * The confirm view (the mobile RodeWithConfirmScreen) sends only the optional
 * `rating`, so both fields default: `userTz` to {@link DEFAULT_LOG_USER_TZ}
 * and `completedOn` to the WDW calendar date of the originating
 * Trip_Log_Entry's creation instant (falling back to WDW today), so a confirmed
 * completion is dated to when the ride was actually logged during the Trip. A
 * caller with a real device clock/zone may supply either explicitly.
 */
export interface ConfirmRodeWithTagOptions {
  /** Calendar date `YYYY-MM-DD` to stamp a newly created Completion. */
  readonly completedOn?: string;
  /** IANA time zone the `completedOn` date was captured in; defaults to WDW. */
  readonly userTz?: string;
  /** Injectable instant used to default `completedOn` when no log-entry date. */
  readonly now?: Date;
}

/**
 * Outcome of {@link TripRepo.confirmRodeWithTag}: the confirmed tag's id plus
 * the Trip and Experience it links, so the route can build its response and, if
 * desired, surface the linked Trip/Experience without a second read.
 */
export interface ConfirmedRodeWithTag {
  readonly tagId: string;
  readonly tripId: string;
  readonly experienceId: string;
}

/**
 * The deep-link target read for a Rode_With_Tag addressed to the caller,
 * returned by {@link TripRepo.getRodeWithTag}. It carries exactly what the
 * mobile confirm view (task 17.4) needs: the tag identity and state, the linked
 * Trip and Trip_Log_Entry, the referenced Experience, the Tagging_Member's
 * display name, and the caller's own current canonical Rating for that
 * Experience (or `null` when unrated) so the confirm view can pre-fill the
 * rating input (R11.5) and detect a stale target (R18.5).
 */
export interface RodeWithTagTarget {
  readonly id: string;
  readonly tripId: string;
  readonly tripLogEntryId: string;
  readonly state: RodeWithTagState;
  readonly experienceId: string;
  readonly experienceName: string;
  readonly taggingMemberDisplayName: string;
  /** The caller's current canonical Rating (1–10) or `null` when unrated. */
  readonly currentRating: number | null;
}

/**
 * One non-empty status group of the caller's Trips list, returned by
 * {@link TripRepo.listMyTrips}. It is the pure {@link groupTripsByStatus}
 * grouping specialized to the {@link TripDTO} read projection: a derived
 * `Trip_Status` shared by every Trip in the group and the group's Trips in
 * display order (ascending start date for `active`/`upcoming`, descending end
 * date for `past`). Empty groups are omitted (R16.2–R16.5).
 */
export type TripListGroup = TripStatusGroup<TripDTO>;

/**
 * One item's persisted optimize output (R8.1). `plannedTime` is the suggested
 * arrival; the optional fields carry the derived wait and travel-from-previous
 * leg the optimizer produced (`travelFromPrev` is `null`/omitted for the first
 * item of a day). When present, they are stamped with `optimized_at = now()`.
 */
export interface PlannedItemTimeUpdate {
  readonly itemId: string;
  readonly plannedTime: string;
  readonly predictedWaitMinutes?: number | null;
  readonly travelFromPrev?: { readonly kind: 'walk' | 'park_hop'; readonly minutes: number } | null;
}

/** Persistence surface returned by {@link createTripRepo}. */
export interface TripRepo {
  /**
   * Create a Trip owned by `creatorId` in one transaction: insert the Trip
   * (name stored trimmed), add the creator as the sole `organizer`, and record
   * a `trip_created` feed item. Returns the created Trip with its identity and
   * derived status (R1.1, R1.2, R1.3, R1.9, R1.10).
   *
   * @param now Injectable instant used to derive the returned `status`.
   */
  createTrip(
    creatorId: string,
    input: TripCreateInput,
    now?: Date,
  ): Promise<TripDTO>;

  /**
   * Read a single Trip and derive its `Trip_Status` at read time, or `null`
   * when no Trip with `tripId` exists (R2, R3.1). Membership authorization is
   * enforced separately by the route's `assertTripMember` gate.
   *
   * @param now Injectable instant used to derive the returned `status`.
   */
  getTripForMember(tripId: string, now?: Date): Promise<TripDTO | null>;

  /**
   * Apply an edit that touches only the supplied fields, leaving every other
   * field unchanged (R3.1). When a single date is supplied the `end >= start`
   * invariant is re-checked against the stored value (R3.6). Returns the
   * updated Trip, or `null` when no Trip with `tripId` exists. Throws
   * `trip_validation_failed` when the merged dates violate `end >= start`.
   *
   * @param now Injectable instant used to derive the returned `status`.
   */
  editTrip(
    tripId: string,
    input: TripEditInput,
    now?: Date,
  ): Promise<TripDTO | null>;

  /**
   * Permanently delete a Trip. Every child entity cascades via the migration's
   * `ON DELETE CASCADE` foreign keys; canonical `completions` / `ratings` /
   * `notes` are never touched, so Tracking data survives (R3.7, R3.10).
   * Returns `true` when a Trip was deleted, `false` when none matched.
   */
  deleteTrip(tripId: string): Promise<boolean>;

  /**
   * Create a `pending` Trip_Invite from `inviterId` to `inviteeId` for `tripId`
   * in one transaction (R6.1). Enforces, in order:
   *   - the invitee is not already a Trip_Member — else `trip_invite_duplicate`
   *     (R6.4); this also absorbs a self-invite since an Organizer is a Member;
   *   - the invitee is a Friend of the inviter, checked against the canonical
   *     `friendships` pair — else `trip_not_friend` (R6.2);
   *   - the invitee holds no `pending` invite for the Trip — else
   *     `trip_invite_duplicate` (R6.5).
   * The partial unique index `trip_invites_one_pending_idx` is the concurrency
   * backstop: a racing insert surfaces SQLSTATE 23505 and is mapped to
   * `trip_invite_duplicate`. Organizer authorization is enforced upstream by
   * the route's `assertTripOrganizer` gate (R6.3). Returns the created invite's
   * identity for post-commit notification dispatch.
   */
  sendInvite(
    tripId: string,
    inviterId: string,
    inviteeId: string,
  ): Promise<CreatedInvite>;

  /**
   * Cancel a `pending` Trip_Invite belonging to `tripId`, transitioning it to
   * the terminal `cancelled` state (R6.8). Returns `false` when no invite with
   * `inviteId` exists for the Trip (route → `trip_not_found`); throws
   * `trip_invite_state_invalid` when the invite exists but is not `pending`.
   * Organizer authorization is enforced upstream by `assertTripOrganizer`
   * (R6.9).
   */
  cancelInvite(tripId: string, inviteId: string): Promise<boolean>;

  /**
   * Accept a `pending` Trip_Invite addressed to `userId` in one transaction:
   * set the invite `accepted`, add `userId` as a `member` idempotently
   * (`ON CONFLICT DO NOTHING`, R7.2), and record a `member_joined` feed item
   * (R7.6). Throws `trip_forbidden` when the invite does not exist or is not
   * addressed to the caller (non-probing, R7.4) and `trip_invite_state_invalid`
   * when it is not `pending` (R7.5). Returns the joined Trip's id.
   */
  acceptInvite(inviteId: string, userId: string): Promise<{ tripId: string }>;

  /**
   * Decline a `pending` Trip_Invite addressed to `userId`, setting it
   * `declined` and adding no membership (R7.3). Throws `trip_forbidden` when
   * the invite does not exist or is not addressed to the caller (R7.4) and
   * `trip_invite_state_invalid` when it is not `pending` (R7.5).
   */
  declineInvite(inviteId: string, userId: string): Promise<void>;

  /**
   * Read the Trip_Invite addressed to `userId` for the deep-link target,
   * carrying the Trip name and inviter display name (R7.7–R7.9). Returns `null`
   * when no invite with `inviteId` is addressed to the caller, so the route can
   * present the "no longer available" fallback without disclosing existence.
   */
  getInvite(inviteId: string, userId: string): Promise<TripInviteDTO | null>;

  /**
   * List every `pending` Trip_Invite addressed to `userId` for their
   * invitations inbox (`GET /me/trip-invites`), each carrying the Trip's name
   * and dates and the inviter's display info. Terminal invites
   * (accepted/declined/cancelled) are omitted, so every row is actionable via
   * accept/decline. A User with no pending invites yields an empty list.
   */
  listMyInvites(userId: string): Promise<TripIncomingInviteDTO[]>;

  /**
   * List every `pending` Trip_Invite for `tripId` with the invited User's
   * display info, so an Organizer can see outstanding invites and cancel them
   * (R6.5, R6.8). Terminal invites (accepted/declined/cancelled) are omitted.
   * A Trip with no pending invites yields an empty list. Organizer
   * authorization is enforced upstream by the route's `assertTripOrganizer`
   * gate.
   */
  listPendingInvites(tripId: string): Promise<TripPendingInviteDTO[]>;

  /**
   * Promote the Trip_Member `targetUserId` from `member` to `organizer` on
   * `tripId` (R4.5). Throws `trip_role_invalid` when the target is already an
   * `organizer` — a no-op role change is rejected (R4.8) — and
   * `trip_validation_failed` when `targetUserId` is not a Trip_Member of the
   * Trip. Promotion never engages the Last_Organizer_Rule (it only ever adds an
   * organizer). Organizer authorization is enforced upstream by the route's
   * `assertTripOrganizer` gate.
   */
  promote(tripId: string, targetUserId: string): Promise<void>;

  /**
   * Demote the Trip_Member `targetUserId` from `organizer` to `member` on
   * `tripId` (R4.6). Throws `trip_role_invalid` when the target is already a
   * `member` (no-op change, R4.8), `trip_validation_failed` when `targetUserId`
   * is not a Trip_Member, and `trip_last_organizer` when the demotion would
   * leave the (non-empty) Trip with zero organizers (R5.2). Organizer
   * authorization is enforced upstream by `assertTripOrganizer`.
   */
  demote(tripId: string, targetUserId: string): Promise<void>;

  /**
   * Remove the Trip_Member `targetUserId` from `tripId` (R8.2). In one
   * transaction: verify the target is a Member (else `trip_validation_failed`,
   * R8.9); reject with `trip_last_organizer` when removing them would strand a
   * non-empty Trip without an organizer (R5.4); delete the membership; cancel
   * every `pending` rode-with tag the former Member created as Tagging_Member
   * or is named in as Tagged_Member so they can no longer be confirmed (R8.6,
   * R8.7); and retain their log entries and confirmed tags (R8.5). Canonical
   * Tracking data is never touched (R8.4). Organizer authorization is enforced
   * upstream by `assertTripOrganizer`.
   */
  removeMember(tripId: string, targetUserId: string): Promise<TripDeparture>;

  /**
   * Remove the caller `userId`'s own membership from `tripId` (R8.1). Uses the
   * same departure discipline as {@link TripRepo.removeMember}: verify the
   * caller is a Member (else `trip_validation_failed`, R8.8); reject with
   * `trip_last_organizer` when leaving would strand a non-empty Trip without an
   * organizer (R5.3); cancel the departing Member's `pending` rode-with tags
   * (created or naming them, R8.6, R8.7) while retaining their log entries and
   * confirmed tags (R8.5). When the caller is the sole Trip_Member the Trip is
   * cascade-deleted (R5.6, R5.7) — `tripDeleted` is `true` — and canonical
   * Tracking data is preserved (R5.7, R8.4).
   */
  leaveTrip(tripId: string, userId: string): Promise<TripDeparture>;

  /**
   * List every current Trip_Member of `tripId` with their display info and
   * role, joining `trip_memberships` to `profiles` for the `displayName` and
   * `avatarPreset` (R4.1). Ordered deterministically by join time then user id.
   * Membership authorization is enforced upstream by the route's
   * `assertTripMember` gate; a Trip with no memberships (e.g. a non-existent
   * Trip) yields an empty list.
   */
  listMembers(tripId: string): Promise<TripMemberDTO[]>;

  /**
   * Add a Planned_Item referencing `input.experienceId` to `tripId`'s
   * Planned_List, recording `adderId` as the Trip_Member who added it (R9.1).
   * The same Experience may be added to a Trip's Planned_List more than once
   * (on the same day or across days), so no duplicate check is performed (R9.3).
   * In one transaction, and after serializing concurrent adds for the Trip so
   * the count check is race-safe, it enforces in order:
   *   - the Experience exists in the Catalog — else `trip_validation_failed`
   *     (R9.4);
   *   - the Planned_List holds fewer than {@link PLANNED_ITEM_LIMIT} items —
   *     else `trip_planned_limit` (R9.5).
   * Membership authorization is enforced upstream by the route's
   * `assertTripMember` gate (R9.2). Returns the created item's read projection.
   */
  addPlannedItem(
    tripId: string,
    adderId: string,
    input: PlannedItemAddInput,
  ): Promise<PlannedItemDTO>;

  editPlannedItem(
    tripId: string,
    itemId: string,
    input: PlannedItemEditInput,
  ): Promise<PlannedItemDTO>;

  updatePlannedItemTimes(
    tripId: string,
    updates: PlannedItemTimeUpdate[],
  ): Promise<void>;

  /**
   * Remove the Planned_Item `itemId` from `tripId`'s Planned_List. Removal is
   * permitted for the Trip_Member who added the item (R9.6) or for any
   * Organizer (R9.7); a `member` who did not add the item is rejected with
   * `trip_forbidden` and the item is left in place (R9.8). Returns `false` when
   * no item with `itemId` belongs to the Trip so the route can map that to
   * `trip_not_found`. `callerRole` is the caller's role on the Trip, resolved
   * by the route's membership gate.
   */
  removePlannedItem(
    tripId: string,
    itemId: string,
    callerId: string,
    callerRole: TripRole,
  ): Promise<boolean>;

  /**
   * List the Planned_Items of `tripId`, joining each referenced Experience's
   * name and Park and the adding Trip_Member's display name for display (R9.9).
   * Membership authorization is enforced upstream by `assertTripMember`.
   */
  listPlannedItems(tripId: string): Promise<PlannedItemDTO[]>;

  /**
   * Log a Completion for `loggerId` against `tripId`, creating the
   * Trip_Log_Entry, its `pending` Rode_With_Tags, and the `completion_logged`
   * feed item, and delegating the canonical Completion (and optional Rating) to
   * the injected Tracking repos so no Trip-local copy exists (R10, R12.1).
   *
   * Validation runs before any write so a rejected request leaves no trace:
   *   - self-tags are rejected with `trip_validation_failed` (R10.5);
   *   - in-request duplicate tags are rejected with `trip_validation_failed`
   *     (R10.6) — the surviving set has at most one tag per Member (R10.3);
   *   - a tagged User who is not a current Trip_Member is rejected with
   *     `trip_validation_failed` (R10.4).
   * Then, in one transaction: the logging Member's canonical Completion is
   * ensured via the injected completion repo (insert-on-conflict; an existing
   * Completion is kept, never duplicated — R10.1, R10.2); the optional Rating
   * is applied via the injected rating repo, which persists the single
   * canonical Rating and emits `RatingChanged` (R10.10, R12.1, R12.2); the
   * `trip_log_entry` is inserted; one `pending` `rode_with_tag` is inserted per
   * distinct tagged Member (R10.3); and a `completion_logged` feed item is
   * added (R10.9).
   *
   * Membership authorization for `loggerId` is enforced upstream by the route's
   * `assertTripMember` gate (R10.7). Returns the created entry's id plus the
   * `pending` tags so the route can dispatch a `RodeWithTagCreatedNotice` per
   * tag after commit (R10.8).
   *
   * Deviation note: the canonical completion/rating repos each open their own
   * connection (their public interfaces take no client), so those writes are
   * not literally enclosed in this method's `trip_*` transaction. They are
   * still issued as part of the same logical operation, ordered after all
   * validation so a rejected request performs no canonical write; the
   * insert-on-conflict Completion and the idempotent Rating upsert make a retry
   * of a partially-applied operation safe.
   *
   * @param now Injectable instant used to default `completedOn` to WDW today.
   */
  logCompletion(
    tripId: string,
    loggerId: string,
    input: LogCompletionInput,
    now?: Date,
  ): Promise<LoggedCompletion>;

  /**
   * Read the Shared_Log of `tripId`: every Trip_Log_Entry with its logging
   * Member's display name, the completed Experience's name, the logging
   * Member's *current* canonical Rating joined live at read time (or `null`
   * when they have none — the unrated indicator, R12.4, R12.8), and each
   * Rode_With_Tag on the entry with its Tagged_Member and current state. The
   * Rating is read live from the canonical `ratings` table (never copied) so a
   * later rating change is always reflected (R12.4). Ordered
   * reverse-chronologically by `created_at` then `id` for a deterministic list.
   * Membership authorization is enforced upstream by the route's
   * `assertTripMember` gate (R15.1); a Trip with no entries yields an empty
   * list.
   */
  listLogEntries(tripId: string): Promise<TripLogEntryDTO[]>;

  /**
   * Confirm the `pending` Rode_With_Tag `tagId` on behalf of its Tagged_Member
   * `callerId`, performing the Trickle_Down inside one transaction (R11.2–R11.5,
   * R11.9, R11.10).
   *
   * Enforced in order so a rejected request writes nothing (R11.1):
   *   - the tag must exist and name `callerId` as its Tagged_Member, else
   *     `trip_forbidden` — a missing tag and one addressed to someone else
   *     collapse to the same non-probing response (R11.7);
   *   - the tag must be `pending`, else `trip_tag_state_invalid` — a
   *     `confirmed` / `declined` / `cancelled` tag is a conflict and nothing is
   *     changed (R11.8);
   *   - when `rating` is supplied it must be a whole number 1–10, else
   *     `rating_out_of_range` and the caller's existing canonical Rating is left
   *     unchanged (R11.9).
   * Then: the Tagged_Member's canonical Completion is ensured via the injected
   * completion repo (insert-on-conflict — an existing Completion is kept and
   * never altered, R11.2, R11.3); the optional canonical Rating is applied via
   * the injected rating repo, which persists the single canonical Rating and
   * emits `RatingChanged` (R11.4, R11.5); and the tag is set `confirmed`
   * (R11.10). No Trip_Feed_Item is written for the confirm — the originating
   * `completion_logged` entry already records the rode-with, so a separate
   * confirm entry would be redundant. When no `rating` is supplied the
   * canonical Rating is left unchanged (R11.5).
   *
   * Authorization that the caller is the Tagged_Member is enforced here (not by
   * a Trip membership gate) since the endpoint is caller-scoped (`/me/...`,
   * R11.7). Returns the confirmed tag's id and the Trip/Experience it links.
   *
   * Deviation note: the canonical completion/rating repos each open their own
   * connection, so those writes are not literally enclosed in this method's
   * `trip_*` transaction — mirroring {@link TripRepo.logCompletion}. They are
   * ordered after all validation so a rejected request performs no canonical
   * write, and their insert-on-conflict / idempotent-upsert semantics make a
   * retry of a partially-applied confirm safe.
   */
  confirmRodeWithTag(
    tagId: string,
    callerId: string,
    rating?: number,
    opts?: ConfirmRodeWithTagOptions,
  ): Promise<ConfirmedRodeWithTag>;

  /**
   * Decline the `pending` Rode_With_Tag `tagId` on behalf of its Tagged_Member
   * `callerId`, transitioning it to the terminal `declined` state and writing
   * nothing to the Tagged_Member's data (R11.6). Throws `trip_forbidden` when
   * the tag does not exist or does not name the caller (non-probing, R11.7) and
   * `trip_tag_state_invalid` when it is not `pending` (R11.8). No Completion,
   * Rating, Note, or feed item is created.
   */
  declineRodeWithTag(tagId: string, callerId: string): Promise<void>;

  /**
   * Read the Rode_With_Tag `tagId` addressed to `callerId` for the mobile
   * confirm view's deep-link target (task 17.4). Joins the linked
   * Trip_Log_Entry, the referenced Experience, the Tagging_Member's display
   * name, and the caller's current canonical Rating for that Experience so the
   * confirm view can pre-fill the rating (R11.5) and detect a stale target
   * (R18.5). Scoped to `tagged_member_id = callerId`; returns `null` when no
   * such tag is addressed to the caller so the route can present the "no longer
   * available" fallback without disclosing tags addressed to others.
   */
  getRodeWithTag(
    tagId: string,
    callerId: string,
  ): Promise<RodeWithTagTarget | null>;

  /**
   * List every `pending` Rode_With_Tag addressed to `userId` as its
   * Tagged_Member, for the Notification_Center's per-domain pending read
   * (`GET /me/rode-with-tags?state=pending`). Scoped to `tagged_member_id =
   * userId` and filtered to `state = 'pending'` so it never returns tags for
   * another User or tags in any non-pending state (R3.1, R3.2). Joins the
   * linked Trip_Log_Entry, the referenced Experience, and the Tagging_Member's
   * `profiles` row to project the tag identifier, the linked trip-log-entry
   * identifier, the Experience name, the tagging member's display name, and the
   * tag's creation timestamp (R3.3). Ordered by `created_at DESC, id ASC` — most
   * recent first with a deterministic id tie-break (R3.1). A User with no
   * pending tags yields an empty list (R3.4).
   */
  listPendingRodeWithTags(userId: string): Promise<PendingRodeWithTagDTO[]>;

  /**
   * Read the Trip_Feed of `tripId` as an ordered list of {@link TripFeedItemDTO}
   * (R13.1). Each item carries its `type`, the acting Trip_Member's display
   * name (joined from `profiles`), its `createdAt` ISO-8601 timestamp, its
   * `metadata`, and the whole group's engagement with it: the aggregated
   * Trip_Reactions per value (with the `callerId` caller's own state) and the
   * Trip_Comments (author display name + whether the caller authored each, so
   * only the author sees a remove control). The list is ordered by the pure
   * {@link orderFeed} helper —
   * reverse-chronologically by `createdAt`, tie-broken by descending `id` — so
   * the order is total and deterministic (R13.3). Membership authorization is
   * enforced upstream by the route's `assertTripMember` gate (R15.1); a Trip
   * with no feed items yields an empty list.
   */
  getFeed(tripId: string, callerId: string): Promise<TripFeedItemDTO[]>;

  /**
   * Add a Trip_Reaction of `reaction` by `memberId` to the target
   * `(targetType, targetId)` on `tripId` (R13.4). The target must belong to the
   * caller's Trip — a `feed_item` to `trip_feed_items` or a `log_entry` to
   * `trip_log_entries`, both scoped to `tripId` — else `trip_not_found` (R13.10).
   * The `reaction` is validated against the closed `Trip_Reaction` vocabulary as
   * defense-in-depth (the route validates too); an unsupported value throws
   * `trip_validation_failed` and nothing is persisted (R13.6). The insert is
   * idempotent via the composite primary key `(target_type, target_id,
   * member_id, reaction)` with `ON CONFLICT DO NOTHING`, so re-adding the same
   * reaction retains the single existing row and never duplicates it (R13.5).
   * Membership authorization is enforced upstream by `assertTripMember` (R13.10).
   */
  addReaction(
    tripId: string,
    targetType: TripFeedTargetType,
    targetId: string,
    memberId: string,
    reaction: TripReactionValue,
  ): Promise<void>;

  /**
   * Remove the Trip_Reaction of `reaction` that `memberId` added to
   * `(targetType, targetId)` on `tripId` (R13.7). The delete is scoped to
   * `member_id = memberId` so a Member can only remove their own reaction, and
   * to `trip_id = tripId`. Idempotent: removing a reaction that does not exist
   * is a no-op and does not error. Membership authorization is enforced upstream
   * by `assertTripMember`.
   */
  removeReaction(
    tripId: string,
    targetType: TripFeedTargetType,
    targetId: string,
    memberId: string,
    reaction: TripReactionValue,
  ): Promise<void>;

  /**
   * Add a Trip_Comment authored by `authorId` to the target
   * `(targetType, targetId)` on `tripId` (R13.8), returning the created
   * comment's identity. The `body` is trimmed and must be 1–2000 characters
   * after trimming — an empty or over-long body throws `trip_validation_failed`
   * and nothing is persisted (R13.9); this is defense-in-depth (the route's
   * shared schema validates the same rule). The target must belong to the
   * caller's Trip, else `trip_not_found` (R13.10). Membership authorization is
   * enforced upstream by `assertTripMember` (R13.10).
   */
  addComment(
    tripId: string,
    targetType: TripFeedTargetType,
    targetId: string,
    authorId: string,
    body: string,
  ): Promise<CreatedComment>;

  /**
   * Remove the Trip_Comment `commentId` on `tripId`, permitted only for its
   * author (R13.11). Returns `false` when no comment with `commentId` belongs to
   * the Trip, so the route can map that to `trip_not_found`. Throws
   * `trip_forbidden` when the comment exists but was authored by another User,
   * leaving it in place (R13.12). Membership authorization is enforced upstream
   * by `assertTripMember`.
   */
  removeComment(
    tripId: string,
    commentId: string,
    authorId: string,
  ): Promise<boolean>;

  /**
   * Derive and return the Trip_Summary of `tripId` (R14.1, R14.6, R14.7). The
   * summary is never stored as an independently editable field; it is always
   * computed here from the Trip's activity via the pure {@link deriveTripSummary}
   * helper. This read assembles that helper's inputs from three live reads —
   * the Trip's log entries (each carrying its logging Member and completed
   * Experience name), its `confirmed` Rode_With_Tags (each carrying its
   * Tagged_Member and Experience), and the canonical Ratings referenced by
   * those Trip-context completions joined live from the `ratings` table (never
   * copied) — then maps the per-Member counts to display names joined from
   * `profiles`. Membership authorization is enforced upstream by the route's
   * `assertTripMember` gate (R14.8); a Trip with no activity yields a summary
   * with a `0` distinct-experience count, an empty `topRated`, and an empty
   * `perMember` list.
   */
  getSummary(tripId: string): Promise<TripSummaryDTO>;

  /**
   * List the caller `userId`'s Trips grouped by derived status for the
   * Trips_List_Screen (R16.1). Fetches exactly the Trips the caller is a
   * Trip_Member of (R16.1), projects each to a {@link TripDTO} with its status
   * derived at read time, and groups them via the pure
   * {@link groupTripsByStatus} helper into the Active, Upcoming, and Past
   * groups in that order — Active/Upcoming ascending by start date, Past
   * descending by end date — omitting empty groups (R16.2–R16.5). Returns an
   * empty array when the caller belongs to no Trips.
   *
   * @param now Injectable instant used to derive each Trip's status and the
   *   WDW date the grouping anchors on.
   */
  listMyTrips(userId: string, now?: Date): Promise<TripListGroup[]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a `TripRepo` bound to the supplied pool and canonical-repo
 * dependencies. Constructor injection (rather than reaching for `getPool()`)
 * keeps the repo testable: unit tests pass a fake pool and fake canonical
 * repos, integration tests pass a sandbox pool and the real repos.
 */
export function createTripRepo(pool: DbPool, deps: TripRepoDeps): TripRepo {
  const ctx: TripRepoContext = {
    pool,
    completions: deps.completions,
    ratings: deps.ratings,
  };
  return {
    createTrip: (creatorId, input, now) =>
      createTrip(ctx, creatorId, input, now),
    getTripForMember: (tripId, now) => getTripForMember(ctx, tripId, now),
    editTrip: (tripId, input, now) => editTrip(ctx, tripId, input, now),
    deleteTrip: (tripId) => deleteTrip(ctx, tripId),
    sendInvite: (tripId, inviterId, inviteeId) =>
      sendInvite(ctx, tripId, inviterId, inviteeId),
    cancelInvite: (tripId, inviteId) => cancelInvite(ctx, tripId, inviteId),
    acceptInvite: (inviteId, userId) => acceptInvite(ctx, inviteId, userId),
    declineInvite: (inviteId, userId) => declineInvite(ctx, inviteId, userId),
    getInvite: (inviteId, userId) => getInvite(ctx, inviteId, userId),
    listMyInvites: (userId) => listMyInvites(ctx, userId),
    promote: (tripId, targetUserId) => promote(ctx, tripId, targetUserId),
    demote: (tripId, targetUserId) => demote(ctx, tripId, targetUserId),
    removeMember: (tripId, targetUserId) =>
      removeMember(ctx, tripId, targetUserId),
    leaveTrip: (tripId, userId) => leaveTrip(ctx, tripId, userId),
    listMembers: (tripId) => listMembers(ctx, tripId),
    listPendingInvites: (tripId) => listPendingInvites(ctx, tripId),
    addPlannedItem: (tripId, adderId, input) =>
      addPlannedItem(ctx, tripId, adderId, input),
    editPlannedItem: (tripId, itemId, input) =>
      editPlannedItem(ctx, tripId, itemId, input),
    updatePlannedItemTimes: (tripId, updates) =>
      updatePlannedItemTimes(ctx, tripId, updates),
    removePlannedItem: (tripId, itemId, callerId, callerRole) =>
      removePlannedItem(ctx, tripId, itemId, callerId, callerRole),
    listPlannedItems: (tripId) => listPlannedItems(ctx, tripId),
    logCompletion: (tripId, loggerId, input, now) =>
      logCompletion(ctx, tripId, loggerId, input, now),
    listLogEntries: (tripId) => listLogEntries(ctx, tripId),
    confirmRodeWithTag: (tagId, callerId, rating, opts) =>
      confirmRodeWithTag(ctx, tagId, callerId, rating, opts),
    declineRodeWithTag: (tagId, callerId) =>
      declineRodeWithTag(ctx, tagId, callerId),
    getRodeWithTag: (tagId, callerId) =>
      getRodeWithTag(ctx, tagId, callerId),
    listPendingRodeWithTags: (userId) =>
      listPendingRodeWithTags(ctx, userId),
    getFeed: (tripId, callerId) => getFeed(ctx, tripId, callerId),
    addReaction: (tripId, targetType, targetId, memberId, reaction) =>
      addReaction(ctx, tripId, targetType, targetId, memberId, reaction),
    removeReaction: (tripId, targetType, targetId, memberId, reaction) =>
      removeReaction(ctx, tripId, targetType, targetId, memberId, reaction),
    addComment: (tripId, targetType, targetId, authorId, body) =>
      addComment(ctx, tripId, targetType, targetId, authorId, body),
    removeComment: (tripId, commentId, authorId) =>
      removeComment(ctx, tripId, commentId, authorId),
    getSummary: (tripId) => getSummary(ctx, tripId),
    listMyTrips: (userId, now) => listMyTrips(ctx, userId, now),
  };
}

// ---------------------------------------------------------------------------
// Row shape + mapping
// ---------------------------------------------------------------------------

/** Row shape mirroring the `trips` SELECT/RETURNING column list. */
interface TripRow {
  id: string;
  name: string;
  description: string;
  start_date: Date | string;
  end_date: Date | string;
  created_at: Date | string;
  walking_speed?: 'slow' | 'moderate' | 'fast';
  early_entry_eligible?: boolean;
  day_touring_hours?: Record<string, unknown> | string;
}

/**
 * Row shape for the Trip_Resort display projection: a `trip_resorts` row joined
 * to its catalog `resorts` row for the resort's display name (R21.1). Carries
 * the owning `trip_id` so a single batched read can be fanned out per Trip.
 */
interface TripResortRow {
  trip_id: string;
  id: string;
  name: string;
}

/**
 * Minimal query surface shared by the pool and an in-transaction client, so the
 * resort read/write helpers below work both on a plain read (via `ctx.pool`)
 * and inside a create/edit transaction (via its `PoolClient`).
 */
type Queryable = Pick<PoolClient, 'query'>;

/**
 * Row shape for the Planned_Item display projection: the `planned_items` row
 * joined to its Experience (name + Park) and the adding Member's profile
 * display name (R9.9).
 */
interface PlannedItemRow {
  id: string;
  experience_id: string;
  experience_name: string;
  park: Park;
  added_by_display_name: string;
  planned_date: string | null;
  planned_time: string | null;
  is_fixed: boolean;
  is_lightning_lane: boolean;
  use_single_rider: boolean;
  priority: number;
  item_type: 'experience' | 'break';
  duration_minutes: number | null;
  predicted_wait_minutes: number | null;
  travel_from_prev_minutes: number | null;
  travel_from_prev_kind: 'walk' | 'park_hop' | null;
  optimized_at: Date | string | null;
}

/**
 * Row shape for the Trip_Member display projection: a `trip_memberships` row
 * joined to the member's `profiles` display name and avatar preset (R4.1).
 */
interface TripMemberRow {
  user_id: string;
  display_name: string;
  avatar_preset: string | null;
  role: TripRole;
}

/**
 * Project a `trips` row to the shared `TripDTO`, deriving the `Trip_Status`
 * from the two stored dates and the WDW calendar date for `now` (R2). The
 * status is computed here rather than stored so it can never drift (R2.5). The
 * `resorts` the Trip's party stayed at are read separately and passed in
 * (R21.1); callers pass an empty array when the Trip records no stay.
 */
function rowToDto(
  row: TripRow,
  now: Date | undefined,
  resorts: readonly TripResortDTO[],
): TripDTO {
  const startDate = toIsoDate(row.start_date);
  const endDate = toIsoDate(row.end_date);
  let dayTouringHours: Record<string, any> | undefined = undefined;
  if (row.day_touring_hours) {
    dayTouringHours =
      typeof row.day_touring_hours === 'string'
        ? JSON.parse(row.day_touring_hours)
        : row.day_touring_hours;
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    startDate,
    endDate,
    status: deriveTripStatus(startDate, endDate, wdwToday(now)),
    createdAt: toIsoTimestamp(row.created_at),
    resorts,
    ...(row.walking_speed !== undefined ? { walkingSpeed: row.walking_speed } : {}),
    ...(row.early_entry_eligible !== undefined ? { earlyEntryEligible: row.early_entry_eligible } : {}),
    ...(dayTouringHours !== undefined ? { dayTouringHours } : {}),
  };
}

// ---------------------------------------------------------------------------
// Trip_Resort read/write helpers (R21.1, R21.2)
// ---------------------------------------------------------------------------

/**
 * Read the Resort stay for one or more Trips in a single query, grouped by
 * Trip. Each Trip's resorts are ordered by name then id so the projection is
 * deterministic (R21.1). A Trip with no recorded stay is simply absent from the
 * returned map; callers default it to an empty array. Works on either the pool
 * or an in-transaction client via the {@link Queryable} surface.
 */
async function selectTripResortsByTrip(
  q: Queryable,
  tripIds: readonly string[],
): Promise<Map<string, TripResortDTO[]>> {
  const byTrip = new Map<string, TripResortDTO[]>();
  if (tripIds.length === 0) {
    return byTrip;
  }
  const placeholders = tripIds.map((_, i) => `$${i + 1}`).join(', ');
  const result = await q.query<TripResortRow>(
    `SELECT tr.trip_id, r.id, r.name
       FROM trip_resorts tr
       JOIN resorts r ON r.id = tr.resort_id
      WHERE tr.trip_id IN (${placeholders})
      ORDER BY r.name ASC, r.id ASC`,
    [...tripIds],
  );
  for (const row of result.rows) {
    const list = byTrip.get(row.trip_id) ?? [];
    list.push({ id: row.id, name: row.name });
    byTrip.set(row.trip_id, list);
  }
  return byTrip;
}

/** Read the Resort stay for a single Trip, defaulting to an empty array. */
async function selectTripResorts(
  q: Queryable,
  tripId: string,
): Promise<TripResortDTO[]> {
  const byTrip = await selectTripResortsByTrip(q, [tripId]);
  return byTrip.get(tripId) ?? [];
}

/**
 * Replace a Trip's recorded Resort stay with exactly `resortIds` inside the
 * caller's transaction (R21.1). Duplicate ids in the request are collapsed. All
 * ids are validated to reference an existing, active catalog Resort before any
 * write — an unknown or soft-deleted Resort throws `trip_validation_failed` and
 * nothing is changed (R21.4). The prior set is deleted and the new set inserted,
 * so an empty `resortIds` clears the stay. The join table's composite PK is the
 * final duplicate guard (R21.2).
 */
async function replaceTripResorts(
  client: PoolClient,
  tripId: string,
  resortIds: readonly string[],
): Promise<void> {
  const distinct = [...new Set(resortIds)];

  if (distinct.length > 0) {
    // Validate every id references an active catalog Resort before writing so a
    // rejected request leaves the existing stay untouched (R21.4). The
    // placeholder list is generated from the array length (never interpolated
    // input), and every id is a bound parameter, so this is injection-safe.
    const placeholders = distinct.map((_, i) => `$${i + 1}`).join(', ');
    const found = await client.query<{ id: string }>(
      `SELECT id FROM resorts WHERE id IN (${placeholders}) AND active = TRUE`,
      [...distinct],
    );
    if (found.rows.length !== distinct.length) {
      throw new AppError(
        'trip_validation_failed',
        'One or more resorts do not exist or are unavailable.',
        { field: 'resortIds' },
      );
    }
  }

  // Wholesale replace: clear the prior stay, then insert the new set (R21.1).
  await client.query(`DELETE FROM trip_resorts WHERE trip_id = $1`, [tripId]);
  if (distinct.length > 0) {
    // Multi-row VALUES insert; $1 is the trip id, $2.. are the resort ids. The
    // composite PK is the final duplicate guard (R21.2).
    const rows = distinct.map((_, i) => `($1, $${i + 2})`).join(', ');
    await client.query(
      `INSERT INTO trip_resorts (trip_id, resort_id) VALUES ${rows}`,
      [tripId, ...distinct],
    );
  }
}

// ---------------------------------------------------------------------------
// createTrip (R1.1, R1.2, R1.3, R1.9, R1.10)
// ---------------------------------------------------------------------------

/**
 * Create a Trip and its creator membership + feed item atomically.
 *
 * The three writes run inside one transaction so a Trip can never exist
 * without its creator's `organizer` membership (R1.1) or its `trip_created`
 * feed item (R1.10). The `name` is trimmed before insert (R1.3); the route's
 * Zod schema already trims and bounds it, so this is defense in depth that
 * also covers direct callers. `creator_id` records the Trip_Creator (R1.9),
 * and the optional description defaults to the empty string (R1.2).
 */
async function createTrip(
  ctx: TripRepoContext,
  creatorId: string,
  input: TripCreateInput,
  now: Date | undefined,
): Promise<TripDTO> {
  const name = input.name.trim();
  const description = input.description ?? '';

  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    const insertTrip = await client.query<TripRow>(
      `INSERT INTO trips (creator_id, name, description, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, start_date, end_date, created_at, walking_speed, early_entry_eligible, day_touring_hours`,
      [creatorId, name, description, input.startDate, input.endDate],
    );
    const row = insertTrip.rows[0];
    if (!row) {
      // Unreachable on a successful INSERT ... RETURNING; surface generically.
      throw new AppError('internal_error', 'Trip insertion returned no row.');
    }

    // The Trip_Creator is the first — and, at creation, the sole — Organizer
    // (R1.1). The membership PK on (trip_id, user_id) guarantees a single role.
    await client.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer')`,
      [row.id, creatorId],
    );

    // Record that the creator created the Trip (R1.10).
    await client.query(
      `INSERT INTO trip_feed_items (trip_id, type, actor_id)
       VALUES ($1, 'trip_created', $2)`,
      [row.id, creatorId],
    );

    // Record the Resort(s) the party stayed at, when supplied (R21.1). An
    // unknown/inactive Resort id aborts the whole create via the transaction.
    // A newly created Trip has no prior stay, so only read the display
    // projection back when at least one Resort was actually recorded.
    let resorts: TripResortDTO[] = [];
    if (input.resortIds !== undefined && input.resortIds.length > 0) {
      await replaceTripResorts(client, row.id, input.resortIds);
      resorts = await selectTripResorts(client, row.id);
    }

    await client.query('COMMIT');
    return rowToDto(row, now, resorts);
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// getTripForMember (R2, R3.1)
// ---------------------------------------------------------------------------

/**
 * Read a Trip and derive its status. A plain read needs no transaction; the
 * derived status is computed by {@link rowToDto}. Returns `null` when the Trip
 * does not exist so the route can map that to `trip_not_found` for an
 * authorized caller (membership is asserted upstream).
 */
async function getTripForMember(
  ctx: TripRepoContext,
  tripId: string,
  now: Date | undefined,
): Promise<TripDTO | null> {
  const result = await ctx.pool.query<TripRow>(
    `SELECT id, name, description, start_date, end_date, created_at, walking_speed, early_entry_eligible, day_touring_hours
       FROM trips
      WHERE id = $1`,
    [tripId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const resorts = await selectTripResorts(ctx.pool, tripId);
  return rowToDto(row, now, resorts);
}

// ---------------------------------------------------------------------------
// editTrip (R3.1, R3.6)
// ---------------------------------------------------------------------------

/**
 * Apply a partial edit, touching only the supplied fields (R3.1).
 *
 * Runs inside one transaction that first reads the current row `FOR UPDATE` so
 * the merged date-order check sees a consistent snapshot and a concurrent edit
 * cannot slip a violating date pair past the `end >= start` invariant. When no
 * field is supplied the current Trip is returned unchanged. The date-order
 * check compares the merged `{start, end}` (supplied value falling back to the
 * stored one), so supplying only one date is validated against the stored
 * other date (R3.6); a violation throws `trip_validation_failed` and no field
 * is changed. The `name` is stored trimmed (R3.2).
 */
async function editTrip(
  ctx: TripRepoContext,
  tripId: string,
  input: TripEditInput,
  now: Date | undefined,
): Promise<TripDTO | null> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<TripRow>(
      `SELECT id, name, description, start_date, end_date, created_at, walking_speed, early_entry_eligible, day_touring_hours
         FROM trips
        WHERE id = $1
        FOR UPDATE`,
      [tripId],
    );
    const currentRow = current.rows[0];
    if (!currentRow) {
      await client.query('ROLLBACK');
      return null;
    }

    // Re-check end >= start against the MERGED dates so an edit that supplies
    // only one date is validated against the stored other date (R3.6).
    const effectiveStart =
      input.startDate ?? toIsoDate(currentRow.start_date);
    const effectiveEnd = input.endDate ?? toIsoDate(currentRow.end_date);
    if (effectiveEnd < effectiveStart) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_validation_failed',
        'Trip end date must be on or after the start date.',
        { field: 'endDate' },
      );
    }

    // Build the SET list from only the supplied fields (R3.1). When nothing
    // was supplied there is no write to perform — return the current Trip.
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) {
      params.push(input.name.trim());
      assignments.push(`name = $${params.length}`);
    }
    if (input.description !== undefined) {
      params.push(input.description);
      assignments.push(`description = $${params.length}`);
    }
    if (input.startDate !== undefined) {
      params.push(input.startDate);
      assignments.push(`start_date = $${params.length}`);
    }
    if (input.endDate !== undefined) {
      params.push(input.endDate);
      assignments.push(`end_date = $${params.length}`);
    }
    if (input.walkingSpeed !== undefined) {
      params.push(input.walkingSpeed);
      assignments.push(`walking_speed = $${params.length}`);
    }
    if (input.earlyEntryEligible !== undefined) {
      params.push(input.earlyEntryEligible);
      assignments.push(`early_entry_eligible = $${params.length}`);
    }
    if (input.dayTouringHours !== undefined) {
      params.push(JSON.stringify(input.dayTouringHours));
      assignments.push(`day_touring_hours = $${params.length}`);
    }

    // Supplying `resortIds` replaces the recorded Resort stay wholesale, even
    // when no scalar Trip field changed; an empty array clears it (R21.1). An
    // unknown/inactive Resort id aborts the whole edit via the transaction.
    if (input.resortIds !== undefined) {
      await replaceTripResorts(client, tripId, input.resortIds);
    }

    if (assignments.length === 0) {
      const resorts = await selectTripResorts(client, tripId);
      await client.query('COMMIT');
      return rowToDto(currentRow, now, resorts);
    }

    params.push(tripId);
    const updated = await client.query<TripRow>(
      `UPDATE trips
          SET ${assignments.join(', ')}, updated_at = now()
        WHERE id = $${params.length}
      RETURNING id, name, description, start_date, end_date, created_at, walking_speed, early_entry_eligible, day_touring_hours`,
      params,
    );
    const updatedRow = updated.rows[0];
    if (!updatedRow) {
      // Unreachable: the row was locked FOR UPDATE above.
      throw new AppError('internal_error', 'Trip update returned no row.');
    }

    const resorts = await selectTripResorts(client, tripId);
    await client.query('COMMIT');
    return rowToDto(updatedRow, now, resorts);
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// deleteTrip (R3.7, R3.10)
// ---------------------------------------------------------------------------

/**
 * Delete a Trip. A single `DELETE FROM trips` fans out to every child entity
 * (memberships, invites, planned items, log entries, rode-with tags, feed
 * items, reactions, comments) through the migration's `ON DELETE CASCADE`
 * foreign keys (R3.7). No canonical Tracking table (`completions`, `ratings`,
 * `notes`) references `trips`, so this write can never remove a Trip_Member's
 * canonical data (R3.10). Returns whether a row was deleted so the route can
 * map `false` to `trip_not_found`.
 */
async function deleteTrip(ctx: TripRepoContext, tripId: string): Promise<boolean> {
  const result = await ctx.pool.query(`DELETE FROM trips WHERE id = $1`, [
    tripId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// sendInvite (R6.1, R6.2, R6.4, R6.5)
// ---------------------------------------------------------------------------

/**
 * Create a `pending` Trip_Invite, enforcing the Friend / not-already-a-member /
 * no-pending-invite preconditions atomically.
 *
 * All checks and the insert run inside one transaction so two concurrent
 * requests cannot both pass the "no pending invite" check and each insert a
 * row; the partial unique index `trip_invites_one_pending_idx` is the final
 * backstop and a losing racer's INSERT surfaces SQLSTATE 23505, mapped here to
 * `trip_invite_duplicate` (R6.5).
 *
 * Check order is chosen so a self-invite (Organizer inviting themselves) is
 * caught by the membership check before the friendship lookup — the canonical
 * pair helper forbids a `(x, x)` pair, so the membership check must run first
 * to avoid reaching it. A User already a Member of the Trip (even one who is
 * not a Friend of this particular Organizer) is reported as a duplicate, which
 * is the correct outcome (R6.4).
 */
async function sendInvite(
  ctx: TripRepoContext,
  tripId: string,
  inviterId: string,
  inviteeId: string,
): Promise<CreatedInvite> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    // R6.4: the invitee must not already be a Trip_Member. This also absorbs a
    // self-invite: the Organizer is a Member, so inviting themselves is a
    // duplicate rather than reaching the (x, x) friendship pair below.
    const membership = await client.query(
      `SELECT 1 FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
      [tripId, inviteeId],
    );
    if ((membership.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_invite_duplicate',
        'That User is already a member of this trip.',
      );
    }

    // R6.2: the invitee must be a Friend of the inviter — one lookup against
    // the canonical `friendships` pair, exactly like `assertOwnerOrFriend`.
    const { lo, hi } = canonicalPair(inviterId, inviteeId);
    const friendship = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM friendships WHERE user_lo_id = $1 AND user_hi_id = $2
       ) AS exists`,
      [lo, hi],
    );
    if (friendship.rows[0]?.exists !== true) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_not_friend',
        'You can only invite your friends to a trip.',
      );
    }

    // R6.5: the invitee must not already hold a pending invite for this Trip.
    const pending = await client.query(
      `SELECT 1 FROM trip_invites
        WHERE trip_id = $1 AND invitee_id = $2 AND state = 'pending'`,
      [tripId, inviteeId],
    );
    if ((pending.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_invite_duplicate',
        'That User already has a pending invite for this trip.',
      );
    }

    const insert = await client.query<{ id: string }>(
      `INSERT INTO trip_invites (trip_id, inviter_id, invitee_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [tripId, inviterId, inviteeId],
    );
    const inviteId = insert.rows[0]?.id;
    if (!inviteId) {
      throw new AppError('internal_error', 'Invite insertion returned no row.');
    }

    await client.query('COMMIT');
    return { inviteId, tripId, inviterId, inviteeId };
  } catch (err) {
    await safeRollback(client);
    // The partial unique index is the race backstop: a concurrent insert that
    // slipped past the "no pending invite" check collides here (R6.5).
    if (isUniqueViolation(err)) {
      throw new AppError(
        'trip_invite_duplicate',
        'That User already has a pending invite for this trip.',
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// cancelInvite (R6.8)
// ---------------------------------------------------------------------------

/**
 * Cancel a `pending` invite for a Trip. Reads the invite `FOR UPDATE` scoped to
 * the Trip so a concurrent accept cannot slip in between the state check and
 * the write. Returns `false` when no invite with `inviteId` belongs to the Trip
 * (route → `trip_not_found`); throws `trip_invite_state_invalid` when the
 * invite is not `pending`, since only a pending invite can be cancelled (R6.8).
 */
async function cancelInvite(
  ctx: TripRepoContext,
  tripId: string,
  inviteId: string,
): Promise<boolean> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<{ state: string }>(
      `SELECT state FROM trip_invites
        WHERE id = $1 AND trip_id = $2
        FOR UPDATE`,
      [inviteId, tripId],
    );
    const row = current.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return false;
    }
    if (row.state !== 'pending') {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_invite_state_invalid',
        'Only a pending invite can be cancelled.',
      );
    }

    await client.query(
      `UPDATE trip_invites
          SET state = 'cancelled', updated_at = now()
        WHERE id = $1`,
      [inviteId],
    );

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// acceptInvite (R7.1, R7.2, R7.6)
// ---------------------------------------------------------------------------

/**
 * Accept a `pending` invite addressed to `userId` and join the Trip.
 *
 * In one transaction: lock the invite `FOR UPDATE`, verify it is addressed to
 * the caller (else `trip_forbidden`, collapsing a missing invite and one
 * addressed to someone else into the same non-probing response, R7.4) and is
 * `pending` (else `trip_invite_state_invalid`, R7.5); then set it `accepted`,
 * insert the `member` membership idempotently (`ON CONFLICT DO NOTHING` so a
 * User already a Member gains no duplicate, R7.2), and record the
 * `member_joined` feed item (R7.6). Returns the joined Trip's id.
 */
async function acceptInvite(
  ctx: TripRepoContext,
  inviteId: string,
  userId: string,
): Promise<{ tripId: string }> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<{
      trip_id: string;
      invitee_id: string;
      state: string;
    }>(
      `SELECT trip_id, invitee_id, state FROM trip_invites
        WHERE id = $1
        FOR UPDATE`,
      [inviteId],
    );
    const row = current.rows[0];
    if (!row || row.invitee_id !== userId) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_forbidden',
        'This invite is not available to you.',
      );
    }
    if (row.state !== 'pending') {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_invite_state_invalid',
        'This invite is no longer pending.',
      );
    }

    await client.query(
      `UPDATE trip_invites
          SET state = 'accepted', updated_at = now()
        WHERE id = $1`,
      [inviteId],
    );

    // R7.1 / R7.2: add the invitee as a `member`; a pre-existing membership is
    // left untouched so no duplicate role is created.
    await client.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (trip_id, user_id) DO NOTHING`,
      [row.trip_id, userId],
    );

    // R7.6: record that the User joined the Trip.
    await client.query(
      `INSERT INTO trip_feed_items (trip_id, type, actor_id)
       VALUES ($1, 'member_joined', $2)`,
      [row.trip_id, userId],
    );

    await client.query('COMMIT');
    return { tripId: row.trip_id };
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// declineInvite (R7.3)
// ---------------------------------------------------------------------------

/**
 * Decline a `pending` invite addressed to `userId`, adding no membership
 * (R7.3). Uses the same lock-and-check discipline as {@link acceptInvite}: a
 * missing invite or one not addressed to the caller collapses to
 * `trip_forbidden` (R7.4), and a non-`pending` invite throws
 * `trip_invite_state_invalid` (R7.5).
 */
async function declineInvite(
  ctx: TripRepoContext,
  inviteId: string,
  userId: string,
): Promise<void> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<{ invitee_id: string; state: string }>(
      `SELECT invitee_id, state FROM trip_invites
        WHERE id = $1
        FOR UPDATE`,
      [inviteId],
    );
    const row = current.rows[0];
    if (!row || row.invitee_id !== userId) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_forbidden',
        'This invite is not available to you.',
      );
    }
    if (row.state !== 'pending') {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_invite_state_invalid',
        'This invite is no longer pending.',
      );
    }

    await client.query(
      `UPDATE trip_invites
          SET state = 'declined', updated_at = now()
        WHERE id = $1`,
      [inviteId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// getInvite (R7.7–R7.9)
// ---------------------------------------------------------------------------

/**
 * Read the invite addressed to `userId` for the deep-link target, joining the
 * Trip name and the inviter's display name for display (R7.7). The invite is
 * returned regardless of its state so the App can present the accept/decline
 * controls when `pending` and the "no longer available" indication otherwise
 * (R7.9). Scoped to `invitee_id = userId` and returning `null` when no such
 * invite exists so the endpoint cannot probe invites addressed to others.
 */
async function getInvite(
  ctx: TripRepoContext,
  inviteId: string,
  userId: string,
): Promise<TripInviteDTO | null> {
  const result = await ctx.pool.query<{
    id: string;
    trip_id: string;
    trip_name: string;
    inviter_display_name: string;
    state: TripInviteDTO['state'];
  }>(
    `SELECT ti.id,
            ti.trip_id,
            t.name             AS trip_name,
            p.display_name     AS inviter_display_name,
            ti.state
       FROM trip_invites ti
       JOIN trips t     ON t.id = ti.trip_id
       JOIN profiles p  ON p.user_id = ti.inviter_id
      WHERE ti.id = $1 AND ti.invitee_id = $2`,
    [inviteId, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    tripId: row.trip_id,
    tripName: row.trip_name,
    inviterDisplayName: row.inviter_display_name,
    state: row.state,
  };
}

// ---------------------------------------------------------------------------
// listMyInvites (R7.1–R7.3, invitee-facing inbox)
// ---------------------------------------------------------------------------

/**
 * List the `pending` Trip_Invites addressed to `userId` for their invitations
 * inbox, joining each Trip's name and dates and the inviter's display info so
 * the Trips_List can show who invited them and offer accept/decline. Scoped to
 * `invitee_id = userId` and filtered to `state = 'pending'` so only actionable
 * invites appear; terminal invites are omitted and, thanks to the partial
 * unique index `trip_invites_one_pending_idx`, at most one row per Trip appears.
 */
async function listMyInvites(
  ctx: TripRepoContext,
  userId: string,
): Promise<TripIncomingInviteDTO[]> {
  const result = await ctx.pool.query<{
    invite_id: string;
    trip_id: string;
    trip_name: string;
    start_date: Date | string;
    end_date: Date | string;
    inviter_display_name: string;
    inviter_avatar_preset: string | null;
    created_at: Date | string;
  }>(
    `SELECT ti.id            AS invite_id,
            ti.trip_id       AS trip_id,
            t.name           AS trip_name,
            t.start_date     AS start_date,
            t.end_date       AS end_date,
            p.display_name   AS inviter_display_name,
            p.avatar_preset  AS inviter_avatar_preset,
            ti.created_at    AS created_at
       FROM trip_invites ti
       JOIN trips t     ON t.id = ti.trip_id
       JOIN profiles p  ON p.user_id = ti.inviter_id
      WHERE ti.invitee_id = $1 AND ti.state = 'pending'
      ORDER BY ti.created_at ASC, ti.id ASC`,
    [userId],
  );
  return result.rows.map((row) => ({
    inviteId: row.invite_id,
    tripId: row.trip_id,
    tripName: row.trip_name,
    startDate: toIsoDate(row.start_date),
    endDate: toIsoDate(row.end_date),
    inviterDisplayName: row.inviter_display_name,
    inviterAvatarPreset: row.inviter_avatar_preset,
    createdAt: toIsoTimestamp(row.created_at),
  }));
}

// ---------------------------------------------------------------------------
// promote (R4.5, R4.8)
// ---------------------------------------------------------------------------

/**
 * Promote a Member to Organizer.
 *
 * Locks the target's membership row `FOR UPDATE` so a concurrent role change
 * cannot race the check. A missing row means the target is not a Trip_Member —
 * rejected with `trip_validation_failed` (R8.9-style guard for a nonsensical
 * target). An already-`organizer` target is a no-op change and rejected with
 * `trip_role_invalid` (R4.8). Otherwise the role is set to `organizer` (R4.5).
 * Promotion can never violate the Last_Organizer_Rule since it only adds an
 * organizer.
 */
async function promote(
  ctx: TripRepoContext,
  tripId: string,
  targetUserId: string,
): Promise<void> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    const role = await lockMemberRole(client, tripId, targetUserId);
    if (role === undefined) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_validation_failed',
        'That User is not a member of this trip.',
      );
    }
    if (role === 'organizer') {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_role_invalid',
        'That member is already an organizer.',
      );
    }

    await client.query(
      `UPDATE trip_memberships SET role = 'organizer'
        WHERE trip_id = $1 AND user_id = $2`,
      [tripId, targetUserId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// demote (R4.6, R4.8, R5.2)
// ---------------------------------------------------------------------------

/**
 * Demote an Organizer to Member, subject to the Last_Organizer_Rule.
 *
 * Locks the whole membership set for the Trip `FOR UPDATE` so the rule is
 * evaluated against a consistent snapshot and a concurrent demote/leave cannot
 * slip past it. A target absent from the set is not a Member
 * (`trip_validation_failed`); an already-`member` target is a no-op change
 * (`trip_role_invalid`, R4.8). When the demotion would leave the non-empty Trip
 * with zero organizers the {@link violatesLastOrganizer} predicate reports a
 * violation and it is rejected with `trip_last_organizer` (R5.2). Otherwise the
 * role is set to `member` (R4.6).
 */
async function demote(
  ctx: TripRepoContext,
  tripId: string,
  targetUserId: string,
): Promise<void> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    const members = await lockMemberships(client, tripId);
    const target = members.find((m) => m.userId === targetUserId);
    if (target === undefined) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_validation_failed',
        'That User is not a member of this trip.',
      );
    }
    if (target.role === 'member') {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_role_invalid',
        'That member is already a member.',
      );
    }
    if (violatesLastOrganizer(members, { kind: 'demote', userId: targetUserId })) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_last_organizer',
        'A trip must always have at least one organizer.',
      );
    }

    await client.query(
      `UPDATE trip_memberships SET role = 'member'
        WHERE trip_id = $1 AND user_id = $2`,
      [tripId, targetUserId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// removeMember (R8.2, R8.5, R8.6, R8.7, R8.9, R5.4)
// ---------------------------------------------------------------------------

/**
 * Remove another Trip_Member from the Trip (an Organizer action). Delegates to
 * the shared {@link departMember} routine with a `remove` change so the
 * Last_Organizer_Rule (R5.4), pending-tag cancellation (R8.6, R8.7), and
 * contribution retention (R8.5) are enforced identically to leaving. A target
 * who is not a Member is rejected with `trip_validation_failed` (R8.9).
 */
async function removeMember(
  ctx: TripRepoContext,
  tripId: string,
  targetUserId: string,
): Promise<TripDeparture> {
  return departMember(ctx, tripId, targetUserId, 'remove');
}

// ---------------------------------------------------------------------------
// leaveTrip (R8.1, R8.5, R8.6, R8.7, R8.8, R5.3, R5.6, R5.7)
// ---------------------------------------------------------------------------

/**
 * Leave the Trip (the caller removes their own membership). Delegates to the
 * shared {@link departMember} routine with a `leave` change. A caller who is
 * not a Member is rejected with `trip_validation_failed` (R8.8); the sole
 * Member leaving empties the Trip and triggers its cascade delete (R5.6, R5.7).
 */
async function leaveTrip(
  ctx: TripRepoContext,
  tripId: string,
  userId: string,
): Promise<TripDeparture> {
  return departMember(ctx, tripId, userId, 'leave');
}

// ---------------------------------------------------------------------------
// departMember — shared removal/leave transaction (R5.3-R5.7, R8.1-R8.9)
// ---------------------------------------------------------------------------

/**
 * The single transactional routine behind both {@link removeMember} and
 * {@link leaveTrip}; the only difference between them is the authorization gate
 * (enforced upstream) and the `change.kind` passed to the Last_Organizer_Rule.
 *
 * In one transaction:
 *   1. Lock the Trip's whole membership set `FOR UPDATE` so the rule check and
 *      the sole-Member test see a consistent snapshot (R5).
 *   2. Reject when the departing User is not a Member (`trip_validation_failed`,
 *      R8.8/R8.9).
 *   3. Reject with `trip_last_organizer` when the departure would leave a
 *      non-empty Trip with zero organizers (R5.3, R5.4); the sole-Member case
 *      empties the set and is permitted (R5.6).
 *   4. Delete the membership.
 *   5. Cancel every `pending` rode-with tag on this Trip that the departing
 *      Member created as Tagging_Member (via a log entry they authored) or is
 *      named in as Tagged_Member, so neither can ever be confirmed (R8.6,
 *      R8.7). Confirmed/declined tags and all log entries are left intact
 *      (R8.5).
 *   6. When no Member remains, cascade-delete the Trip (R5.7) and report
 *      `tripDeleted: true`.
 *
 * Canonical `completions` / `ratings` / `notes` are never referenced, so a
 * departure can never mutate Tracking data (R8.4, R5.7).
 */
async function departMember(
  ctx: TripRepoContext,
  tripId: string,
  userId: string,
  kind: 'remove' | 'leave',
): Promise<TripDeparture> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    const members = await lockMemberships(client, tripId);
    const isMember = members.some((m) => m.userId === userId);
    if (!isMember) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_validation_failed',
        'That User is not a member of this trip.',
      );
    }

    if (violatesLastOrganizer(members, { kind, userId })) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_last_organizer',
        'A trip must always have at least one organizer.',
      );
    }

    // Remove the departing Member's role on this Trip (R8.1, R8.2).
    await client.query(
      `DELETE FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
      [tripId, userId],
    );

    // Cancel every pending rode-with tag on this Trip that the departing Member
    // created (tags on a log entry they authored) or is named in, so they can
    // no longer be confirmed (R8.6, R8.7). Confirmed/declined tags and the log
    // entries themselves are retained (R8.5).
    await client.query(
      `UPDATE rode_with_tags rwt
          SET state = 'cancelled', updated_at = now()
         FROM trip_log_entries tle
        WHERE rwt.log_entry_id = tle.id
          AND tle.trip_id = $1
          AND rwt.state = 'pending'
          AND (rwt.tagged_member_id = $2 OR tle.member_id = $2)`,
      [tripId, userId],
    );

    // When the sole Member left, the Trip is now empty: delete it, cascading to
    // every child entity via the migration's ON DELETE CASCADE (R5.7). Never
    // touches canonical Tracking data (R5.7, R8.4).
    let tripDeleted = false;
    if (members.length === 1) {
      await client.query(`DELETE FROM trips WHERE id = $1`, [tripId]);
      tripDeleted = true;
    }

    await client.query('COMMIT');
    return { tripDeleted };
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// listMembers (R4.1)
// ---------------------------------------------------------------------------

/**
 * List a Trip's current Members with their display projection: each Member's
 * `profiles` display name and avatar preset alongside their Trip role (R4.1). A
 * plain read needs no transaction. Ordered by join time (`joined_at`, then
 * `user_id`) for a deterministic list. A Trip with no memberships yields an
 * empty list, so the route's `assertTripMember` gate — not this read — is what
 * distinguishes a non-member from an empty Trip.
 */
async function listMembers(
  ctx: TripRepoContext,
  tripId: string,
): Promise<TripMemberDTO[]> {
  const result = await ctx.pool.query<TripMemberRow>(
    `SELECT tm.user_id,
            p.display_name   AS display_name,
            p.avatar_preset  AS avatar_preset,
            tm.role          AS role
       FROM trip_memberships tm
       JOIN profiles p ON p.user_id = tm.user_id
      WHERE tm.trip_id = $1
      ORDER BY tm.joined_at ASC, tm.user_id ASC`,
    [tripId],
  );
  return result.rows.map(rowToTripMemberDto);
}

// ---------------------------------------------------------------------------
// listPendingInvites (R6.5, R6.8)
// ---------------------------------------------------------------------------

/**
 * List every `pending` Trip_Invite for a Trip with the invited User's display
 * info (R6.5, R6.8). Terminal invites (accepted/declined/cancelled) are
 * omitted by the `state = 'pending'` filter, which lines up with the partial
 * unique index `trip_invites_one_pending_idx` so at most one row per invitee
 * appears. A Trip with no pending invites yields an empty list.
 */
async function listPendingInvites(
  ctx: TripRepoContext,
  tripId: string,
): Promise<TripPendingInviteDTO[]> {
  const result = await ctx.pool.query<{
    invite_id: string;
    invitee_id: string;
    invitee_display_name: string;
    invitee_avatar_preset: string | null;
  }>(
    `SELECT ti.id            AS invite_id,
            ti.invitee_id    AS invitee_id,
            p.display_name   AS invitee_display_name,
            p.avatar_preset  AS invitee_avatar_preset
       FROM trip_invites ti
       JOIN profiles p ON p.user_id = ti.invitee_id
      WHERE ti.trip_id = $1 AND ti.state = 'pending'
      ORDER BY ti.created_at ASC, ti.id ASC`,
    [tripId],
  );
  return result.rows.map((row) => ({
    inviteId: row.invite_id,
    inviteeId: row.invitee_id,
    inviteeDisplayName: row.invitee_display_name,
    inviteeAvatarPreset: row.invitee_avatar_preset,
  }));
}

// ---------------------------------------------------------------------------
// addPlannedItem (R9.1, R9.3, R9.4, R9.5)
// ---------------------------------------------------------------------------

/**
 * Add a Planned_Item to a Trip's Planned_List, recording the adder (R9.1).
 *
 * The same Experience may appear on a Trip's Planned_List more than once — on
 * the same day or across different days (R9.3) — so no duplicate check is made.
 *
 * All checks and the insert run inside one transaction that first locks the
 * Trip row `FOR UPDATE`, serializing concurrent adds for the same Trip so the
 * 500-item count check cannot be raced past its limit. The checks run in a
 * fixed order:
 *   1. R9.4 — the referenced Experience must exist in the Catalog; an unknown
 *      Experience is rejected with `trip_validation_failed`.
 *   2. R9.5 — the list must hold fewer than {@link PLANNED_ITEM_LIMIT} items;
 *      a full list is rejected with `trip_planned_limit`.
 * On success the new item's read projection (Experience name + Park + adder
 * display name) is read back and returned (R9.9).
 */
async function addPlannedItem(
  ctx: TripRepoContext,
  tripId: string,
  adderId: string,
  input: PlannedItemAddInput,
): Promise<PlannedItemDTO> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    // Serialize concurrent adds for this Trip so the count check below is
    // race-safe against the 500-item cap (R9.5).
    await client.query(`SELECT 1 FROM trips WHERE id = $1 FOR UPDATE`, [tripId]);

    // R9.4: the Experience must exist in the Catalog.
    const experience = await client.query(
      `SELECT 1 FROM experiences WHERE id = $1`,
      [input.experienceId],
    );
    if ((experience.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_validation_failed',
        'That experience does not exist in the catalog.',
        { field: 'experienceId' },
      );
    }

    // R9.3: the same Experience may appear on a Trip's Planned_List more than
    // once — on the same day or across different days — so there is no
    // duplicate-rejection check here. The `planned_items_unique` constraint was
    // dropped in migration 0019 to support this, so the INSERT below can never
    // trip a unique violation on `(trip_id, experience_id)`.

    // R9.5: the Planned_List may hold at most PLANNED_ITEM_LIMIT items.
    const count = await client.query<{ count: string }>(
      `SELECT count(*) AS count FROM planned_items WHERE trip_id = $1`,
      [tripId],
    );
    if (Number(count.rows[0]?.count ?? 0) >= PLANNED_ITEM_LIMIT) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_planned_limit',
        `The planned list already holds the maximum of ${PLANNED_ITEM_LIMIT} items.`,
      );
    }

    const insert = await client.query<{ id: string }>(
      `INSERT INTO planned_items (
         trip_id,
         experience_id,
         added_by,
         planned_date,
         planned_time,
         is_fixed,
         is_lightning_lane,
         use_single_rider,
         priority,
         item_type,
         duration_minutes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        tripId,
        input.experienceId,
        adderId,
        input.plannedDate ?? null,
        input.plannedTime ?? null,
        input.isFixed ?? false,
        input.isLightningLane ?? false,
        input.useSingleRider ?? false,
        input.priority ?? 2,
        input.itemType ?? 'experience',
        input.durationMinutes ?? null,
      ],
    );
    const itemId = insert.rows[0]?.id;
    if (!itemId) {
      throw new AppError(
        'internal_error',
        'Planned item insertion returned no row.',
      );
    }

    const dto = await selectPlannedItem(client, itemId);
    if (!dto) {
      // Unreachable: the row was just inserted in this transaction.
      throw new AppError(
        'internal_error',
        'Planned item read-back returned no row.',
      );
    }

    await client.query('COMMIT');
    return dto;
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

async function editPlannedItem(
  ctx: TripRepoContext,
  tripId: string,
  itemId: string,
  input: PlannedItemEditInput,
): Promise<PlannedItemDTO> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id FROM planned_items WHERE id = $1 AND trip_id = $2 FOR UPDATE',
      [itemId, tripId],
    );
    if ((existing.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      throw new AppError('trip_not_found', 'Item not found');
    }

    const updates: string[] = [];
    const values: any[] = [itemId, tripId];
    let pos = 3;

    if (input.plannedDate !== undefined) {
      updates.push(`planned_date = $${pos++}`);
      values.push(input.plannedDate ?? null);
    }
    if (input.plannedTime !== undefined) {
      updates.push(`planned_time = $${pos++}`);
      values.push(input.plannedTime ?? null);
    }
    if (input.isFixed !== undefined) {
      updates.push(`is_fixed = $${pos++}`);
      values.push(input.isFixed ?? false);
    }
    if (input.isLightningLane !== undefined) {
      updates.push(`is_lightning_lane = $${pos++}`);
      values.push(input.isLightningLane ?? false);
    }
    if (input.useSingleRider !== undefined) {
      updates.push(`use_single_rider = $${pos++}`);
      values.push(input.useSingleRider ?? false);
    }
    if (input.priority !== undefined) {
      updates.push(`priority = $${pos++}`);
      values.push(input.priority ?? 2);
    }
    if (input.itemType !== undefined) {
      updates.push(`item_type = $${pos++}`);
      values.push(input.itemType ?? 'experience');
    }
    if (input.durationMinutes !== undefined) {
      updates.push(`duration_minutes = $${pos++}`);
      values.push(input.durationMinutes ?? null);
    }

    if (updates.length > 0) {
      // Every editable field is an optimizer input, so a manual edit makes this
      // item's persisted optimization result stale — clear it so the timeline
      // shows "not optimized yet" for it until the day is re-optimized (R8.4).
      updates.push('predicted_wait_minutes = NULL');
      updates.push('travel_from_prev_minutes = NULL');
      updates.push('travel_from_prev_kind = NULL');
      updates.push('optimized_at = NULL');
      await client.query(
        `UPDATE planned_items SET ${updates.join(', ')} WHERE id = $1 AND trip_id = $2`,
        values,
      );
    }

    const dto = await selectPlannedItem(client, itemId);
    if (!dto) throw new AppError('internal_error', 'Update failed');

    await client.query('COMMIT');
    return dto;
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

async function updatePlannedItemTimes(
  ctx: TripRepoContext,
  tripId: string,
  updates: PlannedItemTimeUpdate[],
): Promise<void> {
  if (updates.length === 0) return;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    
    // Persist the suggested arrival together with the optimizer's derived
    // display result (predicted wait + travel leg) so a returning member sees
    // the last optimized plan, stamped with when it was optimized (R8.1).
    for (const u of updates) {
      await client.query(
        `UPDATE planned_items
            SET planned_time = $1,
                predicted_wait_minutes = $2,
                travel_from_prev_minutes = $3,
                travel_from_prev_kind = $4,
                optimized_at = now()
          WHERE id = $5 AND trip_id = $6`,
        [
          u.plannedTime,
          u.predictedWaitMinutes ?? null,
          u.travelFromPrev?.minutes ?? null,
          u.travelFromPrev?.kind ?? null,
          u.itemId,
          tripId,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// removePlannedItem (R9.6, R9.7, R9.8)
// ---------------------------------------------------------------------------

/**
 * Remove a Planned_Item, authorized by adder-or-organizer.
 *
 * Locks the item row `FOR UPDATE` scoped to the Trip so a concurrent removal
 * cannot race the authorization check. A missing row returns `false` (route →
 * `trip_not_found`). An Organizer may remove any item (R9.7); a `member` may
 * remove only an item they added (R9.6). A `member` removing an item they did
 * not add is rejected with `trip_forbidden` and the item is left in place
 * (R9.8).
 */
async function removePlannedItem(
  ctx: TripRepoContext,
  tripId: string,
  itemId: string,
  callerId: string,
  callerRole: TripRole,
): Promise<boolean> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<{ added_by: string }>(
      `SELECT added_by FROM planned_items
        WHERE id = $1 AND trip_id = $2
        FOR UPDATE`,
      [itemId, tripId],
    );
    const row = current.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return false;
    }

    // R9.6 / R9.7 / R9.8: only the adder or an Organizer may remove the item.
    if (callerRole !== 'organizer' && row.added_by !== callerId) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_forbidden',
        'You can only remove planned items you added.',
      );
    }

    await client.query(`DELETE FROM planned_items WHERE id = $1`, [itemId]);

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// listPlannedItems (R9.9)
// ---------------------------------------------------------------------------

/**
 * List a Trip's Planned_Items with their display projection: each referenced
 * Experience's name and Park and the adding Member's display name (R9.9). A
 * plain read needs no transaction. Ordered by insertion (`created_at`, then
 * `id`) for a deterministic list.
 */
async function listPlannedItems(
  ctx: TripRepoContext,
  tripId: string,
): Promise<PlannedItemDTO[]> {
  const result = await ctx.pool.query<PlannedItemRow>(
    `SELECT pi.id,
            pi.experience_id,
            e.name          AS experience_name,
            e.park          AS park,
            p.display_name  AS added_by_display_name,
            pi.planned_date,
            pi.planned_time,
            pi.is_fixed,
            pi.is_lightning_lane,
            pi.use_single_rider,
            pi.priority,
            pi.item_type,
            pi.duration_minutes,
            pi.predicted_wait_minutes,
            pi.travel_from_prev_minutes,
            pi.travel_from_prev_kind,
            pi.optimized_at
       FROM planned_items pi
       JOIN experiences e ON e.id = pi.experience_id
       JOIN profiles    p ON p.user_id = pi.added_by
      WHERE pi.trip_id = $1
      ORDER BY pi.created_at ASC, pi.id ASC`,
    [tripId],
  );
  return result.rows.map(rowToPlannedItemDto);
}

// ---------------------------------------------------------------------------
// logCompletion (R10.1–R10.6, R10.9, R10.10, R12.1, R12.2)
// ---------------------------------------------------------------------------

/**
 * Log a Completion against a Trip: create the Trip_Log_Entry, its `pending`
 * Rode_With_Tags, and the `completion_logged` feed item, delegating the
 * canonical Completion and optional Rating to the injected Tracking repos.
 *
 * Order of work:
 *   1. Pure validation of the rode-with list — reject self-tags (R10.5) and
 *      in-request duplicates (R10.6) — so the surviving set has at most one tag
 *      per distinct Member (R10.3). Doing this first means an invalid request
 *      performs no canonical or Trip write.
 *   2. Open the `trip_*` transaction and validate that every distinct tagged
 *      Member is a current Trip_Member (R10.4); a stranger is rejected with
 *      `trip_validation_failed` and nothing is written.
 *   3. Ensure the logging Member's canonical Completion via the injected
 *      completion repo (`mark` = insert-on-conflict): a `null` return means a
 *      Completion already existed and is kept unchanged — never duplicated
 *      (R10.1, R10.2).
 *   4. Apply the optional canonical Rating via the injected rating repo, which
 *      persists the single canonical Rating and emits `RatingChanged` so stats,
 *      catalog, and aggregate stay in sync (R10.10, R12.1, R12.2).
 *   5. Insert the `trip_log_entry`, one `pending` `rode_with_tag` per distinct
 *      tagged Member (R10.3), and the `completion_logged` feed item (R10.9),
 *      then COMMIT.
 *
 * See {@link TripRepo.logCompletion} for the deviation note on the injected
 * repos opening their own connections.
 */
async function logCompletion(
  ctx: TripRepoContext,
  tripId: string,
  loggerId: string,
  input: LogCompletionInput,
  now: Date | undefined,
): Promise<LoggedCompletion> {
  // Step 1 — pure validation of the rode-with list (R10.5, R10.6). Build the
  // distinct set preserving first-occurrence order for a deterministic result.
  const distinctTaggedIds: string[] = [];
  const seen = new Set<string>();
  for (const taggedId of input.rodeWith) {
    if (taggedId === loggerId) {
      // R10.5: a Member may not tag themselves.
      throw new AppError(
        'trip_validation_failed',
        'You cannot tag yourself as having ridden with you.',
        { field: 'rodeWith' },
      );
    }
    if (seen.has(taggedId)) {
      // R10.6: the same Member may not be tagged more than once per entry.
      throw new AppError(
        'trip_validation_failed',
        'You cannot tag the same member more than once on one log entry.',
        { field: 'rodeWith' },
      );
    }
    seen.add(taggedId);
    distinctTaggedIds.push(taggedId);
  }

  const completedOn = input.completedOn ?? wdwToday(now);
  const userTz = input.userTz ?? DEFAULT_LOG_USER_TZ;

  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    // Step 2 — every distinct tagged User must be a current Trip_Member (R10.4).
    // Read the Trip's membership set once and check the tags against it.
    if (distinctTaggedIds.length > 0) {
      const members = await client.query<{ user_id: string }>(
        `SELECT user_id FROM trip_memberships WHERE trip_id = $1`,
        [tripId],
      );
      const memberIds = new Set(members.rows.map((r) => r.user_id));
      for (const taggedId of distinctTaggedIds) {
        if (!memberIds.has(taggedId)) {
          await client.query('ROLLBACK');
          throw new AppError(
            'trip_validation_failed',
            'You can only tag current members of this trip.',
            { field: 'rodeWith' },
          );
        }
      }
    }

    // Step 3 — ensure the logging Member's canonical Completion via the
    // injected Tracking repo. `mark` inserts on conflict-do-nothing semantics:
    // a `null` return means a Completion already existed and is kept, never
    // duplicated (R10.1, R10.2). Delegated so no Trip-local copy exists (R12.1).
    await ctx.completions.mark({
      userId: loggerId,
      experienceId: input.experienceId,
      completedOn,
      userTz,
    });

    // Step 4 — apply the optional canonical Rating via the injected repo, which
    // persists the single canonical Rating and emits `RatingChanged` (R10.10,
    // R12.1, R12.2). Skipped entirely when the caller supplied no rating.
    if (input.rating !== undefined) {
      await ctx.ratings.setRating(loggerId, input.experienceId, input.rating);
    }

    // Step 5a — insert the Trip_Log_Entry linking the Completion to the Trip
    // via (member_id, experience_id) (R10.1, R10.2).
    const entryInsert = await client.query<{ id: string }>(
      `INSERT INTO trip_log_entries (trip_id, member_id, experience_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [tripId, loggerId, input.experienceId],
    );
    const logEntryId = entryInsert.rows[0]?.id;
    if (!logEntryId) {
      throw new AppError(
        'internal_error',
        'Trip log entry insertion returned no row.',
      );
    }

    // Step 5b — one `pending` Rode_With_Tag per distinct tagged Member (R10.3).
    const pendingTags: CreatedRodeWithTag[] = [];
    for (const taggedId of distinctTaggedIds) {
      const tagInsert = await client.query<{ id: string }>(
        `INSERT INTO rode_with_tags (log_entry_id, tagged_member_id, state)
         VALUES ($1, $2, 'pending')
         RETURNING id`,
        [logEntryId, taggedId],
      );
      const tagId = tagInsert.rows[0]?.id;
      if (!tagId) {
        throw new AppError(
          'internal_error',
          'Rode-with tag insertion returned no row.',
        );
      }
      pendingTags.push({ tagId, taggedMemberId: taggedId });
    }

    // Step 5c — record that the logging Member completed the Experience (R10.9).
    await client.query(
      `INSERT INTO trip_feed_items (trip_id, type, actor_id, metadata)
       VALUES ($1, 'completion_logged', $2, $3::jsonb)`,
      [
        tripId,
        loggerId,
        JSON.stringify({
          experienceId: input.experienceId,
          logEntryId,
        }),
      ],
    );

    await client.query('COMMIT');
    return { logEntryId, pendingTags };
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// listLogEntries (R12.4, R12.7, R12.8, R15.1)
// ---------------------------------------------------------------------------

/**
 * Row shape for the Shared_Log read projection: a `trip_log_entries` row joined
 * to the logging Member's `profiles` display name, the completed Experience's
 * name, and the logging Member's live canonical Rating (`ratings.value`, `null`
 * when unrated), with the entry's Rode_With_Tags aggregated as JSON (R12.4,
 * R12.8). The Rating is joined live from the canonical `ratings` table so it is
 * never a Trip-local copy and always reflects the current value (R12.4).
 */
interface TripLogEntryRow {
  id: string;
  member_id: string;
  member_display_name: string;
  experience_id: string;
  experience_name: string;
  /** `ratings.value` (SMALLINT 1–10) or `null` when the Member has no Rating. */
  rating: number | string | null;
  /** Aggregated tags; `pg` parses the `json` column to a JS array. */
  rode_with: readonly { taggedMemberId: string; state: RodeWithTagState }[];
}

/**
 * Read a Trip's Shared_Log with each entry's display projection (R12.4, R12.8).
 *
 * A plain read needs no transaction. The logging Member's canonical Rating is
 * `LEFT JOIN`ed live from the `ratings` table on `(member_id, experience_id)`,
 * so a Member with no Rating yields `null` (the unrated indicator) and a later
 * rating change is always reflected — the Rating is never copied into the Trip
 * (R12.4). Each entry's Rode_With_Tags are aggregated into a JSON array
 * (Tagged_Member id + current state) ordered deterministically. Entries are
 * ordered reverse-chronologically by `created_at` then `id`. A Trip with no
 * entries yields an empty list, so the route's `assertTripMember` gate — not
 * this read — distinguishes a non-member from an empty Trip.
 */
async function listLogEntries(
  ctx: TripRepoContext,
  tripId: string,
): Promise<TripLogEntryDTO[]> {
  const result = await ctx.pool.query<TripLogEntryRow>(
    `SELECT le.id,
            le.member_id,
            p.display_name  AS member_display_name,
            le.experience_id,
            e.name          AS experience_name,
            r.value         AS rating,
            COALESCE(
              (SELECT json_agg(
                        json_build_object(
                          'taggedMemberId', rwt.tagged_member_id,
                          'state', rwt.state
                        )
                        ORDER BY rwt.created_at ASC, rwt.id ASC
                      )
                 FROM rode_with_tags rwt
                WHERE rwt.log_entry_id = le.id),
              '[]'::json
            )               AS rode_with
       FROM trip_log_entries le
       JOIN profiles    p ON p.user_id = le.member_id
       JOIN experiences e ON e.id = le.experience_id
       LEFT JOIN ratings r
              ON r.user_id = le.member_id
             AND r.experience_id = le.experience_id
      WHERE le.trip_id = $1
      ORDER BY le.created_at DESC, le.id DESC`,
    [tripId],
  );
  return result.rows.map(rowToTripLogEntryDto);
}

/** Project a `trip_log_entries` join row to the shared `TripLogEntryDTO`. */
function rowToTripLogEntryDto(row: TripLogEntryRow): TripLogEntryDTO {
  return {
    id: row.id,
    memberId: row.member_id,
    memberDisplayName: row.member_display_name,
    experienceId: row.experience_id,
    experienceName: row.experience_name,
    rating: row.rating === null ? null : Number(row.rating),
    rodeWith: row.rode_with.map((tag) => ({
      taggedMemberId: tag.taggedMemberId,
      state: tag.state,
    })),
  };
}

// ---------------------------------------------------------------------------
// confirmRodeWithTag (R11.2–R11.5, R11.7–R11.10)
// ---------------------------------------------------------------------------

/**
 * Confirm a `pending` Rode_With_Tag and trickle the completion (and optional
 * Rating) down into the Tagged_Member's canonical Tracking data.
 *
 * A supplied `rating` is bound-checked first, before opening the transaction,
 * so an invalid value rejects with `rating_out_of_range` without touching the
 * tag or the caller's canonical Rating (R11.9). Then, inside one transaction,
 * the tag row is locked `FOR UPDATE` and its log-entry context read; a missing
 * tag or one addressed to another User collapses to `trip_forbidden` (R11.7)
 * and a non-`pending` tag to `trip_tag_state_invalid` (R11.8), each leaving
 * everything unchanged.
 *
 * The canonical writes are delegated to the injected Tracking repos so no
 * Trip-local copy exists (R12.1): `completions.mark` ensures the Completion
 * insert-on-conflict (an existing Completion is kept, never altered — R11.2,
 * R11.3), and `ratings.setRating` applies the optional canonical Rating and
 * emits `RatingChanged` (R11.4, R11.5). Finally the tag is set `confirmed`
 * (R11.10); no Trip_Feed_Item is written, since the originating
 * `completion_logged` entry already records the rode-with. See
 * {@link TripRepo.confirmRodeWithTag} for the deviation note on the injected
 * repos opening their own connections.
 */
async function confirmRodeWithTag(
  ctx: TripRepoContext,
  tagId: string,
  callerId: string,
  rating: number | undefined,
  opts: ConfirmRodeWithTagOptions | undefined,
): Promise<ConfirmedRodeWithTag> {
  // R11.9: bound-check a supplied Rating up-front so an invalid value rejects
  // before any canonical or Trip write and leaves the existing Rating intact.
  if (
    rating !== undefined &&
    (!Number.isInteger(rating) || rating < 1 || rating > 10)
  ) {
    throw new AppError(
      'rating_out_of_range',
      'Rating must be an integer between 1 and 10 inclusive.',
      { field: 'rating' },
    );
  }

  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the tag and read its log-entry context. `FOR UPDATE OF rwt` locks
    // only the tag row so a concurrent confirm/decline cannot race the
    // check-then-write while leaving the joined rows unlocked.
    const current = await client.query<{
      state: RodeWithTagState;
      tagged_member_id: string;
      trip_id: string;
      experience_id: string;
      log_created_at: Date | string | null;
    }>(
      `SELECT rwt.state,
              rwt.tagged_member_id,
              tle.trip_id,
              tle.experience_id,
              tle.created_at AS log_created_at
         FROM rode_with_tags rwt
         JOIN trip_log_entries tle ON tle.id = rwt.log_entry_id
        WHERE rwt.id = $1
        FOR UPDATE OF rwt`,
      [tagId],
    );
    const row = current.rows[0];

    // R11.7: a missing tag or one addressed to another User both collapse to
    // the same non-probing authorization response.
    if (!row || row.tagged_member_id !== callerId) {
      await client.query('ROLLBACK');
      throw new AppError('trip_forbidden', 'This tag is not available to you.');
    }
    // R11.8: only a pending tag can be confirmed; a confirmed/declined/cancelled
    // tag is a conflict and nothing is changed.
    if (row.state !== 'pending') {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_tag_state_invalid',
        'This rode-with tag is no longer pending.',
      );
    }

    // R11.2 / R11.3: ensure the Tagged_Member's canonical Completion via the
    // injected repo. `mark` inserts on-conflict-do-nothing semantics: a `null`
    // return means a Completion already existed and is kept, never altered. The
    // Completion is dated to when the ride was logged during the Trip, so the
    // trickled-down completion reflects the Trip day rather than the confirm day.
    const completedOn =
      opts?.completedOn ??
      wdwToday(
        row.log_created_at != null ? new Date(row.log_created_at) : opts?.now,
      );
    const userTz = opts?.userTz ?? DEFAULT_LOG_USER_TZ;
    await ctx.completions.mark({
      userId: callerId,
      experienceId: row.experience_id,
      completedOn,
      userTz,
    });

    // R11.4 / R11.5: apply the optional canonical Rating via the injected repo,
    // which persists the single canonical Rating and emits `RatingChanged`.
    // Skipped entirely when the caller supplied none — the existing Rating is
    // left unchanged.
    if (rating !== undefined) {
      await ctx.ratings.setRating(callerId, row.experience_id, rating);
    }

    // R11.10: transition the tag to confirmed — the durable link of the
    // Tagged_Member's completion to this Trip. No Trip_Feed_Item is written:
    // the originating `completion_logged` entry already records that these
    // Members rode together, so a separate confirm entry would be redundant.
    await client.query(
      `UPDATE rode_with_tags
          SET state = 'confirmed', updated_at = now()
        WHERE id = $1`,
      [tagId],
    );

    await client.query('COMMIT');
    return { tagId, tripId: row.trip_id, experienceId: row.experience_id };
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// declineRodeWithTag (R11.6, R11.7, R11.8)
// ---------------------------------------------------------------------------

/**
 * Decline a `pending` Rode_With_Tag, transitioning it to `declined` and writing
 * nothing to the Tagged_Member's data (R11.6). Uses the same lock-and-check
 * discipline as {@link confirmRodeWithTag}: a missing tag or one not addressed
 * to the caller collapses to `trip_forbidden` (R11.7), and a non-`pending` tag
 * throws `trip_tag_state_invalid` (R11.8). No canonical Completion, Rating, or
 * Note and no feed item is created.
 */
async function declineRodeWithTag(
  ctx: TripRepoContext,
  tagId: string,
  callerId: string,
): Promise<void> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<{
      state: RodeWithTagState;
      tagged_member_id: string;
    }>(
      `SELECT state, tagged_member_id
         FROM rode_with_tags
        WHERE id = $1
        FOR UPDATE`,
      [tagId],
    );
    const row = current.rows[0];
    if (!row || row.tagged_member_id !== callerId) {
      await client.query('ROLLBACK');
      throw new AppError('trip_forbidden', 'This tag is not available to you.');
    }
    if (row.state !== 'pending') {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_tag_state_invalid',
        'This rode-with tag is no longer pending.',
      );
    }

    await client.query(
      `UPDATE rode_with_tags
          SET state = 'declined', updated_at = now()
        WHERE id = $1`,
      [tagId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// getRodeWithTag (deep-link target read; R11.5, R18.5)
// ---------------------------------------------------------------------------

/**
 * Read the Rode_With_Tag deep-link target for the mobile confirm view, scoped
 * to the Tagged_Member (task 17.4). Joins the linked Trip_Log_Entry, the
 * referenced Experience, the Tagging_Member's display name, and the caller's
 * current canonical Rating for that Experience (via a `LEFT JOIN ratings` so an
 * unrated Experience yields `null`, letting the view pre-fill the rating for
 * R11.5). A plain read needs no transaction. Scoped to `tagged_member_id =
 * callerId` and returning `null` when no such tag exists so the endpoint cannot
 * probe tags addressed to other Users and the route can present the "no longer
 * available" fallback (R18.5).
 */
async function getRodeWithTag(
  ctx: TripRepoContext,
  tagId: string,
  callerId: string,
): Promise<RodeWithTagTarget | null> {
  const result = await ctx.pool.query<{
    id: string;
    trip_id: string;
    log_entry_id: string;
    state: RodeWithTagState;
    experience_id: string;
    experience_name: string;
    tagging_member_display_name: string;
    current_rating: number | string | null;
  }>(
    `SELECT rwt.id,
            tle.trip_id,
            tle.id           AS log_entry_id,
            rwt.state,
            tle.experience_id,
            e.name           AS experience_name,
            p.display_name   AS tagging_member_display_name,
            r.value          AS current_rating
       FROM rode_with_tags rwt
       JOIN trip_log_entries tle ON tle.id = rwt.log_entry_id
       JOIN experiences      e   ON e.id = tle.experience_id
       JOIN profiles         p   ON p.user_id = tle.member_id
       LEFT JOIN ratings     r   ON r.user_id = rwt.tagged_member_id
                                AND r.experience_id = tle.experience_id
      WHERE rwt.id = $1 AND rwt.tagged_member_id = $2`,
    [tagId, callerId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    tripId: row.trip_id,
    tripLogEntryId: row.log_entry_id,
    state: row.state,
    experienceId: row.experience_id,
    experienceName: row.experience_name,
    taggingMemberDisplayName: row.tagging_member_display_name,
    currentRating:
      row.current_rating === null ? null : Number(row.current_rating),
  };
}

// ---------------------------------------------------------------------------
// listPendingRodeWithTags (Notification_Center pending read; R3.1–R3.4)
// ---------------------------------------------------------------------------

/**
 * List the `pending` Rode_With_Tags addressed to `userId` as their
 * Tagged_Member for the Notification_Center's per-domain pending read
 * (`GET /me/rode-with-tags?state=pending`). Modeled on {@link getRodeWithTag}'s
 * joins and {@link listMyInvites}'s list projection. A plain read needs no
 * transaction. Scoped to `tagged_member_id = $1` and filtered to
 * `state = 'pending'` so it never returns another User's tags or a tag in any
 * non-pending state (R3.1, R3.2). Joins the linked Trip_Log_Entry, the
 * referenced Experience, and the Tagging_Member's `profiles` row (the log
 * entry's `member_id`, matching {@link getRodeWithTag}) to project every
 * required field (R3.3). Ordered by `created_at DESC, id ASC` — most recent
 * first with a deterministic id tie-break (R3.1). A User with no pending tags
 * yields an empty list (R3.4).
 */
async function listPendingRodeWithTags(
  ctx: TripRepoContext,
  userId: string,
): Promise<PendingRodeWithTagDTO[]> {
  const result = await ctx.pool.query<{
    tag_id: string;
    trip_log_entry_id: string;
    experience_name: string;
    tagging_member_display_name: string;
    created_at: Date | string;
  }>(
    `SELECT rwt.id            AS tag_id,
            tle.id            AS trip_log_entry_id,
            e.name            AS experience_name,
            p.display_name    AS tagging_member_display_name,
            rwt.created_at    AS created_at
       FROM rode_with_tags rwt
       JOIN trip_log_entries tle ON tle.id = rwt.log_entry_id
       JOIN experiences      e   ON e.id = tle.experience_id
       JOIN profiles         p   ON p.user_id = tle.member_id
      WHERE rwt.tagged_member_id = $1 AND rwt.state = 'pending'
      ORDER BY rwt.created_at DESC, rwt.id ASC`,
    [userId],
  );
  return result.rows.map((row) => ({
    tagId: row.tag_id,
    tripLogEntryId: row.trip_log_entry_id,
    experienceName: row.experience_name,
    taggingMemberDisplayName: row.tagging_member_display_name,
    createdAt: toIsoTimestamp(row.created_at),
  }));
}

// ---------------------------------------------------------------------------
// Trip_Feed, reactions, and comments (R13.1, R13.4–R13.12)
// ---------------------------------------------------------------------------

/** Row shape mirroring the `trip_feed_items` display SELECT column list. */
interface TripFeedItemRow {
  id: string;
  type: string;
  actor_display_name: string;
  /** Acting Member's avatar preset id (`profiles.avatar_preset`), or `null`. */
  actor_avatar_preset: string | null;
  created_at: Date | string;
  /** `pg` parses the `jsonb` column to a JS object. */
  metadata: Record<string, unknown>;
  /** Referenced Experience name, joined live via `metadata->>'experienceId'`. */
  experience_name: string | null;
  /** Referenced Experience Park (or `null` for a non-Park Experience). */
  experience_park: string | null;
  /** Referenced Experience classification (`experiences.category`). */
  experience_category: string | null;
  /** Referenced Experience themed Land (`experiences.land`), or `null`. */
  experience_land: string | null;
  /** Referenced Experience representative image URL, or `null`. */
  experience_image_url: string | null;
  /** For a `completion_logged` item: the logging Member's live canonical Rating. */
  rating: number | string | null;
  /** For a `completion_logged` item: how many Members were tagged rode-with. */
  rode_with_count: number | string | null;
  /**
   * For a `completion_logged` item: each Rode_With_Tag on the linked log entry
   * with its Tagged_Member id, display name, and current confirmation state, so
   * the Trip_Activity feed can render confirmation state inline (R20.3). `null`
   * for items with no linked log entry. `pg` parses the `json` column.
   */
  rode_with: readonly {
    taggedMemberId: string;
    displayName: string;
    state: RodeWithTagState;
  }[] | null;
}

/** Row shape for the per-item reaction aggregate (count + caller membership). */
interface TripReactionAggRow {
  target_id: string;
  reaction: TripReactionValue;
  count: number | string;
  mine: boolean;
}

/** Row shape for a feed item's comment with its author's display name. */
interface TripCommentRow {
  id: string;
  target_id: string;
  author_id: string;
  author_display_name: string;
  /** Comment author's avatar preset id (`profiles.avatar_preset`), or `null`. */
  author_avatar_preset: string | null;
  body: string;
  created_at: Date | string;
}

/**
 * Read a Trip's Trip_Feed and order it deterministically (R13.1, R13.3).
 *
 * A plain read needs no transaction. Each `trip_feed_items` row is joined to the
 * acting Member's `profiles` display name and projected to a
 * {@link TripFeedItemDTO}, then the whole list is ordered by the pure
 * {@link orderFeed} helper — the same comparator the property tests pin — so
 * the SQL and the display order cannot drift: reverse-chronological by
 * `createdAt`, tie-broken by descending `id`. A Trip with no feed items yields
 * an empty list, so the route's `assertTripMember` gate — not this read —
 * distinguishes a non-member from an empty Trip.
 */
async function getFeed(
  ctx: TripRepoContext,
  tripId: string,
  callerId: string,
): Promise<TripFeedItemDTO[]> {
  // Three independent reads: the feed items themselves (enriched with the human
  // context below), and the group's engagement with them — reactions and
  // comments — keyed by the feed item they target. Issued together so the read
  // is one round-trip's worth of latency rather than three serial hops.
  //
  // Enrich each item with the human context the feed needs to say *what*
  // happened rather than only *that* something happened: the referenced
  // Experience's name/Park (for `completion_logged`, joined live via
  // `metadata->>'experienceId'`), and — for a logged
  // Completion — the logging Member's current canonical Rating and how many
  // Members they tagged rode-with (joined via `metadata->>'logEntryId'`). The
  // `NULLIF(...,'')::uuid` guard yields NULL for items that carry no such id
  // (e.g. `trip_created`, `member_joined`), so those items simply gain nothing.
  const [itemsResult, reactionsResult, commentsResult] = await Promise.all([
    ctx.pool.query<TripFeedItemRow>(
      `SELECT fi.id,
              fi.type,
              p.display_name  AS actor_display_name,
              p.avatar_preset AS actor_avatar_preset,
              fi.created_at,
              fi.metadata,
              e.name          AS experience_name,
              e.park          AS experience_park,
              e.category      AS experience_category,
              e.land          AS experience_land,
              e.image_url     AS experience_image_url,
              r.value         AS rating,
              (SELECT count(*)::int
                 FROM rode_with_tags rwt
                WHERE rwt.log_entry_id = le.id) AS rode_with_count,
              (SELECT json_agg(
                        json_build_object(
                          'taggedMemberId', rwt.tagged_member_id,
                          'displayName', pr.display_name,
                          'state', rwt.state
                        )
                        ORDER BY rwt.created_at ASC, rwt.id ASC
                      )
                 FROM rode_with_tags rwt
                 JOIN profiles pr ON pr.user_id = rwt.tagged_member_id
                WHERE rwt.log_entry_id = le.id) AS rode_with
         FROM trip_feed_items fi
         JOIN profiles        p ON p.user_id = fi.actor_id
         LEFT JOIN experiences e
                ON e.id = NULLIF(fi.metadata->>'experienceId', '')::uuid
         LEFT JOIN trip_log_entries le
                ON le.id = NULLIF(fi.metadata->>'logEntryId', '')::uuid
         LEFT JOIN ratings r
                ON r.user_id = le.member_id
               AND r.experience_id = le.experience_id
        WHERE fi.trip_id = $1`,
      [tripId],
    ),
    // Reactions on this Trip's feed items, aggregated per (item, value): the
    // total count and whether the reading caller is one of the reactors (R13.4,
    // R13.6, R13.7). `bool_or` collapses the caller's membership to one flag.
    ctx.pool.query<TripReactionAggRow>(
      `SELECT target_id,
              reaction,
              count(*)::int          AS count,
              bool_or(member_id = $2) AS mine
         FROM trip_reactions
        WHERE trip_id = $1 AND target_type = 'feed_item'
        GROUP BY target_id, reaction`,
      [tripId, callerId],
    ),
    // Comments on this Trip's feed items, with the author's display name and a
    // `mine` flag so only the author gets a remove control (R13.8, R13.11,
    // R13.12). Oldest-first so each item reads as a conversation.
    ctx.pool.query<TripCommentRow>(
      `SELECT c.id,
              c.target_id,
              c.author_id,
              p.display_name AS author_display_name,
              p.avatar_preset AS author_avatar_preset,
              c.body,
              c.created_at
         FROM trip_comments c
         JOIN profiles p ON p.user_id = c.author_id
        WHERE c.trip_id = $1 AND c.target_type = 'feed_item'
        ORDER BY c.created_at ASC, c.id ASC`,
      [tripId],
    ),
  ]);

  // Group the engagement rows by the feed item they target so each item's
  // projection can attach its own reactions/comments in one pass.
  const reactionsByItem = new Map<string, TripReactionSummary[]>();
  for (const row of reactionsResult.rows) {
    const list = reactionsByItem.get(row.target_id) ?? [];
    list.push({
      reaction: row.reaction,
      count: Number(row.count),
      mine: row.mine,
    });
    reactionsByItem.set(row.target_id, list);
  }

  const commentsByItem = new Map<string, TripCommentDTO[]>();
  for (const row of commentsResult.rows) {
    const list = commentsByItem.get(row.target_id) ?? [];
    list.push({
      id: row.id,
      authorId: row.author_id,
      authorDisplayName: row.author_display_name,
      authorAvatarPreset: row.author_avatar_preset,
      body: row.body,
      createdAt: toIsoTimestamp(row.created_at),
      mine: row.author_id === callerId,
    });
    commentsByItem.set(row.target_id, list);
  }

  return orderFeed(
    itemsResult.rows.map((row) =>
      rowToTripFeedItemDto(
        row,
        reactionsByItem.get(row.id) ?? [],
        commentsByItem.get(row.id) ?? [],
      ),
    ),
  );
}

/**
 * Project a `trip_feed_items` join row to the shared `TripFeedItemDTO`, folding
 * the joined display context into `metadata` (a `Record<string, unknown>`, so
 * this is additive and backward-compatible). Only keys with a value are added,
 * leaving items with no referenced Experience/log-entry untouched.
 */
function rowToTripFeedItemDto(
  row: TripFeedItemRow,
  reactions: readonly TripReactionSummary[],
  comments: readonly TripCommentDTO[],
): TripFeedItemDTO {
  const enrichment: Record<string, unknown> = {};
  if (row.experience_name !== null) {
    enrichment.experienceName = row.experience_name;
    enrichment.park = row.experience_park;
    // Additional Experience context so the feed card can show more than the
    // name: classification, themed Land, and the representative image.
    if (row.experience_category !== null) {
      enrichment.experienceCategory = row.experience_category;
    }
    if (row.experience_land !== null) {
      enrichment.experienceLand = row.experience_land;
    }
    if (row.experience_image_url !== null) {
      enrichment.experienceImageUrl = row.experience_image_url;
    }
  }
  if (row.rating !== null) {
    enrichment.rating = Number(row.rating);
  }
  const rodeWithCount =
    row.rode_with_count === null ? 0 : Number(row.rode_with_count);
  if (rodeWithCount > 0) {
    enrichment.rodeWithCount = rodeWithCount;
  }
  if (row.rode_with !== null && row.rode_with.length > 0) {
    enrichment.rodeWith = row.rode_with;
  }
  return {
    id: row.id,
    type: row.type,
    actorDisplayName: row.actor_display_name,
    actorAvatarPreset: row.actor_avatar_preset,
    createdAt: toIsoTimestamp(row.created_at),
    metadata: { ...row.metadata, ...enrichment },
    reactions,
    comments,
  };
}

/**
 * Assert on the given client that the target `(targetType, targetId)` belongs to
 * `tripId`, throwing `trip_not_found` when it does not (R13.10). A `feed_item`
 * target must be a `trip_feed_items` row and a `log_entry` target a
 * `trip_log_entries` row, both scoped to the Trip. Because the route has already
 * asserted the caller is a Member of `tripId`, verifying the target belongs to
 * that same Trip is what confines a reaction/comment to a Trip the caller is
 * authorized for; a target from another Trip (or one that does not exist)
 * collapses to the same non-probing not-found response.
 */
async function assertTargetInTrip(
  client: PoolClient,
  tripId: string,
  targetType: TripFeedTargetType,
  targetId: string,
): Promise<void> {
  const table =
    targetType === 'feed_item' ? 'trip_feed_items' : 'trip_log_entries';
  const result = await client.query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND trip_id = $2`,
    [targetId, tripId],
  );
  if (result.rowCount === 0) {
    throw new AppError(
      'trip_not_found',
      'The target of this reaction or comment does not exist on this Trip.',
    );
  }
}

/**
 * Add a Trip_Reaction, idempotent on the composite key (R13.4, R13.5).
 *
 * The `reaction` is validated against the closed `Trip_Reaction` vocabulary
 * up-front as defense-in-depth (R13.6) so an unsupported value rejects before
 * any write. Then, in one transaction, the target is verified to belong to the
 * Trip (R13.10) and the reaction is inserted with `ON CONFLICT DO NOTHING` on
 * the `(target_type, target_id, member_id, reaction)` primary key, so a second
 * add of the same reaction retains the single existing row (R13.5).
 */
async function addReaction(
  ctx: TripRepoContext,
  tripId: string,
  targetType: TripFeedTargetType,
  targetId: string,
  memberId: string,
  reaction: TripReactionValue,
): Promise<void> {
  // R13.6: reject an unsupported reaction type before touching the database.
  if (!tripReactionValueSchema.safeParse(reaction).success) {
    throw new AppError(
      'trip_validation_failed',
      'Unsupported reaction type.',
      { field: 'reaction' },
    );
  }

  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    await assertTargetInTrip(client, tripId, targetType, targetId);
    // R13.4 / R13.5: at most one reaction of a type per (target, member); the
    // composite primary key makes the insert idempotent.
    await client.query(
      `INSERT INTO trip_reactions
              (trip_id, target_type, target_id, member_id, reaction)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [tripId, targetType, targetId, memberId, reaction],
    );
    await client.query('COMMIT');
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Remove a Member's own Trip_Reaction (R13.7). The delete is scoped to
 * `member_id = memberId` (own only) and `trip_id = tripId`, and is idempotent:
 * removing a reaction that is not present affects no rows and does not error. A
 * plain single-statement delete needs no transaction.
 */
async function removeReaction(
  ctx: TripRepoContext,
  tripId: string,
  targetType: TripFeedTargetType,
  targetId: string,
  memberId: string,
  reaction: TripReactionValue,
): Promise<void> {
  await ctx.pool.query(
    `DELETE FROM trip_reactions
      WHERE trip_id = $1
        AND target_type = $2
        AND target_id = $3
        AND member_id = $4
        AND reaction = $5`,
    [tripId, targetType, targetId, memberId, reaction],
  );
}

/**
 * Add a Trip_Comment, returning its identity (R13.8). The `body` is trimmed and
 * bound-checked to 1–2000 characters up-front as defense-in-depth (R13.9) so an
 * empty or over-long body rejects with `trip_validation_failed` before any
 * write. Then, in one transaction, the target is verified to belong to the Trip
 * (R13.10) and the trimmed comment is inserted.
 */
async function addComment(
  ctx: TripRepoContext,
  tripId: string,
  targetType: TripFeedTargetType,
  targetId: string,
  authorId: string,
  body: string,
): Promise<CreatedComment> {
  // R13.9: validate the trimmed body length before touching the database.
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) {
    throw new AppError(
      'trip_validation_failed',
      'A comment must be between 1 and 2000 characters after trimming.',
      { field: 'body' },
    );
  }

  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    await assertTargetInTrip(client, tripId, targetType, targetId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO trip_comments
              (trip_id, target_type, target_id, author_id, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [tripId, targetType, targetId, authorId, trimmed],
    );
    const commentId = inserted.rows[0]?.id;
    if (commentId === undefined) {
      // The RETURNING clause always yields the inserted row; this guard exists
      // only to satisfy the compiler's strict indexed-access checks.
      throw new AppError('trip_validation_failed', 'Failed to persist comment.');
    }
    await client.query('COMMIT');
    return { commentId };
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Remove a Trip_Comment, author-scoped (R13.11, R13.12).
 *
 * In one transaction the comment row is locked `FOR UPDATE` and its author read.
 * A comment that does not belong to the Trip returns `false` so the route can
 * map it to `trip_not_found`; a comment authored by another User throws
 * `trip_forbidden` and is left in place (R13.12); otherwise the caller's own
 * comment is deleted and `true` is returned (R13.11).
 */
async function removeComment(
  ctx: TripRepoContext,
  tripId: string,
  commentId: string,
  authorId: string,
): Promise<boolean> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<{ author_id: string }>(
      `SELECT author_id FROM trip_comments
        WHERE id = $1 AND trip_id = $2
        FOR UPDATE`,
      [commentId, tripId],
    );
    const row = current.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return false;
    }
    // R13.12: only the author may remove their comment; others are rejected and
    // the comment is retained.
    if (row.author_id !== authorId) {
      await client.query('ROLLBACK');
      throw new AppError(
        'trip_forbidden',
        'You can only remove comments you authored.',
      );
    }

    await client.query(`DELETE FROM trip_comments WHERE id = $1`, [commentId]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await safeRollback(client);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// getSummary (R14.1, R14.6, R14.7)
// ---------------------------------------------------------------------------

/**
 * Assemble the {@link deriveTripSummary} inputs from four live reads and map
 * the result onto a `TripSummaryDTO` with per-Member display names.
 *
 * The Trip_Summary is a faithful derivation of the Trip's activity, never a
 * stored field (R14.6): this read collects the raw activity and hands it to the
 * pure helper so the SQL and the derivation cannot drift. The activity reads
 * are independent and issued together:
 *   - log entries — one per Trip_Log_Entry, with the logging Member and the
 *     completed Experience's name (feeds the distinct-experience count, the
 *     top-rated names, and each Member's log-entry count);
 *   - confirmed tags — one per `confirmed` Rode_With_Tag, with its
 *     Tagged_Member and the Experience the linked entry completed (feeds the
 *     distinct-experience count and each Member's confirmed-tag count);
 *   - ratings — the canonical Ratings referenced by the Trip-context
 *     completions, read live from the `ratings` table (never copied) so a later
 *     rating change is reflected. Each row is one Member's canonical Rating for
 *     an Experience they completed in this Trip (via a log entry or a confirmed
 *     tag), deduplicated to one participation per (Member, Experience).
 *   - planned items — one per Planned_Item, with its referenced Experience;
 *     the source of the planned total count and, matched against the log
 *     entries under the Planned_Completion_Match, the planned-completed count
 *     (planned-list-completion-sync R5.1, R5.2, R5.3).
 *
 * The pure helper then computes the distinct-experience count (0 when none),
 * the up-to-5 `topRated` list, the per-Member counts, and the planned
 * total/completed counts. A final `profiles` read resolves the display name for
 * each Member the summary reports, so the DTO carries a display name alongside
 * every per-Member count (R14.7).
 */
async function getSummary(
  ctx: TripRepoContext,
  tripId: string,
): Promise<TripSummaryDTO> {
  const [logEntriesResult, confirmedTagsResult, ratingsResult, plannedItemsResult] =
    await Promise.all([
      ctx.pool.query<{
        member_id: string;
        experience_id: string;
        experience_name: string;
      }>(
        `SELECT le.member_id,
                le.experience_id,
                e.name AS experience_name
           FROM trip_log_entries le
           JOIN experiences e ON e.id = le.experience_id
          WHERE le.trip_id = $1`,
        [tripId],
      ),
      ctx.pool.query<{ member_id: string; experience_id: string }>(
        `SELECT rwt.tagged_member_id AS member_id,
                tle.experience_id
           FROM rode_with_tags rwt
           JOIN trip_log_entries tle ON tle.id = rwt.log_entry_id
          WHERE tle.trip_id = $1 AND rwt.state = 'confirmed'`,
        [tripId],
      ),
      // The canonical Ratings referenced by this Trip's completions: for each
      // distinct (Member, Experience) that completed in the Trip context —
      // whether by logging an entry or by a confirmed tag — join the Member's
      // single canonical Rating for that Experience when one exists. `UNION`
      // deduplicates so a Member who both logged and was tagged on the same
      // Experience contributes their Rating once.
      ctx.pool.query<{ experience_id: string; value: number | string }>(
        `SELECT participation.experience_id,
                r.value
           FROM (
                  SELECT le.member_id, le.experience_id
                    FROM trip_log_entries le
                   WHERE le.trip_id = $1
                  UNION
                  SELECT rwt.tagged_member_id AS member_id, tle.experience_id
                    FROM rode_with_tags rwt
                    JOIN trip_log_entries tle ON tle.id = rwt.log_entry_id
                   WHERE tle.trip_id = $1 AND rwt.state = 'confirmed'
                ) participation
           JOIN ratings r
             ON r.user_id = participation.member_id
            AND r.experience_id = participation.experience_id`,
        [tripId],
      ),
      // The Trip's Planned_Items — the source of the planned total count and,
      // matched against the log entries under the Planned_Completion_Match, the
      // planned-completed count (planned-list-completion-sync R5.1, R5.2, R5.3).
      ctx.pool.query<{ experience_id: string }>(
        `SELECT experience_id FROM planned_items WHERE trip_id = $1`,
        [tripId],
      ),
    ]);

  const summary = deriveTripSummary({
    logEntries: logEntriesResult.rows.map((row) => ({
      memberId: row.member_id,
      experienceId: row.experience_id,
      experienceName: row.experience_name,
    })),
    confirmedTags: confirmedTagsResult.rows.map((row) => ({
      memberId: row.member_id,
      experienceId: row.experience_id,
    })),
    ratings: ratingsResult.rows.map((row) => ({
      experienceId: row.experience_id,
      value: Number(row.value),
    })),
    plannedItems: plannedItemsResult.rows.map((row) => ({
      experienceId: row.experience_id,
    })),
  });

  // Resolve a display name for every Member the summary reports. A Member who
  // has since left the Trip may still appear (their log entries and confirmed
  // tags are retained, R8.5), so names are looked up by the reported ids
  // against the durable `profiles` table rather than the current membership.
  const memberIds = summary.perMember.map((m) => m.memberId);
  const displayNameById = new Map<string, string>();
  if (memberIds.length > 0) {
    const profiles = await ctx.pool.query<{
      user_id: string;
      display_name: string;
    }>(
      `SELECT user_id, display_name FROM profiles WHERE user_id = ANY($1)`,
      [memberIds],
    );
    for (const row of profiles.rows) {
      displayNameById.set(row.user_id, row.display_name);
    }
  }

  return {
    distinctExperienceCount: summary.distinctExperienceCount,
    topRated: summary.topRated.map((top) => ({
      experienceId: top.experienceId,
      experienceName: top.experienceName,
      meanRating: top.meanRating,
      ratingCount: top.ratingCount,
    })),
    perMember: summary.perMember.map((member) => ({
      memberId: member.memberId,
      displayName: displayNameById.get(member.memberId) ?? '',
      logEntryCount: member.logEntryCount,
      confirmedTagCount: member.confirmedTagCount,
    })),
    plannedTotalCount: summary.plannedTotalCount,
    plannedCompletedCount: summary.plannedCompletedCount,
  };
}

// ---------------------------------------------------------------------------
// listMyTrips (R16.1)
// ---------------------------------------------------------------------------

/**
 * Fetch the caller's Trips and group them by derived status (R16.1–R16.5).
 *
 * A plain read joins `trip_memberships` to `trips` so exactly the Trips the
 * caller is a Trip_Member of are returned (R16.1). Each row is projected to a
 * {@link TripDTO} with its `Trip_Status` derived at read time, and the whole
 * set is handed to the pure {@link groupTripsByStatus} helper — anchored on the
 * same WDW calendar date used to derive each status — which returns the Active,
 * Upcoming, and Past groups in that order, ordered within each group and with
 * empty groups omitted (R16.2–R16.5). A caller who belongs to no Trips yields
 * an empty array.
 */
async function listMyTrips(
  ctx: TripRepoContext,
  userId: string,
  now: Date | undefined,
): Promise<TripListGroup[]> {
  const result = await ctx.pool.query<TripRow>(
    `SELECT t.id, t.name, t.description, t.start_date, t.end_date, t.created_at, t.walking_speed, t.early_entry_eligible, t.day_touring_hours
       FROM trips t
       JOIN trip_memberships tm ON tm.trip_id = t.id
      WHERE tm.user_id = $1`,
    [userId],
  );
  // One batched read fans the recorded Resort stays out per Trip (R21.1),
  // avoiding a per-Trip query.
  const resortsByTrip = await selectTripResortsByTrip(
    ctx.pool,
    result.rows.map((row) => row.id),
  );
  const trips = result.rows.map((row) =>
    rowToDto(row, now, resortsByTrip.get(row.id) ?? []),
  );
  return groupTripsByStatus(trips, wdwToday(now));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a single Planned_Item's display projection by id on the given client,
 * joining the Experience name/Park and the adder's display name (R9.9), or
 * `null` when no such item exists. Shared by {@link addPlannedItem}'s
 * read-back so the created item is projected identically to the list read.
 */
async function selectPlannedItem(
  client: PoolClient,
  itemId: string,
): Promise<PlannedItemDTO | null> {
  const result = await client.query<PlannedItemRow>(
    `SELECT pi.id,
            pi.experience_id,
            e.name          AS experience_name,
            e.park          AS park,
            p.display_name  AS added_by_display_name,
            pi.planned_date,
            pi.planned_time,
            pi.is_fixed,
            pi.is_lightning_lane,
            pi.use_single_rider,
            pi.priority,
            pi.item_type,
            pi.duration_minutes,
            pi.predicted_wait_minutes,
            pi.travel_from_prev_minutes,
            pi.travel_from_prev_kind,
            pi.optimized_at
       FROM planned_items pi
       JOIN experiences e ON e.id = pi.experience_id
       JOIN profiles    p ON p.user_id = pi.added_by
      WHERE pi.id = $1`,
    [itemId],
  );
  const row = result.rows[0];
  return row ? rowToPlannedItemDto(row) : null;
}

/** Project a `planned_items` join row to the shared `PlannedItemDTO` (R9.9). */
function rowToPlannedItemDto(row: PlannedItemRow): PlannedItemDTO {
  return {
    id: row.id,
    experienceId: row.experience_id,
    experienceName: row.experience_name,
    park: row.park,
    addedByDisplayName: row.added_by_display_name,
    plannedDate: row.planned_date,
    plannedTime: row.planned_time,
    isFixed: row.is_fixed,
    isLightningLane: row.is_lightning_lane,
    useSingleRider: row.use_single_rider,
    priority: row.priority,
    itemType: row.item_type,
    durationMinutes: row.duration_minutes,
    predictedWaitMinutes: row.predicted_wait_minutes,
    travelFromPrev:
      row.travel_from_prev_minutes != null && row.travel_from_prev_kind != null
        ? { kind: row.travel_from_prev_kind, minutes: row.travel_from_prev_minutes }
        : null,
    optimizedAt:
      row.optimized_at == null
        ? null
        : row.optimized_at instanceof Date
          ? row.optimized_at.toISOString()
          : new Date(row.optimized_at).toISOString(),
  };
}

/** Project a `trip_memberships` join row to the shared `TripMemberDTO` (R4.1). */
function rowToTripMemberDto(row: TripMemberRow): TripMemberDTO {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatarPreset: row.avatar_preset,
    role: row.role,
  };
}

/**
 * Lock and return the role held by `userId` on `tripId`, or `undefined` when no
 * membership row exists. Locking the single row `FOR UPDATE` serializes a
 * concurrent role change against the caller's check-then-write.
 */
async function lockMemberRole(
  client: PoolClient,
  tripId: string,
  userId: string,
): Promise<TripRole | undefined> {
  const result = await client.query<{ role: TripRole }>(
    `SELECT role FROM trip_memberships
      WHERE trip_id = $1 AND user_id = $2
      FOR UPDATE`,
    [tripId, userId],
  );
  return result.rows[0]?.role;
}

/**
 * Lock and return the entire membership set for `tripId` as {@link Membership}
 * records for the Last_Organizer_Rule check. `FOR UPDATE` locks every
 * membership row for the Trip so the rule is evaluated against a snapshot that
 * a concurrent demote/leave/remove cannot mutate mid-transaction.
 */
async function lockMemberships(
  client: PoolClient,
  tripId: string,
): Promise<Membership[]> {
  const result = await client.query<{ user_id: string; role: TripRole }>(
    `SELECT user_id, role FROM trip_memberships
      WHERE trip_id = $1
      FOR UPDATE`,
    [tripId],
  );
  return result.rows.map((r) => ({ userId: r.user_id, role: r.role }));
}

/**
 * Roll back a transaction without throwing if the rollback itself fails (e.g.
 * the connection is already in an aborted state), mirroring the pattern in
 * `db/pool.ts::withTransaction` so the original cause surfaces.
 */
async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Swallow rollback errors so the original cause surfaces.
  }
}

/**
 * Format a `DATE` column value as `YYYY-MM-DD`. `pg` returns `DATE` as a `Date`
 * pinned to `00:00:00 UTC` of the calendar date, so the UTC components recover
 * the exact stored day regardless of the server's process timezone; a string
 * (custom type parser) is sliced to its date part. Mirrors the Tracking
 * completion repo's `toIsoDate`.
 */
function toIsoDate(value: Date | string): string {
  if (typeof value === 'string') {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  const yyyy = value.getUTCFullYear().toString().padStart(4, '0');
  const mm = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = value.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format a `TIMESTAMPTZ` column value as an ISO-8601 UTC string. Accepts either
 * a `Date` (the `pg` default) or an already-ISO string (custom type parser).
 */
function toIsoTimestamp(value: Date | string): string {
  if (typeof value === 'string') {
    return value;
  }
  return value.toISOString();
}

/**
 * Detect a Postgres `unique_violation` (SQLSTATE 23505) without depending on
 * the `pg` package's exported error type at compile time. The `code` property
 * is the stable signal across `pg` versions; mirrors the helper in the friends
 * and tracking repos.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

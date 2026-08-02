# Requirements Document

## Introduction

The Disney trips app currently scatters items that need a user's attention across
several unconnected surfaces. Incoming Friend_Requests live on the Friends surface,
Trip_Invites live in an invitations section of the Trips list (and on a deep-link
screen), Shares live in the Share Inbox, and Rode_With_Tags have no in-app home at
all — a user can only confirm or decline one by tapping its push notification, so a
missed push leaves the tag unreachable. There is also no app-wide indicator that new
actionable items are waiting; awareness depends on a push notification arriving and
surviving.

The Notification_Center introduces a single "needs your attention" surface that
aggregates pending, actionable items across all four domains and an app-wide badge
that reflects how many items are waiting. The bottom tab bar is unchanged — Home,
Catalog, Trips, Friends, and Profile — so the social Friends surface keeps its
first-class slot. The Notification_Center is reached from the Profile area, and the
Attention_Badge is displayed on the Profile tab so a waiting-items indicator stays
visible app-wide without giving up a tab.

Rather than acting as a thin router, the Notification_Center lets the user act on
each item inline: accept or decline a Friend_Request, accept or decline a
Trip_Invite, confirm or decline a Rode_With_Tag (with the optional rating on
confirm), and mark a Share read — all directly from the rows of the Attention_Feed,
without leaving the surface. Each domain still owns its own data and lifecycle; the
Notification_Center reuses each domain's existing per-domain read AND action
endpoints unchanged as the source of truth. The actionable friend-request inbox and the
Trips-list trip-invite invitations section are consolidated into the
Notification_Center rather than remaining as separate actionable surfaces, so
friend requests, trip invites, and rode-with tags all live in one place.
Shares are handled as a hybrid: unread Shares surface as inline items the user can
mark read in the Notification_Center, while the standalone Share Inbox survives as a
browse/history/react surface reachable from the Notification_Center. The underlying
Share model and the `GET /me/inbox` contract are reused without being reshaped.

One backend gap must be closed to support this: Rode_With_Tags today expose only a
single-tag deep-link read and confirm/decline actions, with no way to list a user's
pending tags. A new per-domain pending read is required so the Notification_Center
can aggregate rode-with tags the same way it aggregates the other domains.

## Glossary

- **Mobile_App**: The client application that hosts the Notification_Center surface and the Attention_Badge.
- **Trips_API**: The backend service that owns Trip_Invite and Rode_With_Tag data and endpoints.
- **Notification_Center**: The in-app surface, reached from the Profile area, that aggregates pending, actionable items from all supported domains into one list and lets the user act on each item inline.
- **Profile_Notifications_Entry**: The entry in the Profile area that opens the Notification_Center. The bottom tab bar is unchanged (Home, Catalog, Trips, Friends, Profile); there is no dedicated Notifications tab.
- **Attention_Feed**: The single ordered list of Attention_Items presented by the Notification_Center.
- **Attention_Item**: One row in the Attention_Feed representing a single pending, actionable item from one domain. Carries a domain type, a summary, a source timestamp, the inline action controls appropriate to its domain type, and any identifiers needed to invoke its domain's action endpoints or to open its underlying destination.
- **Inline_Action**: An accept, decline, confirm, or read action the user performs on an Attention_Item directly within the Notification_Center, without navigating to a separate handler screen.
- **Attention_Badge**: The app-wide count indicator, displayed on the Profile tab, showing how many pending, actionable items are waiting for the authenticated user.
- **Domain_Source**: The per-domain backend endpoints the Notification_Center reuses for a domain, comprising that domain's pending-item read endpoint AND its accept/decline/confirm/read action endpoints. The four read endpoints are the Friend_Request read (`GET /me/friends` → `incomingRequests`), the Trip_Invite read (`GET /me/trip-invites`), the Rode_With_Tag read (`GET /me/rode-with-tags?state=pending`), and the Share read (`GET /me/inbox`); each domain's existing per-item action endpoints (friend-request accept/decline, trip-invite accept/decline, rode-with-tag confirm/decline, share read) are the actions the Notification_Center invokes inline.
- **Friend_Request**: An incoming pending friend request addressed to the authenticated user.
- **Trip_Invite**: A pending invitation for the authenticated user to join a Trip.
- **Rode_With_Tag**: A pending tag naming the authenticated user as having ridden an Experience with another user, awaiting confirm or decline.
- **Share**: A delivered, unread item in the authenticated user's inbox. A Share may reference an underlying destination (for example, an Experience) that can be opened.
- **Share_Destination**: The underlying subject a Share points to, such as an Experience, that the user can open from the Share's Attention_Item.
- **Share_Inbox**: The standalone browse/history surface that lists the user's delivered Shares regardless of read state and lets the user add or change a per-share reaction. It survives alongside the Notification_Center and is reachable from it.
- **Pending_Item**: A Friend_Request, Trip_Invite, or Rode_With_Tag whose state is `pending`, or a Share whose per-recipient read state is unread.
- **Polling_Interval**: The fixed 60-second cadence at which the Notification_Center refreshes its Domain_Sources while the Mobile_App is foregrounded.
- **Load_Deadline**: The 10-second per-attempt ceiling after which an in-flight Domain_Source read is treated as failed.

## Requirements

### Requirement 1: Aggregated attention feed across domains

**User Story:** As a user, I want one place that lists everything waiting for my response across friends, trips, rode-with tags, and shares, so that I do not have to check each screen separately.

#### Acceptance Criteria

1. WHEN the authenticated user opens the Notification_Center, THE Notification_Center SHALL request Pending_Items from each of the four Domain_Sources.
2. THE Notification_Center SHALL present one Attention_Item in the Attention_Feed for each pending Friend_Request, each pending Trip_Invite, each pending Rode_With_Tag, and each unread Share returned by the Domain_Sources.
3. THE Notification_Center SHALL display, for each Attention_Item, the domain type, a human-readable summary of at most 140 characters that identifies the originating user and the referenced subject, and the item's source timestamp.
4. THE Notification_Center SHALL order the Attention_Items in the Attention_Feed by source timestamp in descending order, so the most recent item appears first.
5. WHERE two Attention_Items share the same source timestamp, THE Notification_Center SHALL order those items by domain type in the fixed sequence Friend_Request, then Trip_Invite, then Rode_With_Tag, then Share.
6. WHERE two Attention_Items share the same source timestamp and the same domain type, THE Notification_Center SHALL order those items by their domain item identifier in ascending lexicographic order.
7. THE Notification_Center SHALL provide a sort control that lets the user switch the Attention_Feed between the default source-timestamp descending order and a group-by-domain-type order.
8. WHILE the user has selected the group-by-domain-type order, THE Notification_Center SHALL group the Attention_Items by domain type in the fixed sequence Friend_Request, then Trip_Invite, then Rode_With_Tag, then Share, and SHALL order the items within each group by source timestamp in descending order.

### Requirement 2: Inline actions on attention items

**User Story:** As a user, I want to accept, decline, confirm, or read each item directly from its row, so that I can clear waiting items without leaving the attention center.

#### Acceptance Criteria

1. THE Notification_Center SHALL present, on each Attention_Item, the Inline_Action controls appropriate to that item's domain type: accept and decline for a Friend_Request, accept and decline for a Trip_Invite, confirm and decline for a Rode_With_Tag with an optional rating input on confirm, and mark-read for a Share.
2. WHEN the user activates an Inline_Action on an Attention_Item, THE Notification_Center SHALL invoke that domain's existing per-item action endpoint directly, forwarding the item's identifiers: the friend-request accept or decline endpoint for a Friend_Request, the trip-invite accept or decline endpoint for a Trip_Invite, the rode-with-tag confirm or decline endpoint (including the optional rating on confirm) for a Rode_With_Tag, and the share read endpoint for a Share.
3. WHERE a Share references a Share_Destination, THE Notification_Center SHALL present a control on that Attention_Item that opens the Share_Destination.
4. WHEN an invoked Inline_Action endpoint reports success, THE Notification_Center SHALL remove the resolved Attention_Item from the Attention_Feed and refresh the affected Domain_Source read within the Load_Deadline.
5. WHEN the user activates an Inline_Action, THE Notification_Center SHALL optimistically remove the affected Attention_Item from the Attention_Feed and SHALL keep that item removed whenever the invoked action endpoint returns any response, regardless of whether the response reports success or failure.
6. IF the invoked Inline_Action endpoint does not return a response within the Load_Deadline, THEN THE Notification_Center SHALL restore that Attention_Item to the Attention_Feed and present an error indication that the action did not complete.
7. IF an invoked Inline_Action endpoint returns a response reporting failure while the underlying item is still pending, THEN THE Notification_Center SHALL keep the Attention_Item removed and present an error indication that the action did not complete.
8. IF an invoked Inline_Action endpoint reports that the underlying item is no longer pending or no longer available, THEN THE Notification_Center SHALL keep that Attention_Item removed from the Attention_Feed and present an error indication that the item is no longer available.
9. THE Notification_Center SHALL provide a control that opens the full Share_Inbox surface, where the user can view already-read Shares and add or change a per-share reaction.

### Requirement 3: Rode-with pending read endpoint

**User Story:** As a user, I want my pending rode-with tags to appear in the attention list even if I missed the push, so that I can still confirm or decline them from inside the app.

#### Acceptance Criteria

1. THE Trips_API SHALL expose a read endpoint `GET /me/rode-with-tags?state=pending` that returns, as a list ordered by creation timestamp in descending order, the authenticated user's Rode_With_Tags whose state is `pending`, and SHALL exclude any Rode_With_Tag whose state is not `pending`.
2. THE Trips_API SHALL scope the `GET /me/rode-with-tags?state=pending` response to Rode_With_Tags for which the authenticated user is the Tagged_Member.
3. THE Trips_API SHALL return, for each pending Rode_With_Tag in the response, the tag identifier, the linked trip-log-entry identifier, the referenced Experience name, the tagging member's display name, and the tag's creation timestamp.
4. WHEN the authenticated user has no pending Rode_With_Tags, THE Trips_API SHALL return an empty list with a success status.
5. IF a caller without an authenticated session requests `GET /me/rode-with-tags?state=pending`, THEN THE Trips_API SHALL reject the request with an unauthorized status.
6. IF a request to `GET /me/rode-with-tags` omits the `state` parameter or specifies a `state` value other than `pending`, THEN THE Trips_API SHALL reject the request with a client-error status indicating that the `state` parameter value is not supported and SHALL NOT return any Rode_With_Tags.

### Requirement 4: Attention badge count

**User Story:** As a user, I want a single badge that tells me how many things are waiting, so that I know at a glance whether I need to act.

#### Acceptance Criteria

1. THE Attention_Badge SHALL compute a total attention count equal to the sum of the authenticated user's pending Friend_Requests, pending Trip_Invites, pending Rode_With_Tags, and unread Shares returned by the Domain_Sources.
2. WHILE the total attention count is zero, THE Attention_Badge SHALL display no count indicator.
3. WHILE the total attention count is between 1 and 99 inclusive, THE Attention_Badge SHALL display the exact count.
4. WHILE the total attention count is greater than 99, THE Attention_Badge SHALL display "99+", including when the count is exactly 100.
5. THE Attention_Badge total attention count SHALL equal the number of Attention_Items the Notification_Center would present in the Attention_Feed for the same set of Domain_Source responses.
6. THE Attention_Badge SHALL derive its display mode and its displayed value from the same total attention count, so the visible indicator is always consistent with that count.

### Requirement 5: Badge and feed synchronization with domain state

**User Story:** As a user, I want the badge and list to stay in sync with what I have already handled, so that resolved items disappear and the count stays accurate.

#### Acceptance Criteria

1. WHILE the Mobile_App is foregrounded, THE Notification_Center SHALL refresh the Domain_Sources at the Polling_Interval.
2. WHEN the user resolves a Pending_Item by activating an Inline_Action that accepts, declines, confirms, or reads it, THE Notification_Center SHALL refresh the affected Domain_Source within the Load_Deadline so the resolved item is omitted from the Attention_Feed.
3. WHEN one or more Pending_Items are resolved and omitted from the Attention_Feed, THE Attention_Badge SHALL decrease its displayed count by the number of resolved items, and THE displayed count SHALL never fall below zero.
4. IF a refresh would reduce the Attention_Badge count to zero, THEN THE Notification_Center SHALL hide the Attention_Badge and display an empty-state indication in the Attention_Feed showing that no Pending_Items remain.
5. WHEN the user returns to the Notification_Center after navigating away from it, THE Notification_Center SHALL refresh the Domain_Sources within the Load_Deadline so items resolved elsewhere no longer appear in the Attention_Feed.
6. THE Notification_Center SHALL derive the Attention_Badge count and the Attention_Feed from the same Domain_Source responses so that, after each refresh, the Attention_Badge count is exactly equal to the number of Pending_Items displayed in the Attention_Feed.

### Requirement 6: In-app alerting independent of push delivery

**User Story:** As a user, I want to be alerted in-app when a new trip invite or rode-with tag is waiting, so that my awareness does not depend on a push notification arriving.

#### Acceptance Criteria

1. WHILE the Mobile_App is foregrounded, WHEN a successful Domain_Source read at the Polling_Interval returns a Pending_Item that was not present in the prior successful read of that Domain_Source, THE Attention_Badge SHALL increase its displayed count to include that Pending_Item within one Polling_Interval, applying the display rules of Requirement 4.
2. THE Attention_Badge SHALL derive its displayed count solely from the Pending_Items returned by the Domain_Sources, independent of whether a push notification for any of those items was delivered or tapped.
3. WHEN the user opens the Notification_Center, THE Attention_Feed SHALL include one Attention_Item for every Pending_Item returned by the Domain_Sources, including Pending_Items for which no push notification was delivered or tapped.

### Requirement 7: Consolidation of actionable inboxes and reuse of domain backends

**User Story:** As a user, I want friend requests and shares handled in one attention center instead of scattered inboxes, so that there is a single place to act while the underlying data stays owned by each domain.

#### Acceptance Criteria

1. THE Notification_Center SHALL be the single in-app surface for acting on pending Friend_Requests and for marking unread Shares read, and the Mobile_App SHALL NOT present a friend-request accept/decline section on the Friends list as an actionable surface for those requests.
2. THE Notification_Center SHALL retrieve its Attention_Items only through the existing per-domain Domain_Source read endpoints and SHALL use no other data source.
3. THE Notification_Center SHALL reuse each domain's existing per-domain backend endpoints unchanged as the source of truth for both reads and actions, and SHALL neither reshape those endpoints nor introduce a new aggregation data store.
4. THE Notification_Center SHALL retrieve Share items through the existing `GET /me/inbox` contract using the same request parameters that the inbox read uses, without adding a required request parameter and without reshaping the Share model.
5. THE Notification_Center SHALL be the single in-app surface for acting on pending Trip_Invites, and the Mobile_App SHALL NOT present a Trip_Invite invitations section in the Trips list as an actionable surface for those invites.
6. THE Notification_Center SHALL invoke each domain's existing per-item action endpoints without modifying the semantics or contract of those endpoints, so a Pending_Item resolved through the Notification_Center reaches the same domain state it would reach through that domain's own surface.
7. THE Share_Inbox SHALL remain available as a browse, history, and reaction surface reachable from the Notification_Center, and it SHALL NOT serve as the alerting surface for unread Shares; alerting for unread Shares is provided by the Notification_Center and the Attention_Badge.

### Requirement 8: Partial and total source failure handling

**User Story:** As a user, I want the attention list to still show what it can when one source is unavailable, so that a single failure does not hide everything.

#### Acceptance Criteria

1. IF at least one Domain_Source read succeeds and at least one Domain_Source read fails or exceeds the Load_Deadline, THEN THE Notification_Center SHALL present all Attention_Items from the successful Domain_Sources without suppressing any successfully loaded item and SHALL display an indication that identifies each affected Domain_Source domain type whose items could not be loaded.
2. WHILE one or more Domain_Source reads have failed, THE Notification_Center SHALL provide an enabled retry control that, when activated, re-requests only the failed Domain_Sources and does not re-request the successful Domain_Sources.
3. IF every Domain_Source read fails or exceeds the Load_Deadline, THEN THE Notification_Center SHALL display an error indication with a retry control and SHALL NOT present an empty-feed success state.
4. WHILE at least one Domain_Source read has succeeded and at least one Domain_Source read has failed, THE Attention_Badge SHALL display a count derived solely from the Attention_Items of the successful Domain_Sources.
5. WHEN the retry control is activated, THE Notification_Center SHALL re-request the failed Domain_Sources within the Load_Deadline and merge the retry results with the previously loaded successful Attention_Items.
6. WHEN a retried Domain_Source read succeeds, THE Notification_Center SHALL present that Domain_Source's Attention_Items, remove that Domain_Source domain type from the failure indication, and update the Attention_Badge count to include the newly loaded Attention_Items.
7. IF every Domain_Source read fails or exceeds the Load_Deadline, THEN THE Attention_Badge SHALL NOT display a count indicator.

### Requirement 9: Loading and empty states

**User Story:** As a user, I want clear feedback while the list loads and when there is nothing to do, so that I can tell the difference between loading, empty, and broken.

#### Acceptance Criteria

1. WHILE at least one Domain_Source read is in flight and its Load_Deadline has not elapsed, THE Notification_Center SHALL display a loading indication that is visually distinct from the empty-state indication and from the error indication defined in Requirement 8.
2. WHEN all four Domain_Source reads succeed and the total number of Pending_Items returned across all Domain_Sources is zero, THE Notification_Center SHALL display an empty-state indication that is visually distinct from the loading indication and from the error indication defined in Requirement 8.
3. WHILE at least one Domain_Source read is in flight, THE Notification_Center SHALL display the loading indication in preference to the empty-state indication until every Domain_Source read resolves by succeeding, failing, or exceeding the Load_Deadline.
4. IF a Domain_Source read does not complete within the Load_Deadline, THEN THE Notification_Center SHALL treat that read as failed for the purposes of Requirement 8.
5. WHEN every in-flight Domain_Source read has resolved by succeeding, failing, or exceeding the Load_Deadline, THE Notification_Center SHALL remove the loading indication, WHERE a brief transitional period during which the loading indication persists after the reads complete is permitted before the empty-state or error indication is shown.
6. THE Notification_Center SHALL display at most one of the loading indication, the empty-state indication, and the error indication defined in Requirement 8 at any given time.

### Requirement 10: Profile-area entry point and discoverability

**User Story:** As a user, I want to reach the attention center from my Profile and see its badge on the Profile tab, so that the Friends tab stays in the bottom bar while I am still alerted to waiting items from anywhere in the app.

#### Acceptance Criteria

1. THE Mobile_App SHALL present a bottom tab bar containing the tabs Home, Catalog, Trips, Friends, and Profile, unchanged from today, with no dedicated Notifications tab.
2. THE Mobile_App SHALL provide a Profile_Notifications_Entry in the Profile area that opens the Notification_Center.
3. WHILE the total attention count is greater than zero, THE Mobile_App SHALL display the Attention_Badge on the Profile tab.
4. WHILE the total attention count is zero, THE Mobile_App SHALL hide the Attention_Badge on the Profile tab, using the single derived total attention count, WHERE a brief display lag during which the badge remains momentarily visible while the system processes a count update is permitted.
5. WHEN the user opens the Notification_Center from the Profile_Notifications_Entry, THE Notification_Center SHALL display the Attention_Feed for the authenticated user.
6. WHILE the Mobile_App is foregrounded, THE Mobile_App SHALL update the Attention_Badge on the Profile tab to reflect a change in the total attention count within one Polling_Interval.

### Requirement 11: Session scoping and privacy

**User Story:** As a user, I want the attention list to show only my own items and to clear when my session ends, so that my pending items stay private to me.

#### Acceptance Criteria

1. THE Notification_Center SHALL request each Domain_Source using the authenticated user's session, so the Attention_Feed contains only Pending_Items belonging to that authenticated user and contains no Pending_Item belonging to any other user.
2. WHILE no authenticated session exists, THE Notification_Center SHALL present no Attention_Items in the Attention_Feed.
3. WHILE no authenticated session exists, THE Attention_Badge SHALL display no count indicator.
4. WHEN the authenticated session ends, THE Notification_Center SHALL clear the Attention_Feed so that no Attention_Items remain presented.
5. WHEN the authenticated session ends, THE Attention_Badge SHALL clear its count indicator so that no count is displayed.
6. WHEN the authenticated session ends, THE Notification_Center SHALL discard every Pending_Item retrieved during that session so that no item from the ended session is presented to any subsequently authenticated user.

### Requirement 12: Share Inbox survival and placement

**User Story:** As a user, I want to still browse my past shares and react to them after unread shares start surfacing in the attention center, so that consolidating alerts does not cost me my share history or reactions.

#### Acceptance Criteria

1. THE Mobile_App SHALL keep the Share_Inbox available as a surface that lists the authenticated user's delivered Shares regardless of their read state.
2. THE Mobile_App SHALL make the Share_Inbox reachable from the Notification_Center.
3. THE Share_Inbox SHALL allow the user to add or change a per-share reaction, reusing the existing share reaction contract without reshaping it.
4. THE Share_Inbox SHALL retrieve its Shares through the existing `GET /me/inbox` contract without reshaping that contract.
5. WHEN the user marks an unread Share read from the Notification_Center, THE Share_Inbox SHALL reflect that Share as read.

### Requirement 13: Push notification routing into the attention center

**User Story:** As a user, I want tapping a push notification for a friend request, trip invite, rode-with tag, or share to take me somewhere I can act on it, so that taps keep working after the old handler screens change.

#### Acceptance Criteria

1. WHEN the user taps a push notification whose payload references a Friend_Request, a Trip_Invite, a Rode_With_Tag, or a Share, THE Mobile_App SHALL open the Notification_Center.
2. WHEN the Mobile_App opens the Notification_Center in response to a tapped push notification, THE Notification_Center SHALL present the Attention_Item corresponding to the referenced item so the user can perform its Inline_Action, WHERE that item is still a Pending_Item.
3. IF the item referenced by a tapped push notification cannot be acted upon, whether because it is no longer a Pending_Item or because it is otherwise unavailable, THEN THE Notification_Center SHALL present an indication that the referenced item is no longer available, and SHALL open with the Attention_Feed where possible; presenting the unavailable indication is sufficient even if the Attention_Feed does not open.
4. THE Mobile_App SHALL NOT route a tapped push notification for a Friend_Request, Trip_Invite, Rode_With_Tag, or Share to a standalone handler screen in place of the Notification_Center.

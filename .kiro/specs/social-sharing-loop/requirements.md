# Requirements Document

## Introduction

The Social Sharing Loop reworks the existing sharing feature of the Disney World Tracker into a coherent, end-to-end social experience. Today a User can send a Share to Friends, but the flow is broken in three ways: the Share is composed from a top-level button on the Friends page that forces the sender to type a raw Experience identifier as free text, a delivered Share lands in the recipient's Inbox as a dead end that shows only a raw identifier with no way to reach the referenced content, and there is no signal that a Share arrived and no way for a recipient to respond. This feature does not replace the already-implemented Friends system, Sharing_Service endpoints, or Friend_Profile_View; it builds on top of them.

The work is organized into three phases that ship independently and in order:

- **Phase 1 — Fix the broken flow and close the loop.** Move Share initiation onto the content being shared (an Experience and a progress snapshot), remove the free-text identifier input, present the recipient with the sender and the Experience name and context instead of a raw identifier, and make a Share navigate to its referenced destination.
- **Phase 2 — Make a Share land and let recipients respond.** Deliver a push notification when a Share arrives, and let a recipient attach a lightweight reaction to a Share that the sender can see.
- **Phase 3 — Progress comparison.** Frame a Friend's profile as a side-by-side comparison of the viewer's and the Friend's completion, including a list of Experiences the Friend has completed that the viewer has not.

Requirements 1 through 6 constitute Phase 1 and are independently shippable. Requirements 7 through 11 constitute Phase 2. Requirements 12 through 14 constitute Phase 3. Cross-cutting concerns (privacy, backward compatibility, and consistent loading, empty, and error states) are stated as explicit requirements where they apply.

## Glossary

- **App**: The Disney World Tracker mobile application (React Native / Expo) as a whole.
- **User**: An authenticated account holder of the App.
- **Friend**: A User who has an accepted, mutual relationship with another User via the existing Friends_Service.
- **Experience**: An individual catalog item at Walt Disney World, identified by a stable internal identifier.
- **Park**: One of the Walt Disney World locations defined by the existing catalog (four theme parks, two water parks, and Disney Springs).
- **Experience_Category**: The classification of an Experience (Ride, Show, Restaurant, Parade, Character_Meet, Other).
- **Sharing_Service**: The existing API component that creates and delivers Shares and serves the recipient Inbox via the endpoints `POST /me/shares`, `GET /me/inbox`, `POST /me/inbox/:shareId/open`, and `DELETE /me/inbox/:shareId`.
- **Share**: A unit of content sent through the Sharing_Service from one sending User to one or more recipient Friends. A Share has a payload of kind `experience` or `progress`.
- **Experience_Share**: A Share whose payload kind is `experience`, referencing one Experience and optionally the sender's Rating and Note captured at send time.
- **Progress_Share**: A Share whose payload kind is `progress`, containing the sender's overall, per-Park, and per-Experience_Category completion percentages captured at send time.
- **Share_Payload**: The content snapshot carried by a Share, captured at delivery time and unchanged thereafter.
- **Rating**: A whole-number score from 1 to 10 that a User has assigned to an Experience.
- **Note**: A free-form text entry up to 2000 characters that a User has recorded for an Experience.
- **Share_Composer**: The App screen on which the sending User selects recipient Friends and confirms sending a Share.
- **Inbox**: The App screen on which a recipient User views Shares delivered to that User.
- **Experience_Detail_View**: The existing App screen (ExperienceDetailScreen, hosted on the RootStack) that displays a single Experience together with the viewing User's own Rating and Note for that Experience.
- **Progress_Screen**: The existing App screen (StatsScreen) that displays the viewing User's own overall, per-Park, and per-Experience_Category completion.
- **Friend_Profile_View**: The existing App screen (FriendProfileScreen) that displays a Friend's completion percentages, per-Park and per-Experience_Category breakdowns, and completed-Experience list.
- **Share_Entry_Point**: A control in the App from which a User initiates a Share of specific content, located on the content being shared.
- **Read_State**: A per-recipient marker on a delivered Share indicating whether the recipient has viewed it (`read`) or not (`unread`). The Read_State drives the Inbox unread count only; it does NOT gate disclosure of the sender identity, the Share_Payload, or the timestamp — all of which the Inbox shows for every delivered Share regardless of Read_State. A Share becomes `read` when the recipient views it in the Inbox.
- **Notification_Service**: The API component responsible for sending push notifications to Users' registered devices when a Share arrives.
- **Push_Token**: A device-specific Expo push token that identifies one of a User's devices as a destination for push notifications.
- **Push_Registration**: The record associating a User with a Push_Token and its lifecycle state (active or invalidated).
- **Notification_Permission**: The operating-system-level permission that authorizes the App to display push notifications on a device.
- **Share_Notification_Preference**: A per-User setting that controls whether the Notification_Service sends Share push notifications to that User.
- **Reaction_Service**: The API component responsible for persisting and serving reactions to opened Shares.
- **Share_Reaction**: A lightweight response attached by a recipient to an opened Share and visible to the Share's sender. A Share_Reaction is one value drawn from the Reaction_Vocabulary; free-form text is not permitted.
- **Reaction_Vocabulary**: The fixed, closed set of predefined Share_Reaction values the App offers: `like` (👍), `love` (❤️), `been_there`, and `want_to_go`.
- **Progress_Comparison**: A derived, side-by-side view over the viewing User's and a Friend's completion data, presented within the Friend_Profile_View.
- **Completion_Diff**: The set of Experiences that a Friend has completed and the viewing User has not completed.

## Requirements

### Requirement 1: Content-Anchored Share Entry Points (Phase 1)

**User Story:** As a User, I want to start a Share directly from the Experience or progress I am looking at, so that I never have to identify content by typing a raw identifier.

#### Acceptance Criteria

1. THE Experience_Detail_View SHALL display a Share_Entry_Point for the currently displayed Experience.
2. WHILE the Experience, the viewing User's Rating, or the viewing User's Note for the currently displayed Experience is still loading, THE Experience_Detail_View SHALL disable the Share_Entry_Point.
3. WHEN a User activates the Share_Entry_Point on the Experience_Detail_View, THE App SHALL open the Share_Composer pre-populated with an Experience_Share referencing the currently displayed Experience.
4. WHEN a User activates the Share_Entry_Point on the Experience_Detail_View and the viewing User has a Rating recorded for the currently displayed Experience, THE App SHALL include that Rating value, as a whole number from 1 to 10 inclusive, in the pre-populated Experience_Share without requiring further User input.
5. WHEN a User activates the Share_Entry_Point on the Experience_Detail_View and the viewing User has a Note recorded for the currently displayed Experience, THE App SHALL include that Note text, up to 2000 characters, in the pre-populated Experience_Share without requiring further User input.
6. THE Progress_Screen SHALL display a Share_Entry_Point for the viewing User's progress.
7. WHILE the viewing User's completion data is still loading, THE Progress_Screen SHALL disable the Share_Entry_Point.
8. WHEN a User activates the Share_Entry_Point on the Progress_Screen, THE App SHALL open the Share_Composer pre-populated with a Progress_Share containing the viewing User's overall, per-Park, and per-Experience_Category completion percentages, each to one decimal place, as displayed on the Progress_Screen at activation time.

### Requirement 2: Streamlined Share Composer (Phase 1)

**User Story:** As a User, I want the Share_Composer to just let me pick recipients and confirm what I am sending, so that composing a Share is fast and unambiguous.

#### Acceptance Criteria

1. WHEN the Share_Composer is opened from a Share_Entry_Point, THE Share_Composer SHALL determine the Share payload kind from the originating Share_Entry_Point and SHALL NOT present a control for the User to change the payload kind.
2. THE Share_Composer SHALL display a read-only preview of the content to be shared.
3. WHERE the Share payload kind is `experience`, THE Share_Composer SHALL display in the read-only preview the referenced Experience's name, Park, and Experience_Category, and WHILE the sender's Rating or Note is marked for inclusion SHALL display each included value.
4. WHERE the Share payload kind is `progress`, THE Share_Composer SHALL display in the read-only preview the sender's overall completion percentage to one decimal place.
5. THE Share_Composer SHALL NOT provide a free-text input for an Experience identifier.
6. THE Share_Composer SHALL allow the User to select between 1 and 50 recipient Friends inclusive.
7. WHILE the count of selected recipient Friends is 0 or greater than 50, THE Share_Composer SHALL disable the control that sends the Share.
8. WHEN a User confirms sending with between 1 and 50 selected recipient Friends inclusive, THE Share_Composer SHALL submit the Share to the Sharing_Service via `POST /me/shares` with the payload kind and content derived from the Share_Entry_Point, including only the sender's Rating and Note that the User has marked for inclusion.
9. WHILE the Share submission is in progress, THE Share_Composer SHALL display a loading indication and SHALL disable the control that sends the Share.
10. WHEN the Sharing_Service confirms successful delivery, THE Share_Composer SHALL display a success indication for 250 milliseconds and SHALL then return the User to the screen from which the Share_Composer was opened.
11. IF the Sharing_Service rejects the Share with a recipient-count error, THEN THE Share_Composer SHALL display a message indicating that between 1 and 50 Friends must be selected and SHALL NOT return the User to the previous screen.
12. IF the Sharing_Service rejects the Share because one or more selected recipients are no longer Friends, THEN THE Share_Composer SHALL display a message indicating that some recipients are no longer Friends and SHALL NOT return the User to the previous screen.
13. IF the Share submission fails for any reason other than a recipient-count error or a non-Friend-recipient error, THEN THE Share_Composer SHALL display a generic retry message and SHALL retain the User's recipient selection.
14. WHERE the pre-populated Experience_Share includes the sender's Rating or Note, THE Share_Composer SHALL provide a control that allows the User to include or exclude each of the Rating and the Note independently, with each value marked for inclusion by default.
15. WHILE the User has zero Friends available to select as recipients, THE Share_Composer SHALL display an empty-state indication that the User has no Friends to share with and SHALL disable the control that sends the Share.

### Requirement 3: Removal of the Friends-Page Share Entry (Phase 1)

**User Story:** As a User, I want the confusing top-level Share button removed from the Friends page, so that I only start a Share from the content I want to share.

#### Acceptance Criteria

1. THE App SHALL NOT display any control on the Friends page that opens the Share_Composer.
2. THE App SHALL open the Share_Composer only when a Share is initiated from a Share_Entry_Point.
3. WHEN a User initiates a Share from a Share_Entry_Point, THE App SHALL open the Share_Composer with a pre-populated Share payload.
4. THE Friends page SHALL display the Inbox control and the Find control.
5. WHEN a User activates the Inbox control on the Friends page, THE App SHALL navigate to the Inbox.

> Resolved (OQ-1): The Friends-page Share button is removed and NOT repurposed as an "Invite" action. An in-app invite is a separate product bet that would need its own deep-link and friend-connection flow to be worthwhile; it is out of scope for this feature. The Friends page retains only the Inbox and Find controls.

### Requirement 4: Human-Readable Inbox Content (Phase 1)

**User Story:** As a recipient, I want to see who shared with me and the name and context of what they shared, so that every Share in my Inbox is meaningful instead of a raw identifier.

#### Acceptance Criteria

1. WHEN the Inbox displays a Share to a recipient, regardless of the Share's Read_State, THE Inbox SHALL display the sending User's display name.
2. WHEN the Inbox displays an Experience_Share to a recipient, THE Inbox SHALL display the referenced Experience's name, Park, and Experience_Category.
3. WHEN the Inbox displays an Experience_Share to a recipient, THE Inbox SHALL NOT display the referenced Experience's raw internal identifier as the primary label for the Share.
4. WHEN the Inbox displays an Experience_Share that includes the sender's Rating, THE Inbox SHALL display the sender's Rating as a whole number from 1 to 10 inclusive.
5. WHEN the Inbox displays an Experience_Share for which the sender's Rating is marked unavailable, THE Inbox SHALL display an indication that the Rating is unavailable.
6. WHEN the Inbox displays an Experience_Share that includes neither the sender's Rating nor an indication that the Rating is unavailable, THE Inbox SHALL NOT display a Rating for that Share.
7. WHEN the Inbox displays an Experience_Share that includes the sender's Note, THE Inbox SHALL display the sender's complete Note text up to 2000 characters.
8. WHEN the Inbox displays an Experience_Share that does not include the sender's Note, THE Inbox SHALL NOT display a Note for that Share.
9. WHEN the Inbox displays a Progress_Share to a recipient, THE Inbox SHALL display the sender's overall, per-Park, and per-Experience_Category completion percentages to one decimal place.
10. WHILE the Inbox is retrieving the name, Park, or Experience_Category for an Experience_Share and fewer than 10 seconds have elapsed since the retrieval began, THE Inbox SHALL display a loading indication for that Share.
11. IF the Inbox cannot retrieve the name, Park, or Experience_Category for an Experience_Share, or has not retrieved them within 10 seconds of the retrieval beginning, THEN THE Inbox SHALL display the Share with a fallback label indicating the Experience is unavailable and SHALL keep the remaining Share content visible.

### Requirement 5: Share Tap-Through Navigation (Phase 1)

**User Story:** As a recipient, I want to tap a Share and land on the shared content, so that I can act on what a Friend sent me.

#### Acceptance Criteria

1. WHEN a recipient selects an Experience_Share in the Inbox whose referenced Experience is available, THE App SHALL navigate to the Experience_Detail_View for the referenced Experience.
2. WHEN a recipient selects a Progress_Share in the Inbox whose sending User remains a Friend of the recipient, THE App SHALL navigate to the Friend_Profile_View for the sending User.
3. WHEN a recipient selects a Share whose Read_State is `unread`, THE App SHALL set that Share's Read_State to `read` and SHALL update the Inbox unread count accordingly.
4. WHEN the App navigates from the Inbox to the Experience_Detail_View, THE App SHALL perform the navigation across navigator boundaries such that the Experience_Detail_View is presented from its host stack.
5. IF a recipient selects an Experience_Share whose referenced Experience cannot be retrieved, THEN THE App SHALL keep the recipient on the Inbox, display a message indicating the Experience is unavailable, and retain the remaining Inbox content.
6. IF a recipient selects a Progress_Share whose sending User is no longer a Friend of the recipient, THEN THE App SHALL keep the recipient on the Inbox, display a message indicating the sender's profile is unavailable, and retain the remaining Inbox content.
7. WHILE the App is verifying the availability of the destination for a selected Share, THE App SHALL display a loading indication for that Share and SHALL NOT initiate a second navigation for the same Share until the verification completes.

### Requirement 6: Privacy and Backward Compatibility of the Reworked Flow (Phase 1)

**User Story:** As a User, I want the reworked flow to disclose Shares only to their intended recipients and keep already-delivered Shares usable, so that nothing regresses when the redesign ships.

#### Acceptance Criteria

1. THE App SHALL disclose a Share's sender identity, Share_Payload, and delivery timestamp only to the Share's sender and its intended recipients, and SHALL NOT disclose them to any other User, regardless of the Share's Read_State.
2. WHEN the Inbox displays a Share to a recipient, THE Inbox SHALL display the Share's sender, content, and timestamp regardless of the Share's Read_State, and SHALL use the Share's Read_State only to compute the unread count.
3. WHEN the App displays a Share that was delivered before this feature shipped, THE Inbox SHALL render that Share using the same content rules defined in Requirement 4 for its payload kind.
4. WHEN the Inbox displays an Experience_Share delivered before this feature shipped whose Share_Payload does not contain the Experience name, Park, or Experience_Category, THE Inbox SHALL retrieve those values from the referenced Experience for display, applying the loading indication and the Experience-unavailable fallback behavior defined in Requirement 4 for that retrieval.
5. THE reworked flow SHALL send Shares using the existing `POST /me/shares` request contract accepted by the Sharing_Service, without introducing any new required request parameters.
6. THE reworked flow SHALL read the Inbox using the existing `GET /me/inbox`, `POST /me/inbox/:shareId/open`, and `DELETE /me/inbox/:shareId` contracts served by the Sharing_Service, without introducing any new required request parameters.

### Requirement 7: Share Push Notification Delivery (Phase 2)

**User Story:** As a recipient, I want a push notification when a Friend shares with me, so that I know to look at my Inbox.

#### Acceptance Criteria

1. WHEN the Sharing_Service delivers a Share to a recipient who has at least one active Push_Registration and whose Share_Notification_Preference permits Share notifications, THE Notification_Service SHALL send a push notification to each of that recipient's active Push_Tokens within 30 seconds of delivery.
2. THE Notification_Service SHALL compose the push notification to disclose only the sending User's display name and a single content label of at most 100 characters, and SHALL NOT include the sender's Rating, the sender's Note, or any completion percentages.
3. WHERE a delivered Share is an Experience_Share, THE Notification_Service SHALL set the content label to the referenced Experience's name, truncated to at most 100 characters.
4. WHERE a delivered Share is a Progress_Share, THE Notification_Service SHALL set the content label to an indication that the sender shared progress.
5. IF the recipient has no active Push_Registration, THEN THE Notification_Service SHALL complete Share delivery without sending a push notification.
6. IF the push delivery provider reports that a Push_Token is no longer valid, THEN THE Notification_Service SHALL mark the corresponding Push_Registration as invalidated and SHALL NOT send further push notifications to that Push_Token.
7. IF the push delivery provider is unreachable or returns an error, THEN THE Notification_Service SHALL retry delivery at most 3 times within the 30-second window, and SHALL complete Share delivery successfully and SHALL NOT reject the originating `POST /me/shares` request regardless of the push outcome.

### Requirement 8: Push Token Registration and Lifecycle (Phase 2)

**User Story:** As a User, I want the App to register my device for notifications, so that Share notifications can reach me on the device I use.

#### Acceptance Criteria

1. WHEN a User grants Notification_Permission on a device, THE App SHALL obtain an Expo Push_Token for that device and register it with the API as an active Push_Registration for that User within 10 seconds of Notification_Permission being granted.
2. WHEN the App obtains a Push_Token that differs from the Push_Token most recently registered for the same device, where a device is identified by a stable device installation identifier, THE App SHALL register the new Push_Token and THE API SHALL associate the new Push_Token with the User.
3. THE API SHALL associate a Push_Token with exactly one User at a time.
4. WHEN a User logs out, THE App SHALL request invalidation of the Push_Registration for the current device, and THE API SHALL mark that Push_Registration as invalidated.
5. IF the API receives a request to register a Push_Token that is already registered as active for a different User, THEN THE API SHALL reassign that Push_Token to the requesting User and mark it active for the requesting User only.
6. WHILE a Push_Registration is invalidated, THE Notification_Service SHALL exclude its Push_Token from push notification delivery.
7. IF the App cannot obtain an Expo Push_Token or the API rejects a Push_Registration request, THEN THE App SHALL retry the registration up to 3 times with no more than 60 seconds between attempts, and if all attempts fail SHALL continue to provide all in-App sharing and Inbox functionality without an active Push_Registration for that device.
8. IF the request to invalidate the Push_Registration on logout fails, THEN THE App SHALL complete the logout and clear the local session without blocking on the invalidation result.

### Requirement 9: Notification Permission and Opt-Out (Phase 2)

**User Story:** As a User, I want control over whether I receive Share notifications, so that I am not notified against my wishes.

#### Acceptance Criteria

1. WHEN a User authenticates on a device on which the App has not previously requested Notification_Permission, THE App SHALL request Notification_Permission from the operating system.
2. IF the User denies Notification_Permission, THEN THE App SHALL NOT register a Push_Token and SHALL continue to provide all in-App sharing and Inbox functionality.
3. THE App SHALL provide a Share_Notification_Preference control that displays the User's current Share_Notification_Preference value and allows the User to set it to enabled or disabled.
4. WHEN a User disables the Share_Notification_Preference, THE API SHALL persist that preference and THE Notification_Service SHALL NOT send Share push notifications to that User.
5. WHEN a User enables the Share_Notification_Preference and the User has granted Notification_Permission with at least one active Push_Registration, THE Notification_Service SHALL resume sending Share push notifications to that User.
6. IF Notification_Permission has been revoked at the operating-system level, THEN WHEN the App next becomes active, THE App SHALL display the Share_Notification_Preference control in a state indicating that Share push notifications are unavailable until Notification_Permission is re-granted, regardless of the stored Share_Notification_Preference value.
7. WHERE a User has never set the Share_Notification_Preference, THE App SHALL treat the Share_Notification_Preference as enabled by default.
8. IF the API cannot persist a change to the Share_Notification_Preference, THEN THE App SHALL retain the previously persisted preference value, SHALL NOT change the Notification_Service sending behavior, and SHALL display a message indicating that the preference change did not save.

### Requirement 10: Notification Tap Deep-Linking (Phase 2)

**User Story:** As a recipient, I want tapping a Share notification to take me to the Share, so that I can act on it immediately.

#### Acceptance Criteria

1. WHEN a recipient taps a Share push notification, whether the App was not running, in the background, or in the foreground, THE App SHALL open and navigate to the Inbox within 3 seconds of the App reaching a foreground interactive state.
2. WHEN a recipient taps a Share push notification for a Share that exists in the recipient's Inbox, THE App SHALL navigate to the destination defined in Requirement 5 for that Share's payload kind and SHALL set that Share's Read_State to `read`.
3. IF a recipient taps a Share push notification while not authenticated, THEN THE App SHALL require authentication and, after successful authentication, navigate to the Inbox.
4. IF a recipient taps a Share push notification for a Share that no longer exists in the recipient's Inbox, THEN THE App SHALL open the Inbox, display the current Inbox contents, and display a message indicating the Share is no longer available.
5. IF a tapped Share push notification does not carry a resolvable Share identifier, THEN THE App SHALL open and navigate to the Inbox and display the current Inbox contents.

### Requirement 11: Share Reactions (Phase 2)

**User Story:** As a recipient, I want to react to a Share a Friend sent me, and as a sender I want to see reactions, so that a Share becomes a two-way exchange.

#### Acceptance Criteria

1. WHEN a recipient submits a Share_Reaction to a Share that was delivered to that recipient, THE Reaction_Service SHALL persist the Share_Reaction associated with that Share and the reacting recipient.
2. THE App SHALL allow a recipient to submit only a Share_Reaction whose value belongs to the Reaction_Vocabulary, and SHALL NOT provide a free-text reaction input.
3. IF the Reaction_Service receives a Share_Reaction whose value is not in the Reaction_Vocabulary, THEN THE Reaction_Service SHALL reject the request with a validation error and SHALL NOT persist a Share_Reaction.
4. THE Reaction_Service SHALL store at most one Share_Reaction per Share per reacting recipient.
5. WHEN a recipient submits a Share_Reaction to a Share for which that recipient already has a Share_Reaction, THE Reaction_Service SHALL replace the prior Share_Reaction with the submitted Share_Reaction.
6. WHEN a recipient removes a Share_Reaction that exists for that recipient and Share, THE Reaction_Service SHALL delete that Share_Reaction.
7. WHEN the sending User views a Share the sending User sent, THE App SHALL display each Share_Reaction attached to that Share together with the reacting recipient's display name.
8. IF a recipient submits a Share_Reaction to a Share that was not delivered to that recipient, THEN THE Reaction_Service SHALL reject the request and return an authorization error.
9. WHILE reactions for a Share are being retrieved, THE App SHALL display a loading indication for that Share's reactions.
10. WHEN a Share has no reactions, THE App SHALL display an empty-state indication that no reactions exist.
11. IF reactions for a Share cannot be retrieved, THEN THE App SHALL display a message indicating the reactions are unavailable and SHALL keep the remaining Share content visible.
12. IF a Share_Reaction submission or removal fails for a reason other than an authorization error, THEN THE App SHALL display a message indicating the action did not complete, SHALL retain the Share view, and SHALL preserve the prior Share_Reaction state.

> Resolved (OQ-2): Share_Reaction is a fixed, closed set (the Reaction_Vocabulary: `like`, `love`, `been_there`, `want_to_go`). Free-text replies are not permitted, keeping reactions a lightweight acknowledgement and avoiding moderation, sanitization, and abuse surface.

### Requirement 12: Progress Comparison View (Phase 3)

**User Story:** As a User, I want to see my completion next to a Friend's on their profile, so that I can compare how far each of us has gotten.

#### Acceptance Criteria

1. WHEN a User views the Friend_Profile_View for a Friend, THE App SHALL display the viewing User's overall completion percentage alongside the Friend's overall completion percentage, each rounded to one decimal place within the range 0.0 to 100.0 inclusive, and each labeled to identify whether it belongs to the viewing User or the Friend.
2. WHEN a User views the Friend_Profile_View for a Friend, THE App SHALL display, for each Park, the viewing User's per-Park completion percentage alongside the Friend's per-Park completion percentage, each rounded to one decimal place within the range 0.0 to 100.0 inclusive, and each labeled to identify whether it belongs to the viewing User or the Friend.
3. WHEN a User views the Friend_Profile_View for a Friend, THE App SHALL display, for each Experience_Category, the viewing User's per-Experience_Category completion percentage alongside the Friend's per-Experience_Category completion percentage, each rounded to one decimal place within the range 0.0 to 100.0 inclusive, and each labeled to identify whether it belongs to the viewing User or the Friend.
4. THE App SHALL derive the Progress_Comparison from the completion data already retrieved for the viewing User and the Friend.
5. WHILE the Progress_Comparison data is loading and fewer than 30 seconds have elapsed since the retrieval began, THE Friend_Profile_View SHALL display a loading indication for the comparison.
6. IF the completion data for either the viewing User or the Friend cannot be retrieved, or has not been retrieved within 30 seconds of the retrieval beginning, THEN THE Friend_Profile_View SHALL display a message indicating the comparison is unavailable and SHALL keep the remaining profile content visible.

### Requirement 13: Completion Difference List (Phase 3)

**User Story:** As a User, I want to see which Experiences a Friend has completed that I have not, so that I get ideas for what to do next.

#### Acceptance Criteria

1. WHEN a User views the Friend_Profile_View for a Friend, THE App SHALL display a Completion_Diff listing every Experience that is present in the Friend's completed-Experience set and absent from the viewing User's completed-Experience set, compared by Experience identity.
2. THE App SHALL display each Completion_Diff entry with the Experience's name, Park, and Experience_Category.
3. WHEN a User selects a Completion_Diff entry, THE App SHALL navigate to the Experience_Detail_View for the selected Experience, presented from the Experience_Detail_View's host stack.
4. IF the Completion_Diff contains zero Experiences, THEN THE Friend_Profile_View SHALL display an empty-state indication that the viewing User has completed every Experience the Friend has completed.
5. THE App SHALL derive the Completion_Diff from the completion data already retrieved for the viewing User and the Friend.
6. WHILE the completion data required for the Completion_Diff is loading, THE Friend_Profile_View SHALL display a loading indication for the Completion_Diff.
7. IF the completion data for either the viewing User or the Friend cannot be retrieved, THEN THE Friend_Profile_View SHALL display a message indicating the Completion_Diff is unavailable and SHALL keep the remaining profile content visible.
8. IF a User selects a Completion_Diff entry whose Experience cannot be retrieved, THEN THE App SHALL keep the User on the Friend_Profile_View and display a message indicating the Experience is unavailable.

### Requirement 14: Progress Share Deep-Link to Comparison (Phase 3)

**User Story:** As a recipient of a progress Share, I want to land on the comparison view, so that a shared progress snapshot leads directly to comparing our completion.

#### Acceptance Criteria

1. WHEN a recipient selects a Progress_Share in the Inbox, THE App SHALL navigate to the Friend_Profile_View for the sending User and SHALL present the Progress_Comparison as the initially visible section of that view, selected via the navigation parameters passed to the Friend_Profile_View.
2. WHEN the App navigates from the Inbox to the Friend_Profile_View for a Progress_Share, THE App SHALL perform the navigation across navigator boundaries such that the Friend_Profile_View is presented from its host stack.
3. IF the sending User of a Progress_Share is no longer a Friend of the recipient, THEN THE App SHALL keep the recipient on the Inbox, SHALL NOT navigate to the Friend_Profile_View, and SHALL display a message indicating the sender's profile is unavailable.
4. IF the Progress_Comparison data cannot be retrieved when the App navigates to the Friend_Profile_View from a Progress_Share, THEN THE App SHALL complete the navigation to the Friend_Profile_View and display the comparison-unavailable indication defined in Requirement 12.

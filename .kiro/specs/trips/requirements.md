# Requirements Document

## Introduction

The Trips feature introduces shared, multi-person Walt Disney World visits into the Disney World Tracker application. A Trip groups a set of Friends around a named visit with a start date and an end date, gives that group a shared planned list of Experiences they want to do, a shared log of what they actually did, a per-Trip activity feed with reactions and comments, and a summary/highlights view of the group's accomplishments.

The standout mechanic is the "rode with" tag on a logged Completion. When a Trip Member logs an Experience they completed during a Trip, they may tag other Trip Members they rode with. Tagging never silently writes to another User's data: each tagged Member receives a notification and must confirm the tag. On confirmation, the completion trickles down into the tagged Member's real, canonical Tracking data, and the Member is offered the chance to add or update their one canonical Rating for that Experience. There is exactly one canonical Rating per User per Experience; a Trip references that Rating rather than storing a frozen copy, so a Rating edited through a Trip updates everywhere it appears (catalog, personal stats, aggregate ratings, and leaderboard).

This feature builds on and reuses existing systems rather than duplicating them: the Auth_Service (accounts and Profiles), the Friends_Service (accepted friendships and the friend-request accept/decline pattern), the Tracking_Service (canonical Completions, Ratings, and Notes), the Catalog (Experiences, Parks, Lands, Resorts), the Stats_Service (personal statistics, currently being reworked by the in-flight stats-experience-redesign spec), the Reactions_Service (reactions), and the Notification_Service and Push_Service (fire-and-forget push with deep-link on tap).

Trips also adds a new top-level Trips tab to the App's bottom navigation. Because the navigation bar currently holds five tabs (Home, Catalog, Stats, Friends, Profile), the Stats tab relocates to live under Profile so that Trips can occupy a top-level slot, producing the tab set Home, Catalog, Trips, Friends, Profile. This navigation change deliberately intersects with the in-flight stats-experience-redesign work and is called out explicitly in Requirement 17.

The following capabilities are explicitly out of scope for v1 and are noted as future work: real-time group chat within a Trip, and a full trip-to-trip comparison view. The summary/highlights data model defined in this document is required to leave room for a future trip-to-trip comparison.

## Glossary

- **App**: The Disney World Tracker mobile application (React Native / Expo) as a whole.
- **User**: An authenticated account holder of the App.
- **Profile**: The public-facing account information for a User, including display name and avatar preset.
- **Friend**: A User who has an accepted, mutual relationship with another User via the Friends_Service.
- **Friends_Service**: The existing component responsible for managing friend requests and canonical friendship pairs between Users.
- **Friendship**: An accepted, mutual relationship between two Users as recorded by the Friends_Service.
- **Auth_Service**: The existing component responsible for User accounts, sessions, and Profiles.
- **Catalog**: The existing component that defines Experiences, Parks, Lands, and Resorts.
- **Experience**: An individual catalog item at Walt Disney World, such as a ride, show, restaurant, parade, character meet-and-greet, or other activity, identified by a stable internal identifier.
- **Tracking_Service**: The existing component that records and serves per-User Completions, Ratings, and Notes for Experiences.
- **Completion**: A canonical record in the Tracking_Service indicating that a User has completed a specific Experience, including a Completion date.
- **Rating**: The single canonical whole-number score from 1 to 10 inclusive that a User has assigned to an Experience in the Tracking_Service. There is exactly one canonical Rating per User per Experience.
- **Note**: A free-form text entry a User has recorded for an Experience in the Tracking_Service.
- **Stats_Service**: The existing component that computes personal completion statistics for a User; currently being reworked by the stats-experience-redesign spec.
- **Aggregate_Rating**: The existing aggregate rating and leaderboard component that derives community rankings from canonical Ratings.
- **Reactions_Service**: The existing component responsible for persisting and serving reactions to shared items.
- **Notification_Service**: The existing component responsible for creating in-App notifications and dispatching push notifications.
- **Push_Service**: The existing component that delivers fire-and-forget push notifications to a User's registered devices and carries a deep-link target that the App opens when the notification is tapped.
- **Trip**: A named shared Walt Disney World visit with a start date, an end date, a description, a set of Trip_Members, a Planned_List, a Shared_Log, a Trip_Feed, and a Trip_Summary.
- **Trip_Service**: The component introduced by this feature that owns Trips, Trip_Memberships, Trip_Invites, Planned_Items, Trip_Log_Entries, Rode_With_Tags, and Trip_Feed entries, and that enforces Trip authorization.
- **Trip_Name**: The human-readable name of a Trip, a text value from 1 to 100 characters inclusive after trimming leading and trailing whitespace.
- **Trip_Description**: Optional free-form text describing a Trip, up to 2000 characters.
- **Trip_Start_Date**: The local calendar start date of a Trip.
- **Trip_End_Date**: The local calendar end date of a Trip, on or after the Trip_Start_Date.
- **Trip_Status**: A derived value of `upcoming`, `active`, or `past`, computed from the Trip_Start_Date, the Trip_End_Date, and the WDW_Current_Date; it is never stored as an independent editable field.
- **WDW_Current_Date**: The current calendar date in the Walt Disney World local time zone (United States Eastern Time), used as the anchor for deriving Trip_Status so that status transitions align with the local calendar dates that define a Trip.
- **Trip_Identifier**: The unique, stable identifier assigned to a Trip by the Trip_Service at creation.
- **Trip_Member**: A User who has joined a Trip and holds a Trip_Role on that Trip.
- **Trip_Role**: The role a Trip_Member holds on a Trip, either `organizer` or `member`.
- **Organizer**: A Trip_Member whose Trip_Role is `organizer`.
- **Member**: A Trip_Member whose Trip_Role is `member`.
- **Trip_Creator**: The User who created a Trip; the Trip_Creator is added as the first Organizer at creation.
- **Last_Organizer_Rule**: The invariant that a Trip must always have at least one Organizer.
- **Trip_Invite**: An invitation from an Organizer to a Friend to join a Trip, with a state of `pending`, `accepted`, or `declined`.
- **Planned_List**: The shared list of Experiences that Trip_Members want to do on a Trip.
- **Planned_Item**: One entry in a Planned_List referencing one Experience, recorded by the Trip_Member who added it.
- **Shared_Log**: The collection of Trip_Log_Entries recorded against a Trip. It is a data concept presented to Trip_Members within the Trip_Activity surface rather than as a separate view.
- **Trip_Log_Entry**: A record that a Trip_Member completed an Experience in the context of a Trip, referencing the logging Member's canonical Completion for that Experience and carrying zero or more Rode_With_Tags.
- **Rode_With_Tag**: A tag on a Trip_Log_Entry naming another Trip_Member the logging Member rode with, with a state of `pending`, `confirmed`, or `declined`.
- **Tagging_Member**: The Trip_Member who created a Trip_Log_Entry and its Rode_With_Tags.
- **Tagged_Member**: The Trip_Member named by a Rode_With_Tag.
- **Trickle_Down**: The process by which a confirmed Rode_With_Tag results in a canonical Completion for the Tagged_Member in the Tracking_Service and links that Completion to the Trip.
- **Trip_Feed**: The reverse-chronological activity feed of a Trip, composed of Trip_Feed_Items.
- **Trip_Feed_Item**: One event in a Trip_Feed, such as a Member joining, an Invite being accepted, a Completion being logged, or a Rating being recorded or updated.
- **Trip_Reaction**: A reaction of a supported reaction type attached by a Trip_Member to a Trip_Feed_Item or Trip_Log_Entry via the Reactions_Service; a Trip_Member holds at most one Trip_Reaction of a given reaction type per target item.
- **Trip_Comment**: A free-form text comment attached by a Trip_Member to a Trip_Feed_Item or Trip_Log_Entry; comments are not real-time chat.
- **Trip_Summary**: A derived view over a Trip presenting group counts, top-rated moments, and per-Member contributions.
- **Trip_Activity**: The single Trip_Detail_View surface that combines the Trip_Feed activity stream with the control to log a Completion; it is where Trip_Members log Completions and follow, react to, and comment on Trip activity, and where the Shared_Log's Trip_Log_Entries are presented.
- **Trips_List_Screen**: The App screen that lists the viewing User's Trips grouped by Trip_Status.
- **Trip_Detail_View**: The App screen that presents a single Trip as a hub containing the Planned_List, Trip_Activity, Trip_Members, and Trip_Summary.
- **Active_Trip_Shortcut**: A control surfaced outside the Trips tab that opens the Trip_Detail_View for a Trip whose Trip_Status is `active`.
- **Trip_Member_Rule**: The authorization rule that grants a requesting User read or action access to a Trip only when the requesting User is a Trip_Member of that Trip.

## Requirements

### Requirement 1: Create a Trip

**User Story:** As a User, I want to create a Trip with a name and dates, so that I can organize a shared Walt Disney World visit with my friends.

#### Acceptance Criteria

1. WHEN a User submits a Trip creation request with a Trip_Name, a Trip_Start_Date, and a Trip_End_Date, THE Trip_Service SHALL create a Trip owned by that User, add the User as a Trip_Member with the Trip_Role `organizer`, and return the created Trip including its unique Trip_Identifier.
2. WHEN a User submits a Trip creation request that includes a Trip_Description, THE Trip_Service SHALL store the Trip_Description with the Trip.
3. WHEN the Trip_Service creates a Trip, THE Trip_Service SHALL store the Trip_Name trimmed of leading and trailing whitespace.
4. IF a Trip creation request omits the Trip_Name, the Trip_Start_Date, or the Trip_End_Date, THEN THE Trip_Service SHALL reject the request with a validation error identifying the missing required field and SHALL NOT create a Trip.
5. IF a Trip creation request has a Trip_Name that is empty after trimming leading and trailing whitespace or longer than 100 characters, THEN THE Trip_Service SHALL reject the request with a validation error identifying the Trip_Name constraint and SHALL NOT create a Trip.
6. IF a Trip creation request has a Trip_Description longer than 2000 characters, THEN THE Trip_Service SHALL reject the request with a validation error identifying the Trip_Description constraint and SHALL NOT create a Trip.
7. IF a Trip creation request has a Trip_Start_Date or a Trip_End_Date that is not a valid calendar date, THEN THE Trip_Service SHALL reject the request with a validation error identifying the invalid date and SHALL NOT create a Trip.
8. IF a Trip creation request has a Trip_End_Date that is earlier than the Trip_Start_Date, THEN THE Trip_Service SHALL reject the request with a validation error identifying the end-before-start constraint and SHALL NOT create a Trip.
9. WHEN the Trip_Service creates a Trip, THE Trip_Service SHALL record the Trip_Creator as the User who submitted the creation request.
10. WHEN the Trip_Service creates a Trip, THE Trip_Service SHALL add a Trip_Feed_Item recording that the Trip_Creator created the Trip.

### Requirement 2: Derived Trip Status

**User Story:** As a Trip_Member, I want a Trip's status to reflect its dates automatically, so that I can tell whether a Trip is upcoming, happening now, or finished without maintaining it by hand.

#### Acceptance Criteria

1. WHILE the WDW_Current_Date is earlier than the Trip_Start_Date, THE Trip_Service SHALL report the Trip_Status as `upcoming`.
2. WHILE the WDW_Current_Date is on or after the Trip_Start_Date and on or before the Trip_End_Date, THE Trip_Service SHALL report the Trip_Status as `active`.
3. WHILE the Trip_Start_Date equals the Trip_End_Date and the WDW_Current_Date equals that date, THE Trip_Service SHALL report the Trip_Status as `active`.
4. WHILE the WDW_Current_Date is later than the Trip_End_Date, THE Trip_Service SHALL report the Trip_Status as `past`.
5. THE Trip_Service SHALL derive the Trip_Status solely from the Trip_Start_Date, the Trip_End_Date, and the WDW_Current_Date, and SHALL NOT expose the Trip_Status as an independently editable field.
6. WHEN an Organizer changes the Trip_Start_Date or the Trip_End_Date, THE Trip_Service SHALL derive the Trip_Status from the updated dates on the next report of the Trip_Status.

### Requirement 3: Edit and Delete a Trip

**User Story:** As an Organizer, I want to edit a Trip's settings and delete the Trip, so that I can keep the Trip accurate and remove it when it is no longer needed.

#### Acceptance Criteria

1. WHEN an Organizer submits a change to the Trip_Name, the Trip_Description, the Trip_Start_Date, or the Trip_End_Date of a Trip, THE Trip_Service SHALL apply the change to that Trip such that a subsequent read of the Trip returns the updated value, and SHALL leave every field that was not part of the change unchanged.
2. WHEN an Organizer submits a change to the Trip_Name of a Trip, THE Trip_Service SHALL store the Trip_Name trimmed of leading and trailing whitespace.
3. IF a User who is not an Organizer of a Trip submits a change to that Trip's Trip_Name, Trip_Description, Trip_Start_Date, or Trip_End_Date, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL NOT change any field of the Trip.
4. IF an edit to a Trip would set the Trip_Name to a value that is empty after trimming or longer than 100 characters, THEN THE Trip_Service SHALL reject the edit with a validation error and SHALL NOT change any field of the Trip.
5. IF an edit to a Trip would set the Trip_Description to a value longer than 2000 characters, THEN THE Trip_Service SHALL reject the edit with a validation error and SHALL NOT change any field of the Trip.
6. IF an edit to a Trip would result in a Trip_End_Date earlier than the Trip_Start_Date, THEN THE Trip_Service SHALL reject the edit with a validation error and SHALL NOT change any field of the Trip.
7. WHEN an Organizer submits a request to delete a Trip, THE Trip_Service SHALL permanently delete the Trip together with its Trip_Memberships, Trip_Invites, Planned_Items, Trip_Log_Entries, Rode_With_Tags, Trip_Feed_Items, Trip_Reactions, and Trip_Comments such that a subsequent read of the Trip returns a not-found error.
8. IF a User who is not an Organizer of a Trip submits a request to delete that Trip, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL preserve the Trip together with its associated entities.
9. IF a User submits a request to edit or delete a Trip that does not exist or has already been deleted, THEN THE Trip_Service SHALL reject the request with a not-found error and SHALL NOT change any Trip data.
10. WHEN the Trip_Service deletes a Trip, THE Trip_Service SHALL preserve every Trip_Member's canonical Completions, Ratings, and Notes in the Tracking_Service.

### Requirement 4: Trip Roles and Permissions

**User Story:** As a Trip_Member, I want organizers and members to have clearly defined permissions, so that the right people can manage the Trip while everyone can contribute.

#### Acceptance Criteria

1. THE Trip_Service SHALL assign each Trip_Member exactly one Trip_Role, either `organizer` or `member`.
2. WHERE a Trip_Member holds the Trip_Role `organizer`, THE Trip_Service SHALL permit that Trip_Member to edit Trip settings, send Trip_Invites, cancel pending Trip_Invites, remove Trip_Members, promote a Member to Organizer, demote an Organizer to Member, and delete the Trip.
3. WHERE a Trip_Member holds the Trip_Role `member`, THE Trip_Service SHALL permit that Trip_Member to add Planned_Items, create Trip_Log_Entries, add Rode_With_Tags, add Trip_Comments, add Trip_Reactions, and leave the Trip.
4. WHERE a Trip_Member holds the Trip_Role `organizer`, THE Trip_Service SHALL permit that Trip_Member to perform every action available to a Member in addition to the Organizer actions.
5. WHEN an Organizer promotes another Trip_Member who currently holds the Trip_Role `member` on the same Trip, THE Trip_Service SHALL set that Trip_Member's Trip_Role to `organizer`.
6. WHEN an Organizer demotes a Trip_Member who currently holds the Trip_Role `organizer` on the same Trip, THE Trip_Service SHALL set that Trip_Member's Trip_Role to `member`, subject to the Last_Organizer_Rule.
7. IF a Trip_Member who holds the Trip_Role `member` submits a request to edit Trip settings, send a Trip_Invite, cancel a pending Trip_Invite, remove a Trip_Member, promote a Member to Organizer, demote an Organizer to Member, or delete the Trip, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL NOT perform the requested action.
8. IF an Organizer submits a promotion request naming a Trip_Member who already holds the Trip_Role `organizer`, or a demotion request naming a Trip_Member who already holds the Trip_Role `member`, THEN THE Trip_Service SHALL reject the request with a validation error and SHALL NOT change any Trip_Role.

### Requirement 5: Last Organizer Guardrail

**User Story:** As a Trip_Member, I want a Trip to always have at least one organizer, so that the Trip never becomes unmanageable.

#### Acceptance Criteria

1. THE Trip_Service SHALL ensure that every Trip that has at least one Trip_Member has at least one Organizer.
2. IF an Organizer requests to demote themselves to Member and that Organizer is the only Organizer of the Trip, THEN THE Trip_Service SHALL reject the request with a Last_Organizer_Rule error and SHALL leave that Trip_Member's Trip_Role as `organizer`.
3. IF an Organizer requests to leave a Trip and that Organizer is the only Organizer of the Trip while one or more other Trip_Members remain, THEN THE Trip_Service SHALL reject the request with a Last_Organizer_Rule error and SHALL keep that Organizer as a Trip_Member with the Trip_Role `organizer`.
4. IF an Organizer requests to remove another Organizer and doing so would leave the Trip with zero Organizers while one or more Trip_Members remain, THEN THE Trip_Service SHALL reject the request with a Last_Organizer_Rule error and SHALL leave the target Organizer as a Trip_Member with the Trip_Role `organizer`.
5. WHILE a Trip has two or more Organizers, THE Trip_Service SHALL permit any Organizer of that Trip to demote themselves to Member, to be removed from the Trip, or to leave the Trip without a Last_Organizer_Rule error.
6. WHERE an Organizer is the only Trip_Member of a Trip, THE Trip_Service SHALL permit that Organizer to leave the Trip without a Last_Organizer_Rule error.
7. WHEN the only Trip_Member of a Trip leaves the Trip, THE Trip_Service SHALL delete the Trip together with its Trip_Memberships, Trip_Invites, Planned_Items, Trip_Log_Entries, Rode_With_Tags, Trip_Feed_Items, Trip_Reactions, and Trip_Comments, and SHALL preserve that former Trip_Member's canonical Completions, Ratings, and Notes in the Tracking_Service.

### Requirement 6: Invite Friends to a Trip

**User Story:** As an Organizer, I want to invite my friends to a Trip, so that the people I visit Disney World with can participate.

#### Acceptance Criteria

1. WHEN an Organizer sends a Trip_Invite to a User who is a Friend of the Organizer and is not already a Trip_Member or holder of a `pending` Trip_Invite for that Trip, THE Trip_Service SHALL create a Trip_Invite in the `pending` state for that User.
2. IF an Organizer sends a Trip_Invite to a User who is not a Friend of the Organizer, THEN THE Trip_Service SHALL reject the request with a validation error indicating the target User is not a Friend and SHALL NOT create a Trip_Invite.
3. IF a User who is not an Organizer of a Trip sends a Trip_Invite for that Trip, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL NOT create a Trip_Invite.
4. IF an Organizer sends a Trip_Invite to a User who is already a Trip_Member of that Trip, THEN THE Trip_Service SHALL reject the request with a validation error indicating the target User is already a Trip_Member and SHALL NOT create a Trip_Invite and SHALL NOT create a duplicate Trip_Membership.
5. IF an Organizer sends a Trip_Invite to a User who already holds a `pending` Trip_Invite for that Trip, THEN THE Trip_Service SHALL reject the request with a validation error indicating a `pending` Trip_Invite already exists and SHALL NOT create a second `pending` Trip_Invite.
6. WHEN the Trip_Service creates a Trip_Invite, THE Notification_Service SHALL create an in-App notification addressed to the invited User indicating that the Organizer invited them to the Trip.
7. WHEN the Trip_Service creates a Trip_Invite, THE Push_Service SHALL send a push notification to the invited User whose deep-link target opens the created Trip_Invite for that Trip.
8. WHEN an Organizer cancels a `pending` Trip_Invite, THE Trip_Service SHALL transition that Trip_Invite out of the `pending` state to a terminal state, SHALL cause any subsequent attempt by the invited User to accept that Trip_Invite to be rejected, and SHALL permit an Organizer to send a new Trip_Invite to that User for the Trip.
9. IF a User who is not an Organizer of a Trip attempts to cancel a `pending` Trip_Invite for that Trip, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL leave the Trip_Invite in the `pending` state.

### Requirement 7: Accept or Decline a Trip Invite

**User Story:** As an invited User, I want to accept or decline a Trip invitation, so that I control which Trips I join.

#### Acceptance Criteria

1. WHEN a User accepts a Trip_Invite addressed to that User in the `pending` state and that User is not already a Trip_Member of the Trip, THE Trip_Service SHALL set the Trip_Invite to `accepted` and add the User as a Trip_Member with the Trip_Role `member`.
2. IF a User accepts a Trip_Invite addressed to that User while the User is already a Trip_Member of the Trip, THEN THE Trip_Service SHALL NOT create a duplicate Trip_Membership.
3. WHEN a User declines a Trip_Invite addressed to that User in the `pending` state, THE Trip_Service SHALL set the Trip_Invite to `declined` and SHALL NOT add the User as a Trip_Member.
4. IF a User attempts to accept or decline a Trip_Invite that is not addressed to that User, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL NOT change the Trip_Invite.
5. IF a User attempts to accept or decline a Trip_Invite that is not in the `pending` state, THEN THE Trip_Service SHALL reject the request with a validation error and SHALL NOT change the Trip_Invite.
6. WHEN a User accepts a Trip_Invite, THE Trip_Service SHALL add a Trip_Feed_Item recording that the User joined the Trip.
7. WHILE a Trip_Invite is in the `pending` state, WHEN the App opens the deep-link target of that Trip_Invite for the authenticated invited User, THE App SHALL present the Trip_Invite with controls to accept or decline it.
8. IF the App opens the deep-link target of a Trip_Invite while no User is authenticated, THEN THE App SHALL prompt for authentication and, upon successful authentication of the invited User within the same App session, open the Trip_Invite.
9. WHEN the App opens the deep-link target of a Trip_Invite that is not in the `pending` state, THE App SHALL display an indication that the Trip_Invite is no longer available and SHALL hide the accept and decline controls.

### Requirement 8: Membership Management and Leaving

**User Story:** As a Trip_Member, I want to leave a Trip, and as an Organizer I want to remove members, so that Trip membership stays accurate.

#### Acceptance Criteria

1. WHEN a Trip_Member who is not restricted by the Last_Organizer_Rule requests to leave a Trip, THE Trip_Service SHALL remove that Trip_Member's Trip_Membership from the Trip.
2. WHEN an Organizer removes a Trip_Member who is not restricted by the Last_Organizer_Rule, THE Trip_Service SHALL remove that Trip_Member's Trip_Membership from the Trip.
3. IF a User who is not an Organizer of a Trip requests to remove a Trip_Member other than themselves, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL NOT remove any Trip_Membership.
4. WHEN a Trip_Member leaves or is removed from a Trip, THE Trip_Service SHALL preserve that former Trip_Member's canonical Completions, Ratings, and Notes in the Tracking_Service.
5. WHEN a Trip_Member leaves or is removed from a Trip, THE Trip_Service SHALL retain the Trip_Log_Entries and confirmed Rode_With_Tags that former Trip_Member contributed to the Trip.
6. WHEN a Trip_Member leaves or is removed from a Trip, THE Trip_Service SHALL cancel every pending Rode_With_Tag that the former Trip_Member created as Tagging_Member on that Trip such that those Rode_With_Tags can no longer be confirmed.
7. WHEN a Trip_Member leaves or is removed from a Trip, THE Trip_Service SHALL cancel every pending Rode_With_Tag on that Trip that names the former Trip_Member as Tagged_Member such that those Rode_With_Tags can no longer be confirmed.
8. IF a User who is not a Trip_Member of a Trip requests to leave that Trip, THEN THE Trip_Service SHALL reject the request with a validation error and SHALL NOT change any Trip_Membership.
9. IF an Organizer requests to remove a User who is not a Trip_Member of that Trip, THEN THE Trip_Service SHALL reject the request with a validation error and SHALL NOT remove any Trip_Membership.

### Requirement 9: Shared Planned List

**User Story:** As a Trip_Member, I want to add Experiences to a shared planned list, so that the group can agree on what we want to do.

#### Acceptance Criteria

1. WHEN a Trip_Member adds an Experience to the Planned_List of a Trip, THE Trip_Service SHALL create a Planned_Item referencing that Experience and recording the Trip_Member who added it.
2. IF a User who is not a Trip_Member of a Trip attempts to add a Planned_Item to that Trip, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL NOT create a Planned_Item.
3. IF a Trip_Member adds an Experience to the Planned_List that references an Experience already present in that Trip's Planned_List, THEN THE Trip_Service SHALL reject the request with a validation error and SHALL NOT create a duplicate Planned_Item.
4. IF a Trip_Member adds a Planned_Item referencing an Experience that does not exist in the Catalog, THEN THE Trip_Service SHALL reject the request with a validation error and SHALL NOT create a Planned_Item.
5. IF a Trip_Member adds a Planned_Item to a Planned_List that already contains 500 Planned_Items, THEN THE Trip_Service SHALL reject the request with a validation error and SHALL NOT create a Planned_Item.
6. WHEN a Trip_Member removes a Planned_Item that Trip_Member added, THE Trip_Service SHALL remove that Planned_Item from the Planned_List.
7. WHEN an Organizer removes any Planned_Item, THE Trip_Service SHALL remove that Planned_Item from the Planned_List.
8. IF a Trip_Member who holds the Trip_Role `member` attempts to remove a Planned_Item that Trip_Member did not add, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL NOT remove the Planned_Item.
9. WHEN the Trip_Detail_View displays the Planned_List, THE App SHALL display each Planned_Item's referenced Experience name, the Park of the referenced Experience, and the display name of the Trip_Member who added it.

### Requirement 10: Log a Completion During a Trip with Rode-With Tags

**User Story:** As a Trip_Member, I want to log an Experience I completed during a Trip and tag the members I rode with, so that our shared log reflects who was there.

#### Acceptance Criteria

1. WHEN a Trip_Member logs a Completion of an Experience against a Trip and no canonical Completion exists for the logging Member and that Experience, THE Trip_Service SHALL create the logging Member's canonical Completion in the Tracking_Service and create a Trip_Log_Entry that references that canonical Completion and links it to the Trip.
2. WHEN a Trip_Member logs a Completion of an Experience against a Trip and a canonical Completion already exists for the logging Member and that Experience, THE Trip_Service SHALL create a Trip_Log_Entry that references the existing canonical Completion and links it to the Trip, and SHALL NOT create a duplicate canonical Completion.
3. WHEN a Trip_Member logs a Completion against a Trip and tags one or more other Trip_Members as rode with, THE Trip_Service SHALL create at most one Rode_With_Tag in the `pending` state for each distinct tagged Trip_Member.
4. IF a Trip_Member creates a Rode_With_Tag naming a User who is not a Trip_Member of that Trip, THEN THE Trip_Service SHALL reject that Rode_With_Tag with a validation error and SHALL NOT create the Rode_With_Tag.
5. IF a Trip_Member creates a Rode_With_Tag naming themselves, THEN THE Trip_Service SHALL reject that Rode_With_Tag with a validation error and SHALL NOT create the Rode_With_Tag.
6. IF a Trip_Member creates a Trip_Log_Entry with more than one Rode_With_Tag naming the same Tagged_Member, THEN THE Trip_Service SHALL reject the request with a validation error and SHALL NOT create the duplicate Rode_With_Tag.
7. IF a User who is not a Trip_Member of a Trip attempts to create a Trip_Log_Entry for that Trip, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL NOT create a Trip_Log_Entry.
8. WHEN the Trip_Service creates a Rode_With_Tag, THE Notification_Service SHALL create a notification to the Tagged_Member and THE Push_Service SHALL send a push notification whose deep-link target opens the Rode_With_Tag confirmation for the Tagged_Member.
9. WHEN the Trip_Service creates a Trip_Log_Entry, THE Trip_Service SHALL add a Trip_Feed_Item recording that the logging Member completed the referenced Experience.
10. WHEN a Trip_Member logs a Completion against a Trip and includes a Rating for the referenced Experience that is a whole number from 1 to 10 inclusive, THE Trip_Service SHALL apply that Rating as the logging Member's single canonical Rating in the Tracking_Service.

### Requirement 11: Confirmable Trickle-Down of Rode-With Tags

**User Story:** As a Tagged_Member, I want to confirm before a rode-with tag writes to my data, so that nothing is recorded on my behalf without my consent.

#### Acceptance Criteria

1. THE Trip_Service SHALL NOT create, modify, or link any Completion, Rating, or Note for a Tagged_Member from a Rode_With_Tag while that Rode_With_Tag is in the `pending` state.
2. WHEN a Tagged_Member confirms a Rode_With_Tag that is in the `pending` state and the Tagged_Member has no canonical Completion for the referenced Experience, THE Trip_Service SHALL create a canonical Completion for the Tagged_Member in the Tracking_Service and link that Completion to the Trip.
3. WHEN a Tagged_Member confirms a Rode_With_Tag that is in the `pending` state and the Tagged_Member already has a canonical Completion for the referenced Experience, THE Trip_Service SHALL link the existing canonical Completion to the Trip and SHALL NOT alter the Tagged_Member's existing Rating.
4. WHEN a Tagged_Member confirms a Rode_With_Tag that is in the `pending` state for an Experience for which the Tagged_Member has no canonical Rating, THE Trip_Service SHALL offer the Tagged_Member the option to record a canonical Rating and, WHERE the Tagged_Member provides one, SHALL apply it as the Tagged_Member's single canonical Rating in the Tracking_Service.
5. WHEN a Tagged_Member confirms a Rode_With_Tag that is in the `pending` state for an Experience for which the Tagged_Member already has a canonical Rating, THE Trip_Service SHALL offer the Tagged_Member the option to update that Rating pre-filled with the current canonical Rating value, and IF the Tagged_Member skips the update, THEN THE Trip_Service SHALL leave the existing canonical Rating unchanged.
6. WHEN a Tagged_Member declines a Rode_With_Tag that is in the `pending` state, THE Trip_Service SHALL set the Rode_With_Tag to `declined` and SHALL NOT create, modify, or link any Completion, Rating, or Note for that Tagged_Member.
7. IF a User who is not the Tagged_Member named by a Rode_With_Tag attempts to confirm or decline that Rode_With_Tag, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL NOT change the Rode_With_Tag.
8. IF the Tagged_Member named by a Rode_With_Tag attempts to confirm or decline that Rode_With_Tag while it is in the `confirmed` or `declined` state, THEN THE Trip_Service SHALL reject the request with a conflict validation error and SHALL NOT change the Rode_With_Tag or any associated Completion, Rating, or Note.
9. IF a Tagged_Member supplies a Rating value that is missing, non-numeric, or not a whole number from 1 to 10 inclusive while confirming a Rode_With_Tag, THEN THE Trip_Service SHALL reject the Rating with a validation error and SHALL leave the Tagged_Member's existing canonical Rating unchanged.
10. WHEN a Tagged_Member confirms a Rode_With_Tag that is in the `pending` state, THE Trip_Service SHALL set the Rode_With_Tag to `confirmed` and SHALL NOT add a Trip_Feed_Item for the confirmation, because the originating `completion_logged` Trip_Feed_Item already records that the tagged Members rode the referenced Experience together.

### Requirement 12: Single Canonical Rating Referenced by Trips

**User Story:** As a User, I want each Experience to have one rating that stays consistent everywhere, so that rating an Experience through a Trip updates my catalog, stats, and leaderboard standing too.

#### Acceptance Criteria

1. THE Trip_Service SHALL reference a Trip_Member's canonical Rating for an Experience from the Tracking_Service and SHALL NOT store a Trip-local copy of that Rating.
2. WHEN a Trip_Member records or updates a Rating for an Experience through a Trip, THE Tracking_Service SHALL persist that value as the Trip_Member's single canonical Rating for that Experience.
3. WHEN a canonical Rating is recorded or updated through a Trip, THE Stats_Service, the Catalog Experience view, and the Aggregate_Rating SHALL reflect the updated canonical Rating within 60 seconds of the Rating being persisted.
4. WHEN the Trip_Detail_View displays a Rating within the Trip_Activity feed or Trip_Summary for a Trip_Member who has a canonical Rating for the referenced Experience, THE App SHALL display the current canonical Rating from the Tracking_Service as a whole number from 1 to 10 inclusive.
5. IF a Rating recorded or updated through a Trip is missing, non-numeric, or not a whole number from 1 to 10 inclusive, THEN THE Trip_Service SHALL reject the request with a validation error and SHALL NOT change the canonical Rating.
6. WHEN a confirmed Trip_Log_Entry or a confirmed Rode_With_Tag results in a canonical Completion, THE Stats_Service SHALL count that Completion toward the Trip_Member's personal statistics and THE Aggregate_Rating SHALL include the Trip_Member's canonical Rating for the referenced Experience in the same manner as a Completion recorded outside a Trip.
7. IF a User who is not a Trip_Member of a Trip attempts to record or update a Rating through that Trip, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL NOT change any canonical Rating.
8. WHEN the Trip_Detail_View displays the Trip_Activity feed or Trip_Summary for a Trip_Member who has no canonical Rating for a referenced Experience, THE App SHALL display an unrated indicator rather than a Rating value.

### Requirement 13: Trip Activity Feed, Reactions, and Comments

**User Story:** As a Trip_Member, I want a shared activity feed with reactions and comments, so that the group can follow and respond to what everyone is doing.

#### Acceptance Criteria

1. THE Trip_Service SHALL maintain a Trip_Feed for each Trip composed of Trip_Feed_Items for Trip_Members joining, Trip_Invites being accepted, Trip_Log_Entries being created, and canonical Ratings being recorded or updated through the Trip.
2. WHEN an event that originates a Trip_Feed_Item occurs, THE Trip_Service SHALL create the corresponding Trip_Feed_Item within 5 seconds of that event.
3. WHEN the Trip_Detail_View displays the Trip_Feed, THE App SHALL display the Trip_Feed_Items in reverse-chronological order by creation timestamp, breaking ties between Trip_Feed_Items with identical timestamps by descending Trip_Feed_Item identifier so that the order is deterministic.
4. WHEN a Trip_Member adds a Trip_Reaction of a given reaction type to a Trip_Feed_Item or a Trip_Log_Entry for which that Trip_Member has no existing Trip_Reaction of that type, THE Reactions_Service SHALL persist that Trip_Reaction associated with the Trip_Member and the target item.
5. WHEN a Trip_Member adds a Trip_Reaction of a reaction type that the Trip_Member has already applied to the same target item, THE Reactions_Service SHALL retain the single existing Trip_Reaction and SHALL NOT persist a duplicate Trip_Reaction.
6. IF a Trip_Member adds a Trip_Reaction whose reaction type is not a supported reaction type, THEN THE Trip_Service SHALL reject the request with a validation error and SHALL NOT persist the Trip_Reaction.
7. WHEN a Trip_Member removes a Trip_Reaction that Trip_Member added, THE Reactions_Service SHALL remove that Trip_Reaction.
8. WHEN a Trip_Member adds a Trip_Comment to a Trip_Feed_Item or a Trip_Log_Entry, THE Trip_Service SHALL persist that Trip_Comment associated with the Trip_Member and the target item.
9. IF a Trip_Comment exceeds 2000 characters or is empty after trimming leading and trailing whitespace, THEN THE Trip_Service SHALL reject the request with a validation error indicating the Trip_Comment length constraint and SHALL NOT persist the Trip_Comment.
10. IF a User who is not a Trip_Member of a Trip attempts to add a Trip_Reaction or a Trip_Comment to that Trip's Trip_Feed_Item or Trip_Log_Entry, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL NOT persist the Trip_Reaction or Trip_Comment.
11. WHEN a Trip_Member removes a Trip_Comment they authored, THE Trip_Service SHALL remove that Trip_Comment.
12. IF a Trip_Member attempts to remove a Trip_Comment they did not author, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL retain the Trip_Comment.

### Requirement 14: Trip Summary and Highlights

**User Story:** As a Trip_Member, I want a summary of what the group accomplished on a Trip, so that we can look back on the visit and compare contributions.

#### Acceptance Criteria

1. WHEN the Trip_Detail_View displays the Trip_Summary, THE App SHALL display the count of distinct Experiences the Trip_Members completed in the context of the Trip as a non-negative integer that counts each such Experience at most once and that is 0 when no Experiences were completed in the context of the Trip.
2. WHEN the Trip_Detail_View displays the Trip_Summary and one or more Experiences completed in the context of the Trip have at least one referenced canonical Rating, THE App SHALL display at most 5 top-rated Experiences ranked by descending mean of the referenced canonical Ratings of the Trip_Members, breaking ties by descending count of referenced canonical Ratings and then by ascending Experience name.
3. WHEN the Trip_Detail_View displays the Trip_Summary and no Experience completed in the context of the Trip has a referenced canonical Rating, THE App SHALL display an empty-state indication that no rated Experiences exist for the Trip.
4. WHEN the Trip_Detail_View displays the Trip_Summary, THE App SHALL display, for each Trip_Member, the count of Trip_Log_Entries that Trip_Member created for the Trip as a non-negative integer that is 0 when that Trip_Member created no Trip_Log_Entries.
5. WHEN the Trip_Detail_View displays the Trip_Summary, THE App SHALL display, for each Trip_Member, the count of confirmed Rode_With_Tags that Trip_Member contributed to the Trip as a non-negative integer that is 0 when that Trip_Member contributed no confirmed Rode_With_Tags.
6. THE Trip_Service SHALL derive the Trip_Summary from Trip_Log_Entries, confirmed Rode_With_Tags, and referenced canonical Ratings, and SHALL NOT store precomputed Trip_Summary values as an independent editable field.
7. THE Trip_Summary data model SHALL expose per-Trip aggregate counts and per-Member contribution counts in a form that supports a future trip-to-trip comparison across two or more Trips.
8. IF a User who is not a Trip_Member of a Trip requests that Trip's Trip_Summary, THEN THE Trip_Service SHALL reject the request with an authorization error and SHALL withhold the Trip_Summary.

### Requirement 15: Trip Authorization and Visibility

**User Story:** As a Trip_Member, I want Trip data limited to the Trip's members, so that a Trip's plans and log stay private to the people on the Trip.

#### Acceptance Criteria

1. WHILE a User has a valid, authenticated session, WHEN that User requests a Trip's detail, Planned_List, Shared_Log, Trip_Feed, Trip_Members, or Trip_Summary and the requesting User is a Trip_Member of that Trip, THE Trip_Service SHALL authorize the request and return the requested data scoped to that Trip only.
2. IF a User requests a Trip's detail, Planned_List, Shared_Log, Trip_Feed, Trip_Members, or Trip_Summary and the requesting User is not a Trip_Member of that Trip, THEN THE Trip_Service SHALL deny the request with an authorization error, SHALL NOT include any of the requested Trip data in the response, and SHALL NOT modify any Trip data.
3. WHILE a User does not have a valid, authenticated session issued by the Auth_Service that is present and unexpired, THE Trip_Service SHALL evaluate the authenticated-session check before the Trip_Member_Rule and SHALL deny each Trip request with an `unauthorized` error, disclosing no information about whether the Trip exists or whether the requesting User is a Trip_Member.
4. IF a User with a valid, authenticated session requests a Trip that does not correspond to an existing Trip, THEN THE Trip_Service SHALL deny the request with the identical authorization error and response content returned to a requesting User who is not a Trip_Member, disclosing no information about whether the Trip exists.
5. WHERE an action is one of the Organizer actions defined in Requirement 4 (editing Trip settings, sending Trip_Invites, canceling pending Trip_Invites, removing Trip_Members, promoting a Member to Organizer, demoting an Organizer to Member, and deleting the Trip), THE Trip_Service SHALL permit the action only for a Trip_Member whose Trip_Role is `organizer` and SHALL deny the action for a Member or a non-member with an authorization error while making no change to Trip data.
6. WHEN a former Trip_Member whose Trip_Membership has been removed from a Trip requests that Trip's detail, Planned_List, Shared_Log, Trip_Feed, Trip_Members, or Trip_Summary, THE Trip_Service SHALL treat the requesting User as not a Trip_Member and deny the request with an authorization error, withholding the requested data.

### Requirement 16: Trips List Screen

**User Story:** As a User, I want a list of my Trips grouped by status, so that I can quickly find the Trip I care about.

#### Acceptance Criteria

1. WHEN a User opens the Trips_List_Screen, THE App SHALL display exactly the Trips on which the User is a Trip_Member, in accordance with the Trip_Member_Rule, and SHALL NOT display any Trip on which the User is not a Trip_Member.
2. THE Trips_List_Screen SHALL group the displayed Trips into an Active group for Trips whose Trip_Status is `active`, an Upcoming group for Trips whose Trip_Status is `upcoming`, and a Past group for Trips whose Trip_Status is `past`, in that order.
3. WHEN the Trips_List_Screen displays the Active group or the Upcoming group, THE App SHALL order the Trips within that group by ascending Trip_Start_Date.
4. WHEN the Trips_List_Screen displays the Past group, THE App SHALL order the Trips within that group by descending Trip_End_Date.
5. WHERE a status group contains no Trips, THE Trips_List_Screen SHALL omit that status group.
6. WHEN a User selects a Trip on the Trips_List_Screen, THE App SHALL navigate to the Trip_Detail_View for the selected Trip.
7. WHILE the User's Trips are loading and fewer than 10 seconds have elapsed since the retrieval began, THE Trips_List_Screen SHALL display a loading indication.
8. IF retrieval of the User's Trips fails or does not complete within 10 seconds of the retrieval beginning, THEN THE Trips_List_Screen SHALL display an error indication with a control to retry retrieval and SHALL NOT present a partial or empty list as a successful result.
9. IF retrieval of the User's Trips completes successfully and the User is a Trip_Member of zero Trips, THEN THE Trips_List_Screen SHALL display an empty-state indication with a control to create a Trip.
10. THE Trips_List_Screen SHALL provide a control to create a Trip.

### Requirement 17: Bottom Tab Navigation Change

**User Story:** As a User, I want a Trips tab in the bottom navigation, so that I can reach my Trips in one tap.

#### Acceptance Criteria

1. THE App SHALL present a bottom tab bar containing exactly five top-level tabs in the left-to-right order Home, Catalog, Trips, Friends, Profile, and SHALL NOT include the personal statistics view as one of these five top-level tabs.
2. WHEN a User selects the Trips tab from the bottom tab bar, THE App SHALL navigate to the Trips_List_Screen with a single tap and SHALL mark the Trips tab as the active tab.
3. THE App SHALL present the personal statistics view as a destination reachable through a navigation control on the Profile tab, and SHALL NOT register the personal statistics view as a top-level bottom tab.
4. WHEN a User selects the personal statistics destination from the Profile tab, THE App SHALL navigate to the personal statistics view.
5. THE App SHALL preserve access to the personal statistics view after its relocation such that every screen of the personal statistics view that was reachable before the relocation remains reachable through navigation originating from the Profile tab.

### Requirement 18: Trip Detail Hub and Deep Links

**User Story:** As a Trip_Member, I want the Trip detail screen to be a hub and notifications to deep-link me into the right place, so that I can act quickly during a visit.

#### Acceptance Criteria

1. WHEN the App displays the Trip_Detail_View for a Trip, THE App SHALL present within that view a distinct navigation control for each of that Trip's Planned_List, Trip_Activity, Trip_Members, and Trip_Summary.
2. WHEN a User taps a Trip_Invite push notification and is authenticated, THE App SHALL navigate to the Trip_Invite for the referenced Trip and present controls to accept or decline it.
3. WHEN a User taps a Rode_With_Tag push notification and is authenticated, THE App SHALL navigate to the Rode_With_Tag confirmation for the referenced Trip_Log_Entry and present controls to confirm or decline it.
4. IF a User taps a Trip push notification while not authenticated, THEN THE App SHALL require authentication and, upon the User completing authentication successfully within the same App session, navigate to the deep-link target of the notification.
5. IF a User taps a Trip push notification whose referenced Trip, Trip_Invite, or Rode_With_Tag no longer exists or the User is no longer a Trip_Member, THEN THE App SHALL navigate to the Trips_List_Screen and display a message indicating that the requested target is no longer available.
6. WHEN a Trip_Member selects the Planned_List, Trip_Activity, Trip_Members, or Trip_Summary navigation control within the Trip_Detail_View, THE App SHALL open the corresponding section for that Trip.
7. IF a User taps a Trip push notification while not authenticated and does not complete authentication within the same App session, THEN THE App SHALL NOT navigate to the deep-link target of the notification.

### Requirement 19: Active Trip Shortcut

**User Story:** As a Trip_Member, I want a shortcut to my active Trip from elsewhere in the App, so that in-park logging is one tap away.

#### Acceptance Criteria

1. WHILE the viewing User is a Trip_Member of at least one Trip whose Trip_Status is `active`, THE App SHALL display the Active_Trip_Shortcut on App surfaces outside the Trips tab.
2. WHERE the viewing User is a Trip_Member of exactly one Trip whose Trip_Status is `active`, WHEN the User activates the Active_Trip_Shortcut, THE App SHALL navigate to the Trip_Detail_View for that Trip.
3. WHILE the viewing User is a Trip_Member of no Trip whose Trip_Status is `active`, THE App SHALL NOT display the Active_Trip_Shortcut.
4. WHERE the viewing User is a Trip_Member of more than one Trip whose Trip_Status is `active`, WHEN the User activates the Active_Trip_Shortcut, THE App SHALL present a list of those active Trips from which the User can select one Trip.
5. WHEN the User selects a Trip from the Active_Trip_Shortcut list, THE App SHALL navigate to the Trip_Detail_View for the selected Trip.
6. IF the User activates the Active_Trip_Shortcut for a Trip whose Trip_Status is no longer `active` or of which the User is no longer a Trip_Member, THEN THE App SHALL navigate to the Trips_List_Screen and display a message indicating the active Trip is no longer available.

### Requirement 20: Consolidated Trip Activity Surface

**User Story:** As a Trip_Member, I want one place to log what I did and follow what the group is doing, so that the Trip has a single activity surface instead of two overlapping ones.

#### Acceptance Criteria

1. THE App SHALL present a single Trip_Activity surface within the Trip_Detail_View that combines the Trip_Feed and the logging of Completions, and SHALL NOT present the Shared_Log as a separate navigation destination.
2. WHEN a Trip_Member opens the Trip_Activity surface, THE App SHALL provide a control to log a Completion against the Trip that assembles the same Trip_Log_Entry request defined in Requirement 10 (the referenced Experience, rode-with tags, and an optional Rating).
3. WHEN the Trip_Activity surface displays a Trip_Feed_Item that records a logged Completion, THE App SHALL display the referenced Experience name, the Park of the referenced Experience, the logging Member, the logging Member's current canonical Rating or an unrated indicator in accordance with Requirement 12, and each Rode_With_Tag's Tagged_Member and confirmation state.
4. THE Trip_Activity surface SHALL provide a filter that narrows the displayed items to logged Completions only, and SHALL display all Trip_Feed_Item types by default.
5. WHERE a Trip_Feed_Item is displayed in the Trip_Activity surface, THE App SHALL permit Trip_Reactions and Trip_Comments on that Trip_Feed_Item in accordance with Requirement 13.
6. THE consolidation of the Shared_Log and Trip_Feed into the Trip_Activity surface SHALL NOT alter the Trip_Service data model: Trip_Log_Entries, Rode_With_Tags, canonical Completions and Ratings, and the Trip_Summary derivation remain as specified in Requirements 10 through 14.

### Requirement 21: Trip Resort Stay

**User Story:** As a Trip_Member, I want to record which Resort or Resorts our party stayed at on a Trip, so that the Trip captures where we lodged, including split stays across more than one hotel.

#### Acceptance Criteria

1. WHEN a Trip is created or edited with a set of Resort references, THE Trip_Service SHALL record that set as the Trip's Trip_Resort_Stay, and THE Trip_Service SHALL surface the Trip_Resort_Stay on the Trip read projection as the referenced Resorts' identities and display names ordered by name.
2. WHERE a create or edit request names the same Resort more than once, THE Trip_Service SHALL record at most one Trip_Resort_Stay link per (Trip, Resort) pair.
3. WHEN a Trip is deleted, THE Trip_Service SHALL delete that Trip's Trip_Resort_Stay links, and THE deletion SHALL NOT remove or alter any referenced Resort in the Catalog.
4. IF a create or edit request references a Resort that does not exist in the Catalog or is not active, THEN THE Trip_Service SHALL reject the request with a validation error and SHALL leave the Trip's existing Trip_Resort_Stay unchanged.
5. WHEN an edit supplies a set of Resort references, THE Trip_Service SHALL replace the Trip's Trip_Resort_Stay with exactly that set, and WHERE the supplied set is empty THE Trip_Service SHALL clear the Trip_Resort_Stay; WHERE an edit omits Resort references entirely, THE Trip_Service SHALL leave the Trip_Resort_Stay unchanged.
6. THE Trip_Resort_Stay SHALL reference the same canonical Catalog Resorts and SHALL NOT copy Resort data, so a later change to a Resort in the Catalog is reflected wherever the Trip_Resort_Stay is displayed.

## Out of Scope (Future Work)

- **Real-time group chat**: Live, real-time messaging within a Trip is deferred. Trip_Comments in Requirement 13 are not real-time chat.
- **Full trip-to-trip comparison view**: A dedicated view comparing two or more Trips side by side is deferred. Requirement 14 requires the Trip_Summary data model to leave room for this future capability.

# Requirements Document

## Introduction

The Friend Stats Viewing feature lets a User open one of the User's accepted Friends and view that Friend's progress: the Friend's Profile summary, completion statistics (overall, per-Park, and per-Experience_Category completion percentages), and the list of Experiences the Friend has completed. The feature builds on the existing friends infrastructure and the established owner-or-friend authorization model in the Disney World Tracker application rather than introducing a parallel one.

Specifically, the Stats_Service already exposes a friend-or-self statistics summary, the Auth_Service already exposes an owner-or-friend Profile read, and both already deny non-friend reads with a `profile_forbidden` authorization error without recording the attempt. This feature reuses that authorization rule and those computations, and adds a Friend-scoped Completions read (which does not exist today) plus a single App screen, the Friend_Profile_View, that surfaces a Friend's Profile, statistics, and Completions together.

## Glossary

- **App**: The Disney World Tracker mobile application as a whole.
- **User**: An authenticated account holder of the App.
- **Profile**: The public-facing account information for a User, including display name and avatar image, plus the User's overall completion percentage.
- **Friend**: A User who has an accepted, mutual relationship with another User via the Friends_Service.
- **Friend_Request**: A pending request from one User to another to establish a Friend relationship that has not yet been accepted.
- **Friends_Service**: The component responsible for managing Friend_Requests and Friend relationships between Users.
- **Auth_Service**: The component responsible for user accounts, sessions, and serving a User's Profile.
- **Stats_Service**: The component responsible for computing completion percentages and progress statistics for a User.
- **Tracking_Service**: The component responsible for recording and serving per-User Completions, Ratings, and Notes for Experiences.
- **Experience**: An individual catalog item at Walt Disney World, such as a ride, show, restaurant, parade, character meet-and-greet, or other activity.
- **Active Experience**: An Experience currently present in the catalog and not marked inactive; inactive Experiences are excluded from catalog browse, search, and filter results while their Completion, Rating, and Note records are preserved.
- **Park**: One of the Walt Disney World locations to which an Experience belongs, as defined by the catalog.
- **Experience_Category**: The classification of an Experience (Ride, Show, Restaurant, Parade, Character_Meet, or Other).
- **Completion**: A record indicating that a User has completed a specific Experience, including the Completion date.
- **Completion date**: The local calendar date, in the completing User's time zone, on which a Completion was recorded.
- **Rating**: A numeric score, an integer from 1 to 10 inclusive, assigned by a User to an Experience.
- **Note**: A free-form personal text entry assigned by a User to an Experience, carrying a per-Note shareable flag that controls whether the Note is visible to the owning User's Friends; the shareable flag is private by default and becomes shareable only when the owning User explicitly marks that specific Note as shareable.
- **Completion_Entry**: One item in a Friend's Completions list, comprising the completed Experience's name, Park, and Experience_Category, the Completion date, the Friend's Rating for that Experience when one exists, and the text of the Friend's Note for that Experience when that Note exists and is marked shareable.
- **Owner_Or_Friend_Rule**: The authorization rule that grants a requesting User read access to a target User's Profile, completion statistics, or Completions only when the requesting User is the target User or an accepted Friend of the target User, and otherwise denies the read.
- **Friend_Viewing_Services**: Collectively, the Auth_Service operation that serves a target User's Profile, the Stats_Service operation that serves a target User's completion statistics, and the Tracking_Service operation that serves a target User's Completions, each of which enforces the Owner_Or_Friend_Rule.
- **Friend_Profile_View**: The App screen that displays a selected Friend's Profile summary, completion statistics, and Completions.

## Requirements

### Requirement 1: Owner-or-Friend Authorization for Viewing

**User Story:** As a User, I want viewing of another User's stats and completions to be limited to that User's accepted friends, so that personal progress is shared only with people the owner has approved.

#### Acceptance Criteria

1. WHEN a User requests a target User's Profile, completion statistics, or Completions and the requesting User is the target User or an accepted Friend of the target User, THE Friend_Viewing_Services SHALL authorize the request and return the requested data.
2. IF a User requests a target User's Profile, completion statistics, or Completions and the requesting User is neither the target User nor an accepted Friend of the target User, THEN THE Friend_Viewing_Services SHALL deny the request and return a `profile_forbidden` authorization error.
3. IF a User requests a target User's Profile, completion statistics, or Completions and the only relationship between the requesting User and the target User is a pending Friend_Request, THEN THE Friend_Viewing_Services SHALL deny the request and return a `profile_forbidden` authorization error.
4. WHEN the Friend_Viewing_Services deny a request under the Owner_Or_Friend_Rule, THE Friend_Viewing_Services SHALL return the authorization error without recording the viewing attempt in any analytics, audit, or telemetry record.
5. IF a User requests a Profile, completion statistics, or Completions for a target identifier that does not correspond to an existing User account, THEN THE Friend_Viewing_Services SHALL return the same `profile_forbidden` authorization error returned for a request from a non-Friend, disclosing no information about whether the target identifier exists.
6. WHILE a User does not have a valid, non-expired, authenticated session, THE Friend_Viewing_Services SHALL evaluate the session check before the Owner_Or_Friend_Rule and SHALL deny each request for any target User's Profile, completion statistics, or Completions with an `unauthorized` error, regardless of whether the target identifier corresponds to an existing User or to an accepted Friend.
7. WHEN a Friend relationship between two Users is terminated, THE Friend_Viewing_Services SHALL deny, with a `profile_forbidden` authorization error, each request from one former Friend for the other former Friend's Profile, completion statistics, or Completions whose Owner_Or_Friend_Rule evaluation begins after the termination is committed.

### Requirement 2: View a Friend's Profile Summary

**User Story:** As a User, I want to see a Friend's profile with display name, avatar, and overall completion, so that I can recognize the Friend and gauge overall progress.

#### Acceptance Criteria

1. WHEN an authorized User requests a Friend's Profile, THE Auth_Service SHALL return the Friend's display name, the Friend's avatar image reference when an avatar image is set, a no-avatar indicator when no avatar image is set, and the Friend's overall completion percentage as computed by the Stats_Service.
2. THE Auth_Service SHALL compute the Friend's overall completion percentage using the same formula that applies to a User's own overall completion percentage, rounded to the nearest 0.1, and SHALL constrain the returned percentage to the range 0.0 to 100.0 inclusive.
3. IF the denominator used for the Friend's overall completion percentage is zero, THEN THE Auth_Service SHALL report the Friend's overall completion percentage as 0.0.
4. WHEN the Friend_Profile_View is displayed for a Friend, THE App SHALL display, within 2 seconds, the Friend's display name and the Friend's overall completion percentage to one decimal place.
5. WHEN the Friend_Profile_View is displayed for a Friend and the Friend has an avatar image set, THE App SHALL display the Friend's avatar image.
6. WHERE the Friend has no avatar image set, THE App SHALL display a default avatar placeholder in the Friend_Profile_View.

### Requirement 3: View a Friend's Completion Statistics

**User Story:** As a User, I want to see a Friend's completion percentages across parks and categories, so that I can compare how much of Disney World each of us has experienced.

#### Acceptance Criteria

1. WHEN a User requests a Friend's completion statistics and the request satisfies the Owner_Or_Friend_Rule, THE Stats_Service SHALL return the Friend's overall completion percentage, a per-Park completion percentage for each Park defined in the catalog, and a per-Experience_Category completion percentage for each of the Experience_Categories Ride, Show, Restaurant, Parade, Character_Meet, and Other, computed over only Active Experiences.
2. THE Stats_Service SHALL compute each completion percentage for a Friend using the same formula and rounding to the nearest 0.1 that apply to a User's own statistics, and SHALL constrain every returned percentage to the range 0.0 to 100.0 inclusive.
3. THE Stats_Service SHALL return, for each reported overall, per-Park, and per-Experience_Category percentage of a Friend, the corresponding completed-Experience count and total-Experience count.
4. IF a denominator used for a Friend's overall, per-Park, or per-Experience_Category completion percentage is zero, THEN THE Stats_Service SHALL report that completion percentage as 0.0 and report a total-Experience count of 0.
5. WHEN the Friend_Profile_View receives the Stats_Service response for a Friend's completion statistics, THE App SHALL display, within 2 seconds of receiving the response, the Friend's overall, per-Park, and per-Experience_Category completion percentages to exactly one decimal place, each accompanied by its completed-Experience count and total-Experience count.
6. IF a User requests a Friend's completion statistics and the request does not satisfy the Owner_Or_Friend_Rule, THEN THE Stats_Service SHALL deny the request with a `profile_forbidden` authorization error and withhold all completion percentages and counts.

### Requirement 4: View a Friend's Completions

**User Story:** As a User, I want to see the Experiences a Friend has completed and when, so that I can compare trips and discover recommendations.

#### Acceptance Criteria

1. WHEN an authorized User requests a Friend's Completions, THE Tracking_Service SHALL return one Completion_Entry for each Completion the Friend has recorded against an Active Experience, up to a maximum of 5,000 Completion_Entries, returning the most recent by Completion date when more than 5,000 such Completions exist.
2. THE Tracking_Service SHALL include in each Completion_Entry the completed Experience's name, Park, and Experience_Category, and the Completion date.
3. WHERE the Friend has a Rating for the Experience referenced by a Completion_Entry, THE Tracking_Service SHALL include that Rating as an integer from 1 to 10 inclusive in the Completion_Entry.
4. WHERE the Friend has no Rating for the Experience referenced by a Completion_Entry, THE Tracking_Service SHALL include a no-rating indicator in the Completion_Entry.
5. THE Tracking_Service SHALL exclude from a Friend's Completions every Completion whose associated Experience is not an Active Experience.
6. WHERE the Friend has marked as shareable the Note for the Experience referenced by a Completion_Entry, THE Tracking_Service SHALL include that Note's text in the Completion_Entry.
7. WHERE the Friend has no Note for the Experience referenced by a Completion_Entry, or has a Note for that Experience that is not marked shareable, THE Tracking_Service SHALL exclude all Note text and Note content from the Completion_Entry and SHALL include only a no-shared-note indicator that conveys no information about whether a non-shareable Note exists.
8. THE Tracking_Service SHALL order a Friend's Completion_Entries by Completion date descending, breaking ties by Experience name ascending, then by Park name ascending, then by Experience_Category ascending, all using case-insensitive comparison.
9. WHEN the Friend_Profile_View is displayed and the Friend has at least one Completion for an Active Experience, THE App SHALL display the returned set of the Friend's Completion_Entries within 2 seconds, each showing the Experience name, Park, Experience_Category, Completion date as a calendar date, the Rating when a Rating is present, and the shared Note's text when a shared Note is present in the Completion_Entry.
10. IF an authorized User requests a Friend's Completions and the Friend has zero Completions for Active Experiences, THEN THE App SHALL display an empty-state message indicating that the Friend has no completed Experiences to show.

### Requirement 5: Friend_Profile_View Navigation and States

**User Story:** As a User, I want to open a Friend's profile from my friends list and see clear loading and error states, so that viewing a Friend's progress is reliable.

#### Acceptance Criteria

1. WHEN a User selects a Friend from the friends list, THE App SHALL navigate to the Friend_Profile_View for the selected Friend within 2 seconds of the selection.
2. WHILE a Friend_Profile_View request for the Friend's Profile, statistics, or Completions is in progress and no prior data for that request is available, THE App SHALL display a loading indicator for that request in the Friend_Profile_View within 1 second of the request starting and SHALL continue to display it until the request completes, fails, or times out.
3. IF a Friend_Profile_View request fails with a `profile_forbidden` authorization error, THEN THE App SHALL display a message indicating that the Friend's data is unavailable and SHALL withhold the Friend's statistics and Completions from display.
4. IF a Friend_Profile_View request fails with an error other than `profile_forbidden`, THEN THE App SHALL display an error message indicating that the request failed, SHALL present a retry control for the failed request, and SHALL retain any Profile, statistics, or Completions already successfully loaded for the other Friend_Profile_View requests.
5. IF a Friend_Profile_View request remains in progress for 30 seconds without completing, THEN THE App SHALL treat the request as a failed request with a non-`profile_forbidden` error, display an error message indicating the request did not complete, and present a retry control for that request.
6. WHEN a User selects the retry control after a failed Friend_Profile_View request, THE App SHALL re-issue only the failed request and SHALL display the loading indicator for that request while the re-issued request is in progress.

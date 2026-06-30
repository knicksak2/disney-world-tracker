# Requirements Document

## Introduction

The Disney World Tracker is a mobile application that provides a comprehensive catalog of experiences available at Walt Disney World, including attractions, shows, restaurants, parades, character meet-and-greets, and other activities. The catalog is sourced from the public ThemeParks.wiki API. Users can track which experiences they have completed, view completion statistics, rate experiences, and record personal notes. The application also surfaces userbase aggregate ratings, highlights highest-rated experiences on the home screen, and supports user profiles, a friends system, and the ability to share progress and recommendations with friends.

## Glossary

- **App**: The Disney World Tracker mobile application as a whole.
- **Home_Screen**: The default landing screen of the App displayed to an authenticated User.
- **Experience**: An individual catalog item at Walt Disney World, such as a ride, show, restaurant, parade, character meet-and-greet, or other activity.
- **Experience_Category**: The classification of an Experience. Allowed values are Ride, Show, Restaurant, Parade, Character_Meet, and Other.
- **Park**: One of the four Walt Disney World theme parks (Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom), the two water parks (Typhoon Lagoon, Blizzard Beach), or Disney Springs.
- **ThemeParks_API**: The public ThemeParks.wiki HTTP API (version 1, base URL https://api.themeparks.wiki/v1) used as the upstream source of Walt Disney World Experience data, accessed via the entity-based endpoints `/destinations` and `/entity/{id}/children`.
- **Catalog_Sync**: The process by which the Catalog_Service retrieves Experience data from the ThemeParks_API and reconciles it into the local cache.
- **Catalog_Service**: The component responsible for sourcing Experience data from the ThemeParks_API, maintaining a local cache, and serving the list of Experiences to the App.
- **Image_Sourcing_Job**: A standalone job, run independently of and separately from the Catalog_Sync, that enriches active Experience records with freely-licensed imagery sourced from Wikipedia and Wikimedia Commons.
- **Experience_Image**: A representative image associated with an Experience, stored as a URL, that is absent when no image has been sourced for that Experience.
- **Image_Attribution**: The licensing and source attribution text stored alongside an Experience_Image for an Experience.
- **Image_Override**: A curated entry in the overrides file (imageOverrides.json) that maps an Experience name to a specific Experience_Image and takes precedence over automated sourcing.
- **Tracking_Service**: The component responsible for recording per-User completion status, ratings, and notes for Experiences.
- **Stats_Service**: The component responsible for computing completion percentages and progress statistics for a User.
- **Auth_Service**: The component responsible for user registration, login, logout, and session management.
- **User**: An authenticated account holder of the App.
- **Profile**: The public-facing account information for a User, including display name and avatar.
- **Friends_Service**: The component responsible for managing friend requests and friend relationships between Users.
- **Friend_Request**: A pending request from one User to another to establish a Friend relationship.
- **Friend**: A User who has an accepted, mutual relationship with another User via the Friends_Service.
- **Sharing_Service**: The component responsible for sending shared content (Experiences, completions, ratings, notes, progress) from one User to a Friend.
- **Share**: A unit of content sent through the Sharing_Service from one User to one or more Friends.
- **Completion**: A record indicating that a User has completed a specific Experience, including the date of completion.
- **Rating**: A numeric score from 1 to 10 (whole numbers) assigned by a User to an Experience.
- **Aggregate_Rating**: The arithmetic mean of all User Ratings for a single Experience, rounded to one decimal place, constrained to the range 1.0 to 10.0 inclusive.
- **Aggregate_Ratings_Service**: The component responsible for computing and serving the Aggregate_Rating and contributing Rating count for each Experience.
- **Note**: A free-form text entry up to 2000 characters assigned by a User to an Experience.

## Requirements

### Requirement 1: Experience Catalog

**User Story:** As a User, I want to browse a comprehensive catalog of Disney World Experiences sourced from a live upstream data source, so that I can discover and look up everything available to do without relying on stale or manually curated data.

#### Acceptance Criteria

1. THE Catalog_Service SHALL source Experience data from the ThemeParks_API by resolving the Walt Disney World Resort destination via the `/destinations` endpoint and retrieving its child entities via the `/entity/{id}/children` endpoint.
2. THE Catalog_Service SHALL include in the Experience set those upstream entities whose ThemeParks_API entity type is ATTRACTION, SHOW, or RESTAURANT.
3. THE Catalog_Service SHALL map ThemeParks_API entity types to Experience_Category as follows: ATTRACTION maps to Ride, SHOW maps to Show, RESTAURANT maps to Restaurant, and any other included upstream entity type maps to Other.
4. WHERE upstream sub-classification data identifies an entity as a parade, THE Catalog_Service SHALL assign Experience_Category Parade to the corresponding Experience.
5. WHERE upstream sub-classification data identifies an entity as a character meet-and-greet, THE Catalog_Service SHALL assign Experience_Category Character_Meet to the corresponding Experience.
6. THE Catalog_Service SHALL associate each Experience with exactly one Park derived from the upstream entity's parent park, mapped to a Park value defined in the glossary.
7. THE Catalog_Service SHALL assign each Experience a stable internal identifier that is a one-to-one function of the ThemeParks_API entity ID, such that the same upstream entity ID resolves to the same internal identifier across Catalog_Sync runs.
8. THE Catalog_Service SHALL provide for each Experience a name of 1 to 200 characters, a Park, an Experience_Category, and a description of 0 to 1000 characters, all populated from the ThemeParks_API.
9. THE Catalog_Service SHALL persist a local cache of Experience data retrieved from the ThemeParks_API.
10. THE Catalog_Service SHALL perform a scheduled Catalog_Sync against the ThemeParks_API at least once every 24 hours.
11. WHEN the App requests catalog data and the local cache age strictly exceeds 24 hours, THE Catalog_Service SHALL initiate an opportunistic Catalog_Sync before serving the request and SHALL serve the request from the existing cache if the opportunistic Catalog_Sync does not complete within 5 seconds.
12. WHEN the App requests catalog data and the local cache age is 24 hours or less, THE Catalog_Service SHALL serve the request from the existing cache without initiating an opportunistic Catalog_Sync.
13. IF the ThemeParks_API is unreachable or returns an error during a Catalog_Sync, THEN THE Catalog_Service SHALL serve Experience data from the most recent successful cache, return a stale-cache indicator on the response, and retain the prior cache contents unchanged.
14. WHEN a Catalog_Sync identifies a ThemeParks_API entity ID that is not present in the local cache, THE Catalog_Service SHALL add a new Experience with a stable internal identifier derived from the upstream entity ID.
15. WHEN a Catalog_Sync identifies an Experience in the local cache whose corresponding ThemeParks_API entity ID is no longer returned by the ThemeParks_API, THE Catalog_Service SHALL mark that Experience as inactive, exclude inactive Experiences from catalog browse, search, and filter results, and preserve all existing Completion, Rating, and Note records associated with that Experience.
16. WHEN a Catalog_Sync identifies a change in an upstream entity's name, parent Park association, or entity type, THE Catalog_Service SHALL update the corresponding Experience's name, Park, or Experience_Category to match the upstream value while preserving that Experience's stable internal identifier.
17. WHEN a User opens the catalog view, THE App SHALL display all active Experiences grouped by Park, with Experiences sorted alphabetically by name (case-insensitive, ascending) within each Park group.
18. WHERE a filter by Experience_Category is selected, THE App SHALL display only active Experiences whose Experience_Category equals the selected Experience_Category.
19. WHERE a filter by Park is selected, THE App SHALL display only active Experiences whose Park equals the selected Park.
20. WHEN a User enters a search query containing at least 1 non-whitespace character, THE App SHALL display active Experiences whose name contains the trimmed query as a case-insensitive substring.
21. WHILE a Park filter or Experience_Category filter is active and a search query containing at least 1 non-whitespace character is entered, THE App SHALL display only active Experiences that match the trimmed search query and all active filters.
22. WHEN a User selects an Experience from the catalog, THE App SHALL display the detail view for that Experience showing its name, Park, Experience_Category, and description.
23. IF the combination of active filters and search query yields zero matching active Experiences, THEN THE App SHALL display an empty-state message indicating that no Experiences match the current filters and search.
24. IF the Catalog_Service has no successful prior cache and the ThemeParks_API is unreachable, THEN THE App SHALL display an error message indicating that the catalog could not be loaded.

### Requirement 2: Completion Tracking

**User Story:** As a User, I want to mark Experiences as completed, so that I can keep a personal record of what I have done at Disney World.

#### Acceptance Criteria

1. WHEN a User marks an Experience as completed, THE Tracking_Service SHALL record a Completion for that User and Experience with the current date in the User's local time zone.
2. WHEN a User unmarks an Experience for which a Completion already exists for that User, THE Tracking_Service SHALL remove that Completion for that User and Experience.
3. THE Tracking_Service SHALL store at most one Completion per User per Experience at any given time.
4. WHEN a User views an Experience, THE App SHALL display a completed indicator together with the Completion date when a Completion exists in the Tracking_Service for that User and Experience, and a not-completed indicator when no Completion exists, except in the event of a transient rendering failure during which neither indicator may be displayed temporarily until the App is able to recover the indicator state.
5. WHEN a User submits an edit to the date of an existing Completion with a date that is not later than the current date in the User's local time zone, THE Tracking_Service SHALL update the Completion date to the User-specified date.
6. IF a User attempts to mark an Experience as completed with a date later than the current date in the User's local time zone, or to edit a Completion date to a date later than the current date in the User's local time zone, THEN THE Tracking_Service SHALL reject the request, leave any existing Completion unchanged, and return a validation error indicating that the Completion date must not be in the future.
7. IF a User attempts to unmark an Experience for which no Completion exists for that User, THEN THE Tracking_Service SHALL reject the request and return a not-found error.
8. IF a User submits a single operation that both unmarks an Experience and edits the date of the Completion for that Experience, THEN THE Tracking_Service SHALL reject the date edit portion of the operation, perform the unmark only, and return a validation error indicating that a Completion date cannot be edited while the Completion is being removed.

### Requirement 3: Completion Statistics

**User Story:** As a User, I want to see my completion percentages and progress, so that I can track how much of Disney World I have experienced.

#### Acceptance Criteria

1. THE Stats_Service SHALL compute the overall completion percentage for a User as the count of completed Experiences divided by the total count of Experiences in the Catalog_Service, multiplied by 100, rounded to the nearest 0.1, and constrained to the range 0.0 to 100.0 inclusive.
2. THE Stats_Service SHALL compute a per-Park completion percentage for each Park as the count of completed Experiences in that Park divided by the total count of Experiences in that Park, multiplied by 100, rounded to the nearest 0.1, and constrained to the range 0.0 to 100.0 inclusive.
3. THE Stats_Service SHALL compute a per-Experience_Category completion percentage for each Experience_Category as the count of completed Experiences in that Experience_Category divided by the total count of Experiences in that Experience_Category, multiplied by 100, rounded to the nearest 0.1, and constrained to the range 0.0 to 100.0 inclusive.
4. WHEN a User opens the progress screen, THE App SHALL display, within 2 seconds, the overall, per-Park, and per-Experience_Category completion percentages for that User to one decimal place along with the corresponding completed-Experience count and total-Experience count for each percentage.
5. WHEN a Completion is added or removed, THE Stats_Service SHALL recompute the affected overall, per-Park, and per-Experience_Category percentages within 2 seconds and before the next display of those percentages to the User.
6. IF the total count of Experiences used as the denominator for the overall, per-Park, or per-Experience_Category completion percentage is zero, THEN THE Stats_Service SHALL report the corresponding completion percentage as 0.0 and SHALL report a total-Experience count of 0.
7. IF an Experience_Category has zero Experiences within a given Park, THEN THE Stats_Service SHALL report the per-Experience_Category completion percentage for that Park as 0.0 and SHALL report a total-Experience count of 0 for that Experience_Category in that Park.
8. THE Stats_Service SHALL cap every reported overall, per-Park, and per-Experience_Category completion percentage at 100.0, such that no reported percentage exceeds 100.0 under any computation.

### Requirement 4: Ratings

**User Story:** As a User, I want to rate Experiences on a 1 to 10 scale, so that I can remember which ones I enjoyed and share my opinions with finer granularity.

#### Acceptance Criteria

1. WHEN a User submits a Rating for an Experience, THE Tracking_Service SHALL record the Rating as an integer between 1 and 10 inclusive and return an observable confirmation within 2 seconds.
2. THE Tracking_Service SHALL store at most one Rating per User per Experience.
3. WHEN a User submits a new Rating for an Experience that already has a Rating from that same User, THE Tracking_Service SHALL replace the existing Rating with the new value and return an observable confirmation within 2 seconds.
4. WHEN a User removes an existing Rating for an Experience, THE Tracking_Service SHALL delete the Rating for that User and Experience and return an observable confirmation within 2 seconds.
5. WHEN a User views an Experience for which a Rating from that User exists, THE App SHALL display the stored Rating as an integer between 1 and 10 inclusive and SHALL NOT display the empty-state indicator.
6. WHEN a User views an Experience for which no Rating from that User exists, THE App SHALL display an empty-state indicator showing that no Rating has been recorded and SHALL NOT display any Rating value.
7. IF a Rating value is submitted that is not an integer between 1 and 10 inclusive, THEN THE Tracking_Service SHALL reject the submission, leave any existing Rating for that User and Experience unchanged, and return a validation error indicating that the allowed range is an integer from 1 to 10 inclusive.
8. IF a User attempts to remove a Rating for an Experience for which no Rating from that User exists, THEN THE Tracking_Service SHALL reject the request and return a not-found error indicating that no Rating exists for that User and Experience.

### Requirement 5: Notes

**User Story:** As a User, I want to write personal notes on Experiences, so that I can remember details, tips, and memories.

#### Acceptance Criteria

1. THE Tracking_Service SHALL store at most one Note per User per Experience.
2. THE Tracking_Service SHALL accept Note text with a minimum length of 1 Unicode code point after trimming leading and trailing whitespace and a maximum length of 2000 characters inclusive.
3. WHEN a User saves a Note for an Experience and no Note currently exists for that User and Experience, THE Tracking_Service SHALL store the submitted Note text against that User and Experience and return a save confirmation within 2 seconds.
4. WHEN a User edits a Note for an Experience and a Note currently exists for that User and Experience, THE Tracking_Service SHALL replace the prior Note text with the submitted text and return a save confirmation within 2 seconds.
5. WHEN a User edits a Note for an Experience and no Note currently exists for that User and Experience, THE Tracking_Service SHALL create the Note with the submitted text and return a save confirmation within 2 seconds.
6. WHEN a User deletes a Note for an Experience and a Note currently exists for that User and Experience, THE Tracking_Service SHALL remove the Note for that User and Experience and return a delete confirmation within 2 seconds.
7. IF a User requests deletion of a Note for an Experience and no Note currently exists for that User and Experience, THEN THE Tracking_Service SHALL reject the request with a not-found error indication and SHALL make no modification to stored Note data.
8. WHEN a User views an Experience for which a Note exists, THE App SHALL display the User's current Note text for that Experience within 2 seconds of the view being requested.
9. WHEN a User views an Experience for which no Note exists, THE App SHALL display an empty-state indication that no Note has been recorded within 2 seconds of the view being requested.
10. IF a Note submission exceeds 2000 characters or contains only whitespace after trimming, THEN THE Tracking_Service SHALL reject the submission, return a validation error indication identifying the violated length constraint, and SHALL leave any previously stored Note for that User and Experience unchanged.

### Requirement 6: User Accounts and Authentication

**User Story:** As a User, I want to create an account and log in, so that my completions, ratings, and notes are saved and tied to me.

#### Acceptance Criteria

1. WHEN a new User submits a registration with an email matching standard email syntax (RFC 5322), a display name between 1 and 50 characters, and a password of at least 8 characters and at most 128 characters, THE Auth_Service SHALL create a new User account with a unique identifier and establish an authenticated session for that User within 2 seconds, where the established session is subject to the same expiration rules defined for login sessions and MAY expire prior to the User's first authenticated request.
2. THE Auth_Service SHALL require the email address on each User account to be unique across all User accounts.
3. IF a registration submission contains an email that is already associated with an existing User account, THEN THE Auth_Service SHALL reject the registration, return a duplicate-email error response, and not create a new User account.
4. IF a registration submission fails input validation (invalid email syntax, display name outside 1-50 characters, or password shorter than 8 or longer than 128 characters), THEN THE Auth_Service SHALL reject the registration, return a validation error response indicating the failing field, and not create a new User account.
5. WHEN a User submits valid login credentials, THE Auth_Service SHALL establish an authenticated session for that User within 2 seconds, where the session expires after 24 hours of continuous activity or 30 days of inactivity, whichever occurs first.
6. IF a User submits invalid login credentials, THEN THE Auth_Service SHALL reject the login attempt within 2 seconds, return an authentication error response, and not establish an authenticated session.
7. IF a User account accumulates 5 failed login attempts within a 15-minute window, THEN THE Auth_Service SHALL lock the account for 15 minutes and reject all login attempts during the lockout with an account-locked error response.
8. WHEN a User initiates logout, THE Auth_Service SHALL terminate the User's authenticated session and invalidate the session credentials such that all subsequent requests using those credentials are rejected with an unauthorized error response.
9. WHEN an authenticated session ends for any reason, including logout, expiration, lockout, or administrative termination, THE Auth_Service SHALL invalidate the session credentials such that all subsequent requests using those credentials are rejected with an unauthorized error response.
10. WHILE a User does not have a valid non-expired authenticated session, THE App SHALL deny access to Completions, Ratings, Notes, Friends, and Sharing features with an unauthorized error response.
11. THE Auth_Service SHALL store passwords only as one-way cryptographic hashes and SHALL NOT store or transmit passwords in plaintext at any time.
12. THE Auth_Service SHALL grant access to Completions, Ratings, Notes, Friends, and Sharing features if and only if the request is associated with a valid non-expired authenticated session.

### Requirement 7: User Profile

**User Story:** As a User, I want a profile with my display name and avatar, so that friends can recognize me and see my progress.

#### Acceptance Criteria

1. THE Auth_Service SHALL associate each User account with a Profile containing a display name and an optional avatar image.
2. WHEN a User submits a display name update for the User's Profile and the submitted display name is between 1 and 50 characters inclusive after trimming leading and trailing whitespace and contains at least 1 non-whitespace character, THE Auth_Service SHALL save the submitted display name on the User's Profile.
3. WHEN a User uploads an avatar image in PNG or JPEG format with a file size of at most 5 megabytes, THE Auth_Service SHALL save the avatar image on the User's Profile.
4. WHEN the User or a Friend of the User views the User's Profile, THE App SHALL display the User's display name, the User's avatar image if one is set, and the User's overall completion percentage as computed by the Stats_Service.
5. THE Auth_Service SHALL require display names to be between 1 and 50 characters inclusive.
6. IF a User submits a display name update that is empty, contains only whitespace characters, or exceeds 50 characters, THEN THE Auth_Service SHALL reject the update, return a validation error indicating the length or whitespace violation, and preserve the prior display name on the User's Profile.
7. IF a User uploads an avatar image that is not in PNG or JPEG format or exceeds 5 megabytes, THEN THE Auth_Service SHALL reject the upload, return a validation error indicating the format or size violation, and preserve the prior avatar image on the User's Profile.
8. IF a User who is not the Profile owner and not a Friend of the Profile owner attempts to view the User's Profile, THEN THE App SHALL deny access to the Profile, return an authorization error, and SHALL NOT log, track, or otherwise record the viewing attempt for analytics purposes.

### Requirement 8: Friends Management

**User Story:** As a User, I want to add other Users as friends, so that I can connect with them in the App.

#### Acceptance Criteria

1. WHEN a User submits a search query of 1 to 100 characters for another User by display name or email, THE Friends_Service SHALL return up to 50 Users whose display name or email contains the query as a case-insensitive substring, excluding the requesting User.
2. IF a User submits a search query whose length is less than 1 character or greater than 100 characters, THEN THE Friends_Service SHALL reject the query and return a validation error indicating that the search query length is out of allowed range.
3. WHEN a User sends a Friend_Request to another User, THE Friends_Service SHALL create a pending Friend_Request from the sender to the recipient.
4. WHEN a recipient accepts a Friend_Request, THE Friends_Service SHALL establish a mutual Friend relationship between the sender and the recipient and remove the Friend_Request from the pending state.
5. WHEN a recipient declines a Friend_Request, THE Friends_Service SHALL remove the Friend_Request without establishing a Friend relationship.
6. WHEN a User removes a Friend, THE Friends_Service SHALL terminate the Friend relationship for both Users.
7. IF a User sends a Friend_Request to a recipient with whom there exists a pending Friend_Request in either direction or an established Friend relationship, THEN THE Friends_Service SHALL reject the request and return a duplicate-relationship error.
8. IF a User sends a Friend_Request to the User's own account, THEN THE Friends_Service SHALL reject the request and return a validation error.
9. WHEN a User views the friends list, THE App SHALL display all current Friends and all pending incoming and outgoing Friend_Requests for that User.
10. IF a User sends a Friend_Request specifying a recipient that does not correspond to an existing User account, THEN THE Friends_Service SHALL reject the request and return a validation error.
11. IF a User attempts to remove a Friend with whom no current Friend relationship exists, THEN THE Friends_Service SHALL reject the request and return a validation error.

### Requirement 9: Sharing With Friends

**User Story:** As a User, I want to share Experiences, completions, ratings, notes, and progress with friends, so that we can compare our trips and recommend things to each other.

#### Acceptance Criteria

1. WHEN a User initiates a Share of an Experience to between 1 and 50 selected Friends inclusive, THE Sharing_Service SHALL deliver a Share to each selected Friend referencing the Experience and the sending User within 10 seconds of initiation.
2. IF a User initiates a Share with zero selected recipients or more than 50 selected recipients, THEN THE Sharing_Service SHALL reject the entire Share and return a validation error indicating the recipient count is out of allowed range.
3. IF a User initiates a Share in which any one or more selected recipients are not Friends of the User, THEN THE Sharing_Service SHALL reject the entire Share atomically, deliver the Share to no recipient, and return an authorization error.
4. WHERE the Share includes the sender's Rating for the Experience, THE Sharing_Service SHALL include the sender's Rating value as an integer between 1 and 10 inclusive in the delivered Share.
5. IF the Share includes the sender's Rating but no Rating exists for the sender on the referenced Experience at delivery time, THEN THE Sharing_Service SHALL deliver the Share without the Rating and include a notice to the recipient indicating that the Rating is unavailable.
6. WHERE the Share includes the sender's Note for the Experience, THE Sharing_Service SHALL include the sender's Note text in the delivered Share, truncated or rejected at a maximum of 2000 characters.
7. WHEN a User initiates a Share of overall progress to between 1 and 50 selected Friends inclusive, THE Sharing_Service SHALL deliver a Share containing the sender's overall, per-Park, and per-Experience_Category completion percentages, each capped at 100.0 and reported as a value from 0.0 to 100.0 inclusive to one decimal place.
8. WHILE a received Share has not been opened by the recipient, THE App SHALL display only an unopened indicator and the recipient's unread Share count, withholding the sender, content, and timestamp of the Share from display.
9. WHEN a recipient opens a Share, THE App SHALL display the sender, the shared content, and the time the Share was sent within 2 seconds of the open action.
10. WHEN a recipient deletes a received Share, THE Sharing_Service SHALL remove the Share from the recipient's view within 2 seconds while leaving the sender's record of the Share persisted unchanged.

### Requirement 10: Aggregate User Ratings

**User Story:** As a User, I want to see how the entire userbase has rated each Experience, so that I can use the wisdom of the crowd to plan my visit.

#### Acceptance Criteria

1. THE Aggregate_Ratings_Service SHALL compute the Aggregate_Rating for an Experience as the arithmetic mean of all User Ratings recorded by the Tracking_Service for that Experience, rounded to one decimal place, constrained to the range 1.0 to 10.0 inclusive.
2. THE Aggregate_Ratings_Service SHALL count each User's Rating for an Experience exactly once when computing the Aggregate_Rating for that Experience.
3. WHERE an Experience has at least 3 User Ratings, THE Aggregate_Ratings_Service SHALL report the Aggregate_Rating value to one decimal place together with the count of contributing Ratings.
4. WHERE an Experience has fewer than 3 User Ratings, THE Aggregate_Ratings_Service SHALL withhold the Aggregate_Rating value, report an empty-state indicator, and report the count of contributing Ratings.
5. WHEN a User opens the detail view of an Experience that has at least 3 User Ratings, THE App SHALL display the Experience's Aggregate_Rating to one decimal place along with the count of contributing Ratings.
6. WHEN a User opens the detail view of an Experience that has fewer than 3 User Ratings, THE App SHALL display an empty-state indicator that the Aggregate_Rating is unavailable along with the count of contributing Ratings.
7. WHEN a User Rating is added, replaced, or removed for an Experience, THE Aggregate_Ratings_Service SHALL update the Experience's Aggregate_Rating and contributing Rating count within 60 seconds of the change.
8. WHEN a User replaces the User's prior Rating for an Experience, THE Aggregate_Ratings_Service SHALL include the User's new Rating value exactly once in the Aggregate_Rating for that Experience and SHALL exclude the prior Rating value.
9. WHEN a User removes the User's Rating for an Experience, THE Aggregate_Ratings_Service SHALL exclude that User's Rating from the Aggregate_Rating computation for that Experience.
10. THE Aggregate_Ratings_Service SHALL expose only the Aggregate_Rating value and the count of contributing Ratings for an Experience and SHALL NOT expose the individual Rating value of any User other than the requesting User through any Aggregate_Rating response.

### Requirement 11: Highest-Rated Experiences on Home Screen

**User Story:** As a User, I want to see the highest-rated Experiences on the Home_Screen, so that I can quickly discover the best things to do based on community ratings.

#### Acceptance Criteria

1. THE Home_Screen SHALL include a Highest-Rated Experiences section.
2. THE Home_Screen SHALL include in the Highest-Rated Experiences section only active Experiences that meet the minimum sample threshold of at least 3 contributing Ratings as defined for Aggregate_Rating.
3. THE Home_Screen SHALL rank Experiences in the Highest-Rated Experiences section by Aggregate_Rating in descending order, then by count of contributing Ratings in descending order, then by Experience name in case-insensitive alphabetical ascending order.
4. THE Home_Screen SHALL display at most the top 10 ranked Experiences in the Highest-Rated Experiences section.
5. THE Home_Screen SHALL display for each entry in the Highest-Rated Experiences section the Experience's name, Park, Experience_Category, Aggregate_Rating to one decimal place, and count of contributing Ratings.
6. WHEN a User taps an entry in the Highest-Rated Experiences section, THE App SHALL open the detail view for the corresponding Experience.
7. WHEN a User opens the Home_Screen and the cached Highest-Rated Experiences section data is 5 minutes old or older, THE App SHALL refresh the Highest-Rated Experiences section data from the Aggregate_Ratings_Service before displaying the section.
8. WHEN a User opens the Home_Screen and the cached Highest-Rated Experiences section data is younger than 5 minutes, THE App SHALL display the cached Highest-Rated Experiences section data without refreshing.
9. THE App SHALL refresh the Highest-Rated Experiences section data at most once every 5 minutes.
10. WHERE between 1 and 9 active Experiences inclusive meet the minimum sample threshold, THE Home_Screen SHALL display all qualifying Experiences in the Highest-Rated Experiences section, ranked according to acceptance criterion 3.
11. WHERE zero active Experiences meet the minimum sample threshold, THE Home_Screen SHALL display an empty-state message in the Highest-Rated Experiences section indicating that no highest-rated Experiences are available.
12. WHILE the Highest-Rated Experiences section is in the empty-state described in acceptance criterion 11, THE App SHALL ignore tap gestures within the section and SHALL NOT open any Experience detail view as a result of those gestures.

### Requirement 12: Experience Images

**User Story:** As a User, I want to see a representative photo for each Experience in the catalog, so that I can visually recognize attractions, shows, and restaurants while browsing and viewing details.

#### Acceptance Criteria

1. THE Catalog_Service SHALL store for each Experience an optional Experience_Image URL that, when present, is between 1 and 2048 characters inclusive, and that is absent when no Experience_Image has been sourced for that Experience.
2. THE Catalog_Service SHALL store for each Experience an optional Image_Attribution value that, when present, is between 1 and 1000 characters inclusive, and that is absent when no Experience_Image has been sourced for that Experience.
3. WHEN a Catalog_Sync reconciles upstream Experience data into the local cache, THE Catalog_Service SHALL leave each existing Experience's stored Experience_Image URL and Image_Attribution values unchanged.
4. WHEN a Catalog_Sync adds a new Experience for a previously unseen ThemeParks_API entity ID, THE Catalog_Service SHALL create that Experience with an absent Experience_Image URL and an absent Image_Attribution value.
5. THE Image_Sourcing_Job SHALL process only active Experiences and SHALL exclude inactive Experiences from processing.
6. WHEN the Image_Sourcing_Job resolves an Experience_Image for an Experience, THE Image_Sourcing_Job SHALL evaluate candidate sources in the following precedence order and select the first source that yields an image: the Image_Override, then a confident Wikipedia article lead-image match, then a confident Wikimedia Commons photo match, then, where park-level fallback is enabled, the Experience's Park image.
7. WHERE an Image_Override exists for an Experience, THE Image_Sourcing_Job SHALL select the Image_Override image as the Experience_Image without consulting any other source.
8. THE Image_Sourcing_Job SHALL match an Image_Override entry to an Experience by comparing the Experience name to the Image_Override key case-insensitively and ignoring punctuation.
9. THE Image_Sourcing_Job SHALL treat a candidate title as a confident match for an Experience name when the Jaccard token similarity between the two names is at least 0.5, or when one name's meaningful tokens (excluding stopwords) are a subset of the other's, subject to a distinctiveness guard that prevents a match based on a single short generic token.
10. WHEN the Image_Sourcing_Job evaluates a Wikimedia Commons candidate, THE Image_Sourcing_Job SHALL accept only raster photo files with a jpg, jpeg, png, or webp extension and SHALL reject SVG, PDF, audio, and video files.
11. WHERE park-level fallback is enabled and no Image_Override, Wikipedia, or Wikimedia Commons match is found for an Experience, THE Image_Sourcing_Job SHALL select the Experience's Park image as the Experience_Image.
12. IF no candidate source yields an image for an Experience, THEN THE Image_Sourcing_Job SHALL leave that Experience's Experience_Image URL and Image_Attribution values absent.
13. WHILE running in default mode, THE Image_Sourcing_Job SHALL process only active Experiences whose Experience_Image URL is absent.
14. WHILE running in force mode, THE Image_Sourcing_Job SHALL process all active Experiences and re-source the Experience_Image for each.
15. WHILE running in dry-run mode, THE Image_Sourcing_Job SHALL report resolved matches and SHALL leave every stored Experience_Image URL and Image_Attribution value unchanged.
16. WHEN the Image_Sourcing_Job stores an Image_Attribution value, THE Image_Sourcing_Job SHALL truncate the attribution text to at most 1000 characters before storing it.
17. THE Image_Sourcing_Job SHALL send a descriptive User-Agent populated from the WIKI_CONTACT configuration value on each request to Wikipedia and Wikimedia Commons.
18. THE Image_Sourcing_Job SHALL wait a politeness delay between successive requests to Wikipedia and Wikimedia Commons.
19. IF a Wikipedia or Wikimedia Commons request returns HTTP status 429 or 503, THEN THE Image_Sourcing_Job SHALL retry the request using backoff that honors the Retry-After header when the header is present.
20. THE Catalog_Service SHALL include in each Experience's catalog response an imageUrl field holding the Experience_Image URL or null and an imageAttribution field holding the Image_Attribution value or null.
21. WHEN the App requests the catalog browse list, THE Catalog_Service SHALL return the imageUrl and imageAttribution fields for each Experience.
22. WHEN the App requests an Experience detail view by Experience identifier, THE Catalog_Service SHALL return the imageUrl and imageAttribution fields for that Experience.
23. WHEN the App displays an Experience on the catalog browse list or the detail view and the Experience's imageUrl is non-null, THE App SHALL display the Experience_Image together with its Image_Attribution.
24. WHEN the App displays an Experience on the catalog browse list or the detail view and the Experience's imageUrl is null, THE App SHALL display a placeholder corresponding to the Experience's Experience_Category in place of an Experience_Image.

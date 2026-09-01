# Requirements Document

## Introduction

Experience Activity Logging enhances the Disney World Tracker by enabling Users to log multiple visits and repeat rides for any Experience over time, attach visit-specific ratings (1–10) and notes to each visit, and view a rich chronological visit history on the Experience Detail screen.

Previously, an Experience could only be marked completed once in the `completions` table with a single static rating in `ratings`. This made it impossible for returning visitors and annual passholders to record riding an attraction again on subsequent park days or trips, or to record changing opinions over time (e.g., rating a restaurant 10/10 on one vacation and 7/10 on another).

This feature introduces the `experience_logs` event stream while preserving the existing `completions` and `ratings` tables as canonical synchronized projections. This dual-layer architecture provides full backwards compatibility for catalog coverage stats, land badges, and community aggregate ratings while unlocking rich repeat-ride counters, trip itineraries, and date-based challenge evaluation.

## Glossary

- **App**: The mobile client and web interfaces of the Disney World Tracker.
- **User**: An authenticated user of the App.
- **Experience**: An individual attraction, show, restaurant, parade, character meet, or resort in the catalog.
- **Experience_Log**: An individual record of a User experiencing an attraction on a specific calendar date and timestamp, with an optional per-visit Rating (1–10) and visit Note.
- **Visit_History**: The ordered chronological list of all Experience_Logs recorded by a User for a specific Experience.
- **Completion**: The canonical record in `completions` representing that a User has experienced an item at least once, used for unique 0–100% catalog coverage statistics.
- **Canonical_Rating**: The single current 1–10 whole-number score in `ratings` representing the User's current assessment, used for community averages and catalog sorting.
- **Canonical_Note**: The shareable personal note in `notes` linked to the social sharing loop.
- **Repeat_Count**: The total number of Experience_Logs recorded by a User for a given Experience.
- **Trip**: A shared or personal vacation container defined in the Trips feature.
- **Trip_Log_Entry**: An entry in `trip_log_entries` recording that an Experience was logged during a specific Trip, linked directly to an `Experience_Log`.
- **Tracking_Service**: The backend service managing completions, logs, ratings, and notes.

## Requirements

### Requirement 1: Log an Experience Activity (Single or Repeat Visit)

**User Story:** As a User, I want to log every time I experience an attraction, show, or restaurant—including repeat rides on the same or different days—so that my vacation journal captures all my park activity.

#### Acceptance Criteria

1. WHEN a User submits a request to log an Experience, THE Tracking_Service SHALL record a new `Experience_Log` containing `id`, `user_id`, `experience_id`, `visited_on` calendar date, `user_tz`, `logged_at` timestamp, optional `rating` (1–10), and optional `note` (1–2000 chars).
2. WHERE a User logs an Experience within the context of an active Trip, THE Tracking_Service SHALL create a matching `Trip_Log_Entry` in `trip_log_entries` linked via `log_id = experience_logs.id` with matching `member_id` and `experience_id`.
3. THE Tracking_Service SHALL allow a User to create multiple distinct `Experience_Log` records for the same Experience on the same calendar date or across different dates.
4. IF a Trip is deleted, THE Tracking_Service SHALL cascade-delete the `trip_log_entries` row (via `trip_id REFERENCES trips(id) ON DELETE CASCADE`) while preserving the User's underlying `Experience_Log` records intact.

### Requirement 2: Synchronization with Canonical Completions and Ratings

**User Story:** As a User, I want my lifetime catalog stats and my current rating to update automatically when I log a visit, so that my profile statistics stay seamless and consistent.

#### Acceptance Criteria

1. WHEN an `Experience_Log` is created for an Experience that the User has not previously completed, THE Tracking_Service SHALL automatically insert a canonical row into `completions` for that `(user_id, experience_id)`.
2. WHEN an `Experience_Log` is created with a rating value, THE Tracking_Service SHALL update or insert the User's Canonical_Rating in `ratings` with that rating and `updated_at = now()`, so that community aggregates and catalog sorting reflect the User's latest assessment.
3. THE Tracking_Service SHALL persist visit notes on `experience_logs.note` without mutating or overwriting the User's Canonical_Note in `notes`.
4. IF a database transaction creating an `Experience_Log` fails or rolls back, THE Tracking_Service SHALL ensure no orphaned completion or rating state is committed.

### Requirement 3: Rode-With Tag Confirmation Integration

**User Story:** As a tagged friend on a trip ride, I want confirming a "rode with" tag to log the ride in my own personal visit history, so that my repeat counts and single-day challenges count the ride.

#### Acceptance Criteria

1. WHEN a tagged User confirms a `rode_with_tags` invite, THE Tracking_Service SHALL insert an `Experience_Log` record for that tagged User with `visited_on` matching the originating log's `visited_on` date.
2. THE Tracking_Service SHALL ensure the tagged User's canonical `completions` record is also recorded if not previously present.

### Requirement 4: Query Visit History for an Experience

**User Story:** As a User viewing an Experience Detail screen, I want to see how many times I have experienced it and review my past visit dates and ratings, so that I can reminisce on my park memories.

#### Acceptance Criteria

1. WHEN a User requests the Visit_History for an Experience (`GET /me/experiences/:id/logs`), THE Tracking_Service SHALL return all `Experience_Log` records for that User and Experience sorted by `visited_on DESC, logged_at DESC`.
2. THE Tracking_Service SHALL include the `id`, `visited_on`, `logged_at`, `rating`, `note`, and `repeat_count` (where `repeat_count === logs.length`) in the Visit_History response payload.
3. IF the User has no `Experience_Log` records for the Experience, THE Tracking_Service SHALL return an empty list with `repeat_count = 0` and HTTP status `200 OK`.

### Requirement 5: Delete an Experience Log Entry

**User Story:** As a User, I want to delete an accidental log entry, so that my visit history and stats remain accurate.

#### Acceptance Criteria

1. WHEN a User requests to delete an `Experience_Log` by its `id` (`DELETE /me/experiences/:id/logs/:logId`), THE Tracking_Service SHALL remove that specific log record if and only if it belongs to the authenticated User.
2. WHERE the deleted `Experience_Log` was the only log for that Experience, THE Tracking_Service SHALL also remove the corresponding canonical `completions` record.
3. WHERE an `Experience_Log` is deleted, THE Tracking_Service SHALL leave the canonical `ratings` row untouched, preserving the User's directly set current rating.

### Requirement 6: Mobile "Your Visit" Card Experience Enhancement

**User Story:** As a mobile App user, I want an intuitive visit card on the Experience Detail screen that displays my total ride count, lets me log another visit with one tap, and shows my past visit history.

#### Acceptance Criteria

1. WHEN the App renders the Experience Detail screen for an Experience the User has logged, THE App SHALL display a badge showing the `Repeat_Count` (e.g. *"Completed • 3 visits"*).
2. THE App SHALL provide a prominent *"Log Visit / Ride Again"* button in the "Your Visit" card.
3. WHEN the User activates the *"Log Visit / Ride Again"* button, THE App SHALL open a modal sheet allowing the User to select a visit date (defaulting to today), assign an optional 1–10 star rating, enter an optional note, and select an active Trip.
4. WHERE an Experience has one or more `Experience_Log` records, THE App SHALL render a collapsible *"Visit History"* timeline displaying each past visit date, rating, and note.
5. WHEN an `Experience_Log` is created or deleted, THE App SHALL immediately invalidate the `['experience-logs', id]`, `['experience-completion', id]`, `['experience-rating', id]`, `['experience-aggregate', id]`, and `['me-stats']` queries to update all UI surfaces.

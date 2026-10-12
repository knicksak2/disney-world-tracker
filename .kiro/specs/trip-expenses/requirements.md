# Requirements Document

## Introduction

The Trip Expenses feature gives a Trip a shared ledger for real money changing hands around the visit — hotel rooms, park tickets, dining, shop purchases, deposits — so the group can see who paid for what, how much each person actually owes, and settle up as they pay each other back, without anyone doing the arithmetic by hand.

This feature **depends on the Trips feature** (`.kiro/specs/trips`), which owns the Trip, Trip_Membership, Trip_Role, the Last_Organizer_Rule, and the Trip_Detail_View hub this feature adds a new section to. It reuses that feature's authorization pattern (membership gate, adder-or-organizer edit/delete rule) rather than inventing a new one, and it is deleted along with a Trip exactly as every other Trip-owned entity is (`trips` R3.7).

The feature is explicitly **not a payments product**. No money is ever moved, charged, or transferred by the App. Every dollar amount recorded here is a group's own bookkeeping of real-world payments that already happened by some other means (cash, Venmo, a shared card) — the App's job is only to compute who owes whom, and to let the group record that a repayment occurred so the running balance reflects reality.

Four ways of describing "who owes what" were identified as genuinely distinct real scenarios, not speculative generality, and all four are in scope for v1:

- **Exact** — the payer types a specific dollar amount for each person who owes something (e.g., fronting a $200 deposit for one other person).
- **Even** — the total is divided evenly among the payer and whichever other people are selected (e.g., a shared hotel room split 50/50), with any leftover penny landing on the payer so the shares always sum exactly to the total.
- **Tiered** — the Expense defines named price tiers (e.g., Adult $139.65, Child $99.65), and each person's share is a count per tier rather than a dollar amount or a formula (e.g., prix-fixe dining, multi-person ticket purchases where different people bought different mixes of adult/child tickets).
- **Itemized** — the payer enters each line item on a receipt with its own price, and assigns each item to one or more people (an item assigned to more than one person splits evenly among just those people); this also covers "I bought one specific thing for one specific person" at a shop.

Itemized entry may additionally be populated by on-device receipt OCR (Requirement 9) as a faster alternative to typing each line by hand; OCR is an input method into the same itemized data, never a separate code path, and the receipt photo is never uploaded or stored — recognition happens entirely on the member's device.

A **Trip_Guest** (Requirement 2) lets a Trip_Member account for a companion who is not an App user (e.g., a spouse or child) without needing their own account; a Guest's share always rolls up into its sponsoring Trip_Member's balance.

Settling up (Requirement 7) is modeled as its own kind of ledger entry — a Settlement — so that partial repayments over time (e.g., paying back a $800 week-of-meals debt in several installments) are representable, not just a single paid/unpaid toggle.

An Expense may optionally link to a Catalog restaurant (Requirement 11), which pre-fills the Description, lets a `tiered` Expense suggest its tier prices from that restaurant's already-synced menu text (e.g. a buffet's listed "$57 per adult" / "$37 per child" pricing), and lets Receipt_Scan cross-check recognized item names against that restaurant's known menu items — every suggestion is reviewed and confirmed by the member before it is saved, never applied silently, because a menu's listed price does not reflect discounts, comps, or promotions that only the real receipt shows.

A reduction in what was actually owed after an Expense was recorded (e.g. a canceled deposit refunded, a billing dispute resolved) is recorded as a Refund against the original Expense (Requirement 12) rather than by editing the original Amount, so the ledger keeps a visible record that a refund occurred instead of silently rewriting history.

The following capabilities are explicitly out of scope for v1 and are noted as future work: real payment processing or money movement of any kind, multi-currency support and foreign-exchange conversion, persisting the receipt photo used for OCR, and OCR via any third-party cloud vision service (on-device OCR only).

## Glossary

- **Trip**: The existing entity defined by the `trips` feature; a named shared Walt Disney World visit with Trip_Members holding a Trip_Role.
- **Trip_Member**: An existing User who has joined a Trip, per the `trips` feature.
- **Trip_Role**: `organizer` or `member`, per the `trips` feature's permission matrix.
- **Trip_Guest**: A non-account companion recorded against a Trip, identified by a free-text Guest_Name and a sponsoring Trip_Member, usable only as an Expense_Share recipient, never as a Payer. A Trip_Guest holds no login and no balance of its own; every amount attributed to a Trip_Guest is folded into its Sponsoring_Member's Net_Balance.
- **Sponsoring_Member**: The Trip_Member who added a Trip_Guest and whose net balance absorbs that Guest's shares.
- **Expense**: A single real-world payment recorded against a Trip: a Payer (a Trip_Member), a total Amount, a Description, a Date, an optional Category, a Split_Mode, and the resulting Expense_Shares.
- **Payer**: The Trip_Member recorded as having actually paid for an Expense.
- **Amount**: The total cost of an Expense, stored as an integer count of USD cents.
- **Split_Mode**: The method used to determine Expense_Shares for an Expense: `exact`, `even`, `tiered`, or `itemized`.
- **Expense_Share**: A record that one Trip_Member or Trip_Guest owes a specific amount back to the Payer for a given Expense. The Payer's own portion is never a stored Expense_Share; it is always the Amount minus the sum of that Expense's shares.
- **Expense_Tier**: For a `tiered` Expense, one named price category (e.g., "Adult", "Child") with its own per-unit price, scoped to that Expense only.
- **Tier_Count**: For a `tiered` Expense, the number of units of a given Expense_Tier attributed to one Trip_Member or Trip_Guest; that person's Expense_Share amount is the sum of `Tier_Count × tier price` across every Expense_Tier of that Expense.
- **Expense_Item**: For an `itemized` Expense, one receipt line with a Name and a Price, assigned to one or more Trip_Members/Trip_Guests (an Assignee_Set); when the Assignee_Set has more than one member, the item's price splits evenly among just that set, with any leftover penny assigned deterministically (Requirement 5).
- **Item_Subtotal**: For one Trip_Member or Trip_Guest on an `itemized` Expense, the sum of their attributed portions across every Expense_Item that names them as an Assignee, before any Charge_Line is applied.
- **Charge_Line**: On an `itemized` Expense, a bill-level adjustment of kind `tax`, `gratuity`, `fee`, or `discount`, with a signed Amount (`discount` is negative; the others are positive). Unless scoped to a subset of Expense_Items, a Charge_Line's Amount is allocated across every Expense_Item's Assignees in proportion to each person's Item_Subtotal (Requirement 5).
- **Receipt_Scan**: An on-device OCR pass over a photographed or picked receipt image that produces a draft list of Expense_Items and Charge_Lines for the member to review before any of it is saved.
- **Refund**: A record that part or all of an Expense's Amount was returned to the Payer after the fact, reducing that Expense's effective Amount for balance purposes while leaving the original Expense and the Refund both visible in the ledger (Requirement 12).
- **Net_Balance**: For one Trip_Member, the sum across every Expense on the Trip of (amounts owed to them as Payer) minus (amounts they owe as an Expense_Share, including any Expense_Shares attributed to Trip_Guests they sponsor) minus (net Settlements paid) plus (net Settlements received), as of the current moment.
- **Settlement**: A record that one Trip_Member paid another Trip_Member a specific Amount outside the App (cash, Venmo, etc.), reducing the Net_Balance between that pair accordingly. A single debt may be covered by more than one Settlement over time (partial repayment).
- **Trip_Expenses_Section**: The new section of the Trip_Detail_View hub (alongside Planned_List, Trip_Activity, Trip_Members, Trip_Summary, and Reservations) that presents this feature.
- **Expense_Ledger_Screen**: The screen reached from the Trip_Expenses_Section listing every Expense and Settlement on the Trip.
- **Balances_View**: The view, reached from the Trip_Expenses_Section, showing each Trip_Member's current Net_Balance with a drill-down into the Expenses and Settlements that produced it.

## Requirements

### Requirement 1: Record an Expense

**User Story:** As a Trip_Member, I want to record a payment I made on behalf of the group, so that the group has a shared, accurate record of who paid for what.

#### Acceptance Criteria

1. WHEN a Trip_Member submits an `exact`, `even`, or `tiered` Expense with a Payer, an Amount greater than zero, a Description, a Date, and a Split_Mode, THE Trip_Service SHALL create the Expense and return it including its unique identifier; for an `itemized` Expense, THE Trip_Service SHALL instead derive the Amount per Requirement 5.14 and SHALL NOT require it as a submitted field.
2. THE Trip_Service SHALL require the Payer of an Expense to be a Trip_Member of that Trip, and SHALL reject an Expense naming a Payer who is not a Trip_Member with `trip_validation_failed`.
3. THE Trip_Service SHALL store the Amount as an integer count of USD cents and SHALL reject a non-integer, zero, or negative Amount, or an Amount exceeding $100,000.00 (10,000,000 cents), with `trip_validation_failed`, applying this bound to the derived Amount in the `itemized` case as well.
4. IF an `exact`, `even`, or `tiered` Expense submission omits the Payer, the Amount, the Description, the Date, or the Split_Mode, THEN THE Trip_Service SHALL reject the request with `trip_validation_failed` identifying the missing field and SHALL NOT create an Expense; IF an `itemized` Expense submission omits the Payer, the Description, the Date, or the Split_Mode, THEN THE Trip_Service SHALL apply the same rejection without requiring an Amount.
5. IF an Expense's Description is empty after trimming or longer than 200 characters, THEN THE Trip_Service SHALL reject the request with `trip_validation_failed`.
6. THE Trip_Service SHALL accept an optional Category on an Expense from the closed vocabulary `hotel`, `tickets`, `dining`, `shopping`, `transportation`, `other`, and SHALL reject any other value with `trip_validation_failed`.
7. IF a User who is not a Trip_Member of a Trip attempts to create an Expense on that Trip, THEN THE Trip_Service SHALL reject the request with `trip_forbidden` and SHALL NOT create an Expense.
8. WHEN the Trip_Service creates an Expense, THE Trip_Service SHALL record the Trip_Member who submitted the request as the Expense's creator, independent of who is named as Payer, so that one member may log a payment made by another.
9. WHEN the Trip_Service creates an Expense whose Expense_Shares (directly or via a sponsored Trip_Guest) name one or more Trip_Members other than the submitter, THE Notification_Service SHALL create an in-App notification addressed to each such Trip_Member indicating that an Expense was recorded naming them, and THE Push_Service SHALL send a push notification whose deep-link target opens that Expense.
10. WHEN an edit to an existing Expense changes the Amount any affected Trip_Member owes, adds a new Trip_Member to its Expense_Shares, or removes one, THE Notification_Service SHALL notify each newly-affected or changed-amount Trip_Member following the same rule as Requirement 1.9.
11. THE Trip_Service SHALL permit an Expense's Date to fall before, within, or after the Trip's Trip_Start_Date–Trip_End_Date range, and SHALL NOT reject or re-date an Expense on that basis, so that pre-trip costs (deposits, tickets, hotel payments made months in advance) and any post-trip adjustment are both representable, consistent with the existing Trips feature's handling of an out-of-range Reservation date (`trip-reservations` R2.7).
12. IF a Trip_Member adds an Expense to a Trip that already holds 1,000 Expenses, THEN THE Trip_Service SHALL reject the request with `trip_validation_failed`, consistent with the existing per-Trip cap pattern (`trips` R9.5's 500-item Planned_List cap).
13. THE Mobile_App SHALL provide an interactive DatePickerField calendar control on the Add/Edit Expense form to select the Expense Date, formatting the selected date as a YYYY-MM-DD string.

### Requirement 2: Trip Guests

**User Story:** As a Trip_Member, I want to account for a companion who doesn't use the App, so that their share of a cost is tracked without needing them to have an account.

#### Acceptance Criteria

1. WHEN a Trip_Member adds a Trip_Guest with a Guest_Name, THE Trip_Service SHALL create a Trip_Guest on that Trip sponsored by the selected Trip_Member (defaulting to the submitting Trip_Member if none is specified). IF the specified sponsor is not a Trip_Member of that Trip, THEN THE Trip_Service SHALL reject the request with `trip_validation_failed`.
2. THE Trip_Service SHALL require a Guest_Name of 1 to 100 characters after trimming, and SHALL reject an empty or over-length Guest_Name with `trip_validation_failed`.
3. THE Trip_Service SHALL add a Trip_Guest to a standing per-Trip roster so it can be reused across multiple Expenses rather than re-entered each time.
4. IF a User who is not a Trip_Member of a Trip attempts to add a Trip_Guest to that Trip, THEN THE Trip_Service SHALL reject the request with `trip_forbidden`.
5. THE Trip_Service SHALL permit an Expense_Share to name either a Trip_Member or a Trip_Guest of the same Trip, and SHALL reject an Expense_Share naming a Trip_Member, Trip_Guest, or Guest_Name belonging to a different Trip with `trip_validation_failed`.
6. THE Trip_Service SHALL NOT permit a Trip_Guest to be named as the Payer of an Expense, and SHALL reject such a request with `trip_validation_failed`.
7. WHEN computing a Sponsoring_Member's Net_Balance, THE Trip_Service SHALL include every Expense_Share attributed to that member's Trip_Guests as if it were attributed to the Sponsoring_Member directly.
8. WHEN the Balances_View or any drill-down presents amounts owed by a Trip_Guest, THE Mobile_App SHALL display the Guest_Name alongside the Sponsoring_Member's display name so the amount's origin is traceable (e.g., "Bob's wife owes $139.65").
9. WHEN a Trip_Member who sponsors one or more Trip_Guests removes a Trip_Guest, THE Trip_Service SHALL permit the removal only when that Trip_Guest has no Expense_Share, Expense_Item assignment, or Tier_Count on any Expense of the Trip, and SHALL otherwise reject the removal with `trip_validation_failed`.
10. THE Trip_Service SHALL permit only the Sponsoring_Member or a Trip Organizer to remove a Trip_Guest, and SHALL reject removal by any other Trip_Member with `trip_forbidden`.
11. WHEN a Sponsoring_Member or Trip Organizer edits a Trip_Guest, THE Trip_Service SHALL permit updating the Guest_Name and optionally reassigning the Trip_Guest to another Trip_Member of that Trip as the sponsor. IF the reassigned sponsor is not a Trip_Member of that Trip, THEN THE Trip_Service SHALL reject the request with `trip_validation_failed`.
12. THE Mobile_App SHALL provide a sponsor selector when adding a Trip_Guest and when editing a Trip_Guest, allowing the user to select which Trip_Member the Trip_Guest is tied to.

### Requirement 3: Exact and Even Split Modes

**User Story:** As a Trip_Member, I want to either specify exactly what someone owes or split a cost evenly without doing the math myself, so that I can record a debt the way it actually works.

#### Acceptance Criteria

1. WHERE an Expense's Split_Mode is `exact`, THE Trip_Service SHALL accept zero or more Expense_Shares each naming a Trip_Member or Trip_Guest and an explicit Amount, and SHALL reject a submission whose Expense_Shares sum to more than the Expense's Amount with `trip_validation_failed`.
2. WHERE an Expense's Split_Mode is `exact`, THE Trip_Service SHALL reject a negative or zero individual Expense_Share Amount with `trip_validation_failed`.
3. WHERE an Expense's Split_Mode is `even`, THE Mobile_App SHALL present the Payer and the Trip's Trip_Members and Trip_Guests as selectable participants, with the Payer selected by default and removable.
4. WHERE an Expense's Split_Mode is `even`, THE Trip_Service SHALL divide the Amount evenly in integer cents among every selected participant other than the Payer, computing each non-Payer Expense_Share as `floor(Amount / participantCount)`, and SHALL assign any remaining cents (`Amount mod participantCount`) to the Payer's own implicit (unstored) portion so that the stored Expense_Shares plus the Payer's portion always sum to exactly the Amount.
5. WHERE an Expense's Split_Mode is `even` and the Payer is deselected as a participant, THE Trip_Service SHALL divide the Amount evenly in integer cents among the remaining selected participants only, with the Payer's implicit portion equal to zero.
6. IF an Expense's Split_Mode is `even` and fewer than one other participant is selected, THEN THE Trip_Service SHALL reject the request with `trip_validation_failed`.
7. THE Trip_Service SHALL reject an Expense_Share naming the same Trip_Member or Trip_Guest more than once on a single Expense with `trip_validation_failed`.

### Requirement 4: Tiered Split Mode

**User Story:** As a Trip_Member, I want to define per-category prices like adult and child, and just say how many of each a person is covering, so that I don't have to compute totals for mixed groups myself.

#### Acceptance Criteria

1. WHERE an Expense's Split_Mode is `tiered`, THE Trip_Service SHALL accept one or more Expense_Tiers, each with a Tier_Name of 1 to 40 characters and a per-unit price in integer cents greater than zero, scoped to that Expense only.
2. WHERE an Expense's Split_Mode is `tiered`, THE Trip_Service SHALL accept, for each Expense_Share, one or more Tier_Counts naming an Expense_Tier of the same Expense and a count of 1 or greater, and SHALL compute that Expense_Share's Amount as the sum of `Tier_Count × that tier's price` across its Tier_Counts.
3. IF a Tier_Count names an Expense_Tier that does not belong to the same Expense, THEN THE Trip_Service SHALL reject the request with `trip_validation_failed`.
4. THE Trip_Service SHALL reject a `tiered` Expense whose sum of all Expense_Shares' computed Amounts exceeds the Expense's Amount with `trip_validation_failed`.
5. THE Trip_Service SHALL treat the difference between the Expense's Amount and the sum of computed Expense_Share Amounts as the Payer's own implicit, unstored portion, consistent with every other Split_Mode.
6. IF a `tiered` Expense submission includes zero Expense_Tiers, THEN THE Trip_Service SHALL reject the request with `trip_validation_failed`.
7. THE Mobile_App SHALL automatically compute and display the sum of `Tier_Count × that tier's price` across all participant tier counts as the derived tiers total in the tiered Expense form, SHALL auto-populate the Expense Amount with this derived total, and SHALL display per-tier quantity and subtotal summaries as well as per-participant computed subtotals.

### Requirement 5: Itemized Split Mode

**User Story:** As a Trip_Member, I want to enter a receipt's individual items and say who each one is for, so that costs that aren't a clean split (like buying something just for one person, or a mix of shared and individual items) are recorded accurately.

#### Acceptance Criteria

1. WHERE an Expense's Split_Mode is `itemized`, THE Trip_Service SHALL accept one or more Expense_Items, each with a Name of 1 to 100 characters and a Price in integer cents greater than zero.
2. THE Trip_Service SHALL require every Expense_Item to have at least one Assignee (a Trip_Member or Trip_Guest of the same Trip), and SHALL reject an Expense_Item with zero Assignees with `trip_validation_failed`.
3. WHEN an Expense_Item has exactly one Assignee, THE Trip_Service SHALL attribute its full Price to that Assignee.
4. WHEN an Expense_Item has more than one Assignee, THE Trip_Service SHALL split its Price evenly in integer cents among its Assignees, computing each Assignee's portion as `floor(Price / assigneeCount)` and assigning the remaining cents (`Price mod assigneeCount`) one cent at a time, in the Assignee list's order, so the portions always sum to exactly the Price.
5. THE Mobile_App SHALL offer an "everyone on this expense" control that assigns an Expense_Item to the Payer plus every other participant already added to the Expense in one action, so a communal item does not require selecting each person individually.
6. THE Trip_Service SHALL compute each Trip_Member's or Trip_Guest's Expense_Share Amount for an `itemized` Expense as the sum of their attributed portions across every Expense_Item that names them as an Assignee, excluding items wholly or partly assigned to the Payer from the Payer's own Expense_Share (the Payer is never charged a stored Expense_Share against themselves).
7. THE Trip_Service SHALL reject an `itemized` Expense submission containing zero Expense_Items with `trip_validation_failed`.
8. THE Trip_Service SHALL accept zero or more Charge_Lines on an `itemized` Expense, each with a kind of `tax`, `gratuity`, `fee`, or `discount`, and an Amount in integer cents; THE Trip_Service SHALL store a `discount` Charge_Line's Amount as negative and every other kind's Amount as positive, and SHALL reject a Charge_Line whose sign does not match its kind with `trip_validation_failed`.
9. WHERE a Charge_Line's kind is `gratuity`, THE Mobile_App SHALL additionally offer entry as a percentage (e.g. 18%, 20%, 22%, or a custom value) of the sum of the Item_Subtotals of that Charge_Line's Assignees (its full scope, or its explicit Expense_Item subset per Requirement 5.11), computing the resulting Amount as `round(percentage × that sum)` in integer cents before the Charge_Line is submitted; THE Trip_Service SHALL store only the resulting Amount and SHALL have no separate persisted representation for a percentage-entered Charge_Line versus a flat-dollar one.
10. WHERE a Charge_Line is not scoped to a subset of Expense_Items, THE Trip_Service SHALL allocate its Amount across every Expense_Item's Assignees in proportion to each Assignee's Item_Subtotal, computing each Assignee's portion as `round(ChargeLine.amount × assignee's Item_Subtotal / sum of all Assignees' Item_Subtotals)` in integer cents, and SHALL assign any leftover cent(s) arising from rounding to the Payer's implicit portion.
11. WHERE a Charge_Line is scoped to an explicit subset of Expense_Items, THE Trip_Service SHALL allocate its Amount only in proportion to the Item_Subtotals of the Assignees of that subset, following the same proportional rule as Requirement 5.10, and SHALL reject a Charge_Line scoped to zero Expense_Items with `trip_validation_failed`.
12. THE Trip_Service SHALL permit an Expense_Item to be flagged `isAlcohol`, and WHEN a member creates or edits a `discount` Charge_Line, THE Mobile_App SHALL offer an "exclude alcohol items" option that, when enabled, scopes that Charge_Line to every Expense_Item on the Expense that is not flagged `isAlcohol`, so a discount that does not apply to alcohol (a common restriction on Disney's own discounts) is not spread onto alcohol purchases or onto people who did not order one.
13. THE Trip_Service SHALL compute each Trip_Member's or Trip_Guest's final Expense_Share Amount for an `itemized` Expense as their Item_Subtotal plus their allocated portion of every applicable Charge_Line (a negative contribution for a `discount`).
14. FOR an `itemized` Expense, THE Trip_Service SHALL derive the Expense's Amount as the sum of all Expense_Item Prices plus all Charge_Line Amounts, rather than accepting it as a separately submitted value, so the receipt's own total is always the ledger total; THE Trip_Service SHALL reject an itemized Expense whose derived Amount is zero or negative with `trip_validation_failed`.
15. THE Trip_Service SHALL verify that every `itemized` Expense's Expense_Shares, summed with the Payer's own implicit portion, total exactly the derived Amount from Requirement 5.14, as an internal invariant rather than a user-facing validation.

### Requirement 6: Net Balances

**User Story:** As a Trip_Member, I want to see one clear number for who owes whom, with the ability to see exactly how we got there, so that the group can trust the ledger without re-deriving it by hand.

#### Acceptance Criteria

1. THE Trip_Service SHALL derive each Trip_Member's Net_Balance from every Expense and Settlement on the Trip, and SHALL NOT persist Net_Balance as an independently stored or editable field.
2. THE Trip_Service SHALL compute a Trip_Member's Net_Balance as: the sum of Expense_Share Amounts owed to them as Payer across every Expense, minus the sum of Expense_Share Amounts they owe (including any attributed to their Trip_Guests) across every Expense, minus Settlement Amounts they have paid, plus Settlement Amounts they have received.
3. THE Balances_View SHALL present each Trip_Member's Net_Balance as a single signed amount (positive meaning the group owes them, negative meaning they owe the group), and SHALL report `0` for a Trip_Member with no Expense or Settlement activity.
4. THE Balances_View SHALL provide a drill-down, for any Trip_Member, listing every Expense and Settlement that contributed to their current Net_Balance, each showing its Description or counterparty, Date, and signed contribution amount.
5. THE Trip_Service SHALL additionally derive, for every pair of Trip_Members with a nonzero mutual balance, a simplified pairwise amount describing what the net result would be if that pair settled directly with each other, and THE Balances_View SHALL offer this pairwise view as an alternative to the single per-member net total.
6. THE Trip_Service SHALL compute the Net_Balance of every Trip_Member such that the sum of all Trip_Members' Net_Balances on a Trip is always exactly zero, within the integer-cent precision the ledger is stored in.
7. THE Balances_View and THE Expense_Ledger_Screen SHALL provide a pairwise transaction breakdown between any two Trip_Members, listing all mutual expenses and settlements that contribute to their pairwise balance, accessible by selecting any pairwise balance card or member debt item, and offering a control to record a settlement between the pair. THE pairwise transaction breakdown SHALL visually distinguish settlements from expenses with dedicated payment card styling (distinct border and background tint, payment badge, and payer/recipient attribution) and SHALL present settlements as balance-reducing debt deductions (`-`), and mutual expense shares as debt additions (`+`), such that the net sum of displayed entries matches the exact pairwise balance.


### Requirement 7: Settlements

**User Story:** As a Trip_Member, I want to record that I paid someone back, including partial payments over time, so that our balances reflect what has actually been settled.

#### Acceptance Criteria

1. WHEN a Trip_Member submits a Settlement with a Payer, a Recipient, an Amount greater than zero, and a Date, THE Trip_Service SHALL create the Settlement and apply it to the Net_Balance between that Payer and Recipient.
2. THE Trip_Service SHALL require both the Payer and the Recipient of a Settlement to be Trip_Members of the Trip and distinct from each other, and SHALL reject a Settlement naming a Trip_Guest as Payer or Recipient, or naming the same Trip_Member as both, with `trip_validation_failed`.
3. THE Trip_Service SHALL permit any number of Settlements between the same pair of Trip_Members over time, so that a debt may be paid back in multiple partial amounts rather than requiring a single full-amount Settlement.
4. THE Trip_Service SHALL NOT require a Settlement's Amount to match any particular outstanding balance, and SHALL permit a Settlement that would bring a pairwise balance past zero in either direction, consistent with the ledger being a record of real-world payments rather than a constrained transfer.
5. IF a User who is not a Trip_Member of a Trip attempts to create a Settlement on that Trip, THEN THE Trip_Service SHALL reject the request with `trip_forbidden`.
6. THE Expense_Ledger_Screen SHALL list Settlements interleaved with Expenses in Date order, each visually distinguishable as a Settlement rather than an Expense.
7. WHEN a Trip_Member views the Balances_View and a pairwise balance is nonzero, THE Mobile_App SHALL offer a control to record a Settlement pre-filled with that pair and the simplified pairwise amount from Requirement 6.5, which the member may adjust before submitting.

### Requirement 8: Editing, Removing, and Trip Lifecycle Interaction

**User Story:** As a Trip_Member, I want to fix a mistake in an Expense or Settlement I logged, and as an Organizer I want override authority, so that the ledger stays accurate without being locked to whoever typed it first.

#### Acceptance Criteria

1. THE Trip_Service SHALL permit the Trip_Member who created an Expense or Settlement, or any Organizer of the Trip, to edit or remove it, and SHALL reject an edit or removal attempt by any other Trip_Member with `trip_forbidden`.
2. WHEN an Expense or Settlement is edited, THE Trip_Service SHALL apply the same validation rules as creation (Requirements 1, 3, 4, 5, 7) to the edited result, and SHALL reject an edit that would violate them with `trip_validation_failed`, leaving the stored record unchanged.
3. WHEN an edit to an Expense changes its Split_Mode, THE Trip_Service SHALL discard every existing Expense_Share, Expense_Tier, Tier_Count, Expense_Item, and Charge_Line belonging to that Expense and SHALL require the edit to submit a complete set of data valid for the new Split_Mode under Requirements 3, 4, or 5, rather than attempting to carry any prior Split_Mode's data forward.
4. WHEN an Expense or Settlement is removed, THE Trip_Service SHALL delete it together with its Expense_Shares, Expense_Tiers, Expense_Items, Charge_Lines, and any Refunds against it, such that a subsequent read of the Trip's Net_Balance no longer reflects it.
5. WHEN a Trip_Member leaves or is removed from a Trip, THE Trip_Service SHALL preserve every Expense, Settlement, Expense_Share, Refund, and Trip_Guest associated with that former Trip_Member exactly as recorded, consistent with the existing Trips feature's preservation of Trip_Log_Entries on departure (`trips` R8.5).
6. WHEN a Trip is deleted, THE Trip_Service SHALL delete every Expense, Expense_Share, Expense_Tier, Expense_Item, Charge_Line, Refund, Trip_Guest, and Settlement belonging to that Trip as part of the same cascade that removes its other Trip-owned entities (`trips` R3.7).

### Requirement 9: Itemized Entry via On-Device Receipt Scan

**User Story:** As a Trip_Member, I want to photograph a receipt and have its items pre-filled, so that I don't have to type out every line by hand.

#### Acceptance Criteria

1. WHEN a Trip_Member chooses to scan a receipt while creating or editing an `itemized` Expense, THE Mobile_App SHALL capture or select a photo and run on-device text recognition against it, and SHALL NOT upload or persist the photo to the Trip_Service or any other server.
2. THE Mobile_App SHALL parse the on-device recognition output into a draft list of Expense_Items (Name and Price) and draft Charge_Lines (kind and Amount), using a pure, independently testable parsing function that distinguishes item lines from subtotal, tax, gratuity/tip, fee, and discount lines by their text pattern.
3. WHEN a Receipt_Scan produces a draft list of Expense_Items, THE Mobile_App SHALL present every draft item and draft Charge_Line for the member's review and SHALL require the member to confirm, edit, merge, split, or delete each item and Charge_Line and assign each item's Assignees before any Expense_Item or Charge_Line is submitted to the Trip_Service.
4. THE Trip_Service SHALL apply the identical validation rules to Expense_Items and Charge_Lines regardless of whether they originated from manual entry or a Receipt_Scan (Requirement 5), and SHALL have no code path or data field that distinguishes their origin.
5. IF on-device text recognition produces no usable text or the parser identifies zero candidate line items, THEN THE Mobile_App SHALL inform the member that no items were detected and SHALL fall back to manual itemized entry without error.
6. THE Mobile_App SHALL detect a recognized subtotal line when present and display it to the member as context alongside the draft items and Charge_Lines, without creating an Expense_Item or Charge_Line for it.
7. THE on-device text recognition SHALL run without any network request, server-side OCR call, or third-party cloud vision service, so the feature incurs no per-scan cost and requires no new credential or vendor integration.
8. THE Mobile_App's parsing function SHALL flag a draft Expense_Item as a candidate `isAlcohol` item when its recognized name matches a maintained list of common alcoholic-beverage terms (e.g. "beer", "wine", "cocktail", known Disney bar/lounge drink names), and SHALL present this flag to the member as a pre-checked but editable suggestion on the review screen (Requirement 9.3) rather than a silently applied classification, because text-pattern matching on a photographed receipt will not catch every case.
9. WHERE the itemized Expense is linked to a Catalog restaurant (Requirement 11) with a cached menu, THE Mobile_App's parsing function SHALL attempt to match each recognized item name against that restaurant's known menu item names and, on a confident match, SHALL suggest the matched menu item's name as a correction to the member on the review screen, without replacing the member's own edit if they have already changed it.
10. WHEN reviewing a draft list of Expense_Items produced by a Receipt_Scan, THE Mobile_App SHALL offer a control to capture or select an additional photo of the same receipt and run on-device text recognition against it, appending the resulting draft Expense_Items and Charge_Lines to the existing draft list rather than replacing it, so a receipt that does not fit in a single photo (e.g. a long itemized grocery or gift-shop receipt) can be scanned across multiple photos before the member reviews and confirms the combined list.
11. THE Mobile_App SHALL run the duplicate-subtotal/tax/total detection of Requirement 9.6 independently per photo, so that a total line appearing on a later photo of the same multi-photo receipt (e.g. a repeated running total) is identified and excluded the same way as on the first photo.
12. THE Mobile_App SHALL permit the member to remove any photo's contribution from the combined draft list before confirming, so a misscanned or duplicate photo in a multi-photo Receipt_Scan can be discarded without restarting the entire scan.

### Requirement 10: Trip Expenses Section and Authorization

**User Story:** As a Trip_Member, I want to find the group's expenses from the Trip hub, and be confident nobody outside the Trip can see our financial details, so that the ledger is both discoverable and private.

#### Acceptance Criteria

1. THE Trip_Detail_View SHALL present a Trip_Expenses_Section alongside the existing Planned_List, Trip_Activity, Trip_Members, Trip_Summary, and Reservations sections, which opens the Expense_Ledger_Screen and the Balances_View for that Trip.
2. THE Trip_Service SHALL gate every Expense, Expense_Share, Expense_Tier, Expense_Item, Trip_Guest, and Settlement read and write behind the existing Trip membership check, and SHALL collapse a non-member caller or an unknown Trip to `trip_forbidden` so Trip existence cannot be probed, consistent with the existing Trips feature's authorization pattern (`trips` R-series membership gating, `trip-reservations` R6.1).
3. THE Trip_Service SHALL NOT include any Expense, Settlement, or balance data in the Trip Feed, the Trip Summary, or any shared or public surface that is not membership-gated.
4. THE Trip_Service SHALL NOT require a new Trip_Action beyond those enumerated in the `trips` feature's permission matrix, because Expense and Settlement creation are available to every Trip_Member (consistent with `trips` R4.3's `create_log_entry`-style member actions) and edit/removal follows the adder-or-organizer rule already established for Planned_Items (`trips` R9.6–R9.8).
5. THE Mobile_App SHALL provide an integrated balance overview on the Expense_Ledger_Screen showing the user's current net position, simplified direct debts, and quick navigation or tab toggle to full pairwise debts and member balances, and SHALL display on each Expense row the user's personal share and an expandable split breakdown of each participant's share.

### Requirement 11: Linking an Expense to a Catalog Restaurant or Resort

**User Story:** As a Trip_Member, I want to tie a dining or hotel expense to the actual restaurant or resort, so that the app can help pre-fill details and I don't have to type everything from scratch.

#### Acceptance Criteria

1. WHEN a Trip_Member creates or edits an Expense whose Category is `dining`, THE Mobile_App SHALL offer a Catalog restaurant picker (an Experience whose `category` is `Restaurant`), and THE Trip_Service SHALL accept an optional `experienceId` on the Expense referencing that restaurant.
2. WHEN a Trip_Member creates or edits an Expense whose Category is `hotel`, THE Mobile_App SHALL offer a Catalog Resort picker, and THE Trip_Service SHALL accept an optional `resortId` on the Expense referencing that Resort.
3. WHEN an Expense is linked to a Catalog restaurant or Resort and the member has not yet entered a Description, THE Mobile_App SHALL pre-fill the Description with that restaurant's or Resort's name, remaining editable before submission.
4. WHERE an Expense linked to a Catalog restaurant uses Split_Mode `tiered`, AND that restaurant has a cached menu (per the `restaurant-menu-display` feature's Menu_Cache) containing a recognizable per-person pricing line (e.g. text matching a "$X per adult" / "$X per child" pattern), THE Mobile_App SHALL suggest Expense_Tiers pre-filled with the matched tier names and prices, which the member may accept, edit, or discard before submission; THE Trip_Service SHALL NOT persist a suggested Expense_Tier that the member has not explicitly confirmed.
5. IF no recognizable per-person pricing line is found in a linked restaurant's cached menu, THEN THE Mobile_App SHALL fall back to empty manual Expense_Tier entry without error.
6. THE Trip_Service SHALL reject an `experienceId` that does not reference a Restaurant_Experience, or a `resortId` that does not reference a Catalog Resort, or either referencing an entity not found in the Catalog, with `trip_validation_failed`.
7. THE Trip_Service SHALL treat the restaurant/Resort link as informational only: removing the link, or the linked Experience or Resort later being deactivated in the Catalog, SHALL NOT alter any already-stored Expense_Share, Expense_Tier, or Expense_Item.
8. THE Trip_Service SHALL NOT offer a Catalog link for an Expense of any other Category (`tickets`, `shopping`, `transportation`, `other`), because gift shops, transportation providers, and other retail are not individually modeled as Catalog entities; those Expenses are recorded through `exact`, `even`, `tiered`, or `itemized` Split_Mode with no Catalog reference.

### Requirement 12: Refunds

**User Story:** As a Trip_Member, I want to record that part or all of a payment was refunded, so that the ledger reflects what we actually ended up owing without erasing the record of what originally happened.

#### Acceptance Criteria

1. WHEN a Trip_Member submits a Refund against an existing Expense with an Amount greater than zero and a Date, THE Trip_Service SHALL create the Refund and reduce that Expense's effective Amount for Net_Balance purposes by the Refund's Amount.
2. THE Trip_Service SHALL reject a Refund whose Amount, combined with the sum of any prior Refunds against the same Expense, exceeds that Expense's original Amount, with `trip_validation_failed`, so an Expense's effective Amount never goes negative.
3. WHEN one or more Refunds exist against an Expense, THE Trip_Service SHALL reduce every one of that Expense's Expense_Shares (and the Payer's own implicit portion) proportionally to their original share of the Expense's Amount, using the same integer-cent proportional allocation and remainder rule as Requirement 5.10, so a refund is distributed the same way the original cost was split.
4. THE Expense_Ledger_Screen and THE Balances_View drill-down SHALL display a Refund as a distinct, visible entry tied to its original Expense (e.g., "Hotel deposit: $300, Refunded: $50, Net: $250"), and SHALL NOT delete, hide, or merge the original Expense's recorded Amount.
5. THE Trip_Service SHALL permit the Trip_Member who created the original Expense, or any Organizer of the Trip, to create, edit, or remove a Refund against it, and SHALL reject such a request from any other Trip_Member with `trip_forbidden`.
6. IF a User who is not a Trip_Member of a Trip attempts to create a Refund on that Trip, THEN THE Trip_Service SHALL reject the request with `trip_forbidden`.

### Requirement 13: Filtering, Post-Trip Settle-Up, and Export

**User Story:** As a Trip_Member, I want to find specific entries in a long ledger, be reminded to settle up once the trip is over, and keep a copy of the record afterward, so that the feature stays usable for a busy multi-day trip and beyond.

#### Acceptance Criteria

1. THE Expense_Ledger_Screen SHALL provide controls to filter its list by Category and by Payer, applied in combination, and SHALL retain the unfiltered Date ordering within the filtered results.
2. WHEN a Trip's Trip_Status (per the `trips` feature) is `past` and one or more Trip_Members have a nonzero Net_Balance, THE Trip_Expenses_Section SHALL display a banner inviting the group to settle up, linking to the Balances_View, and SHALL NOT display this banner once every Trip_Member's Net_Balance is zero.
3. THE Trip_Expenses_Section SHALL offer an export of the Trip's Expenses, Expense_Shares (with Trip_Guest attributions resolved to "Sponsor's name — Guest_Name"), and Settlements as a CSV file covering the full Trip, generated on demand and not persisted server-side beyond the request that produced it.
4. THE Trip_Service SHALL permit any Trip_Member to request the export, consistent with export being a read operation gated the same as every other Expense read (Requirement 10.2).

### Requirement 14: Alcohol-Excluded Discounts

**User Story:** As a Trip_Member, I want to apply a discount that doesn't cover alcoholic drinks, so that the people who ordered drinks don't get an unearned discount and the ledger matches what Disney's discount actually covers.

#### Acceptance Criteria

1. THE Trip_Service SHALL permit an Expense_Item on an itemized Expense to be flagged `isAlcohol`, defaulting to unflagged, settable and editable by the member regardless of whether the item originated from manual entry or a Receipt_Scan.
2. WHEN a member creates or edits a `discount` Charge_Line, THE Mobile_App SHALL offer an "exclude alcohol items" toggle; WHEN enabled, THE Trip_Service SHALL scope that Charge_Line to exactly the Expense_Items on the Expense not flagged `isAlcohol`, consistent with Requirement 5.10's scoped-allocation rule.
3. THE Trip_Service SHALL NOT infer or apply any alcohol-exclusion rule automatically based on Expense Category, restaurant link, or any other signal; exclusion SHALL occur only when the member explicitly enables it on a specific Charge_Line, because discount terms vary by promotion and the App has no authoritative source for which discounts exclude alcohol.
4. WHEN the "exclude alcohol items" toggle is enabled on a Charge_Line and zero Expense_Items on the Expense are flagged `isAlcohol`, THE Trip_Service SHALL reject the Charge_Line with `trip_validation_failed` consistent with Requirement 5.10's zero-scope rejection, and THE Mobile_App SHALL surface that no alcohol items exist to exclude.

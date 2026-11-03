# N11 spec amendment (additive)

1. requirements.md, Requirement 11.13 (line 234): appended the sentence that the retry keeps the window valid (endDate is the original endDate, or the retry startDate when that is later; no request has startDate after endDate).
2. design.md, External Interfaces / Ticket client item 4 (line 648): after "(never earlier; `endDate` is unchanged)" inserted the exception that endDate becomes the retry startDate when the original endDate is earlier (single-day probe and Diagnose), while full pulls keep their horizon endDate.
3. design.md, Property 35 (line 1424): added "no request has `startDate` after `endDate`, including the retry of Requirement 11.13"; the Validates line already lists 11.13, so it is unchanged.
4. tasks.md, task 8.1 `ticketPriceClient.ts` Tests line (line 127): appended the single-day retry test (startDate = endDate = UTC date), the full-pull case (endDate unchanged) and the "no request has startDate > endDate" assertion; no checkbox state changed.
5. Verification: the `.kiro/specs/trip-budget/` folder is untracked in git, so `git diff --stat` cannot report on it; no tracked or other file was touched by this step. No `get_diagnostics` tool was available in this session; edits were inline text appends in existing bullets/paragraphs, so no headings, numbering or checkboxes changed.

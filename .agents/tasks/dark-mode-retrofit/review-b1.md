# Dark-mode retrofit, batch B1: Explore and destination screens

B1 moves the seven Explore/destination screens and sections under `screens/catalog/` off the frozen `theme` object and module-scope `StyleSheet.create`. They now use `makeStyles` + `useAppTheme`/`usePalette`, and every non-token literal goes into seven new co-located `*.palette.ts` files. `destinationVisuals.ts` loses only its unused `accent` field, and `TodayInParkLens.tsx` has no colour of its own, so it is unchanged. I read all nine snapshot diffs (`git diff --no-index` against `%TEMP%\dark-mode-snapshot\B1`), all seven palettes, and the dark-mode test additions. I re-derived HSL family and WCAG luminance for every off-table literal with a stdin `node -` calculation. I did not re-run the guard, the audit, typecheck or jest. The coder's recorded C4–C7 tails are present and complete. Light parity holds: every converted literal is byte-identical in `light`, and the five audit DIFFs are all accounted for (the rule-6 accent removal, the colour-free `categoryMeta` label read, and one dark-only calendar branch).

Watch for: the CrowdCalendar crowd scale is kept mode-invariant against the literal "else use F" clause of rule V (confirmed, the coder reported it, and it needs the integrator's sign-off). The rule-3 mapping also inverts the dark text hierarchy in ResortGuide and LocationGroup: muted subtitles become brighter than headings (confirmed, screenshot item).

**Verdict**: APPROVED

## High-level view

The conversion follows the consumer pattern exactly. Every function component that reads `styles` calls `useStyles()` itself, including the 11 `React.memo` rows, thumbs and overlays. Palettes are read only as `P[t.scheme].k` or through one `const` alias, and there are no destructured palette records and no `useRef` colours. A scripted scan of every `useMemo`/`useCallback`/`useEffect` in the seven files finds only two hooks that read `styles`: the closure-styled `renderRow`s in Destination and Park. Both list `styles` in their deps, and both FlatLists got `extraData={t.scheme}`. So did the Resorts dining and recreation lists, whose inline `renderItem`s read `styles`/`t`. Each list that needs nothing (search results, favorites, hotels) renders a self-subscribing row component.

The rule mapping is correct by role throughout:

- `#5b2a86` as an icon or text becomes `primaryFg`; as a fill it becomes `primary`.
- `#ffffff` as a background becomes `surface`; on a fill or hero it becomes `textOnPrimary`. The Park visited-disc ring sits inside the thumbnail image, so it is `textOnPrimary`. The Explore/Destination rings overhang onto the row surface, so they stay `surface`.
- Primary-hued borders on surfaces become `primaryFg`. Chromatic token rgba becomes `withAlpha(token, a)`.
- The success-fill visited disc is rule 4. Every non-black `shadowColor` is a rule-0 pair to `#000000`.

All three named placeholder tiles use `categoryVisual[cat].fill` behind a `textOnPrimary` glyph. The hotel-picker `${tierColor}18` site is fed by a `RESORT_TIER` palette that is `#rrggbb` in both schemes.

Artwork is untouched. The `destinationVisuals` gradients are unchanged. The inline fallback gradients and the resort gradient/backstop moved into mode-invariant `*_ART` palettes, tagged `// artwork — mode-invariant`. The hero-tile backstops, veils and the light text on them are H-role and invariant. No exported name, prop or signature changed (`HotelPreviewCard`, `DiningThumb`, `ExperienceRow`, `KNOWN_DINING_METADATA`, `resolveFallbackResortMeta`). `destinationVisuals.accent` had no reader anywhere in the snapshot, so dropping it needs no consumer change.

There are two judgement calls, both disclosed by the coder. The first is the CrowdCalendar scale (below). The second is treating the chromatic near-black scrims `rgba(15, 10, 28, 0.5/0.6)` as H-role and invariant. Rule 3 doesn't name a scrim role, and a near-black scrim over the dark screen behaves correctly, so I accept it. The calendar keeps light `calendarBackground: 'transparent'` through a `t.scheme === 'dark'` branch. That keeps the light string byte-identical, where the design's flat `surface` mapping would have changed it.

The tests meet the plan:

- (a)/(b)/(c) in the five screens;
- (c) in the three sections;
- the (d) live-switch test, the Property 22 tile check, and the rule-2a suffix in both schemes.

Each asserts the palette's or `darkTheme`'s dark value, so each would fail if the element stayed light. The extraData guards are pinned on the closure-styled lists (the Destination rail, Park favorites, Resorts dining) rather than by the Explore (d) test, whose rows subscribe themselves.

<details>
<summary>Issues (3)</summary>

1. **Crowd scale kept invariant against rule V's fallback.** White text on the Quiet/Below-average/High/Peak fills fails 4.5:1 in dark, and rule V says "if it doesn't, use F". Literal F would merge Quiet `#3fa34d` and Below-average `#8bbf3f` into the same `green.fill`. The coder kept the scale invariant, so contrast is identical to light. The integrator should ratify this as a recorded design exception, or amend rule V so the F fallback applies only when the scheme change causes the failure. Not blocking: there is no deterministic compliant option, and light is unaffected.
2. **Dark text hierarchy inverts in ResortGuide and LocationGroup.** Rule 3 sends the near-black violet headings (`#190c2d`, `#372f4a`, `#4a3f60`, `#371756`) to `violet.fg` `#c4a3ff`. It sends the muted neutral `#655d78` (L 0.1195 < 0.12) to `textPrimary` `#f3eefc`. So subtitles and secondary copy render brighter than the titles above them, and body and heading copy share one colour. Check this on the screenshot pass. If it's unacceptable, record a design exception (for example headings → `textPrimary`, `#655d78` → `textSecondary`). Rules were applied correctly, so this doesn't block B1.
3. **Tier badges on the hotel photo darken in dark mode.** `RESORTS.tierDeluxe`/`tierVilla`/`tierModerate`/`tierValue` follow rule 3 F (`orange`/`violet`/`sky.fill`) even though they sit on the hero photo, which doesn't change with scheme. This is rule-correct and improves white-text contrast. Check it on screenshots, because these badges no longer look the same in both modes over identical imagery.

</details>

<details>
<summary>Details</summary>

### Crowd-level scale and rule V

`getLevelInfo` feeds one colour to four places: the day-cell background (white `dayText`/`bestStar`), the level badge (white number), the per-park comparison badge, and the bar fill. The palette `CROWD_LEVEL` keeps `quiet #3fa34d`, `belowAverage #8bbf3f`, `high #e8792b` and `peak #d64545` identical in both schemes. "Moderate" is the `accent` token (gold, the same in both schemes). White on `#3fa34d` is about 3.2:1, and white on gold is far lower. Both are pre-existing light-mode failures, carried over unchanged. Rule V's clause "as long as any text on it still meets 4.5:1 in dark. If it doesn't, use F" isn't met, so the literal rule maps the scale to F:

```
quiet        #3fa34d (hue 128, green)  -> green.fill  #1f7a52
belowAverage #8bbf3f (hue  84, green)  -> green.fill  #1f7a52   <- same as quiet
high         #e8792b (hue  25, orange) -> orange.fill #b5520f
peak         #d64545 (hue   0, red)    -> red.fill    #c42b3c
```

That collapses two adjacent levels of a data-encoding scale. The legend swatches would show two identical greens. The coder's choice is the less harmful one, and it was reported rather than picked silently, as w2-plan requires. It still deviates from the letter of a "no free choice" rule, so it needs explicit ratification. The (c) test pins the invariant choice (`CROWD_LEVEL.dark.quiet` on the EPCOT badge). If the integrator overrules, that assertion has to change with it.

### Rule-3 consequences for the ResortGuide/LocationGroup type ramp

The light design uses near-black violets for headings and a mid-grey violet for secondary copy. Under rule 3:

```
light                      family / role          dark
#190c2d  heading           violet T               #c4a3ff
#372f4a  body, close glyph violet T (s 0.223)     #c4a3ff
#4a3f60  modal body        violet T (s 0.208)     #c4a3ff
#371756  tag-pill text     violet T               #c4a3ff
#655d78  muted / subtitle  neutral T, L 0.1195    #f3eefc  (textPrimary)
#8a7ba7  chevron           neutral T (s 0.19999)  #b3a8c9  (textSecondary)
```

The family, saturation and luminance calculations all match the design's tables and bands. `#655d78` sits just under the 0.12 boundary, and `#8a7ba7`'s saturation is mathematically exactly 0.20 but computes as 0.19999… in IEEE doubles. So the conversion is correct. The visual result is still the opposite of the light hierarchy: `RESORT_GUIDE.bodyMuted` and `LOCATION.briefSub` (`#f3eefc`) out-shine `heading`/`briefTitle` (`#c4a3ff`). This is a design-table consequence, not a B1 mistake, which is why it's non-blocking. It belongs on the screenshot checklist.

### Palette and default-text spot checks

Two family calls that aren't obvious from the diff: listed literals take the high-frequency table even where HSL disagrees (`#cbd5e1` has s 0.27 but is listed as neutral, so its S/B role goes to `borderStrong`). `ctaBorder rgba(106, 27, 154, 0.2)` isn't a token rgba, so it goes to rule 3 (`violet.border`), not rule 2.

A scan of every factory entry that sets a font but no `color` found nine. None is a missed `textDefault` site:

- four hero/gradient icon texts plus `bestBannerIcon` on gold have mode-invariant backgrounds;
- `subdestBadgeText` and `hotelModalTierBadgeText` get their colour inline;
- `filterModalBtnText` is unused;
- `hotelFilterPillIcon`'s pill switches to a violet fill when active.

### Test coverage

Covered with dark-value assertions that would fail if the element stayed light:

- the screen roots, primary text and keyboard appearance;
- the dock disc and glyph;
- the category `fill` placeholders (Ride and Restaurant, with `fill !== tint` asserted);
- the Destination rail and the Park favorites pill repainting live after a scheme switch;
- the Park height badge and the visited disc with its white ring;
- the Resorts card, tier badge, active tab, dining-row repaint, and the `18`-suffix site in both schemes;
- the Calendar theme, plus a remount check (`not.toBe` on the instance);
- the ResortGuide/LocationGroup cards, headings, pills and directions buttons;
- the `TodayInParkLens` child card.

Not tested: the Explore hero tiles (mode-invariant, so dark equals light), the Park filter-sheet chips and their active state, the Resorts transit/CTA pills and hotel-filter pill states, and the ResortGuide amenity modal. Each of these is a single-palette-key read of the same shape as the asserted ones, so the guard and screenshots cover them as the plan allows. `destinationVisuals.ts` is data only.

</details>

<details>
<summary>File map</summary>

- `screens/catalog/ExploreHubScreen.tsx` (+ `.palette.ts`: `EXPLORE`, `EXPLORE_HERO`, `EXPLORE_ART`): `makeStyles`; dock literals; hero tiles invariant; search-row tile `fill`; unused fallback `accent` dropped.
- `screens/catalog/DestinationScreen.tsx` (+ `.palette.ts`: `DESTINATION`): `makeStyles`; rule-4 visited disc; favorites/reset chips; `renderRow` deps + `extraData`; modal `outline.card`; `categoryMeta` label.
- `screens/catalog/ParkDestinationScreen.tsx` (+ `.palette.ts`: `PARK`, `PARK_HERO`, `PARK_ART`): `makeStyles`; filter/chip palette; height badge; visited ring `textOnPrimary`; `renderRow` deps + `extraData`.
- `screens/catalog/ResortsDirectoryScreen.tsx` (+ `.palette.ts`: `RESORTS`, `RESORT_TIER`, `RESORTS_ART`): `makeStyles`; tier F fills; rule-2a `RESORT_TIER`; two FlatLists `extraData`; two `textDefault` placements.
- `screens/catalog/ResortGuideSection.tsx` (+ `.palette.ts`: `RESORT_GUIDE`): `makeStyles`; violet type ramp; four emoji `textDefault`; exports unchanged.
- `screens/catalog/CrowdCalendarScreen.tsx` (+ `.palette.ts`: `CROWD_LEVEL`, `EVENT_BADGE`): `makeStyles`; invariant crowd scale; themed `Calendar` + `key={t.scheme}`; event badges.
- `screens/catalog/LocationGroupSection.tsx` (+ `.palette.ts`: `LOCATION`): `makeStyles`; card/brief/tag/walking palette.
- `screens/catalog/destinationVisuals.ts`: `accent` field removed; gradients untouched.
- `screens/catalog/TodayInParkLens.tsx`: unchanged.
- Tests: dark-mode `describe` blocks added to the 8 owned test files listed in w2-B1-report.md. `ParkDestinationScreen.test.tsx`'s Festival-chip tests in `git diff` predate B1 (festival-booth-tagging task 12.4). `DestinationScreen.layouts.test.tsx` was modified before the snapshot was taken, not by B1.

Full diff: `git diff --no-index -- "$env:TEMP\dark-mode-snapshot\B1\screens\catalog\<file>" apps/mobile/src/screens/catalog/<file>`.

</details>

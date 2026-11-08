import fs from 'node:fs';
import path from 'node:path';

const rows = [
  {
    behavior: 'API: GET /mickeys/config returns 200 and config shape via composeServices',
    testFile: 'apps/api/src/__tests__/composeServices.mickeys.test.ts',
    testName: "it('GET /mickeys/config returns 200'",
    assertion: 'expect(res.statusCode).toBe(200)',
  },
  {
    behavior: 'API: GET /mickeys without session returns 401 via composeServices',
    testFile: 'apps/api/src/__tests__/composeServices.mickeys.test.ts',
    testName: "it('GET /mickeys without a session returns 401'",
    assertion: 'expect(res.statusCode).toBe(401)',
  },
  {
    behavior: 'API: GET /mickeys with session returns 200 and items array via composeServices',
    testFile: 'apps/api/src/__tests__/composeServices.mickeys.test.ts',
    testName: "it('GET /mickeys with a session returns 200 and an items array'",
    assertion: 'expect(Array.isArray(json.items)).toBe(true)',
  },
  {
    behavior: 'API: GET /admin/mickeys with basic auth returns 200 via composeServices',
    testFile: 'apps/api/src/__tests__/composeServices.mickeys.test.ts',
    testName: "it('GET /admin/mickeys with basic auth returns 200'",
    assertion: 'expect(res.statusCode).toBe(200)',
  },
  {
    behavior: 'Admin API: Throws clear error at registration if options.pool and options.mickeys are missing',
    testFile: 'apps/api/src/services/admin/__tests__/mickeyRoutes.test.ts',
    testName: "it('throws a clear error at registration time when options.pool and options.mickeys are missing'",
    assertion: 'registerMickeyRoutes requires options.mickeys or options.pool',
  },
  {
    behavior: 'Text screening port: Moderation check returns ok flagged:false for clean text',
    testFile: 'apps/api/src/services/mickeys/adapters/__tests__/openaiTextScreen.test.ts',
    testName: "it('calls correct URL with Bearer auth and plain string input body'",
    assertion: "expect(result).toEqual({ kind: 'ok', flagged: false })",
  },
  {
    behavior: 'Text screening port: Moderation check returns ok flagged:true for flagged text',
    testFile: 'apps/api/src/services/mickeys/adapters/__tests__/openaiTextScreen.test.ts',
    testName: "it('parses flagged: true correctly'",
    assertion: "expect(result).toEqual({ kind: 'ok', flagged: true })",
  },
  {
    behavior: 'Submissions: Screener flagged rejection throws mickey_text_rejected and leaves no row',
    testFile: 'apps/api/src/services/mickeys/__tests__/submissions.test.ts',
    testName: "it('flagged submission throws mickey_text_rejected and leaves no row of any kind'",
    assertion: 'expect(hmCount.rows[0]!.count).toBe(0)',
  },
  {
    behavior: 'Submissions: Screener timeout/failure creates pending row with text_screen = unscreened',
    testFile: 'apps/api/src/services/mickeys/__tests__/submissions.test.ts',
    testName: "it('with unscreened result (screener timeout/failure): creates pending row with text_screen = unscreened'",
    assertion: "expect(hmRes.rows[0]!.text_screen).toBe('unscreened')",
  },
  {
    behavior: 'Explore Hub: Renders Hidden Mickeys scavenger hunt card when enabled',
    testFile: 'apps/mobile/src/screens/catalog/__tests__/ExploreHubScreen.test.tsx',
    testName: "it('renders Hidden Mickeys scavenger hunt card when enabled and navigates on tap'",
    assertion: "expect(screen.getByText('Hidden Mickeys')).toBeTruthy()",
  },
  {
    behavior: 'Explore Hub: Hidden when GET /mickeys/config returns enabled: false',
    testFile: 'apps/mobile/src/screens/catalog/__tests__/ExploreHubScreen.test.tsx',
    testName: "it('is hidden when GET /mickeys/config returns enabled: false'",
    assertion: "expect(screen.queryByTestId('explore-hidden-mickeys-card')).toBeNull()",
  },
  {
    behavior: 'Explore Hub: Does not crash and remains hidden when GET /mickeys/config returns 404',
    testFile: 'apps/mobile/src/screens/catalog/__tests__/ExploreHubScreen.test.tsx',
    testName: "it('does not crash and is hidden when GET /mickeys/config returns 404'",
    assertion: "expect(screen.queryByTestId('explore-hidden-mickeys-card')).toBeNull()",
  },
  {
    behavior: 'Collection Hub: Renders Hidden Mickeys progress card when enabled',
    testFile: 'apps/mobile/src/screens/collection/__tests__/CollectionScreen.test.tsx',
    testName: "it('renders Hidden Mickeys Vault progress card and navigates to HiddenMickeys",
    assertion: 'expect(card).toBeTruthy()',
  },
  {
    behavior: 'Collection Hub: Hidden when GET /mickeys/config returns enabled: false',
    testFile: 'apps/mobile/src/screens/collection/__tests__/CollectionScreen.test.tsx',
    testName: "it('hides Hidden Mickeys Vault progress card when GET /mickeys/config returns enabled: false'",
    assertion: "expect(screen.queryByTestId('vault-hidden-mickeys-card')).toBeNull()",
  },
  {
    behavior: 'Collection Hub: Does not crash and remains hidden when GET /mickeys/config returns 404',
    testFile: 'apps/mobile/src/screens/collection/__tests__/CollectionScreen.test.tsx',
    testName: "it('does not crash and hides Hidden Mickeys Vault progress card when GET /mickeys/config returns 404'",
    assertion: "expect(screen.queryByTestId('vault-hidden-mickeys-card')).toBeNull()",
  },
  {
    behavior: 'Experience Detail: Renders Mickey section card when enabled',
    testFile: 'apps/mobile/src/screens/catalog/__tests__/ExperienceMickeySection.test.tsx',
    testName: "renders \"N Hidden Mickeys here · you\\'ve found M\" card and navigates to HiddenMickeys with experienceId",
    assertion: 'expect(screen.getByText("2 Hidden Mickeys here · you\'ve found 1")).toBeTruthy()',
  },
  {
    behavior: 'Experience Detail: Renders nothing when MICKEYS_ENABLED is false',
    testFile: 'apps/mobile/src/screens/catalog/__tests__/ExperienceMickeySection.test.tsx',
    testName: "it('renders nothing when MICKEYS_ENABLED is false'",
    assertion: "expect(screen.queryByTestId('experience-mickeys-card')).toBeNull()",
  },
  {
    behavior: 'Experience Detail: Does not crash and renders nothing when GET /mickeys/config returns 404',
    testFile: 'apps/mobile/src/screens/catalog/__tests__/ExperienceMickeySection.test.tsx',
    testName: "it('does not crash and renders nothing when GET /mickeys/config returns 404'",
    assertion: "expect(screen.queryByTestId('experience-mickeys-card')).toBeNull()",
  },
  {
    behavior: 'Friend Profile: Renders friend Mickey finds summary and list in read-only mode',
    testFile: 'apps/mobile/src/screens/friends/__tests__/FriendMickeySection.test.tsx',
    testName: "it('renders summary and recent finds read-only with Clue 1 only'",
    assertion: "expect(screen.getByText(\"Cinderella's Wishing Well\")).toBeTruthy()",
  },
  {
    behavior: 'Friend Profile: Section is hidden when GET /mickeys/config returns enabled: false',
    testFile: 'apps/mobile/src/screens/friends/__tests__/FriendMickeySection.test.tsx',
    testName: "it('renders nothing when GET /mickeys/config returns enabled: false'",
    assertion: "expect(screen.queryByTestId('friend-mickey-section')).toBeNull()",
  },
  {
    behavior: 'Friend Profile: Section does not crash and is hidden when GET /mickeys/config returns 404',
    testFile: 'apps/mobile/src/screens/friends/__tests__/FriendMickeySection.test.tsx',
    testName: "it('does not crash and renders nothing when GET /mickeys/config returns 404'",
    assertion: "expect(screen.queryByTestId('friend-mickey-section')).toBeNull()",
  },
  {
    behavior: 'Trip Detail: Renders trip Mickey finds summary and navigates on tap',
    testFile: 'apps/mobile/src/screens/trips/__tests__/TripDetailScreen.test.tsx',
    testName: "test('renders member counts and mickeys list, and navigates to detail on tap'",
    assertion: "expect(screen.getByText('Look at the gear pattern')).toBeTruthy()",
  },
  {
    behavior: 'Trip Detail: Mickey section is hidden when GET /mickeys/config returns enabled: false',
    testFile: 'apps/mobile/src/screens/trips/__tests__/TripDetailScreen.test.tsx',
    testName: "test('is hidden when GET /mickeys/config returns enabled: false'",
    assertion: "expect(screen.queryByTestId('trip-detail-mickeys-section')).toBeNull()",
  },
  {
    behavior: 'Trip Detail: Mickey section does not crash and is hidden when GET /mickeys/config returns 404',
    testFile: 'apps/mobile/src/screens/trips/__tests__/TripDetailScreen.test.tsx',
    testName: "test('does not crash and is hidden when GET /mickeys/config returns 404'",
    assertion: "expect(screen.queryByTestId('trip-detail-mickeys-section')).toBeNull()",
  },
  {
    behavior: 'Trip Tally API: GET /trips/:id/mickeys returns member counts and mickeys to members',
    testFile: 'apps/api/src/services/trips/__tests__/routes.mickeys.test.ts',
    testName: "it('returns 200 and TripMickeysDTO when caller is a member'",
    assertion: 'expect(res.statusCode).toBe(200)',
  },
  {
    behavior: 'Migration 0072: Foreign key delete cascade actions for users and experiences',
    testFile: 'apps/api/src/db/__tests__/migration0072.test.ts',
    testName: "it('cascades on experience deletion and user deletion'",
    assertion: 'expect(mRes.rows[0]?.submitter_id).toBeNull()',
  },
  {
    behavior: 'Seed Import: Idempotent import by seed_key',
    testFile: 'apps/api/src/scripts/__tests__/importHiddenMickeys.test.ts',
    testName: 'Property 15: importing twice equals importing once',
    assertion: 'expect(rows1).toHaveLength(1)',
  },
  {
    behavior: 'Home Screen: Renders Hidden Mickeys scavenger hunt card below quick logging and navigates on tap',
    testFile: 'apps/mobile/src/screens/home/__tests__/HomeScreen.render.test.tsx',
    testName: "it('renders Hidden Mickeys scavenger hunt card below quick logging and navigates on tap'",
    assertion: "expect(card).toBeTruthy()",
  },
  {
    behavior: 'Home Screen: Hides Hidden Mickeys scavenger hunt card when config is disabled',
    testFile: 'apps/mobile/src/screens/home/__tests__/HomeScreen.render.test.tsx',
    testName: "it('hides Hidden Mickeys scavenger hunt card when config is disabled'",
    assertion: "expect(screen.queryByTestId('home-hidden-mickeys-card')).toBeNull()",
  },
  {
    behavior: 'Active Vacation Card: Renders Hidden Mickeys status row and navigates on tap',
    testFile: 'apps/mobile/src/components/__tests__/ActiveTripShortcut.test.tsx',
    testName: "test('renders Hidden Mickeys status row on active vacation card and navigates on tap'",
    assertion: "expect(screen.getByText('✨ Hidden Mickeys: 2 found this trip ›')).toBeTruthy()",
  },
  {
    behavior: 'Active Vacation Card: Hides Hidden Mickeys status row when mickeys config is disabled',
    testFile: 'apps/mobile/src/components/__tests__/ActiveTripShortcut.test.tsx',
    testName: "test('hides Hidden Mickeys status row when mickeys config is disabled'",
    assertion: "expect(screen.queryByTestId('active-trip-mickey-shortcut')).toBeNull()",
  },
  {
    behavior: 'Experience Detail: Floating quest badge on hero canopy renders and routes on tap',
    testFile: 'apps/mobile/src/screens/catalog/__tests__/ExperienceDetailScreen.heroMickeyBadge.test.tsx',
    testName: "renders floating Mickey badge over hero canopy and navigates to hunt on tap",
    assertion: "expect(badge).toBeTruthy()",
  },
  {
    behavior: 'Gradient Header: Top-right decorative sparkle suppressed when right action slot is present',
    testFile: 'apps/mobile/src/theme/__tests__/components.gradientHeader.test.tsx',
    testName: "renders custom iconText, testID, backTestID, and right slot",
    assertion: "expect(iconsWithRight.some((icon) => icon.props.name === 'sparkles')).toBe(false)",
  },
  {
    behavior: 'Submit Mickey: Searches attraction catalog and renders dropdown results',
    testFile: 'apps/mobile/src/screens/mickeys/__tests__/SubmitMickeyScreen.test.tsx',
    testName: "it('searches experiences, displays duplicate list on selection, and validates form bounds'",
    assertion: "expect(expOption).toBeTruthy()",
  },
];

console.log('| Behavior / Control / Branch | Test File | Test Name | Assertion | Status |');
console.log('| --- | --- | --- | --- | --- |');

let totalOk = 0;
let totalMissing = 0;

for (const row of rows) {
  const filePath = path.resolve(row.testFile);
  let status = 'OK';

  if (!fs.existsSync(filePath)) {
    status = 'MISSING (file not found)';
    totalMissing++;
  } else {
    const content = fs.readFileSync(filePath, 'utf8');
    const hasTest = content.includes(row.testName);
    const hasAssertion = content.includes(row.assertion);

    if (!hasTest && !hasAssertion) {
      status = 'MISSING (both test & assertion not found)';
      totalMissing++;
    } else if (!hasTest) {
      status = 'MISSING (test name not found)';
      totalMissing++;
    } else if (!hasAssertion) {
      status = 'MISSING (assertion not found)';
      totalMissing++;
    } else {
      totalOk++;
    }
  }

  console.log(`| ${row.behavior} | \`${row.testFile}\` | \`${row.testName.replace(/\|/g, '\\|')}\` | \`${row.assertion.replace(/\|/g, '\\|')}\` | **${status}** |`);
}

console.log(`\nSummary: ${totalOk} OK, ${totalMissing} MISSING`);
if (totalMissing > 0) {
  process.exit(1);
}

// Feature: experience-detail-redesign, task 7.5
//
// Static contract test for the pure Info_Tag core.
//
// Requirements: 9.1
//   THE infoTags module SHALL contain no import of React and no import of
//   react-navigation. This preserves the framework-free pure-core contract so
//   the grouping, relabeling, and de-duplication logic stays unit- and
//   property-testable without rendering. The test reads the module source and
//   asserts none of its import statements reference `react`, `react-native`, or
//   any `@react-navigation/...` package.

import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('infoTags.ts pure-core contract (R9.1)', () => {
  const source = readFileSync(resolve(__dirname, '../infoTags.ts'), 'utf8');

  // Collect every import specifier (the module path in `from '...'`) plus any
  // side-effect / bare imports (`import '...'`). We match both `import ... from
  // '<spec>'` and `import '<spec>'` forms, ignoring comments by matching on the
  // import keyword at the start of a statement.
  const importSpecifiers: string[] = [];
  const importRegex =
    /(?:^|\n)\s*import\b[^;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      importSpecifiers.push(specifier);
    }
  }

  it('imports neither React nor react-navigation', () => {
    const forbidden = importSpecifiers.filter(
      (spec) =>
        spec === 'react' ||
        spec === 'react-native' ||
        spec.startsWith('react-native/') ||
        spec.startsWith('@react-navigation/') ||
        spec === '@react-navigation/native',
    );

    expect(forbidden).toEqual([]);
  });

  it('has at least one import (guards the regex against silently matching nothing)', () => {
    // The module imports `ExperienceDTO` from '@dwt/shared'; if the extraction
    // found zero imports the forbidden-check above would be vacuously true, so
    // assert the parser is actually seeing the module's imports.
    expect(importSpecifiers.length).toBeGreaterThan(0);
  });
});

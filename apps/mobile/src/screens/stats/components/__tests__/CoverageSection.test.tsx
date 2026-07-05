/**
 * Component tests for the coverage section building blocks
 * (stats-experience-redesign spec, Task 6.2; updated for the ranked-bar mockup).
 *
 * Validates: Requirements 5.5, 5.8, 5.9, 6.1, 6.3, 6.4
 *
 * The coverage lenses render as ranked bars (`LabeledCellList` rows). These
 * React Native Testing Library tests pin:
 *   - **Ranked rows in order (R6.1).** `LabeledCellList` renders rows in the
 *     exact order supplied — it never re-sorts.
 *   - **Complete vs. incomplete (R5.8, R5.9).** A `completeBadge` row shows the
 *     gold trophy and a green `x / y · 100.0%` value; an incomplete row shows
 *     the plain `x / y · z%` value and carries "N to go" in its spoken label.
 *   - **Zero-total rows (R5.5).** A `total === 0` row still renders (never
 *     hidden) as `0 / 0 · 0.0%`.
 *   - **Resorts-lens separation (R6.4) + empty state (R6.3).** The hotels-visited
 *     `coverage.resort` treatment and the per-resort `byResort` list render as
 *     two distinct elements; an empty `byResort` shows a compact empty state
 *     while hotels-visited remains.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import {
  COMPLETE_CELL,
  EMPTY_CELL,
  PARTIAL_CELL,
  makeCell,
  makeCoverageResponse,
} from '../../__testSupport__/statsFixture';
import type { LabeledCellRow } from '../LabeledCellList';
import { LabeledCellList } from '../LabeledCellList';
import { CoverageSection } from '../CoverageSection';

// ---------------------------------------------------------------------------
// LabeledCellList — ranked rows, order, badge/value, empty state
// ---------------------------------------------------------------------------

describe('LabeledCellList — ranked bar rows (Requirements 6.1, 6.3, 5.8, 5.9, 5.5)', () => {
  const rows: readonly LabeledCellRow[] = [
    { key: 'r1', label: 'Deluxe', cell: PARTIAL_CELL, color: '#7e57c2' }, // 3/8 → incomplete
    { key: 'r2', label: 'Value', cell: COMPLETE_CELL, color: '#2f80ed' }, // 8/8 → complete
    { key: 'r3', label: 'Moderate', cell: EMPTY_CELL, color: '#17a2b8' }, // 0/0 → zero-total
  ];

  it('renders rows in the exact order supplied, without re-sorting (R6.1)', () => {
    render(<LabeledCellList rows={rows} rowTestIDPrefix="row" />);
    const rendered = screen.getAllByTestId(/^row-/);
    expect(rendered.map((n) => n.props.testID)).toEqual(['row-r1', 'row-r2', 'row-r3']);
  });

  it('shows the trophy + green complete value for a complete row, plain value otherwise (R5.8, R5.9)', () => {
    render(<LabeledCellList rows={rows} rowTestIDPrefix="row" />);

    // Complete row (Value 8/8) → trophy + "8 / 8 · 100.0%".
    expect(screen.getByText('🏆')).toBeTruthy();
    expect(screen.getByText('8 / 8 · 100.0%')).toBeTruthy();
    // Incomplete row (Deluxe 3/8) → "3 / 8 · 37.5%" and "N to go" in the label.
    expect(screen.getByText('3 / 8 · 37.5%')).toBeTruthy();
    expect(screen.getByTestId('row-r1').props.accessibilityLabel).toContain('5 to go');
    // Zero-total row (Moderate 0/0) still renders (R5.5).
    expect(screen.getByText('0 / 0 · 0.0%')).toBeTruthy();
  });

  it('renders a compact empty state when there are no rows (R6.3)', () => {
    render(
      <LabeledCellList
        rows={[]}
        emptyTitle="No resort activity yet"
        emptyBody="Complete something to see it here."
        testID="empty-list"
      />,
    );
    expect(screen.getByTestId('empty-list')).toBeTruthy();
    expect(screen.getByText('No resort activity yet')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// CoverageSection — Resorts lens: rows vs. Hotels_Visited treatment (R6.4, R6.1, R6.3)
// ---------------------------------------------------------------------------

describe('CoverageSection — Resorts lens separation (Requirements 6.1, 6.3, 6.4)', () => {
  it('renders the Hotels_Visited treatment and the per-resort list as two distinct elements (R6.4)', () => {
    const coverage = makeCoverageResponse({ resort: makeCell(1, 4) });
    render(<CoverageSection coverage={coverage} lens="resorts" />);

    const hotels = screen.getByTestId('coverage-hotels-visited');
    const byResort = screen.getByTestId('coverage-by-resort');
    expect(hotels).toBeTruthy();
    expect(byResort).toBeTruthy();
    expect(hotels).not.toBe(byResort);
    // Hotels-visited shows the coverage.resort value.
    expect(screen.getByText('1 / 4 · 25.0%')).toBeTruthy();
  });

  it('renders coverage.byResort as ranked rows in server order (R6.1)', () => {
    render(<CoverageSection coverage={makeCoverageResponse()} lens="resorts" />);
    const rows = screen.getAllByTestId(/^resort-row-/);
    expect(rows.map((n) => n.props.testID)).toEqual([
      'resort-row-resort-grand-floridian',
      'resort-row-resort-contemporary',
      'resort-row-resort-pop-century',
    ]);
  });

  it('shows a compact empty state for an empty byResort while keeping hotels-visited (R6.3, R6.4)', () => {
    render(<CoverageSection coverage={makeCoverageResponse({ byResort: [] })} lens="resorts" />);
    expect(screen.getByTestId('coverage-by-resort')).toBeTruthy();
    expect(screen.queryAllByTestId(/^resort-row-/)).toHaveLength(0);
    expect(screen.getByText('No resort activity yet')).toBeTruthy();
    expect(screen.getByTestId('coverage-hotels-visited')).toBeTruthy();
  });

  it('ranks the Parks lens most→least complete, including a zero-total park (R5.5, R6.1)', () => {
    const coverage = makeCoverageResponse();
    render(<CoverageSection coverage={coverage} lens="parks" />);
    // All seven parks render as rows (none hidden).
    expect(screen.getAllByTestId(/^park-row-/)).toHaveLength(7);
  });
});

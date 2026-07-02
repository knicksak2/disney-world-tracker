// Feature: catalog-navigation-redesign, task 8.8
//
// Unit tests for `destinationCardLabel` — the Catalog_Home Destination card
// screen-reader label helper.
//
// Requirements: 12.1
//   The card's accessibility label is the Destination name followed by its
//   active-Experience count as a numeric value, e.g. "Magic Kingdom, 42
//   experiences". The count is emitted verbatim as a number so assistive
//   technology announces it numerically.

import { destinationCardLabel } from '../destinations';

describe('destinationCardLabel (R12.1)', () => {
  it('formats "{name}, {count} experiences" with the numeric count', () => {
    expect(destinationCardLabel('Magic Kingdom', 42)).toBe(
      'Magic Kingdom, 42 experiences',
    );
  });

  it('emits a zero count as the literal number 0', () => {
    expect(destinationCardLabel('Blizzard Beach', 0)).toBe(
      'Blizzard Beach, 0 experiences',
    );
  });

  it('emits a single-item count as the number 1 (no pluralization logic)', () => {
    // The helper is a plain numeric label; it does not singularize "experiences".
    expect(destinationCardLabel('Resorts', 1)).toBe('Resorts, 1 experiences');
  });

  it('renders a large multi-digit count verbatim', () => {
    expect(destinationCardLabel('EPCOT', 1234)).toBe('EPCOT, 1234 experiences');
  });

  it('preserves the Destination name exactly, including internal spacing', () => {
    expect(destinationCardLabel('Hollywood Studios', 7)).toBe(
      'Hollywood Studios, 7 experiences',
    );
  });
});

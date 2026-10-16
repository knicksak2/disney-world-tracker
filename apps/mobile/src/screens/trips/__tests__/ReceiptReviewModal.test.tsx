import React from 'react';
import { StyleSheet, Switch } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { darkTheme } from '../../../theme/theme';
import { RECEIPT_REVIEW } from '../ReceiptReviewModal.palette';
import { ReceiptReviewModal } from '../ReceiptReviewModal';
import { scanReceiptPhoto, isNativeOcrAvailable } from '../receiptScan.native';
import type { TripMemberDTO, TripGuestDTO } from '@dwt/shared';

// Mock OCR call site only (Task 14.6: mocking the OCR call site, never the parser)
jest.mock('../receiptScan.native', () => ({
  scanReceiptPhoto: jest.fn(),
  isNativeOcrAvailable: jest.fn(() => true),
}));

const mockScanReceiptPhoto = scanReceiptPhoto as jest.MockedFunction<typeof scanReceiptPhoto>;
const mockIsNativeOcrAvailable = isNativeOcrAvailable as jest.MockedFunction<typeof isNativeOcrAvailable>;

const mockMembers: TripMemberDTO[] = [
  {
    userId: 'u-1',
    displayName: 'Alice',
    avatarPreset: null,
    role: 'organizer',
  },
  {
    userId: 'u-2',
    displayName: 'Bob',
    avatarPreset: null,
    role: 'member',
  },
];

const mockGuests: TripGuestDTO[] = [
  {
    id: 'g-1',
    tripId: 't-1',
    sponsorMemberId: 'u-1',
    name: 'Charlie',
    createdAt: '2026-10-01T00:00:00Z',
  },
];

describe('ReceiptReviewModal Component Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders draft items and charge lines and updates confirmed output on edit', async () => {
    const rawText = `
      French Onion Soup $14.50
      Safari Amber $9.50
      Sales Tax $2.00
      Subtotal $24.00
      Total $26.00
    `;

    const onConfirm = jest.fn();
    const onFallback = jest.fn();
    const onClose = jest.fn();

    render(
      <ReceiptReviewModal
        visible={true}
        members={mockMembers}
        guests={mockGuests}
        callerId="u-1"
        initialRawText={rawText}
        onConfirm={onConfirm}
        onFallbackToManual={onFallback}
        onClose={onClose}
      />
    );

    // Context subtotal is rendered
    expect(screen.getByTestId('receipt-detected-subtotal')).toBeTruthy();

    // Draft items rendered
    expect(screen.getByDisplayValue('French Onion Soup')).toBeTruthy();
    expect(screen.getByDisplayValue('Safari Amber')).toBeTruthy();

    // Pre-checked alcohol flag for Safari Amber (Req 9.8)
    const alcoholSwitch = screen.getAllByRole('switch')[0];
    expect(alcoholSwitch).toBeTruthy();

    // Edit an item name and price
    fireEvent.changeText(screen.getByDisplayValue('French Onion Soup'), 'Onion Soup Deluxe');
    fireEvent.changeText(screen.getByDisplayValue('14.50'), '16.00');

    // Confirm
    fireEvent.press(screen.getByTestId('confirm-receipt-review-button'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [confirmedItems, confirmedChargeLines] = onConfirm.mock.calls[0]!;
    expect(confirmedItems[0]).toMatchObject({
      name: 'Onion Soup Deluxe',
      priceCents: 1600,
    });
    expect(confirmedItems[1]).toMatchObject({
      name: 'Safari Amber',
      isAlcohol: true,
    });
    expect(confirmedChargeLines[0]).toMatchObject({
      kind: 'tax',
      amountCents: 200,
    });
  });

  it('handles splitting, deleting, and merging draft items (Req 9.3)', async () => {
    const rawText = `
      Mickey Waffle $12.00
      Bacon Plate $8.00
    `;

    const onConfirm = jest.fn();

    render(
      <ReceiptReviewModal
        visible={true}
        members={mockMembers}
        guests={mockGuests}
        callerId="u-1"
        initialRawText={rawText}
        onConfirm={onConfirm}
        onFallbackToManual={jest.fn()}
        onClose={jest.fn()}
      />
    );

    // 1. Split Mickey Waffle ($12 -> two $6 items)
    const splitBtns = screen.getAllByText('Split');
    fireEvent.press(splitBtns[0]!);

    expect(screen.getByDisplayValue('Mickey Waffle (Part 1)')).toBeTruthy();
    expect(screen.getByDisplayValue('Mickey Waffle (Part 2)')).toBeTruthy();

    // 2. Delete Bacon Plate
    const deleteBtns = screen.getAllByText('Delete');
    // Last delete button corresponds to Bacon Plate
    fireEvent.press(deleteBtns[deleteBtns.length - 1]!);

    expect(screen.queryByDisplayValue('Bacon Plate')).toBeNull();

    // 3. Select both waffle parts and merge them
    const checkboxes = screen.getAllByTestId(/^receipt-select-merge-/);
    fireEvent.press(checkboxes[0]!);
    fireEvent.press(checkboxes[1]!);

    // Merge button appears
    const mergeBtn = screen.getByTestId('receipt-merge-items-btn');
    fireEvent.press(mergeBtn);

    expect(screen.getByDisplayValue('Mickey Waffle (Part 1) + Mickey Waffle (Part 2)')).toBeTruthy();
  });

  it('surfaces zero-items fallback message and allows manual entry fallback without error (Req 9.5)', async () => {
    const onFallback = jest.fn();

    render(
      <ReceiptReviewModal
        visible={true}
        members={mockMembers}
        guests={mockGuests}
        callerId="u-1"
        initialRawText="" // Empty scan produces zero items
        onConfirm={jest.fn()}
        onFallbackToManual={onFallback}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByTestId('receipt-no-items-message')).toBeTruthy();
    expect(screen.getByText('No items detected')).toBeTruthy();

    // Tap Enter Manually
    fireEvent.press(screen.getByTestId('receipt-review-manual-fallback'));
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('scans two photos then discards one, leaving exactly the kept photo items (Req 9.10, 9.12)', async () => {
    mockScanReceiptPhoto.mockResolvedValueOnce('Shake $8.00\nBurger $12.00');

    render(
      <ReceiptReviewModal
        visible={true}
        members={mockMembers}
        guests={mockGuests}
        callerId="u-1"
        initialRawText="Dole Whip $6.00"
        onConfirm={jest.fn()}
        onFallbackToManual={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByDisplayValue('Dole Whip')).toBeTruthy();

    // Scan another photo (Req 9.10)
    fireEvent.press(screen.getByTestId('scan-another-photo-button'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Shake')).toBeTruthy();
      expect(screen.getByDisplayValue('Burger')).toBeTruthy();
    });

    // Discard photo 1 (Req 9.12)
    fireEvent.press(screen.getByTestId('discard-photo-photo-1'));

    // Photo 1 items are gone
    expect(screen.queryByDisplayValue('Dole Whip')).toBeNull();
    // Photo 2 items remain
    expect(screen.getByDisplayValue('Shake')).toBeTruthy();
    expect(screen.getByDisplayValue('Burger')).toBeTruthy();
  });

  it('suggests menu item name correction when linked to restaurant with cached menu (Req 9.9)', async () => {
    const rawText = `
      The Grey Stuf $12.00
    `;

    render(
      <ReceiptReviewModal
        visible={true}
        members={mockMembers}
        guests={mockGuests}
        callerId="u-1"
        initialRawText={rawText}
        restaurantMenuNames={['The Grey Stuff', 'Be Our Guest Filet']}
        onConfirm={jest.fn()}
        onFallbackToManual={jest.fn()}
        onClose={jest.fn()}
      />
    );

    // Suggestion chip is displayed
    const suggestionChip = screen.getByTestId(/^receipt-suggested-name-/);
    expect(suggestionChip).toBeTruthy();
    expect(screen.getByText(/The Grey Stuff/)).toBeTruthy();

    // Tap suggestion chip to apply
    fireEvent.press(suggestionChip);

    // Item name is updated to the menu name
    expect(screen.getByDisplayValue('The Grey Stuff')).toBeTruthy();
  });

  it('renders demo notice banner when native OCR is unavailable (Expo Go)', async () => {
    mockIsNativeOcrAvailable.mockReturnValueOnce(false);
    render(
      <ReceiptReviewModal
        visible={true}
        members={mockMembers}
        guests={mockGuests}
        callerId="u-1"
        initialRawText="Soup $10.00"
        onConfirm={jest.fn()}
        onFallbackToManual={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByTestId('receipt-demo-notice')).toBeTruthy();
    expect(screen.getByText(/Demo mode \(Expo Go\)/i)).toBeTruthy();
  });

  describe('dark mode', () => {
    const flat = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};
    const renderModal = () =>
      render(
        <ReceiptReviewModal
          visible={true}
          members={mockMembers}
          guests={mockGuests}
          callerId="u-1"
          initialRawText={'Soup $10.00\nSubtotal $10.00'}
          onConfirm={jest.fn()}
          onFallbackToManual={jest.fn()}
          onClose={jest.fn()}
        />,
      );

    afterEach(resetTestScheme);

    it('(a)(b)(c) paints the sheet, primary text and converted banners with dark values', () => {
      mockIsNativeOcrAvailable.mockReturnValueOnce(false);
      setTestScheme('dark');
      renderModal();

      // (a) the modal sheet surface.
      expect(flat(screen.getByTestId('receipt-review-modal')).backgroundColor).toBe(
        darkTheme.color.surface,
      );
      // (b) primary text: the sheet title.
      expect(flat(screen.getByText('Review Receipt Scan')).color).toBe(
        darkTheme.color.textPrimary,
      );
      // (c) converted literals: the indigo subtotal banner tint, the demo-notice
      // lavender well and violet text.
      expect(flat(screen.getByTestId('receipt-detected-subtotal')).backgroundColor).toBe(
        RECEIPT_REVIEW.dark.subtotalBg,
      );
      expect(flat(screen.getByTestId('receipt-demo-notice')).backgroundColor).toBe(
        RECEIPT_REVIEW.dark.demoBg,
      );
      expect(flat(screen.getByText(/Demo mode \(Expo Go\)/i)).color).toBe(
        RECEIPT_REVIEW.dark.demoText,
      );
    });

    it('themes the item TextInput placeholder in dark only, leaving light at the RN default', () => {
      setTestScheme('dark');
      const { unmount } = renderModal();
      const darkInput = screen.getByDisplayValue('Soup');
      expect(darkInput.props.placeholderTextColor).toBe(darkTheme.color.textSecondary);
      expect(darkInput.props.keyboardAppearance).toBe('dark');
      unmount();

      setTestScheme('light');
      renderModal();
      const lightInput = screen.getByDisplayValue('Soup');
      expect(lightInput.props.placeholderTextColor).toBeUndefined();
      expect(lightInput.props.keyboardAppearance).toBe('light');
    });

    // Feature: dark-mode polish pass (Requirement 9.15): item alcohol Switches.
    const renderWithAlcohol = () =>
      render(
        <ReceiptReviewModal
          visible={true}
          members={mockMembers}
          guests={mockGuests}
          callerId="u-1"
          initialRawText={'Soup $10.00\nSafari Amber $9.50'}
          onConfirm={jest.fn()}
          onFallbackToManual={jest.fn()}
          onClose={jest.fn()}
        />,
      );
    const itemSwitches = () =>
      screen
        .UNSAFE_getAllByType(Switch)
        .filter((s) => String(s.props.testID).startsWith('receipt-item-alcohol-'));

    it('dark: item alcohol Switches get token colours; the on thumb differs from off', () => {
      setTestScheme('dark');
      renderWithAlcohol();
      const switches = itemSwitches();
      const off = switches.find((s) => s.props.value === false)!;
      const on = switches.find((s) => s.props.value === true)!;
      expect(off).toBeDefined();
      expect(on).toBeDefined();
      for (const s of [off, on]) {
        expect(s.props.trackColor).toEqual({
          false: darkTheme.color.borderStrong,
          true: darkTheme.color.primary,
        });
        expect(s.props.ios_backgroundColor).toBe(darkTheme.color.borderStrong);
      }
      expect(off.props.thumbColor).toBe(darkTheme.color.textSecondary);
      expect(on.props.thumbColor).toBe(darkTheme.color.textOnPrimary);

      // Flipping the off one on gives it the on thumb.
      fireEvent(screen.getByTestId(off.props.testID), 'valueChange', true);
      const flipped = itemSwitches().find((s) => s.props.testID === off.props.testID)!;
      expect(flipped.props.value).toBe(true);
      expect(flipped.props.thumbColor).toBe(darkTheme.color.textOnPrimary);
    });

    it('light: item alcohol Switches stay on platform defaults', () => {
      setTestScheme('light');
      renderWithAlcohol();
      for (const s of itemSwitches()) {
        expect(s.props.trackColor).toBeUndefined();
        expect(s.props.thumbColor).toBeUndefined();
        expect(s.props.ios_backgroundColor).toBeUndefined();
      }
    });

    // Feature: dark-mode polish pass (Requirement 9.15): the discount charge
    // line's "Exclude alcohol items" Switch.
    const chargeSwitch = () =>
      screen
        .UNSAFE_getAllByType(Switch)
        .find((s) => String(s.props.testID).startsWith('receipt-charge-exclude-alcohol-'))!;

    it('discount exclude-alcohol Switch: dark tokens, on thumb on flip, remount + defaults in light', () => {
      setTestScheme('dark');
      render(
        <ReceiptReviewModal
          visible={true}
          members={mockMembers}
          guests={mockGuests}
          callerId="u-1"
          initialRawText={'Soup $10.00\nAnnual Passholder Discount -1.99'}
          onConfirm={jest.fn()}
          onFallbackToManual={jest.fn()}
          onClose={jest.fn()}
        />,
      );
      const off = chargeSwitch();
      expect(off).toBeDefined();
      const testID: string = off.props.testID;
      expect(off.props.value).toBe(false);
      expect(off.props.trackColor).toEqual({
        false: darkTheme.color.borderStrong,
        true: darkTheme.color.primary,
      });
      expect(off.props.ios_backgroundColor).toBe(darkTheme.color.borderStrong);
      expect(off.props.thumbColor).toBe(darkTheme.color.textSecondary);

      fireEvent(screen.getByTestId(testID), 'valueChange', true);
      expect(chargeSwitch().props.value).toBe(true);
      expect(chargeSwitch().props.thumbColor).toBe(darkTheme.color.textOnPrimary);

      const darkHost = screen.getByTestId(testID);
      setTestScheme('light');
      // `key={t.scheme}`: a new native view, so no dark colour is left stuck on Android.
      expect(screen.getByTestId(testID)).not.toBe(darkHost);
      expect(chargeSwitch().props.trackColor).toBeUndefined();
      expect(chargeSwitch().props.thumbColor).toBeUndefined();
      expect(chargeSwitch().props.ios_backgroundColor).toBeUndefined();
    });
  });
});

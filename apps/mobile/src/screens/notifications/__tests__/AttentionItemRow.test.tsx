/**
 * AttentionItemRow presentation example tests (task 13.4).
 *
 * Validates: Requirements 2.1, 2.3
 *
 * `AttentionItemRow` is a pure, dependency-light presentational row: it takes an
 * {@link AttentionItem} plus a bundle of inline-action callbacks and renders the
 * per-domain Inline_Action controls. These example tests pin the two
 * presentation requirements the row owns:
 *
 *   - **R2.1** — each domain renders exactly its own controls:
 *       friendRequest → Accept / Decline    (attention-accept / attention-decline)
 *       tripInvite    → Accept / Decline    (attention-accept / attention-decline)
 *       rodeWithTag   → Confirm / Decline    (attention-confirm / attention-decline)
 *                       + an optional rating input (attention-rating)
 *       share         → Mark read            (attention-markread)
 *
 *   - **R2.3** — a Share renders the "Open" control (attention-open) ONLY when
 *     its `ref.destination` references a Share_Destination; a Share with no
 *     destination renders no Open control.
 *
 * The row calls no endpoint and needs no navigator or query client, so it is
 * rendered standalone with `jest.fn()` callbacks. Pressing a control is asserted
 * to invoke the matching callback with the item, confirming the wiring the
 * screen (task 13.3) relies on.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { AttentionItem } from '@dwt/shared';

import { AttentionItemRow } from '../../../features/notifications/AttentionItemRow';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TIMESTAMP = '2024-05-01T12:00:00.000Z';

function friendRequestItem(id = 'fr-1'): AttentionItem {
  return {
    domain: 'friendRequest',
    id,
    sourceTimestamp: TIMESTAMP,
    summary: 'Minnie Mouse sent you a friend request',
    ref: { requestId: id },
  };
}

function tripInviteItem(id = 'ti-1'): AttentionItem {
  return {
    domain: 'tripInvite',
    id,
    sourceTimestamp: TIMESTAMP,
    summary: 'Goofy invited you to a trip',
    ref: { inviteId: id, tripId: 'trip-1' },
  };
}

function rodeWithTagItem(id = 'rw-1'): AttentionItem {
  return {
    domain: 'rodeWithTag',
    id,
    sourceTimestamp: TIMESTAMP,
    summary: 'Donald tagged you on Space Mountain',
    ref: { tagId: id, tripLogEntryId: 'tle-1' },
  };
}

function shareItem(id: string, withDestination: boolean): AttentionItem {
  return {
    domain: 'share',
    id,
    sourceTimestamp: TIMESTAMP,
    summary: 'Daisy shared Space Mountain with you',
    ref: withDestination
      ? { shareId: id, destination: { kind: 'experience', id: 'exp-1' } }
      : { shareId: id },
  };
}

/**
 * The full inline-action callback bundle the row requires. Each is a fresh
 * `jest.fn()` so a test can assert the exact control-to-callback wiring.
 */
function makeCallbacks() {
  return {
    onAcceptFriendRequest: jest.fn(),
    onDeclineFriendRequest: jest.fn(),
    onAcceptTripInvite: jest.fn(),
    onDeclineTripInvite: jest.fn(),
    onConfirmRodeWithTag: jest.fn(),
    onDeclineRodeWithTag: jest.fn(),
    onMarkShareRead: jest.fn(),
    onOpenDestination: jest.fn(),
  };
}

function renderRow(
  item: AttentionItem,
  overrides: Partial<ReturnType<typeof makeCallbacks>> = {},
): ReturnType<typeof makeCallbacks> {
  const callbacks = { ...makeCallbacks(), ...overrides };
  render(<AttentionItemRow item={item} {...callbacks} />);
  return callbacks;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AttentionItemRow per-domain inline controls (R2.1)', () => {
  test('friendRequest renders Accept + Decline and wires their callbacks', () => {
    const item = friendRequestItem('fr-42');
    const cbs = renderRow(item);

    const accept = screen.getByTestId('attention-accept-fr-42');
    const decline = screen.getByTestId('attention-decline-fr-42');
    expect(accept).toBeTruthy();
    expect(decline).toBeTruthy();

    // No other domain's controls leak onto a friend-request row.
    expect(screen.queryByTestId('attention-confirm-fr-42')).toBeNull();
    expect(screen.queryByTestId('attention-markread-fr-42')).toBeNull();
    expect(screen.queryByTestId('attention-open-fr-42')).toBeNull();

    fireEvent.press(accept);
    fireEvent.press(decline);
    expect(cbs.onAcceptFriendRequest).toHaveBeenCalledWith(item);
    expect(cbs.onDeclineFriendRequest).toHaveBeenCalledWith(item);
  });

  test('tripInvite renders Accept + Decline and wires their callbacks', () => {
    const item = tripInviteItem('ti-42');
    const cbs = renderRow(item);

    const accept = screen.getByTestId('attention-accept-ti-42');
    const decline = screen.getByTestId('attention-decline-ti-42');
    expect(accept).toBeTruthy();
    expect(decline).toBeTruthy();

    fireEvent.press(accept);
    fireEvent.press(decline);
    expect(cbs.onAcceptTripInvite).toHaveBeenCalledWith(item);
    expect(cbs.onDeclineTripInvite).toHaveBeenCalledWith(item);
  });

  test('rodeWithTag renders Confirm + Decline + a rating input and wires their callbacks', () => {
    const item = rodeWithTagItem('rw-42');
    const cbs = renderRow(item);

    const confirm = screen.getByTestId('attention-confirm-rw-42');
    const decline = screen.getByTestId('attention-decline-rw-42');
    const rating = screen.getByTestId('attention-rating-rw-42');
    expect(confirm).toBeTruthy();
    expect(decline).toBeTruthy();
    expect(rating).toBeTruthy();

    // A typed rating is parsed and forwarded on confirm.
    fireEvent.changeText(rating, '8');
    fireEvent.press(confirm);
    expect(cbs.onConfirmRodeWithTag).toHaveBeenCalledWith(item, 8);

    fireEvent.press(decline);
    expect(cbs.onDeclineRodeWithTag).toHaveBeenCalledWith(item);
  });

  test('share renders Mark read and wires its callback', () => {
    const item = shareItem('sh-42', false);
    const cbs = renderRow(item);

    const markRead = screen.getByTestId('attention-markread-sh-42');
    expect(markRead).toBeTruthy();

    // A share row never shows the accept/decline/confirm controls.
    expect(screen.queryByTestId('attention-accept-sh-42')).toBeNull();
    expect(screen.queryByTestId('attention-decline-sh-42')).toBeNull();
    expect(screen.queryByTestId('attention-confirm-sh-42')).toBeNull();

    fireEvent.press(markRead);
    expect(cbs.onMarkShareRead).toHaveBeenCalledWith(item);
  });
});

describe('AttentionItemRow Share open-destination control is conditional (R2.3)', () => {
  test('a Share referencing a Share_Destination renders the Open control and wires it', () => {
    const item = shareItem('sh-dest', true);
    const cbs = renderRow(item);

    const open = screen.getByTestId('attention-open-sh-dest');
    expect(open).toBeTruthy();

    fireEvent.press(open);
    expect(cbs.onOpenDestination).toHaveBeenCalledWith(item);
  });

  test('a Share with no Share_Destination renders no Open control', () => {
    const item = shareItem('sh-nodest', false);
    renderRow(item);

    // Mark read is still present, but there is no Open control to press.
    expect(screen.getByTestId('attention-markread-sh-nodest')).toBeTruthy();
    expect(screen.queryByTestId('attention-open-sh-nodest')).toBeNull();
  });
});

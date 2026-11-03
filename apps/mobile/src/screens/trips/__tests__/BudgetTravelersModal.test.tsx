import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TravelerProfileDTO } from '@dwt/shared';

import { BudgetTravelersModal } from '../BudgetTravelersModal';

const mockPutMutateAsync = jest.fn();
const mockDeleteMutateAsync = jest.fn();

jest.mock('../budgetApi', () => {
  const actual = jest.requireActual('../budgetApi');
  return {
    ...actual,
    usePutTravelerProfile: jest.fn(() => ({
      mutateAsync: mockPutMutateAsync,
      isLoading: false,
    })),
    useDeleteTravelerProfile: jest.fn(() => ({
      mutateAsync: mockDeleteMutateAsync,
      isLoading: false,
    })),
  };
});

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('BudgetTravelersModal (Task 18.3, Requirements 4.2, 4.4, 4.5, 18.5, 22.5)', () => {
  const tripId = 'trip-100';

  const mockTravelers: TravelerProfileDTO[] = [
    {
      id: 'profile-1',
      memberId: 'member-1',
      guestId: null,
      label: 'Alice',
      ageBracket: 'adult',
      ticketOption: 'base',
      ticketDays: 4,
      ticketStartDate: '2026-11-01',
      discountGroup: 'std-gst',
      passType: 'none',
    },
    {
      id: 'profile-2',
      memberId: 'member-2',
      guestId: null,
      label: 'Bob',
      ageBracket: 'under3',
      ticketOption: null,
      ticketDays: null,
      ticketStartDate: null,
      discountGroup: 'std-gst',
      passType: 'none',
    },
    {
      id: 'profile-3',
      memberId: null,
      guestId: 'guest-1',
      label: 'Charlie',
      ageBracket: 'adult',
      ticketOption: 'park_hopper',
      ticketDays: 2,
      ticketStartDate: '2026-11-02',
      discountGroup: 'std-gst',
      passType: 'annual_pass',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockPutMutateAsync.mockResolvedValue({});
    mockDeleteMutateAsync.mockResolvedValue({});
  });

  it('renders traveler list and asserts absence of deleted users or deleted flags (Requirement 18.5, review F4)', () => {
    renderWithClient(
      <BudgetTravelersModal
        visible={true}
        tripId={tripId}
        travelers={mockTravelers}
        onClose={jest.fn()}
      />
    );

    // Rendered traveler names
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Charlie')).toBeTruthy();

    // Bob is under3, shows "No ticket needed"
    expect(screen.getAllByText('No ticket needed').length).toBeGreaterThanOrEqual(1);

    // Charlie has passType annual_pass, shows "Enter your price"
    expect(screen.getAllByText(/Enter your price/).length).toBeGreaterThanOrEqual(1);

    // Assert absence of any "Deleted user" text or deleted flags in this modal
    expect(screen.queryByText(/Deleted user/i)).toBeNull();
    expect(screen.queryByText(/pending_deletion/i)).toBeNull();
  });

  it('editing a traveler and saving calls PUT /budget/travelers with expected fields', async () => {
    renderWithClient(
      <BudgetTravelersModal
        visible={true}
        tripId={tripId}
        travelers={mockTravelers}
        onClose={jest.fn()}
      />
    );

    // Tap Edit profile for Alice
    const editBtn = screen.getByLabelText('Edit profile for Alice');
    fireEvent.press(editBtn);

    // Change age to child
    fireEvent.press(screen.getByLabelText('Age child'));

    // Change ticket option to park_hopper
    fireEvent.press(screen.getByLabelText('Ticket option park_hopper'));

    // Change discount group to fl-resident
    fireEvent.press(screen.getByLabelText('Discount group fl-resident'));

    // Change ticket days to 5
    fireEvent.press(screen.getByLabelText('5 days'));

    // Save profile
    fireEvent.press(screen.getByLabelText('Save profile'));

    await waitFor(() => {
      expect(mockPutMutateAsync).toHaveBeenCalledWith({
        memberId: 'member-1',
        ageBracket: 'child',
        ticketOption: 'park_hopper',
        ticketDays: 5,
        ticketStartDate: '2026-11-01',
        discountGroup: 'fl-resident',
        passType: 'none',
      });
    });
  });

  it('under-3 displays "No ticket needed" and clears ticket fields on save', async () => {
    renderWithClient(
      <BudgetTravelersModal
        visible={true}
        tripId={tripId}
        travelers={mockTravelers}
        onClose={jest.fn()}
      />
    );

    // Edit Alice
    fireEvent.press(screen.getByLabelText('Edit profile for Alice'));

    // Switch Alice to under3
    fireEvent.press(screen.getByLabelText('Age under3'));

    // Note appears
    expect(screen.getAllByLabelText('No ticket needed').length).toBeGreaterThanOrEqual(1);

    // Save profile
    fireEvent.press(screen.getByLabelText('Save profile'));

    await waitFor(() => {
      expect(mockPutMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          memberId: 'member-1',
          ageBracket: 'under3',
          ticketOption: null,
          ticketDays: null,
          ticketStartDate: null,
        })
      );
    });
  });

  it('pass type non-none displays "Enter your price"', async () => {
    renderWithClient(
      <BudgetTravelersModal
        visible={true}
        tripId={tripId}
        travelers={mockTravelers}
        onClose={jest.fn()}
      />
    );

    // Edit Alice
    fireEvent.press(screen.getByLabelText('Edit profile for Alice'));

    // Switch passType to dvc
    fireEvent.press(screen.getByLabelText('Pass type dvc'));

    // Note appears
    expect(screen.getAllByLabelText('Enter your price').length).toBeGreaterThanOrEqual(1);

    // Save profile
    fireEvent.press(screen.getByLabelText('Save profile'));

    await waitFor(() => {
      expect(mockPutMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          memberId: 'member-1',
          passType: 'dvc',
        })
      );
    });
  });

  it('delete calls DELETE /budget/travelers/:profileId', async () => {
    renderWithClient(
      <BudgetTravelersModal
        visible={true}
        tripId={tripId}
        travelers={mockTravelers}
        onClose={jest.fn()}
      />
    );

    // Tap Delete profile for Alice
    const deleteBtn = screen.getByLabelText('Delete profile for Alice');
    fireEvent.press(deleteBtn);

    await waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith('profile-1');
    });
  });

  it('adding profile for an unconfigured traveler sends guestId or memberId', async () => {
    const unconfiguredGuests = [{ id: 'guest-99', name: 'Daisy', isGuest: true }];

    renderWithClient(
      <BudgetTravelersModal
        visible={true}
        tripId={tripId}
        travelers={mockTravelers}
        guests={unconfiguredGuests}
        onClose={jest.fn()}
      />
    );

    // Add profile for Daisy
    fireEvent.press(screen.getByLabelText('Add profile for Daisy'));

    // Save profile
    fireEvent.press(screen.getByLabelText('Save profile'));

    await waitFor(() => {
      expect(mockPutMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          guestId: 'guest-99',
          ageBracket: 'adult',
        })
      );
    });
  });
});

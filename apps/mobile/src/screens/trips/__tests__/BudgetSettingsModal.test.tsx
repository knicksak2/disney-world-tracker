import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BudgetSettingsDTO } from '@dwt/shared';

import { BudgetSettingsModal } from '../BudgetSettingsModal';

const mockPatchMutateAsync = jest.fn();

jest.mock('../budgetApi', () => {
  const actual = jest.requireActual('../budgetApi');
  return {
    ...actual,
    usePatchBudgetSettings: jest.fn(() => ({
      mutateAsync: mockPatchMutateAsync,
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

describe('BudgetSettingsModal (Task 18.4, Requirements 7.3, 7.4, 7.6, 8.5, 22.5)', () => {
  const tripId = 'trip-100';

  const mockSettings: BudgetSettingsDTO = {
    taxBps: {
      tickets: 650,
      lightning_lane: 650,
      dining: 650,
      lodging: 1250,
      transportation: 650,
      shopping: 650,
      other: 650,
    },
    taxBpsIsDefault: {
      tickets: true,
      lightning_lane: true,
      dining: true,
      lodging: true,
      transportation: true,
      shopping: true,
      other: true,
    },
    diningTipBps: 1800,
    diningTipBpsIsDefault: true,
    savedCents: 50000,
    savingsTargetCents: 200000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPatchMutateAsync.mockResolvedValue(mockSettings);
  });

  it('renders settings fields and checks assumption label presence/absence', () => {
    renderWithClient(
      <BudgetSettingsModal
        visible={true}
        tripId={tripId}
        settings={mockSettings}
        onClose={jest.fn()}
      />
    );

    // Tickets tax rate is verified from Disney price rows (6.5%); assumption label is absent
    expect(screen.queryByLabelText('Assumed rate for tickets')).toBeNull();

    // Dining, lightning_lane, shopping, etc. are unverified defaults; assumption labels are present
    expect(screen.getByLabelText('Assumed rate for dining')).toBeTruthy();
    expect(screen.getByLabelText('Assumed rate for lightning_lane')).toBeTruthy();
    expect(screen.getByLabelText('Assumed rate for shopping')).toBeTruthy();
    expect(screen.getByLabelText('Assumed rate for dining tip')).toBeTruthy();

    // Verify all input fields found by getByLabelText
    expect(screen.getByLabelText('Tax rate for tickets')).toBeTruthy();
    expect(screen.getByLabelText('Tax rate for lightning_lane')).toBeTruthy();
    expect(screen.getByLabelText('Tax rate for dining')).toBeTruthy();
    expect(screen.getByLabelText('Tax rate for lodging')).toBeTruthy();
    expect(screen.getByLabelText('Tax rate for transportation')).toBeTruthy();
    expect(screen.getByLabelText('Tax rate for shopping')).toBeTruthy();
    expect(screen.getByLabelText('Tax rate for other')).toBeTruthy();
    expect(screen.getByLabelText('Dining tip rate')).toBeTruthy();
    expect(screen.getByLabelText('Saved amount')).toBeTruthy();
    expect(screen.getByLabelText('Savings target')).toBeTruthy();
  });

  it('editing fields and saving sends PATCH with rates in basis points and amounts in cents', async () => {
    const saveSuccessSpy = jest.fn();
    const closeSpy = jest.fn();

    renderWithClient(
      <BudgetSettingsModal
        visible={true}
        tripId={tripId}
        settings={mockSettings}
        onClose={closeSpy}
        onSaveSuccess={saveSuccessSpy}
      />
    );

    // Change dining tax to 7.00%
    const diningTaxInput = screen.getByLabelText('Tax rate for dining');
    fireEvent.changeText(diningTaxInput, '7.00');

    // Change dining tip to 20.00%
    const tipInput = screen.getByLabelText('Dining tip rate');
    fireEvent.changeText(tipInput, '20.00');

    // Change saved amount to $600.50
    const savedInput = screen.getByLabelText('Saved amount');
    fireEvent.changeText(savedInput, '600.50');

    // Change target to $2,500.00
    const targetInput = screen.getByLabelText('Savings target');
    fireEvent.changeText(targetInput, '2500.00');

    // Press save
    const saveBtn = screen.getByLabelText('Save settings');
    fireEvent.press(saveBtn);

    await waitFor(() => {
      expect(mockPatchMutateAsync).toHaveBeenCalledWith({
        taxBps: {
          tickets: 650,
          lightning_lane: 650,
          dining: 700,
          lodging: 1250,
          transportation: 650,
          shopping: 650,
          other: 650,
        },
        diningTipBps: 2000,
        savedCents: 60050,
        savingsTargetCents: 250000,
      });
      expect(saveSuccessSpy).toHaveBeenCalledTimes(1);
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('leaving target blank sends null savingsTargetCents', async () => {
    renderWithClient(
      <BudgetSettingsModal
        visible={true}
        tripId={tripId}
        settings={mockSettings}
        onClose={jest.fn()}
      />
    );

    // Clear savings target
    const targetInput = screen.getByLabelText('Savings target');
    fireEvent.changeText(targetInput, '');

    // Press save
    fireEvent.press(screen.getByLabelText('Save settings'));

    await waitFor(() => {
      expect(mockPatchMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          savingsTargetCents: null,
        })
      );
    });
  });

  it('assumption text is absent when taxBpsIsDefault and diningTipBpsIsDefault are false', () => {
    const customSettings: BudgetSettingsDTO = {
      ...mockSettings,
      taxBpsIsDefault: {
        tickets: false,
        lightning_lane: false,
        dining: false,
        lodging: false,
        transportation: false,
        shopping: false,
        other: false,
      },
      diningTipBpsIsDefault: false,
    };

    renderWithClient(
      <BudgetSettingsModal
        visible={true}
        tripId={tripId}
        settings={customSettings}
        onClose={jest.fn()}
      />
    );

    expect(screen.queryByLabelText('Assumed rate for dining')).toBeNull();
    expect(screen.queryByLabelText('Assumed rate for dining tip')).toBeNull();
  });
});


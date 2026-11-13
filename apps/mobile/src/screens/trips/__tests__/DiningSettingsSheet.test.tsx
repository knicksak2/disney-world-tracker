/**
 * DiningSettingsSheet (dining-plan-calculator task 11.2), rendered for real and driven through the real settings hook;
 * only `apiRequest` is mocked, so each save asserts the `PUT` body.
 *
 * Validates: Requirements 3.3, 6.1 to 6.4, 19.6, 22.2.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { apiRequest } from '../../../api/client';
import { ALEX_KEY, BLAIR_KEY, KIT_KEY, plan, SETTINGS, TRIP_ID } from '../../../test/diningPlanFixtures';
import { DiningSettingsSheet } from '../DiningSettingsSheet';
import { usePutDiningSettings } from '../diningPlanApi';

jest.mock('../../../api/client', () => ({ apiRequest: jest.fn() }));

const mockApi = apiRequest as jest.MockedFunction<typeof apiRequest>;
const URL = `/trips/${TRIP_ID}/dining-plan/settings`;

function Harness({ onClose }: { onClose: () => void }) {
  const put = usePutDiningSettings(TRIP_ID);
  return (
    <DiningSettingsSheet
      visible
      settings={SETTINGS}
      party={plan().party}
      defaultTaxBps={650}
      defaultTipBps={1_800}
      onSave={(s) => put.mutateAsync(s)}
      onClose={onClose}
    />
  );
}

function renderSheet(onClose = jest.fn()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => {
  mockApi.mockReset();
  mockApi.mockResolvedValue(plan());
});

describe('DiningSettingsSheet', () => {
  it('changes order style and beverage and sends the whole settings object', async () => {
    const onClose = renderSheet();
    fireEvent.press(screen.getByTestId('dining-settings-order-splurge'));
    fireEvent.press(screen.getByTestId('dining-settings-beverage-water'));
    expect(screen.getByTestId('dining-settings-order-splurge').props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(screen.getByTestId('dining-settings-save'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockApi).toHaveBeenCalledWith('PUT', URL, { ...SETTINGS, orderStyle: 'splurge', beverage: 'water' });
  });

  it('offers alcohol only to adults and sends the chosen drinkers', async () => {
    renderSheet();
    expect(screen.getByTestId(`dining-settings-alcohol-${ALEX_KEY}`)).toBeTruthy();
    expect(screen.getByTestId(`dining-settings-alcohol-${BLAIR_KEY}`)).toBeTruthy();
    expect(screen.queryByTestId(`dining-settings-alcohol-${KIT_KEY}`)).toBeNull();
    fireEvent.press(screen.getByTestId(`dining-settings-alcohol-${BLAIR_KEY}`));
    fireEvent.press(screen.getByTestId('dining-settings-save'));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('PUT', URL, expect.objectContaining({ alcoholDrinkerKeys: [BLAIR_KEY] })));
  });

  it('rejects a tax rate above 25% (2501 basis points) without calling the server', async () => {
    renderSheet();
    fireEvent.changeText(screen.getByTestId('dining-settings-tax'), '25.01');
    fireEvent.press(screen.getByTestId('dining-settings-save'));
    await waitFor(() => expect(screen.getByTestId('dining-settings-error')).toHaveTextContent('Tax must be a rate from 0% to 25%, or blank for the default.'));
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('accepts 25% and a tip override, sending basis points; blank keeps the default (null)', async () => {
    renderSheet();
    expect(screen.getByText('Sales tax (%), default 6.5%')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('dining-settings-tax'), '25');
    fireEvent.changeText(screen.getByTestId('dining-settings-tip'), '20');
    fireEvent.press(screen.getByTestId('dining-settings-save'));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('PUT', URL, expect.objectContaining({ taxBps: 2_500, tipBps: 2_000 })));
  });

  it('sets the extras with steppers and checkboxes, capping mugs at the eligible party', async () => {
    renderSheet();
    fireEvent.press(screen.getByTestId('dining-settings-appetizers-up'));
    fireEvent.press(screen.getByTestId('dining-settings-snacks-up'));
    for (let i = 0; i < 5; i += 1) fireEvent.press(screen.getByTestId('dining-settings-mugs-up'));
    expect(screen.getByTestId('dining-settings-mugs-value')).toHaveTextContent('3');
    fireEvent.press(screen.getByTestId('dining-settings-dessert'));
    fireEvent.press(screen.getByTestId('dining-settings-kids-eat-free'));
    fireEvent.press(screen.getByTestId('dining-settings-stay-type-dvc_or_passholder_resort'));
    fireEvent.press(screen.getByTestId('dining-settings-save'));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('PUT', URL, {
        ...SETTINGS,
        appetizersPerTable: 1,
        snacksPerPersonPerDay: 2,
        mugsWanted: 3,
        orderDessert: false,
        kidsEatFree: false,
        stayType: 'dvc_or_passholder_resort',
      }),
    );
  });

  it('sends custom stay dates, and refuses check-out before check-in', async () => {
    renderSheet();
    fireEvent.press(screen.getByTestId('dining-settings-custom-dates'));
    fireEvent.changeText(screen.getByTestId('dining-settings-check-in'), '2027-03-04');
    fireEvent.changeText(screen.getByTestId('dining-settings-check-out'), '2027-03-02');
    fireEvent.press(screen.getByTestId('dining-settings-save'));
    await waitFor(() => expect(screen.getByTestId('dining-settings-error')).toHaveTextContent('Check-out must not be before check-in.'));
    expect(mockApi).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('dining-settings-check-out'), '2027-03-06');
    fireEvent.press(screen.getByTestId('dining-settings-save'));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith('PUT', URL, expect.objectContaining({ stay: { checkIn: '2027-03-04', checkOut: '2027-03-06' } })));
  });

  it('shows a refused save in words and stays open', async () => {
    mockApi.mockRejectedValueOnce(new Error('Only adults can be counted as drinking alcohol.'));
    const onClose = renderSheet();
    fireEvent.press(screen.getByTestId('dining-settings-save'));
    await waitFor(() => expect(screen.getByTestId('dining-settings-error')).toHaveTextContent('Only adults can be counted as drinking alcohol.'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

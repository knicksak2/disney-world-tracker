/**
 * TanStack Query keys and API client functions for Trip Expenses (Task 10.1).
 *
 * Covers:
 * - Query keys: tripExpenseKeys.list(tripId), .balances(tripId), .drilldown(tripId, memberId)
 * - Client functions for all 16 endpoints in tripExpenseRoutes
 *
 * Validates: Requirement 10.1
 */

import type {
  ExpenseDTO,
  ExpenseCreateInput,
  ExpenseEditInput,
  SettlementDTO,
  SettlementCreateInput,
  TripGuestDTO,
  TripGuestAddInput,
  TripGuestRenameInput,
  RefundDTO,
  RefundCreateInput,
  TripBalancesResponseDTO,
  BalanceDrillDownEntryDTO,
} from '@dwt/shared';
import { apiRequest, apiFetchText } from '../../api/client';

export interface ListExpensesFilters {
  readonly category?: string;
  readonly payerId?: string;
}

export const tripExpenseKeys = {
  all: ['tripExpenses'] as const,
  lists: () => [...tripExpenseKeys.all, 'list'] as const,
  list: (tripId: string, filters?: ListExpensesFilters) =>
    [...tripExpenseKeys.lists(), tripId, filters ?? {}] as const,
  balancesRoot: () => [...tripExpenseKeys.all, 'balances'] as const,
  balances: (tripId: string) => [...tripExpenseKeys.balancesRoot(), tripId] as const,
  drilldownRoot: () => [...tripExpenseKeys.all, 'drilldown'] as const,
  drilldown: (tripId: string, memberId: string, counterpartyId?: string) =>
    [...tripExpenseKeys.drilldownRoot(), tripId, memberId, counterpartyId ?? 'all'] as const,
  guestsRoot: () => [...tripExpenseKeys.all, 'guests'] as const,
  guests: (tripId: string) => [...tripExpenseKeys.guestsRoot(), tripId] as const,
};

// ---------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------

export async function fetchTripExpenses(
  tripId: string,
  filters?: ListExpensesFilters,
): Promise<readonly (ExpenseDTO | SettlementDTO)[]> {
  const queryParams = new URLSearchParams();
  if (filters?.category) {
    queryParams.set('category', filters.category);
  }
  if (filters?.payerId) {
    queryParams.set('payerId', filters.payerId);
  }
  const queryString = queryParams.toString();
  const path = `/trips/${tripId}/expenses${queryString ? `?${queryString}` : ''}`;
  return apiRequest<readonly (ExpenseDTO | SettlementDTO)[]>('GET', path);
}

export async function fetchTripBalances(
  tripId: string,
): Promise<TripBalancesResponseDTO> {
  return apiRequest<TripBalancesResponseDTO>('GET', `/trips/${tripId}/balances`);
}

export async function fetchBalanceDrillDown(
  tripId: string,
  memberId: string,
  counterpartyId?: string,
): Promise<readonly BalanceDrillDownEntryDTO[]> {
  const query = counterpartyId ? `?counterpartyId=${encodeURIComponent(counterpartyId)}` : '';
  return apiRequest<readonly BalanceDrillDownEntryDTO[]>(
    'GET',
    `/trips/${tripId}/balances/${memberId}/drilldown${query}`,
  );
}

export async function fetchTripGuests(
  tripId: string,
): Promise<readonly TripGuestDTO[]> {
  return apiRequest<readonly TripGuestDTO[]>('GET', `/trips/${tripId}/guests`);
}

export async function createExpense(
  tripId: string,
  input: ExpenseCreateInput,
): Promise<ExpenseDTO> {
  return apiRequest<ExpenseDTO>('POST', `/trips/${tripId}/expenses`, input);
}

export async function editExpense(
  tripId: string,
  expenseId: string,
  input: ExpenseEditInput,
): Promise<ExpenseDTO> {
  return apiRequest<ExpenseDTO>('PATCH', `/trips/${tripId}/expenses/${expenseId}`, input);
}

export async function deleteExpense(
  tripId: string,
  expenseId: string,
): Promise<void> {
  await apiRequest('DELETE', `/trips/${tripId}/expenses/${expenseId}`);
}

export async function createRefund(
  tripId: string,
  expenseId: string,
  input: RefundCreateInput,
): Promise<RefundDTO> {
  return apiRequest<RefundDTO>(
    'POST',
    `/trips/${tripId}/expenses/${expenseId}/refunds`,
    input,
  );
}

export async function editRefund(
  tripId: string,
  expenseId: string,
  refundId: string,
  input: RefundCreateInput,
): Promise<RefundDTO> {
  return apiRequest<RefundDTO>(
    'PATCH',
    `/trips/${tripId}/expenses/${expenseId}/refunds/${refundId}`,
    input,
  );
}

export async function deleteRefund(
  tripId: string,
  expenseId: string,
  refundId: string,
): Promise<void> {
  await apiRequest('DELETE', `/trips/${tripId}/expenses/${expenseId}/refunds/${refundId}`);
}

export async function addTripGuest(
  tripId: string,
  input: TripGuestAddInput,
): Promise<TripGuestDTO> {
  return apiRequest<TripGuestDTO>('POST', `/trips/${tripId}/guests`, input);
}

export async function renameTripGuest(
  tripId: string,
  guestId: string,
  input: TripGuestRenameInput,
): Promise<TripGuestDTO> {
  return apiRequest<TripGuestDTO>(
    'PATCH',
    `/trips/${tripId}/guests/${guestId}`,
    input,
  );
}

export async function removeTripGuest(
  tripId: string,
  guestId: string,
): Promise<void> {
  await apiRequest('DELETE', `/trips/${tripId}/guests/${guestId}`);
}

export async function createSettlement(
  tripId: string,
  input: SettlementCreateInput,
): Promise<SettlementDTO> {
  return apiRequest<SettlementDTO>('POST', `/trips/${tripId}/settlements`, input);
}

export async function editSettlement(
  tripId: string,
  settlementId: string,
  input: SettlementCreateInput,
): Promise<SettlementDTO> {
  return apiRequest<SettlementDTO>(
    'PATCH',
    `/trips/${tripId}/settlements/${settlementId}`,
    input,
  );
}

export async function deleteSettlement(
  tripId: string,
  settlementId: string,
): Promise<void> {
  await apiRequest('DELETE', `/trips/${tripId}/settlements/${settlementId}`);
}

export async function exportExpensesCsv(
  tripId: string,
): Promise<string> {
  return apiFetchText(`/trips/${tripId}/expenses/export`);
}

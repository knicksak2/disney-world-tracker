// Feature: navigation-redesign (Requirement 6 amendment 8c) — CreateFoodListModal
// extracted-component tests, ported from MyFoodListsScreen.test.tsx's
// pre-extraction inline-modal create-flow test cases.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { FoodListDTO } from '@dwt/shared';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

import { apiRequest as mockedApiRequest } from '../../../api/client';
import CreateFoodListModal from '../CreateFoodListModal';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

describe('CreateFoodListModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('submitting with default (private) visibility sends visibility: "private" and isChecklist: false', async () => {
    const onCreated = jest.fn();
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (path === '/me/food-lists' && method === 'POST') {
        return {
          id: 'list-new-1',
          ownerId: 'user-me',
          ownerDisplayName: 'Me',
          name: (body as any)?.name,
          visibility: (body as any)?.visibility,
          isChecklist: (body as any)?.isChecklist,
          itemCount: 0,
          likeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          pinnedAt: null,
        } satisfies FoodListDTO;
      }
      return {};
    });

    render(
      <CreateFoodListModal visible onClose={jest.fn()} onCreated={onCreated} />,
    );

    fireEvent.changeText(screen.getByTestId('new-food-list-name-input'), 'Dole Whip Tour');
    fireEvent.press(screen.getByTestId('submit-create-food-list-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/food-lists', {
        name: 'Dole Whip Tour',
        visibility: 'private',
        isChecklist: false,
      });
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'list-new-1', name: 'Dole Whip Tour' }),
      );
    });
  });

  test('toggling Public visibility sends visibility: "public"', async () => {
    apiRequestMock.mockImplementation(async () => ({
      id: 'list-pub-1',
      ownerId: 'user-me',
      ownerDisplayName: 'Me',
      name: 'Magic Kingdom Sweets',
      visibility: 'public',
      isChecklist: false,
      itemCount: 0,
      likeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pinnedAt: null,
    } satisfies FoodListDTO));

    render(<CreateFoodListModal visible onClose={jest.fn()} onCreated={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('new-food-list-name-input'), 'Magic Kingdom Sweets');
    fireEvent.press(screen.getByTestId('new-food-list-visibility-public'));
    fireEvent.press(screen.getByTestId('submit-create-food-list-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/food-lists', {
        name: 'Magic Kingdom Sweets',
        visibility: 'public',
        isChecklist: false,
      });
    });
  });

  test('activating the checklist toggle sends isChecklist: true', async () => {
    apiRequestMock.mockImplementation(async () => ({
      id: 'list-checklist-1',
      ownerId: 'user-me',
      ownerDisplayName: 'Me',
      name: 'Festival Checklist',
      visibility: 'private',
      isChecklist: true,
      itemCount: 0,
      likeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pinnedAt: null,
    } satisfies FoodListDTO));

    render(<CreateFoodListModal visible onClose={jest.fn()} onCreated={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('new-food-list-name-input'), 'Festival Checklist');
    fireEvent.press(screen.getByTestId('new-food-list-checklist-toggle'));
    fireEvent.press(screen.getByTestId('submit-create-food-list-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/food-lists', {
        name: 'Festival Checklist',
        visibility: 'private',
        isChecklist: true,
      });
    });
  });

  test('a rejected submission surfaces a visible error, keeps the modal open, and leaves the entered name intact', async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new Error('Network error creating list');
    });
    const onClose = jest.fn();

    render(<CreateFoodListModal visible onClose={onClose} onCreated={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('new-food-list-name-input'), 'Failed List');
    fireEvent.press(screen.getByTestId('submit-create-food-list-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('create-food-list-error')).toBeTruthy();
      expect(screen.getByText('Network error creating list')).toBeTruthy();
    });

    expect(onClose).not.toHaveBeenCalled();
    const input = screen.getByTestId('new-food-list-name-input');
    expect(input.props.value).toBe('Failed List');
  });

  test('Cancel calls onClose without submitting', () => {
    const onClose = jest.fn();
    render(<CreateFoodListModal visible onClose={onClose} onCreated={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('new-food-list-name-input'), 'Abandoned List');
    fireEvent.press(screen.getByTestId('cancel-create-food-list-btn'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});

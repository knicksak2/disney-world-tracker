// Feature: navigation-redesign (Requirement 6 amendment 8c) — CreateExperienceListModal
// extracted-component tests, ported from MyExperienceListsScreen.test.tsx's
// pre-extraction inline-modal create-flow test case.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ExperienceListDTO } from '@dwt/shared';

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
import CreateExperienceListModal from '../CreateExperienceListModal';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

describe('CreateExperienceListModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('submitting with default (private) visibility sends visibility: "private"', async () => {
    const onCreated = jest.fn();
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (path === '/me/experience-lists' && method === 'POST') {
        return {
          id: 'exp-list-new-1',
          ownerId: 'user-me',
          ownerDisplayName: 'Me',
          name: (body as any)?.name,
          visibility: (body as any)?.visibility,
          itemCount: 0,
          likeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          pinnedAt: null,
        } satisfies ExperienceListDTO;
      }
      return {};
    });

    render(<CreateExperienceListModal visible onClose={jest.fn()} onCreated={onCreated} />);

    fireEvent.changeText(
      screen.getByTestId('new-experience-list-name-input'),
      'Must-Ride Attractions',
    );
    fireEvent.press(screen.getByTestId('submit-create-experience-list-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/experience-lists', {
        name: 'Must-Ride Attractions',
        visibility: 'private',
      });
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'exp-list-new-1', name: 'Must-Ride Attractions' }),
      );
    });
  });

  test('toggling Public visibility sends visibility: "public"', async () => {
    apiRequestMock.mockImplementation(async () => ({
      id: 'exp-list-pub-1',
      ownerId: 'user-me',
      ownerDisplayName: 'Me',
      name: 'Must Do',
      visibility: 'public',
      itemCount: 0,
      likeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pinnedAt: null,
    } satisfies ExperienceListDTO));

    render(<CreateExperienceListModal visible onClose={jest.fn()} onCreated={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('new-experience-list-name-input'), 'Must Do');
    fireEvent.press(screen.getByTestId('new-experience-list-visibility-public'));
    fireEvent.press(screen.getByTestId('submit-create-experience-list-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/experience-lists', {
        name: 'Must Do',
        visibility: 'public',
      });
    });
  });

  test('a rejected submission surfaces a visible error, keeps the modal open, and leaves the entered name intact', async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new Error('Network error creating list');
    });
    const onClose = jest.fn();

    render(<CreateExperienceListModal visible onClose={onClose} onCreated={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('new-experience-list-name-input'), 'Failed List');
    fireEvent.press(screen.getByTestId('submit-create-experience-list-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('create-experience-list-error')).toBeTruthy();
      expect(screen.getByText('Network error creating list')).toBeTruthy();
    });

    expect(onClose).not.toHaveBeenCalled();
    const input = screen.getByTestId('new-experience-list-name-input');
    expect(input.props.value).toBe('Failed List');
  });

  test('Cancel calls onClose without submitting', () => {
    const onClose = jest.fn();
    render(<CreateExperienceListModal visible onClose={onClose} onCreated={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('new-experience-list-name-input'), 'Abandoned List');
    fireEvent.press(screen.getByTestId('cancel-create-experience-list-btn'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ExperienceDTO, MickeyListItemDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import SubmitMickeyScreen from '../SubmitMickeyScreen';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const Stack = createNativeStackNavigator();

const mockExperience: ExperienceDTO = {
  id: 'exp-space',
  name: 'Space Mountain',
  park: 'Magic Kingdom',
  land: 'Tomorrowland',
  category: 'Ride',
  active: true,
  latitude: null,
  longitude: null,
  description: 'A thrilling high-speed space coaster',
  imageUrl: null,
  areaType: 'ThemePark',
};

const mockExistingMickeys: readonly MickeyListItemDTO[] = [
  {
    id: 'm-exist-1',
    clue1: 'Look at the meteor pattern on the wall',
    zone: 'queue',
    difficulty: 'easy',
    official: true,
    experienceId: 'exp-space',
    experienceName: 'Space Mountain',
    land: 'Tomorrowland',
    park: 'Magic Kingdom',
    hintLevel: 1,
    found: false,
    confidenceLabel: 'confirmed',
    communityVerified: false,
  },
];

function renderScreen(initialParams?: any) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="SubmitMickey"
            component={SubmitMickeyScreen}
            initialParams={initialParams}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('SubmitMickeyScreen (Task 10.5, Requirements 6.9, 6.10, 9.1, 9.2, 15.5)', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it('searches experiences, displays duplicate list on selection, and validates form bounds', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path.startsWith('/catalog?q=')) {
        return [mockExperience] as never;
      }
      if (path.startsWith('/mickeys?experienceId=exp-space')) {
        return { items: mockExistingMickeys, nextCursor: null } as never;
      }
      return {} as never;
    });

    renderScreen();

    // Guidelines visible
    expect(screen.getByText('Submission Guidelines')).toBeTruthy();
    expect(screen.getByText(/Guest areas only/)).toBeTruthy();
    expect(screen.getByText(/No links or contact info/)).toBeTruthy();

    // Search experience
    fireEvent.changeText(screen.getByLabelText('Search attraction or location'), 'Space');

    const expOption = await screen.findByText('Space Mountain');
    fireEvent.press(expOption);

    // Selected experience and duplicate prevention list rendered
    expect(await screen.findByText(/Existing Mickeys for Space Mountain:/)).toBeTruthy();
    expect(await screen.findByText(/Look at the meteor pattern on the wall/)).toBeTruthy();

    // Fill form
    fireEvent.changeText(
      screen.getByLabelText('Clue 1 text'),
      'Notice the three circular speakers arranged as ears',
    );
    fireEvent.changeText(
      screen.getByLabelText('Clue 2 text'),
      'Above the dispatch console on the left side',
    );
    fireEvent.changeText(
      screen.getByLabelText('Reveal text'),
      'Directly mounted on the steel beam over loading bay 2',
    );

    // Submit button should now be enabled
    const submitBtn = screen.getByLabelText('Submit Hidden Mickey');
    expect(submitBtn.props.accessibilityState?.disabled).toBeFalsy();
  });

  it('submits valid form with POST /mickeys payload', async () => {
    mockApiRequest.mockImplementation(async (method: string, path: string) => {
      if (path === '/catalog/exp-space') {
        return mockExperience as never;
      }
      if (path.startsWith('/mickeys?experienceId=exp-space')) {
        return { items: [], nextCursor: null } as never;
      }
      if (method === 'POST' && path === '/mickeys') {
        return {
          id: 'sub-new',
          status: 'approved',
          official: false,
          communityVerified: false,
          clue1: 'Notice the three circular speakers arranged as ears',
          experienceName: 'Space Mountain',
          reviewNote: null,
          createdAt: '2026-02-01T12:00:00Z',
        } as never;
      }
      return {} as never;
    });

    // Provide initial route experienceId
    renderScreen({ experienceId: 'exp-space' });

    expect(await screen.findByText('Space Mountain')).toBeTruthy();

    fireEvent.changeText(
      screen.getByLabelText('Clue 1 text'),
      'Notice the three circular speakers arranged as ears',
    );
    fireEvent.changeText(
      screen.getByLabelText('Clue 2 text'),
      'Above the dispatch console on the left side',
    );
    fireEvent.changeText(
      screen.getByLabelText('Reveal text'),
      'Directly mounted on the steel beam over loading bay 2',
    );

    fireEvent.press(screen.getByLabelText('Submit Hidden Mickey'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'POST',
        '/mickeys',
        {
          experienceId: 'exp-space',
          zone: 'queue',
          difficulty: 'medium',
          clue1: 'Notice the three circular speakers arranged as ears',
          clue2: 'Above the dispatch console on the left side',
          reveal: 'Directly mounted on the steel beam over loading bay 2',
        },
      );
    });
  });

  it('surfaces error message when text check rejects links or emails', async () => {
    mockApiRequest.mockImplementation(async (method: string, path: string) => {
      if (path === '/catalog/exp-space') return mockExperience as never;
      if (path.startsWith('/mickeys?experienceId=exp-space')) return { items: [] } as never;
      if (method === 'POST' && path === '/mickeys') {
        const error = new Error('Text check rejected') as any;
        error.code = 'mickey_text_rejected';
        throw error;
      }
      return {} as never;
    });

    renderScreen({ experienceId: 'exp-space' });

    await screen.findByText('Space Mountain');

    fireEvent.changeText(screen.getByLabelText('Clue 1 text'), 'Visit https://disney.com for clue');
    fireEvent.changeText(screen.getByLabelText('Clue 2 text'), 'Above the dispatch console');
    fireEvent.changeText(screen.getByLabelText('Reveal text'), 'Mount on the steel beam');

    fireEvent.press(screen.getByLabelText('Submit Hidden Mickey'));

    expect(
      await screen.findByText('Text rejected: links, email addresses, and flagged content are strictly forbidden.'),
    ).toBeTruthy();
  });

  it('surfaces error message when daily submission limit is reached', async () => {
    mockApiRequest.mockImplementation(async (method: string, path: string) => {
      if (path === '/catalog/exp-space') return mockExperience as never;
      if (path.startsWith('/mickeys?experienceId=exp-space')) return { items: [] } as never;
      if (method === 'POST' && path === '/mickeys') {
        const error = new Error('Daily limit reached') as any;
        error.code = 'mickey_submission_limit';
        throw error;
      }
      return {} as never;
    });

    renderScreen({ experienceId: 'exp-space' });

    await screen.findByText('Space Mountain');

    fireEvent.changeText(screen.getByLabelText('Clue 1 text'), 'Valid clue text one here');
    fireEvent.changeText(screen.getByLabelText('Clue 2 text'), 'Valid clue text two here');
    fireEvent.changeText(screen.getByLabelText('Reveal text'), 'Valid reveal text here');

    fireEvent.press(screen.getByLabelText('Submit Hidden Mickey'));

    expect(
      await screen.findByText('Daily submission limit reached (5 submissions per day). Please try again tomorrow.'),
    ).toBeTruthy();
  });

  it('surfaces error message when user is banned from submissions', async () => {
    mockApiRequest.mockImplementation(async (method: string, path: string) => {
      if (path === '/catalog/exp-space') return mockExperience as never;
      if (path.startsWith('/mickeys?experienceId=exp-space')) return { items: [] } as never;
      if (method === 'POST' && path === '/mickeys') {
        const error = new Error('Submissions banned') as any;
        error.code = 'mickey_submissions_banned';
        throw error;
      }
      return {} as never;
    });

    renderScreen({ experienceId: 'exp-space' });

    await screen.findByText('Space Mountain');

    fireEvent.changeText(screen.getByLabelText('Clue 1 text'), 'Valid clue text one here');
    fireEvent.changeText(screen.getByLabelText('Clue 2 text'), 'Valid clue text two here');
    fireEvent.changeText(screen.getByLabelText('Reveal text'), 'Valid reveal text here');

    fireEvent.press(screen.getByLabelText('Submit Hidden Mickey'));

    expect(
      await screen.findByText('Your account is currently restricted from submitting Hidden Mickeys.'),
    ).toBeTruthy();
  });
});

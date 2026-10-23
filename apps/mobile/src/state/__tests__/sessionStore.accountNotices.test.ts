/**
 * sessionStore: the two non-persisted account-deletion notices
 * (account-deletion R1.13, R4.9; tasks.md 14.1).
 */

const mockSecureStore = new Map<string, string>();
const mockSetItem = jest.fn(async (key: string, value: string) => {
  mockSecureStore.set(key, value);
});
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: (key: string, value: string) => mockSetItem(key, value),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

import { useSessionStore } from '../sessionStore';

describe('sessionStore account notices', () => {
  beforeEach(() => {
    mockSecureStore.clear();
    mockSetItem.mockClear();
    useSessionStore.setState(useSessionStore.getInitialState(), true);
  });

  it('a fresh store has no deletion notice and no restored notice', () => {
    const s = useSessionStore.getState();
    expect(s.accountDeletionNotice).toBeNull();
    expect(s.accountRestoredNotice).toBe(false);
  });

  it('clearToken() signs out but leaves the deletion notice in place', async () => {
    await useSessionStore.getState().setToken('tok');
    useSessionStore
      .getState()
      .setAccountDeletionNotice({ scheduledPurgeAt: '2030-03-15T12:00:00.000Z', graceDays: 30 });

    await useSessionStore.getState().clearToken();

    expect(useSessionStore.getState().token).toBeNull();
    expect(useSessionStore.getState().accountDeletionNotice).toEqual({
      scheduledPurgeAt: '2030-03-15T12:00:00.000Z',
      graceDays: 30,
    });
  });

  it('dismissAccountDeletionNotice removes it', () => {
    useSessionStore
      .getState()
      .setAccountDeletionNotice({ scheduledPurgeAt: '2030-03-15T12:00:00.000Z', graceDays: 30 });
    useSessionStore.getState().dismissAccountDeletionNotice();
    expect(useSessionStore.getState().accountDeletionNotice).toBeNull();
  });

  it('a successful sign-in (setToken) drops a leftover deletion notice', async () => {
    useSessionStore
      .getState()
      .setAccountDeletionNotice({ scheduledPurgeAt: '2030-03-15T12:00:00.000Z', graceDays: 30 });

    await useSessionStore.getState().setToken('tok-after-login');

    expect(useSessionStore.getState().token).toBe('tok-after-login');
    expect(useSessionStore.getState().accountDeletionNotice).toBeNull();
  });

  it('an undismissed restored notice does not leak into a later ordinary sign-in (setToken resets it)', async () => {
    // A restoring sign-in: token first, then the flag (the order Login and Reset use).
    await useSessionStore.getState().setToken('tok-restoring');
    useSessionStore.getState().setAccountRestoredNotice(true);
    expect(useSessionStore.getState().accountRestoredNotice).toBe(true);

    // Logout without dismissing: clearToken itself leaves the flag alone ...
    await useSessionStore.getState().clearToken();
    expect(useSessionStore.getState().accountRestoredNotice).toBe(true);

    // ... but the next sign-in, which restored nothing, starts with no banner.
    await useSessionStore.getState().setToken('tok-ordinary');
    expect(useSessionStore.getState().token).toBe('tok-ordinary');
    expect(useSessionStore.getState().accountRestoredNotice).toBe(false);
  });

  it('setAccountRestoredNotice / dismissAccountRestoredNotice toggle the flag', () => {
    useSessionStore.getState().setAccountRestoredNotice(true);
    expect(useSessionStore.getState().accountRestoredNotice).toBe(true);
    useSessionStore.getState().dismissAccountRestoredNotice();
    expect(useSessionStore.getState().accountRestoredNotice).toBe(false);
  });

  it('neither notice is written to secure storage and neither survives a restart', async () => {
    useSessionStore
      .getState()
      .setAccountDeletionNotice({ scheduledPurgeAt: '2030-03-15T12:00:00.000Z', graceDays: 30 });
    useSessionStore.getState().setAccountRestoredNotice(true);

    // Nothing was persisted.
    expect(mockSetItem).not.toHaveBeenCalled();
    expect([...mockSecureStore.values()].join('|')).not.toContain('2030');

    // "Restart": a brand new store state hydrated from storage has neither notice.
    useSessionStore.setState(useSessionStore.getInitialState(), true);
    await useSessionStore.getState().loadFromStorage();
    expect(useSessionStore.getState().accountDeletionNotice).toBeNull();
    expect(useSessionStore.getState().accountRestoredNotice).toBe(false);
  });
});

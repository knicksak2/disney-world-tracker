import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import RootNavigator from './navigation/RootNavigator';
import { useSessionStore } from './state/sessionStore';

/**
 * Root application component.
 *
 * Wires up the foundational providers — React Query for server state and
 * SafeArea for layout — then mounts `NavigationContainer` and the
 * `RootNavigator`, which gates the main tabs behind a valid session.
 *
 * On mount we hydrate the session store from secure storage exactly once
 * so the navigator can decide between the auth stack and the main tabs
 * without flashing the login screen for users who are already signed in.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App(): JSX.Element {
  const loadFromStorage = useSessionStore((state) => state.loadFromStorage);

  useEffect(() => {
    void loadFromStorage();
  }, [loadFromStorage]);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
        <StatusBar style="auto" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

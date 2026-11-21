import { useContext, useEffect, useRef } from 'react';
import { NavigationContext } from '@react-navigation/native';

import { useSessionStore } from '../../state/sessionStore';
import { useOnboardingState } from './onboardingApi';

/**
 * Mounts silently inside `MainTabsNavigator`, checks `GET /me/onboarding`,
 * and triggers the full-screen `OnboardingFlow` once per session iff
 * `needsOnboarding === true`. Renders `null` at all times so veterans never
 * see a modal flash while loading, and API failures never block `MainTabs`.
 */
export default function OnboardingGate(): null {
  const navigation = useContext(NavigationContext);
  const token = useSessionStore((state) => state.token);
  const query = useOnboardingState(token !== null);
  const hasTriggeredForTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (token === null) {
      hasTriggeredForTokenRef.current = null;
      return;
    }
    if (
      navigation &&
      query.data?.needsOnboarding === true &&
      hasTriggeredForTokenRef.current !== token
    ) {
      hasTriggeredForTokenRef.current = token;
      (navigation as any).navigate('OnboardingFlow', { mode: 'firstRun' });
    }
  }, [token, navigation, query.data?.needsOnboarding]);

  return null;
}

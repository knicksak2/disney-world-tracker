/**
 * Trips-list transient notice store (trips task 17.7).
 *
 * Some Trip flows navigate the User to the `Trips_List_Screen` and must show a
 * short "no longer available" message once they land there — for example the
 * `Active_Trip_Shortcut` when its target Trip has ticked out of `active` or the
 * User has lost membership since the shortcut rendered (R19.6). The fallback
 * navigation itself is a single nested `navigate` issued through
 * `navigationRef` (see `navigateToTripsList`), which carries no route params
 * (the `TripsList` route intentionally takes `undefined`). Rather than thread a
 * message through navigation params, the caller stashes it here and the
 * `Trips_List_Screen` reads it on render and displays it as a dismissible
 * banner.
 *
 * The store is a minimal module-level value plus a `useSyncExternalStore`
 * subscription so the message survives the navigation (it is set before the
 * dispatch and read after the screen mounts) without any global provider. It
 * holds at most one pending notice; setting a new one replaces the previous.
 *
 * The deep-link tap handler (task 17.8) surfaces the same class of
 * "no longer available" message (R18.5) and can reuse this store, keeping the
 * message-surfacing mechanism in one place.
 */

import { useSyncExternalStore } from 'react';

/** The single pending notice, or `null` when there is nothing to show. */
let notice: string | null = null;

/** Subscribers (React components) notified whenever the notice changes. */
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Queue a notice to be shown the next time the `Trips_List_Screen` renders.
 * Replaces any currently pending notice. Callers set this immediately before
 * dispatching the fallback navigation to the Trips list.
 */
export function setTripsListNotice(message: string): void {
  notice = message;
  emit();
}

/**
 * Clear the pending notice. The `Trips_List_Screen` calls this when the User
 * dismisses the banner and when the screen loses focus, so a notice is shown
 * once and never lingers across later visits.
 */
export function clearTripsListNotice(): void {
  if (notice !== null) {
    notice = null;
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string | null {
  return notice;
}

/**
 * Subscribe a component to the pending Trips-list notice. Returns the current
 * message, or `null` when there is nothing to show.
 */
export function useTripsListNotice(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

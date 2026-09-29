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
 * Queue a notice to be shown when an experience list screen renders.
 */
export function setExperienceListNotice(message: string): void {
  notice = message;
  emit();
}

/**
 * Clear the pending notice.
 */
export function clearExperienceListNotice(): void {
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
 * Subscribe a component to the pending Experience List notice.
 */
export function useExperienceListNotice(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

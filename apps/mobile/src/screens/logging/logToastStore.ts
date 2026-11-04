// Feature: unified-experience-logging, Task 6.2 — App-root log toast store
//
// Validates: Requirements 7.1, 7.3, 7.4, 8.1, 8.2, 8.3, 8.5, 14.3

import { create } from 'zustand';

export const LOG_TOAST_MS = 6000;
export const LOG_TOAST_WITH_DISH_PROMPT_MS = 8000;

export interface LogToastPayload {
  readonly message: string;
  readonly tripId: string | null;
  readonly experienceId: string;
  readonly offerDishPrompt: boolean;
}

export interface LogToastItem extends LogToastPayload {
  readonly nonce: number;
}

export interface LogToastState {
  readonly current: LogToastItem | null;
  show: (toast: LogToastPayload) => void;
  dismiss: () => void;
}

let activeTimer: ReturnType<typeof setTimeout> | null = null;
let nonceSeq = 0;

export const useLogToastStore = create<LogToastState>((set, get) => ({
  current: null,
  show: (toast: LogToastPayload) => {
    if (activeTimer !== null) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
    const item: LogToastItem = {
      ...toast,
      nonce: ++nonceSeq,
    };
    set({ current: item });
    const duration = toast.offerDishPrompt
      ? LOG_TOAST_WITH_DISH_PROMPT_MS
      : LOG_TOAST_MS;
    activeTimer = setTimeout(() => {
      activeTimer = null;
      get().dismiss();
    }, duration);
  },
  dismiss: () => {
    if (activeTimer !== null) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
    set({ current: null });
  },
}));


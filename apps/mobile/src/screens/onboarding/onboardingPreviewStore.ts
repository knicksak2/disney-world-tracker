import { create } from 'zustand';
import type { StarterChecklistDTO } from '@dwt/shared';

const DEFAULT_PREVIEW_CHECKLIST: StarterChecklistDTO = {
  loggedFirstExperience: false,
  starredFavorite: false,
  hasTrip: false,
  claimedPin: false,
};

interface OnboardingPreviewState {
  readonly previewStarterChecklist: boolean;
  readonly previewChecklist: StarterChecklistDTO;
  enableStarterChecklistPreview: (overrides?: Partial<StarterChecklistDTO>) => void;
  markPreviewItemDone: (item: keyof StarterChecklistDTO) => void;
  dismissStarterChecklistPreview: () => void;
}

/**
 * Local-only preview state so existing/veteran accounts can repeatedly test
 * the full 3-step onboarding flow and Home's StartHereCard without mutating
 * real server data or violating veteran grandfathering.
 */
export const useOnboardingPreviewStore = create<OnboardingPreviewState>((set) => ({
  previewStarterChecklist: false,
  previewChecklist: DEFAULT_PREVIEW_CHECKLIST,
  enableStarterChecklistPreview: (overrides) =>
    set({
      previewStarterChecklist: true,
      previewChecklist: {
        ...DEFAULT_PREVIEW_CHECKLIST,
        ...overrides,
      },
    }),
  markPreviewItemDone: (item) =>
    set((state) => {
      if (!state.previewStarterChecklist) return state;
      const nextChecklist: StarterChecklistDTO = {
        ...state.previewChecklist,
        [item]: true,
      };
      const allDone =
        nextChecklist.loggedFirstExperience &&
        nextChecklist.starredFavorite &&
        nextChecklist.hasTrip &&
        nextChecklist.claimedPin;
      return {
        previewStarterChecklist: !allDone,
        previewChecklist: nextChecklist,
      };
    }),
  dismissStarterChecklistPreview: () =>
    set({
      previewStarterChecklist: false,
      previewChecklist: DEFAULT_PREVIEW_CHECKLIST,
    }),
}));

export function markStarterChecklistPreviewDone(
  item: keyof StarterChecklistDTO,
): void {
  useOnboardingPreviewStore.getState().markPreviewItemDone(item);
}

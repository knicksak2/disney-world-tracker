// Feature: unified-experience-logging, Task 6.4 — Thin wrapper over LogExperienceSheet
//
// Validates: Requirements 1.1, 13.3, 13.5

import React from 'react';
import LogExperienceSheet from '../logging/LogExperienceSheet';

export interface LogVisitModalProps {
  /** Stable internal Experience id the log is created for. */
  readonly experienceId: string;
  readonly experience?: {
    readonly name: string;
    readonly category: string | null;
    readonly park?: string | null | undefined;
  } | undefined;
  /** Whether the modal is presented. */
  readonly visible: boolean;
  /** Dismiss the modal without logging. */
  readonly onClose: () => void;
  /**
   * Invoked after a successful `POST`. The parent uses it to invalidate the
   * visit-history, completion, rating, aggregate, and stats queries (R6.5).
   */
  readonly onLogged: () => void;
}

export default function LogVisitModal({
  experienceId,
  experience,
  visible,
  onClose,
  onLogged,
}: LogVisitModalProps): JSX.Element {
  return (
    <LogExperienceSheet
      experienceId={experienceId}
      experience={experience}
      visible={visible}
      onClose={onClose}
      onLogged={onLogged}
    />
  );
}

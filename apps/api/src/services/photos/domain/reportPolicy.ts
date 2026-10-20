import { type PhotoStatus, type PhotoTargetKind } from '@dwt/shared';

export interface ShouldAutoHideParams {
  status: PhotoStatus;
  countedOpenReports: number;
  kind: PhotoTargetKind;
}

export interface ReportAutoHideThresholds {
  food: number;
  trip: number;
}

export function shouldAutoHide(
  params: ShouldAutoHideParams,
  thresholds: ReportAutoHideThresholds
): boolean {
  if (params.status !== 'approved') {
    return false;
  }
  const threshold = params.kind === 'food_log' ? thresholds.food : thresholds.trip;
  return params.countedOpenReports >= threshold;
}

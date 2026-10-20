export type UploadState =
  | 'selected'
  | 'preparing'
  | 'requesting'
  | 'uploading'
  | 'confirming'
  | 'checking'
  | 'approved'
  | 'rejected'
  | 'failed';

export type ActiveUploadStep =
  | 'selected'
  | 'preparing'
  | 'requesting'
  | 'uploading'
  | 'confirming'
  | 'checking';

export interface UploadMachineState {
  readonly status: UploadState;
  readonly failedStep?: ActiveUploadStep | undefined;
  readonly error?: string | undefined;
  readonly rejectReason?: string | undefined;
  readonly rejectMessage?: string | undefined;
}

export type UploadMachineAction =
  | { type: 'START_PREPARE' }
  | { type: 'PREPARE_SUCCESS' }
  | { type: 'START_REQUEST' }
  | { type: 'REQUEST_SUCCESS' }
  | { type: 'START_UPLOAD' }
  | { type: 'UPLOAD_SUCCESS' }
  | { type: 'START_CONFIRM' }
  | { type: 'CONFIRM_SUCCESS' }
  | { type: 'CHECK_APPROVED' }
  | { type: 'CHECK_REJECTED'; reason?: string; message?: string }
  | { type: 'FAIL'; error?: string }
  | { type: 'RETRY' };

export const INITIAL_UPLOAD_STATE: UploadMachineState = {
  status: 'selected',
};

const TERMINAL_STATES: ReadonlySet<UploadState> = new Set(['approved', 'rejected']);

const ACTIVE_STEPS: ReadonlySet<UploadState> = new Set([
  'selected',
  'preparing',
  'requesting',
  'uploading',
  'confirming',
  'checking',
]);

/**
 * Pure state reducer implementing Property 25:
 * Legal transitions:
 * selected -> preparing -> requesting -> uploading -> confirming -> checking -> approved | rejected
 * Active states can transition to failed via FAIL, saving failedStep.
 * From failed, RETRY transitions back to the failed step.
 * Terminal states (approved, rejected) never transition.
 */
export function uploadReducer(
  state: UploadMachineState,
  action: UploadMachineAction
): UploadMachineState {
  // Terminal states never leave their state
  if (TERMINAL_STATES.has(state.status)) {
    return state;
  }

  // FAIL is accepted from any active step
  if (action.type === 'FAIL') {
    if (ACTIVE_STEPS.has(state.status)) {
      return {
        status: 'failed',
        failedStep: state.status as ActiveUploadStep,
        error: action.error,
      };
    }
    return state;
  }

  switch (state.status) {
    case 'selected':
      if (action.type === 'START_PREPARE') {
        return { status: 'preparing' };
      }
      return state;

    case 'preparing':
      if (action.type === 'PREPARE_SUCCESS' || action.type === 'START_REQUEST') {
        return { status: 'requesting' };
      }
      return state;

    case 'requesting':
      if (action.type === 'REQUEST_SUCCESS' || action.type === 'START_UPLOAD') {
        return { status: 'uploading' };
      }
      return state;

    case 'uploading':
      if (action.type === 'UPLOAD_SUCCESS' || action.type === 'START_CONFIRM') {
        return { status: 'confirming' };
      }
      return state;

    case 'confirming':
      if (action.type === 'CONFIRM_SUCCESS') {
        return { status: 'checking' };
      }
      return state;

    case 'checking':
      if (action.type === 'CHECK_APPROVED') {
        return { status: 'approved' };
      }
      if (action.type === 'CHECK_REJECTED') {
        return {
          status: 'rejected',
          rejectReason: action.reason,
          rejectMessage: action.message,
        };
      }
      return state;

    case 'failed':
      if (action.type === 'RETRY') {
        const resumeStep = state.failedStep ?? 'selected';
        return {
          status: resumeStep,
        };
      }
      return state;

    default:
      return state;
  }
}

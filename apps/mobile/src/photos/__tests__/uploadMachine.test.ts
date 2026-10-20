import fc from 'fast-check';
import {
  uploadReducer,
  INITIAL_UPLOAD_STATE,
  type UploadMachineState,
  type UploadMachineAction,
  type UploadState,
} from '../uploadMachine';

// Feature: photo-uploads, Property 25: Client upload state machine
describe('uploadMachine (Property 25 & unit examples)', () => {
  const arbitraryAction: fc.Arbitrary<UploadMachineAction> = fc.oneof(
    fc.constant<UploadMachineAction>({ type: 'START_PREPARE' }),
    fc.constant<UploadMachineAction>({ type: 'PREPARE_SUCCESS' }),
    fc.constant<UploadMachineAction>({ type: 'START_REQUEST' }),
    fc.constant<UploadMachineAction>({ type: 'REQUEST_SUCCESS' }),
    fc.constant<UploadMachineAction>({ type: 'START_UPLOAD' }),
    fc.constant<UploadMachineAction>({ type: 'UPLOAD_SUCCESS' }),
    fc.constant<UploadMachineAction>({ type: 'START_CONFIRM' }),
    fc.constant<UploadMachineAction>({ type: 'CONFIRM_SUCCESS' }),
    fc.constant<UploadMachineAction>({ type: 'CHECK_APPROVED' }),
    fc.record({
      type: fc.constant<'CHECK_REJECTED'>('CHECK_REJECTED'),
      reason: fc.constantFrom('harm', 'not_food', 'face_visible', 'too_much_text'),
      message: fc.string(),
    }),
    fc.record({
      type: fc.constant<'FAIL'>('FAIL'),
      error: fc.string(),
    }),
    fc.constant<UploadMachineAction>({ type: 'RETRY' })
  );

  it('Property 25: only moves along legal edges, terminal states never leave, retry returns to failed step', () => {
    fc.assert(
      fc.property(fc.array(arbitraryAction, { minLength: 1, maxLength: 50 }), (actions) => {
        let state: UploadMachineState = INITIAL_UPLOAD_STATE;

        for (const action of actions) {
          const prevState = state;
          state = uploadReducer(state, action);

          // Invariant 1: Terminal states never transition to any other state
          if (prevState.status === 'approved') {
            expect(state.status).toBe('approved');
          }
          if (prevState.status === 'rejected') {
            expect(state.status).toBe('rejected');
          }

          // Invariant 2: Legal state transitions
          const validNextStates: Record<UploadState, readonly UploadState[]> = {
            selected: ['selected', 'preparing', 'failed'],
            preparing: ['preparing', 'requesting', 'failed'],
            requesting: ['requesting', 'uploading', 'failed'],
            uploading: ['uploading', 'confirming', 'failed'],
            confirming: ['confirming', 'checking', 'failed'],
            checking: ['checking', 'approved', 'rejected', 'failed'],
            approved: ['approved'],
            rejected: ['rejected'],
            failed: [
              'failed',
              'selected',
              'preparing',
              'requesting',
              'uploading',
              'confirming',
              'checking',
            ],
          };

          expect(validNextStates[prevState.status]).toContain(state.status);

          // Invariant 3: From failed, RETRY returns to the failedStep
          if (prevState.status === 'failed' && action.type === 'RETRY') {
            const expectedTarget = prevState.failedStep ?? 'selected';
            expect(state.status).toBe(expectedTarget);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  describe('concrete transitions & retry examples', () => {
    it('executes full happy path: selected -> preparing -> requesting -> uploading -> confirming -> checking -> approved', () => {
      let state = INITIAL_UPLOAD_STATE;
      expect(state.status).toBe('selected');

      state = uploadReducer(state, { type: 'START_PREPARE' });
      expect(state.status).toBe('preparing');

      state = uploadReducer(state, { type: 'PREPARE_SUCCESS' });
      expect(state.status).toBe('requesting');

      state = uploadReducer(state, { type: 'REQUEST_SUCCESS' });
      expect(state.status).toBe('uploading');

      state = uploadReducer(state, { type: 'UPLOAD_SUCCESS' });
      expect(state.status).toBe('confirming');

      state = uploadReducer(state, { type: 'CONFIRM_SUCCESS' });
      expect(state.status).toBe('checking');

      state = uploadReducer(state, { type: 'CHECK_APPROVED' });
      expect(state.status).toBe('approved');

      // Terminal state ignores further actions
      state = uploadReducer(state, { type: 'FAIL', error: 'Network dropped' });
      expect(state.status).toBe('approved');
    });

    it('handles rejection path with reason and message', () => {
      let state = INITIAL_UPLOAD_STATE;
      state = uploadReducer(state, { type: 'START_PREPARE' });
      state = uploadReducer(state, { type: 'PREPARE_SUCCESS' });
      state = uploadReducer(state, { type: 'REQUEST_SUCCESS' });
      state = uploadReducer(state, { type: 'UPLOAD_SUCCESS' });
      state = uploadReducer(state, { type: 'CONFIRM_SUCCESS' });
      expect(state.status).toBe('checking');

      state = uploadReducer(state, {
        type: 'CHECK_REJECTED',
        reason: 'not_food',
        message: 'This does not appear to be food.',
      });
      expect(state.status).toBe('rejected');
      expect(state.rejectReason).toBe('not_food');
      expect(state.rejectMessage).toBe('This does not appear to be food.');

      // Terminal state ignores further actions
      state = uploadReducer(state, { type: 'RETRY' });
      expect(state.status).toBe('rejected');
    });

    it('retries from failed preparing', () => {
      let state = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'START_PREPARE' });
      expect(state.status).toBe('preparing');

      state = uploadReducer(state, { type: 'FAIL', error: 'Out of memory' });
      expect(state.status).toBe('failed');
      expect(state.failedStep).toBe('preparing');

      state = uploadReducer(state, { type: 'RETRY' });
      expect(state.status).toBe('preparing');
    });

    it('retries from failed requesting', () => {
      let state = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'START_PREPARE' });
      state = uploadReducer(state, { type: 'PREPARE_SUCCESS' });
      expect(state.status).toBe('requesting');

      state = uploadReducer(state, { type: 'FAIL', error: '503 Service Unavailable' });
      expect(state.status).toBe('failed');
      expect(state.failedStep).toBe('requesting');

      state = uploadReducer(state, { type: 'RETRY' });
      expect(state.status).toBe('requesting');
    });

    it('retries from failed uploading', () => {
      let state = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'START_PREPARE' });
      state = uploadReducer(state, { type: 'PREPARE_SUCCESS' });
      state = uploadReducer(state, { type: 'REQUEST_SUCCESS' });
      expect(state.status).toBe('uploading');

      state = uploadReducer(state, { type: 'FAIL', error: 'Network dropped during PUT' });
      expect(state.status).toBe('failed');
      expect(state.failedStep).toBe('uploading');

      state = uploadReducer(state, { type: 'RETRY' });
      expect(state.status).toBe('uploading');
    });

    it('retries from failed confirming', () => {
      let state = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'START_PREPARE' });
      state = uploadReducer(state, { type: 'PREPARE_SUCCESS' });
      state = uploadReducer(state, { type: 'REQUEST_SUCCESS' });
      state = uploadReducer(state, { type: 'UPLOAD_SUCCESS' });
      expect(state.status).toBe('confirming');

      state = uploadReducer(state, { type: 'FAIL', error: 'Confirm timeout' });
      expect(state.status).toBe('failed');
      expect(state.failedStep).toBe('confirming');

      state = uploadReducer(state, { type: 'RETRY' });
      expect(state.status).toBe('confirming');
    });

    it('retries from failed checking', () => {
      let state = uploadReducer(INITIAL_UPLOAD_STATE, { type: 'START_PREPARE' });
      state = uploadReducer(state, { type: 'PREPARE_SUCCESS' });
      state = uploadReducer(state, { type: 'REQUEST_SUCCESS' });
      state = uploadReducer(state, { type: 'UPLOAD_SUCCESS' });
      state = uploadReducer(state, { type: 'CONFIRM_SUCCESS' });
      expect(state.status).toBe('checking');

      state = uploadReducer(state, { type: 'FAIL', error: 'Status poll failed' });
      expect(state.status).toBe('failed');
      expect(state.failedStep).toBe('checking');

      state = uploadReducer(state, { type: 'RETRY' });
      expect(state.status).toBe('checking');
    });
  });
});

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingStateDTO } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { onboardingRoutes } from '../routes.js';
import { createOnboardingService } from '../service.js';
import type { OnboardingRepo, OnboardingSnapshot } from '../repo.js';
import {
  shouldGrandfatherOnFirstRead,
  type ActivitySignals,
  type StoredOnboardingRow,
} from '../domain/statePolicy.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXP_1 = '22222222-2222-4222-8222-222222222222';
const EXP_2 = '33333333-3333-4333-8333-333333333333';

function emptyStored(): StoredOnboardingRow {
  return {
    completedAt: null,
    skippedAt: null,
    grandfatheredAt: null,
    initialIntent: null,
    selectedPark: null,
    starterChecklistDismissedAt: null,
  };
}

function emptySignals() {
  return {
    hasCompletion: false,
    hasExperienceLog: false,
    hasFoodLog: false,
    hasFavorite: false,
    hasTripMembership: false,
    hasClaimedPin: false,
  };
}

describe('onboardingRoutes HTTP integration', () => {
  let stored: StoredOnboardingRow | null;
  let signals: ActivitySignals;
  let throwNotFound: boolean;
  let awardPins: ReturnType<typeof vi.fn<(userId: string) => Promise<readonly string[]>>>;
  let authedUserId: string | undefined;
  let app: FastifyInstance;

  beforeEach(async () => {
    stored = null;
    signals = emptySignals();
    throwNotFound = false;
    authedUserId = USER_ID;
    awardPins = vi.fn(async () => ['bronze_park_starter_magic_kingdom']);

    const fakeRepo: OnboardingRepo = {
      async getOrInitSnapshot(_userId, now): Promise<OnboardingSnapshot> {
        if (!stored) {
          stored = {
            ...emptyStored(),
            grandfatheredAt: shouldGrandfatherOnFirstRead(signals)
              ? now.toISOString()
              : null,
          };
        }
        return { stored, signals };
      },
      async upsertState(_userId, next) {
        stored = next;
        return next;
      },
      async insertQuickCompletions(_userId, experienceIds) {
        if (throwNotFound) {
          throw new AppError('experience_not_found', 'Missing or inactive experience.');
        }
        const uniqueCount = new Set(experienceIds).size;
        return { addedCount: uniqueCount, alreadyCompletedCount: 0 };
      },
    };

    const service = createOnboardingService({
      repo: fakeRepo,
      awardPins,
      clock: () => new Date('2026-11-18T18:00:00.000Z'),
    });

    app = Fastify();
    registerErrorHandler(app);
    await app.register(
      onboardingRoutes({
        service,
        requireSession: async (request) => {
          if (!authedUserId) {
            throw new AppError('unauthorized', 'Authentication is required.');
          }
          (request as { userId?: string }).userId = authedUserId;
        },
      }),
    );
    await app.ready();
  });

  it('rejects unauthenticated requests with 401 on all 3 routes', async () => {
    authedUserId = undefined;

    const r1 = await app.inject({ method: 'GET', url: '/me/onboarding' });
    expect(r1.statusCode).toBe(401);

    const r2 = await app.inject({ method: 'PATCH', url: '/me/onboarding', payload: { complete: true } });
    expect(r2.statusCode).toBe(401);

    const r3 = await app.inject({
      method: 'POST',
      url: '/me/onboarding/quick-completions',
      payload: { experienceIds: [EXP_1], userTz: 'America/New_York' },
    });
    expect(r3.statusCode).toBe(401);
  });

  it('serves GET and PATCH /me/onboarding and returns OnboardingStateDTO', async () => {
    const getRes = await app.inject({ method: 'GET', url: '/me/onboarding' });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json<OnboardingStateDTO>();
    expect(body.needsOnboarding).toBe(true);
    expect(body.showStarterChecklist).toBe(true);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/me/onboarding',
      payload: {
        initialIntent: 'in_park',
        selectedPark: 'EPCOT',
        complete: true,
        dismissStarterChecklist: true,
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = patchRes.json<OnboardingStateDTO>();
    expect(updated.needsOnboarding).toBe(false);
    expect(updated.initialIntent).toBe('in_park');
    expect(updated.selectedPark).toBe('EPCOT');
    expect(updated.completedAt).toBe('2026-11-18T18:00:00.000Z');
    expect(updated.showStarterChecklist).toBe(false);
  });

  it('rejects invalid PATCH and quick-completions payloads with 400 validation_failed', async () => {
    const badIntent = await app.inject({
      method: 'PATCH',
      url: '/me/onboarding',
      payload: { initialIntent: 'bogus' },
    });
    expect(badIntent.statusCode).toBe(400);
    expect(badIntent.json().error.code).toBe('validation_failed');

    const badPark = await app.inject({
      method: 'PATCH',
      url: '/me/onboarding',
      payload: { selectedPark: 'Typhoon Lagoon' },
    });
    expect(badPark.statusCode).toBe(400);

    const conflictDismissRestore = await app.inject({
      method: 'PATCH',
      url: '/me/onboarding',
      payload: { dismissStarterChecklist: true, restoreStarterChecklist: true },
    });
    expect(conflictDismissRestore.statusCode).toBe(400);

    const badTz = await app.inject({
      method: 'POST',
      url: '/me/onboarding/quick-completions',
      payload: { experienceIds: [EXP_1], userTz: 'Not/A_Real_Zone' },
    });
    expect(badTz.statusCode).toBe(400);
    expect(badTz.json().error.code).toBe('validation_failed');

    const emptyIds = await app.inject({
      method: 'POST',
      url: '/me/onboarding/quick-completions',
      payload: { experienceIds: [], userTz: 'America/New_York' },
    });
    expect(emptyIds.statusCode).toBe(400);

    const tooManyIds = await app.inject({
      method: 'POST',
      url: '/me/onboarding/quick-completions',
      payload: {
        experienceIds: Array.from({ length: 21 }, (_, i) =>
          `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        ),
        userTz: 'America/New_York',
      },
    });
    expect(tooManyIds.statusCode).toBe(400);

    const unknownField = await app.inject({
      method: 'POST',
      url: '/me/onboarding/quick-completions',
      payload: { experienceIds: [EXP_1], userTz: 'America/New_York', extra: 1 },
    });
    expect(unknownField.statusCode).toBe(400);
  });

  it('propagates 404 experience_not_found and calls awardPins once best-effort', async () => {
    const okRes = await app.inject({
      method: 'POST',
      url: '/me/onboarding/quick-completions',
      payload: { experienceIds: [EXP_1, EXP_2], userTz: 'America/New_York' },
    });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json()).toEqual({
      addedCount: 2,
      alreadyCompletedCount: 0,
      newlyAwardedPinIds: ['bronze_park_starter_magic_kingdom'],
    });
    expect(awardPins).toHaveBeenCalledTimes(1);

    // Throwing awardPins must not fail the 200 response
    awardPins.mockRejectedValueOnce(new Error('pin boom'));
    const resilientRes = await app.inject({
      method: 'POST',
      url: '/me/onboarding/quick-completions',
      payload: { experienceIds: [EXP_1], userTz: 'America/New_York' },
    });
    expect(resilientRes.statusCode).toBe(200);
    expect(resilientRes.json()).toEqual({
      addedCount: 1,
      alreadyCompletedCount: 0,
      newlyAwardedPinIds: [],
    });

    // Missing/inactive experience rejects with 404
    throwNotFound = true;
    const notFoundRes = await app.inject({
      method: 'POST',
      url: '/me/onboarding/quick-completions',
      payload: { experienceIds: [EXP_1], userTz: 'America/New_York' },
    });
    expect(notFoundRes.statusCode).toBe(404);
    expect(notFoundRes.json().error.code).toBe('experience_not_found');
  });

  it('grandfathers veterans when PATCH /me/onboarding arrives before any GET', async () => {
    signals = { ...emptySignals(), hasTripMembership: true };

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/me/onboarding',
      payload: { initialIntent: 'plan' },
    });
    expect(patchRes.statusCode).toBe(200);
    const body = patchRes.json<OnboardingStateDTO>();
    expect(body.needsOnboarding).toBe(false);
    expect(body.showStarterChecklist).toBe(false);
    expect(stored?.grandfatheredAt).toBe('2026-11-18T18:00:00.000Z');
    expect(stored?.initialIntent).toBe('plan');
  });
});

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import type { MickeysConfig } from '../../config.js';
import type { MickeyRepo, MickeyListFilters } from './repo.js';
import type { StillThereParams } from './domain/stillThere.js';
import type {
  MickeyClientConfigDTO,
  MickeyListItemDTO,
  MickeyDetailDTO,
  MickeyProgressDTO,
  MickeySummaryDTO,
  FriendMickeyFindsPageDTO,
  TripMickeysDTO,
} from '@dwt/shared';
import { assertOwnerOrFriend } from '../friends/ownerOrFriend.js';
import { assertTripMember } from '../trips/authz.js';

function toStillThereParams(cfg: MickeysConfig): StillThereParams {
  return {
    priorValue: cfg.confidencePriorValue,
    priorWeight: cfg.confidencePriorWeight,
    halfLifeDays: cfg.confidenceHalfLifeDays,
    confirmedMin: cfg.confidenceConfirmedMin,
    uncertainMin: cfg.confidenceUncertainMin,
  };
}

export class HuntService {
  constructor(
    private readonly pool: DbPool,
    private readonly repo: MickeyRepo,
    private readonly config: MickeysConfig,
  ) {}

  getConfig(): MickeyClientConfigDTO {
    return {
      enabled: this.config.enabled,
      submissionsEnabled: this.config.submissionsEnabled,
    };
  }

  async listMickeys(
    filters: MickeyListFilters,
    userId?: string,
  ): Promise<{ items: MickeyListItemDTO[]; nextCursor: string | null }> {
    const searchFilters: MickeyListFilters = {
      ...filters,
      ...(userId !== undefined ? { userId } : {}),
    };
    return this.repo.findApprovedMickeys(
      searchFilters,
      toStillThereParams(this.config),
      this.config.communityVerifiedMin,
    );
  }

  async getSummary(requesterId?: string, forUserId?: string): Promise<MickeySummaryDTO> {
    if (forUserId) {
      if (!requesterId) {
        throw new AppError('unauthorized', 'Authentication required to view friend summary.');
      }
      await assertOwnerOrFriend(this.pool, requesterId, forUserId);
      return this.repo.getSummary(forUserId);
    }
    return this.repo.getSummary(requesterId);
  }

  async getMickeyDetail(id: string, userId?: string): Promise<MickeyDetailDTO> {
    const detail = await this.repo.getMickeyDetail(
      id,
      userId,
      toStillThereParams(this.config),
      this.config.communityVerifiedMin,
    );
    if (!detail) {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found');
    }
    return detail;
  }

  async recordHint(userId: string, mickeyId: string, level: 2 | 3): Promise<MickeyDetailDTO> {
    const row = await this.repo.getMickeyById(mickeyId);
    if (!row || row.status !== 'approved') {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found');
    }

    await this.repo.recordHint(userId, mickeyId, level);
    const updated = await this.repo.getMickeyDetail(
      mickeyId,
      userId,
      toStillThereParams(this.config),
      this.config.communityVerifiedMin,
    );
    if (!updated) {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found');
    }
    return updated;
  }

  async recordFind(
    userId: string,
    mickeyId: string,
    tripId?: string | null,
  ): Promise<MickeyProgressDTO> {
    const row = await this.repo.getMickeyById(mickeyId);
    if (!row || row.status !== 'approved') {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found');
    }

    if (tripId) {
      await assertTripMember(this.pool, userId, tripId);
    }

    return this.repo.recordFind(userId, mickeyId, tripId);
  }

  async undoFind(userId: string, mickeyId: string): Promise<void> {
    const row = await this.repo.getMickeyById(mickeyId);
    if (!row || row.status !== 'approved') {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found');
    }

    await this.repo.undoFind(userId, mickeyId);
  }

  async recordVote(userId: string, mickeyId: string, vote: 'there' | 'gone'): Promise<void> {
    const row = await this.repo.getMickeyById(mickeyId);
    if (!row || row.status !== 'approved') {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found');
    }

    await this.repo.recordVote(userId, mickeyId, vote);
  }

  async getUserFinds(
    requesterId: string,
    targetUserId: string,
    cursor?: string,
    limit?: number,
  ): Promise<FriendMickeyFindsPageDTO> {
    await assertOwnerOrFriend(this.pool, requesterId, targetUserId);
    return this.repo.findUserFinds(targetUserId, cursor, limit);
  }

  async getTripMickeys(tripId: string): Promise<TripMickeysDTO> {
    return this.repo.getTripMickeys(tripId);
  }
}

import type { DbPool } from '../../db/pool.js';
import type {
  MickeyListItemDTO,
  MickeyDetailDTO,
  MickeyProgressDTO,
  MickeyZone,
  MickeyDifficulty,
  MickeyHintLevel,
  MickeyFoundFilter,
  MickeyScope,
  MickeyAreaType,
  FriendMickeyFindsPageDTO,
  TripMickeysDTO,
  Park,
} from '@dwt/shared';
import {
  stillThereConfidence,
  confidenceLabel,
  isCommunityVerified,
  type StillThereParams,
  DEFAULT_STILL_THERE_PARAMS,
} from './domain/stillThere.js';
import { visibleLayers } from './domain/hintGate.js';
import { summarizeProgress, type MickeyProgressInputItem } from './domain/progress.js';

export function wdwToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

function formatWdwDate(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'string') {
    return val.slice(0, 10);
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  return null;
}

export interface MickeyListFilters {
  readonly userId?: string;
  readonly experienceId?: string;
  readonly park?: Park | null;
  readonly areaType?: MickeyAreaType;
  readonly land?: string;
  readonly zone?: MickeyZone;
  readonly difficulty?: MickeyDifficulty;
  readonly q?: string;
  readonly found?: MickeyFoundFilter;
  readonly scope?: MickeyScope;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface HiddenMickeyRow {
  readonly id: string;
  readonly experience_id: string;
  readonly zone: MickeyZone;
  readonly difficulty: MickeyDifficulty;
  readonly clue_1: string;
  readonly clue_2: string;
  readonly reveal: string;
  readonly source: 'seed' | 'user';
  readonly official: boolean;
  readonly status: string;
  readonly hidden_reason: string | null;
  readonly seed_key: string | null;
  readonly submitter_id: string | null;
  readonly review_note: string | null;
  readonly text_screen: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly reviewed_at: Date | null;
  readonly promoted_at: Date | null;
  readonly experience_name: string;
  readonly park: Park | null;
  readonly land: string | null;
}

export interface MickeyRepo {
  findApprovedMickeys(
    filters: MickeyListFilters,
    params?: StillThereParams,
    communityVerifiedMin?: number,
  ): Promise<{ items: MickeyListItemDTO[]; nextCursor: string | null }>;

  getMickeyDetail(
    id: string,
    userId?: string,
    params?: StillThereParams,
    communityVerifiedMin?: number,
  ): Promise<MickeyDetailDTO | null>;

  recordHint(userId: string, mickeyId: string, level: 2 | 3): Promise<MickeyHintLevel>;

  recordFind(
    userId: string,
    mickeyId: string,
    tripId?: string | null,
    now?: Date,
  ): Promise<MickeyProgressDTO>;

  undoFind(userId: string, mickeyId: string): Promise<void>;

  recordVote(userId: string, mickeyId: string, vote: 'there' | 'gone'): Promise<void>;

  getSummary(userId?: string): Promise<ReturnType<typeof summarizeProgress>>;

  getFriendsFoundCount(mickeyId: string, userId: string): Promise<number>;

  getReportCount(mickeyId: string): Promise<number>;

  getMickeyById(id: string): Promise<HiddenMickeyRow | null>;

  findUserFinds(
    targetUserId: string,
    cursor?: string,
    limit?: number,
  ): Promise<FriendMickeyFindsPageDTO>;

  getTripMickeys(tripId: string): Promise<TripMickeysDTO>;
}

export class DefaultMickeyRepo implements MickeyRepo {
  constructor(private readonly pool: DbPool) {}

  async findApprovedMickeys(
    filters: MickeyListFilters,
    params: StillThereParams = DEFAULT_STILL_THERE_PARAMS,
    communityVerifiedMin = 3,
  ): Promise<{ items: MickeyListItemDTO[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const conditions: string[] = ["hm.status = 'approved'"];
    const values: unknown[] = [];
    let pIdx = 1;

    let ctes = '';
    if (filters.experienceId) {
      ctes = `
        WITH canon AS (
          SELECT COALESCE(
            (SELECT a.canonical_experience_id FROM mickey_experience_aliases a WHERE a.alias_experience_id = $${pIdx}),
            $${pIdx}::uuid
          ) AS id
        ), grp AS (
          SELECT id FROM canon
          UNION
          SELECT a.alias_experience_id FROM mickey_experience_aliases a JOIN canon c ON a.canonical_experience_id = c.id
        )
      `;
      conditions.push(`hm.experience_id IN (SELECT id FROM grp)`);
      values.push(filters.experienceId);
      pIdx++;
    }

    let userParamIndex: number | null = null;
    if (filters.userId) {
      userParamIndex = pIdx;
      values.push(filters.userId);
      pIdx++;
      // Exclude hidden mickeys the caller reported
      conditions.push(`mr.mickey_id IS NULL`);
    }

    if (filters.zone) {
      conditions.push(`hm.zone = $${pIdx}`);
      values.push(filters.zone);
      pIdx++;
    }

    if (filters.difficulty) {
      conditions.push(`hm.difficulty = $${pIdx}`);
      values.push(filters.difficulty);
      pIdx++;
    }

    if (filters.park !== undefined) {
      if (filters.park === null) {
        conditions.push(`e.park IS NULL`);
      } else {
        conditions.push(`e.park = $${pIdx}`);
        values.push(filters.park);
        pIdx++;
      }
    }

    if (filters.areaType) {
      conditions.push(`e.area_type = $${pIdx}`);
      values.push(filters.areaType);
      pIdx++;
    }

    if (filters.land) {
      conditions.push(`e.land = $${pIdx}`);
      values.push(filters.land);
      pIdx++;
    }

    if (filters.q && filters.q.trim().length > 0) {
      const qVal = `%${filters.q.trim()}%`;
      conditions.push(`(e.name ILIKE $${pIdx} OR hm.clue_1 ILIKE $${pIdx} OR COALESCE(e.land, '') ILIKE $${pIdx})`);
      values.push(qVal);
      pIdx++;
    }

    if (filters.scope === 'official') {
      conditions.push(`hm.official = TRUE`);
    } else if (filters.scope === 'community') {
      conditions.push(`hm.official = FALSE`);
    }

    if (filters.found === 'found') {
      if (userParamIndex) {
        conditions.push(`mp.found_at IS NOT NULL`);
      } else {
        // Unauthenticated caller has found nothing
        return { items: [], nextCursor: null };
      }
    } else if (filters.found === 'unfound') {
      if (userParamIndex) {
        conditions.push(`mp.found_at IS NULL`);
      }
    }

    if (filters.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(filters.cursor, 'base64url').toString('utf8'));
        if (decoded.createdAt && decoded.id) {
          const cDateIdx = pIdx++;
          const cIdIdx = pIdx++;
          values.push(decoded.createdAt);
          values.push(decoded.id);
          conditions.push(
            `(hm.created_at < $${cDateIdx}::timestamptz OR (hm.created_at = $${cDateIdx}::timestamptz AND hm.id < $${cIdIdx}::uuid))`,
          );
        }
      } catch {
        // Ignore invalid cursor
      }
    }

    const limitParamIdx = pIdx++;
    values.push(limit + 1);

    const progressJoin = userParamIndex
      ? `LEFT JOIN mickey_progress mp ON mp.mickey_id = hm.id AND mp.user_id = $${userParamIndex}`
      : `LEFT JOIN mickey_progress mp ON FALSE`;

    const reportJoin = userParamIndex
      ? `LEFT JOIN mickey_reports mr ON mr.mickey_id = hm.id AND mr.user_id = $${userParamIndex}`
      : ``;

    const sql = `
      ${ctes}
      SELECT hm.id,
             hm.experience_id,
             e.name AS experience_name,
             e.park,
             COALESCE(e.land, CASE WHEN r.name <> e.name THEN r.name ELSE NULL END) AS land,
             hm.zone,
             hm.difficulty,
             hm.clue_1,
             hm.official,
             hm.submitter_id,
             hm.created_at,
             COALESCE(mp.hint_level, 1)::int AS hint_level,
             CASE WHEN mp.found_at IS NOT NULL THEN TRUE ELSE FALSE END AS found
        FROM hidden_mickeys hm
        JOIN experiences e ON e.id = hm.experience_id
        LEFT JOIN resorts r ON r.id = e.resort_id
        ${progressJoin}
        ${reportJoin}
       WHERE ${conditions.join(' AND ')}
       ORDER BY hm.created_at DESC, hm.id DESC
       LIMIT $${limitParamIdx}
    `;

    const res = await this.pool.query<{
      id: string;
      experience_id: string;
      experience_name: string;
      park: Park | null;
      land: string | null;
      zone: MickeyZone;
      difficulty: MickeyDifficulty;
      clue_1: string;
      official: boolean;
      submitter_id: string | null;
      created_at: Date;
      hint_level: number;
      found: boolean;
    }>(sql, values);

    const rows = res.rows;
    const hasNext = rows.length > limit;
    const pagedRows = hasNext ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasNext && pagedRows.length > 0) {
      const last = pagedRows[pagedRows.length - 1];
      if (last) {
        nextCursor = Buffer.from(
          JSON.stringify({
            createdAt: last.created_at instanceof Date ? last.created_at.toISOString() : String(last.created_at),
            id: last.id,
          }),
        ).toString('base64url');
      }
    }

    if (pagedRows.length === 0) {
      return { items: [], nextCursor: null };
    }

    const mickeyIds = pagedRows.map((r) => r.id);
    const votesRes = await this.pool.query<{
      mickey_id: string;
      user_id: string;
      vote: 'there' | 'gone';
      voted_at: Date;
    }>(
      `SELECT mickey_id, user_id, vote, voted_at
         FROM mickey_still_there_votes
        WHERE mickey_id = ANY($1::uuid[])`,
      [mickeyIds],
    );

    const votesByMickey = new Map<string, Array<{ user_id: string; vote: 'there' | 'gone'; votedAt: Date }>>();
    for (const v of votesRes.rows) {
      const list = votesByMickey.get(v.mickey_id) ?? [];
      list.push({
        user_id: v.user_id,
        vote: v.vote,
        votedAt: v.voted_at instanceof Date ? v.voted_at : new Date(v.voted_at),
      });
      votesByMickey.set(v.mickey_id, list);
    }

    const now = new Date();
    const items: MickeyListItemDTO[] = pagedRows.map((row) => {
      const votes = votesByMickey.get(row.id) ?? [];
      const score = stillThereConfidence(votes, now, params);
      const label = confidenceLabel(score, params);
      const otherThereVoters = votes.filter((v) => v.vote === 'there' && v.user_id !== row.submitter_id).length;
      const verified = isCommunityVerified({
        official: row.official,
        label,
        otherThereVoters,
        min: communityVerifiedMin,
      });

      return {
        id: row.id,
        experienceId: row.experience_id,
        experienceName: row.experience_name,
        park: row.park,
        land: row.land,
        zone: row.zone,
        difficulty: row.difficulty,
        clue1: row.clue_1,
        official: row.official,
        communityVerified: verified,
        confidenceLabel: label,
        hintLevel: (row.hint_level >= 3 ? 3 : row.hint_level === 2 ? 2 : 1) as MickeyHintLevel,
        found: row.found,
      };
    });

    return { items, nextCursor };
  }

  async getMickeyDetail(
    id: string,
    userId?: string,
    params: StillThereParams = DEFAULT_STILL_THERE_PARAMS,
    communityVerifiedMin = 3,
  ): Promise<MickeyDetailDTO | null> {
    const progressJoin = userId
      ? `LEFT JOIN mickey_progress mp ON mp.mickey_id = hm.id AND mp.user_id = $2`
      : `LEFT JOIN mickey_progress mp ON FALSE`;
    const reportJoin = userId
      ? `LEFT JOIN mickey_reports mr ON mr.mickey_id = hm.id AND mr.user_id = $2`
      : ``;
    const reportWhere = userId ? `AND mr.mickey_id IS NULL` : ``;
    const values: unknown[] = [id];
    if (userId) values.push(userId);

    const res = await this.pool.query<{
      id: string;
      experience_id: string;
      experience_name: string;
      park: Park | null;
      land: string | null;
      zone: MickeyZone;
      difficulty: MickeyDifficulty;
      clue_1: string;
      clue_2: string;
      reveal: string;
      official: boolean;
      status: string;
      submitter_id: string | null;
      hint_level: number;
      found: boolean;
      trip_id: string | null;
    }>(
      `SELECT hm.id,
              hm.experience_id,
              e.name AS experience_name,
              e.park,
              COALESCE(e.land, CASE WHEN r.name <> e.name THEN r.name ELSE NULL END) AS land,
              hm.zone,
              hm.difficulty,
              hm.clue_1,
              hm.clue_2,
              hm.reveal,
              hm.official,
              hm.status,
              hm.submitter_id,
              COALESCE(mp.hint_level, 1)::int AS hint_level,
              CASE WHEN mp.found_at IS NOT NULL THEN TRUE ELSE FALSE END AS found,
              mp.trip_id
         FROM hidden_mickeys hm
         JOIN experiences e ON e.id = hm.experience_id
         LEFT JOIN resorts r ON r.id = e.resort_id
         ${progressJoin}
         ${reportJoin}
        WHERE hm.id = $1 AND hm.status = 'approved' ${reportWhere}`,
      values,
    );

    const row = res.rows[0];
    if (!row) {
      return null;
    }

    const votesRes = await this.pool.query<{
      user_id: string;
      vote: 'there' | 'gone';
      voted_at: Date;
    }>(
      `SELECT user_id, vote, voted_at
         FROM mickey_still_there_votes
        WHERE mickey_id = $1`,
      [id],
    );

    const votes = votesRes.rows.map((v) => ({
      user_id: v.user_id,
      vote: v.vote,
      votedAt: v.voted_at instanceof Date ? v.voted_at : new Date(v.voted_at),
    }));

    const now = new Date();
    const score = stillThereConfidence(votes, now, params);
    const label = confidenceLabel(score, params);
    const otherThereVoters = votes.filter((v) => v.vote === 'there' && v.user_id !== row.submitter_id).length;
    const verified = isCommunityVerified({
      official: row.official,
      label,
      otherThereVoters,
      min: communityVerifiedMin,
    });

    let friendsFoundCount = 0;
    if (userId) {
      friendsFoundCount = await this.getFriendsFoundCount(id, userId);
    }

    const layers = visibleLayers(
      { clue2: row.clue_2, reveal: row.reveal },
      { hintLevel: row.hint_level, found: row.found },
    );

    const result: MickeyDetailDTO = {
      id: row.id,
      experienceId: row.experience_id,
      experienceName: row.experience_name,
      park: row.park,
      land: row.land,
      zone: row.zone,
      difficulty: row.difficulty,
      clue1: row.clue_1,
      ...(layers.clue2 !== undefined ? { clue2: layers.clue2 } : {}),
      ...(layers.reveal !== undefined ? { reveal: layers.reveal } : {}),
      official: row.official,
      communityVerified: verified,
      confidenceLabel: label,
      hintLevel: (row.hint_level >= 3 ? 3 : row.hint_level === 2 ? 2 : 1) as MickeyHintLevel,
      found: row.found,
      tripId: row.trip_id,
      friendsFoundCount,
      userVote: (userId ? votes.find((v) => v.user_id === userId)?.vote : null) ?? null,
    };
    return result;
  }

  async recordHint(userId: string, mickeyId: string, level: 2 | 3): Promise<MickeyHintLevel> {
    const res = await this.pool.query<{ hint_level: number }>(
      `INSERT INTO mickey_progress (user_id, mickey_id, hint_level, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())
       ON CONFLICT (user_id, mickey_id) DO UPDATE SET
         hint_level = GREATEST(mickey_progress.hint_level, EXCLUDED.hint_level),
         updated_at = now()
       RETURNING hint_level`,
      [userId, mickeyId, level],
    );
    const hl = res.rows[0]?.hint_level ?? level;
    return (hl >= 3 ? 3 : hl === 2 ? 2 : 1) as MickeyHintLevel;
  }

  async recordFind(
    userId: string,
    mickeyId: string,
    tripId?: string | null,
    now: Date = new Date(),
  ): Promise<MickeyProgressDTO> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const todayStr = wdwToday(now);

      const res = await client.query<{
        mickey_id: string;
        hint_level: number;
        found_at: Date | string | null;
        found_on: Date | string | null;
        trip_id: string | null;
      }>(
        `INSERT INTO mickey_progress (user_id, mickey_id, hint_level, found_at, found_on, trip_id, created_at, updated_at)
         VALUES ($1, $2, 1, $3, $4, $5, now(), now())
         ON CONFLICT (user_id, mickey_id) DO UPDATE SET
           found_at = COALESCE(mickey_progress.found_at, EXCLUDED.found_at),
           found_on = COALESCE(mickey_progress.found_on, EXCLUDED.found_on),
           trip_id = COALESCE(mickey_progress.trip_id, EXCLUDED.trip_id),
           updated_at = now()
         RETURNING mickey_id, hint_level, found_at, found_on, trip_id`,
        [userId, mickeyId, now, todayStr, tripId ?? null],
      );

      // Find automatically sets vote to 'there' (Property 8)
      await client.query(
        `INSERT INTO mickey_still_there_votes (user_id, mickey_id, vote, voted_at)
         VALUES ($1, $2, 'there', now())
         ON CONFLICT (user_id, mickey_id) DO UPDATE SET
           vote = 'there',
           voted_at = now()`,
        [userId, mickeyId],
      );

      await client.query('COMMIT');

      const row = res.rows[0]!;
      return {
        mickeyId: row.mickey_id,
        hintLevel: (row.hint_level >= 3 ? 3 : row.hint_level === 2 ? 2 : 1) as MickeyHintLevel,
        foundAt: row.found_at instanceof Date ? row.found_at.toISOString() : (row.found_at ? new Date(row.found_at).toISOString() : null),
        foundOn: formatWdwDate(row.found_on),
        tripId: row.trip_id,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async undoFind(userId: string, mickeyId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Single UPDATE to clear all find fields atomically (Property 4, chk_mp_trip_needs_find)
      await client.query(
        `UPDATE mickey_progress
            SET found_at = NULL,
                found_on = NULL,
                trip_id = NULL,
                updated_at = now()
          WHERE user_id = $1 AND mickey_id = $2`,
        [userId, mickeyId],
      );

      // Remove the vote
      await client.query(
        `DELETE FROM mickey_still_there_votes
          WHERE user_id = $1 AND mickey_id = $2`,
        [userId, mickeyId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async recordVote(userId: string, mickeyId: string, vote: 'there' | 'gone'): Promise<void> {
    await this.pool.query(
      `INSERT INTO mickey_still_there_votes (user_id, mickey_id, vote, voted_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, mickey_id) DO UPDATE SET
         vote = EXCLUDED.vote,
         voted_at = now()`,
      [userId, mickeyId, vote],
    );
  }

  async getSummary(userId?: string): Promise<ReturnType<typeof summarizeProgress>> {
    const progressJoin = userId
      ? `LEFT JOIN mickey_progress mp ON mp.mickey_id = hm.id AND mp.user_id = $1`
      : `LEFT JOIN mickey_progress mp ON FALSE`;
    const reportJoin = userId
      ? `LEFT JOIN mickey_reports mr ON mr.mickey_id = hm.id AND mr.user_id = $1`
      : `LEFT JOIN mickey_reports mr ON FALSE`;
    const values: unknown[] = userId ? [userId] : [];

    const res = await this.pool.query<{
      id: string;
      official: boolean;
      status: string;
      park: Park | null;
      found: boolean;
      reported: boolean;
    }>(
      `SELECT hm.id,
              hm.official,
              hm.status,
              e.park,
              CASE WHEN mp.found_at IS NOT NULL THEN TRUE ELSE FALSE END AS found,
              CASE WHEN mr.user_id IS NOT NULL THEN TRUE ELSE FALSE END AS reported
         FROM hidden_mickeys hm
         JOIN experiences e ON e.id = hm.experience_id
         ${progressJoin}
         ${reportJoin}
        WHERE hm.status = 'approved'`,
      values,
    );

    const mickeys: MickeyProgressInputItem[] = [];
    const userFoundIds = new Set<string>();

    for (const r of res.rows) {
      // Official entries stay in total and found even if reported by caller (Requirement 2.4)
      // Community entries leave community.found if reported by caller
      if (!r.official && r.reported) {
        continue;
      }

      mickeys.push({
        id: r.id,
        official: r.official,
        status: r.status,
        park: r.park,
      });

      if (r.found) {
        userFoundIds.add(r.id);
      }
    }

    return summarizeProgress(mickeys, userFoundIds);
  }

  async getFriendsFoundCount(mickeyId: string, userId: string): Promise<number> {
    const res = await this.pool.query<{ count: number }>(
      `SELECT count(DISTINCT mp.user_id)::int AS count
         FROM mickey_progress mp
         JOIN active_friendships af ON (
           (af.user_lo_id = $2 AND af.user_hi_id = mp.user_id) OR
           (af.user_hi_id = $2 AND af.user_lo_id = mp.user_id)
         )
        WHERE mp.mickey_id = $1
          AND mp.found_at IS NOT NULL`,
      [mickeyId, userId],
    );
    return res.rows[0]?.count ?? 0;
  }

  async getReportCount(mickeyId: string): Promise<number> {
    const res = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM mickey_reports r
        WHERE r.mickey_id = $1
          AND r.status = 'open'
          AND EXISTS (
            SELECT 1 FROM mickey_progress p
             WHERE p.user_id = r.user_id AND p.found_at IS NOT NULL
          )`,
      [mickeyId],
    );
    return res.rows[0]?.n ?? 0;
  }

  async getMickeyById(id: string): Promise<HiddenMickeyRow | null> {
    const res = await this.pool.query<HiddenMickeyRow>(
      `SELECT hm.*,
              e.name AS experience_name,
              e.park,
              COALESCE(e.land, CASE WHEN r.name <> e.name THEN r.name ELSE NULL END) AS land
         FROM hidden_mickeys hm
         JOIN experiences e ON e.id = hm.experience_id
         LEFT JOIN resorts r ON r.id = e.resort_id
        WHERE hm.id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async findUserFinds(
    userId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<FriendMickeyFindsPageDTO> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const params: unknown[] = [userId];
    let cursorClause = '';

    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const [cursorFoundAt, cursorId] = decoded.split('|');
      if (cursorFoundAt && cursorId) {
        params.push(cursorFoundAt, cursorId);
        cursorClause = `AND (mp.found_at < $${params.length - 1} OR (mp.found_at = $${params.length - 1} AND mp.mickey_id < $${params.length}))`;
      }
    }

    params.push(safeLimit + 1);
    const limitParamIdx = params.length;

    const res = await this.pool.query<{
      mickey_id: string;
      clue_1: string;
      official: boolean;
      experience_id: string;
      experience_name: string;
      park: Park | null;
      land: string | null;
      found_at: Date;
      found_on: string | null;
    }>(
      `SELECT hm.id AS mickey_id,
              hm.clue_1,
              hm.official,
              e.id AS experience_id,
              e.name AS experience_name,
              e.park,
              COALESCE(e.land, CASE WHEN r.name <> e.name THEN r.name ELSE NULL END) AS land,
              mp.found_at,
              mp.found_on
         FROM mickey_progress mp
         JOIN hidden_mickeys hm ON hm.id = mp.mickey_id
         JOIN experiences e ON e.id = hm.experience_id
         LEFT JOIN resorts r ON r.id = e.resort_id
        WHERE mp.user_id = $1
          AND hm.status = 'approved'
          AND mp.found_at IS NOT NULL
          ${cursorClause}
        ORDER BY mp.found_at DESC, mp.mickey_id DESC
        LIMIT $${limitParamIdx}`,
      params,
    );

    const hasMore = res.rows.length > safeLimit;
    const rows = hasMore ? res.rows.slice(0, safeLimit) : res.rows;
    let nextCursor: string | null = null;

    if (hasMore && rows.length > 0) {
      const last = rows[rows.length - 1]!;
      nextCursor = Buffer.from(`${last.found_at.toISOString()}|${last.mickey_id}`).toString('base64');
    }

    return {
      items: rows.map((r) => ({
        mickeyId: r.mickey_id,
        clue1: r.clue_1,
        official: r.official,
        experienceId: r.experience_id,
        experienceName: r.experience_name,
        park: r.park,
        land: r.land,
        foundAt: r.found_at.toISOString(),
        foundOn: formatWdwDate(r.found_on) ?? r.found_at.toISOString().slice(0, 10),
      })),
      nextCursor,
    };
  }

  async getTripMickeys(tripId: string): Promise<TripMickeysDTO> {
    const membersRes = await this.pool.query<{
      user_id: string;
      display_name: string;
      avatar_preset: string | null;
      count: number;
    }>(
      `SELECT tm.user_id,
              COALESCE(p.display_name, 'Explorer') AS display_name,
              p.avatar_preset,
              COALESCE(counts.count, 0)::int AS count
         FROM active_trip_memberships tm
         LEFT JOIN profile_identity p ON p.user_id = tm.user_id
         LEFT JOIN (
           SELECT mp.user_id,
                  count(DISTINCT mp.mickey_id)::int AS count
             FROM mickey_progress mp
             JOIN hidden_mickeys hm ON hm.id = mp.mickey_id
            WHERE mp.trip_id = $1
              AND hm.status = 'approved'
              AND mp.found_at IS NOT NULL
            GROUP BY mp.user_id
         ) counts ON counts.user_id = tm.user_id
        WHERE tm.trip_id = $1
        ORDER BY tm.joined_at ASC, tm.user_id ASC`,
      [tripId],
    );

    const mickeysRes = await this.pool.query<{
      mickey_id: string;
      clue_1: string;
      official: boolean;
      experience_name: string;
      found_by_count: number;
    }>(
      `SELECT hm.id AS mickey_id,
              hm.clue_1,
              hm.official,
              e.name AS experience_name,
              count(DISTINCT mp.user_id)::int AS found_by_count
         FROM mickey_progress mp
         JOIN hidden_mickeys hm ON hm.id = mp.mickey_id
         JOIN experiences e ON e.id = hm.experience_id
         JOIN active_trip_memberships tm ON tm.trip_id = mp.trip_id AND tm.user_id = mp.user_id
        WHERE mp.trip_id = $1
          AND hm.status = 'approved'
          AND mp.found_at IS NOT NULL
        GROUP BY hm.id, hm.clue_1, hm.official, e.name
        ORDER BY found_by_count DESC, e.name ASC, hm.id ASC`,
      [tripId],
    );

    return {
      members: membersRes.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        avatarPreset: r.avatar_preset,
        count: r.count,
      })),
      mickeys: mickeysRes.rows.map((r) => ({
        mickeyId: r.mickey_id,
        clue1: r.clue_1,
        official: r.official,
        experienceName: r.experience_name,
        foundByCount: r.found_by_count,
      })),
    };
  }
}

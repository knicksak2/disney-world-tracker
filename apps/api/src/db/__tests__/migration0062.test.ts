/**
 * Migration test for `0062_photo_uploads.sql`.
 *
 * Validates: Requirements 1.1, 1.2, 5.1, 7.1, 7.3, 11.2, 11.4, 13.6, 13.7, 13.8, 14.1, 14.4
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb({ noAstCoverageCheck: true });

  db.registerExtension('citext', () => {});
  db.registerExtension('pg_trgm', () => {});
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });
  });

  const pub = db.public;
  pub.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });
  pub.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  pub.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });

  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

describe('migration 0062_photo_uploads', () => {
  let db: IMemoryDb;
  let user1Id: string;
  let user2Id: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0062_photo_uploads.sql');

    user1Id = randomUUID();
    user2Id = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${user1Id}', 'alice@example.com', 'hash1'),
             ('${user2Id}', 'bob@example.com', 'hash2');
    `);
  });

  it('migration file wraps statements in BEGIN and COMMIT', () => {
    const rawSql = readFileSync(migrationPath('0062_photo_uploads.sql'), 'utf8');
    expect(rawSql).toMatch(/^\s*BEGIN;/m);
    expect(rawSql).toMatch(/^\s*COMMIT;/m);
  });

  it('creates all seven tables with expected columns', () => {
    const expectedTables: Record<string, string[]> = {
      photos: [
        'id',
        'owner_id',
        'target_kind',
        'target_id',
        'scope_id',
        'feed_item_id',
        'status',
        'object_key',
        'thumb_key',
        'byte_size',
        'thumb_byte_size',
        'width',
        'height',
        'taken_at',
        'sort_at',
        'harm_verdict',
        'vision_verdict',
        'reject_reason',
        'hidden_reason',
        'vision_fields',
        'attempts',
        'next_attempt_at',
        'lease_until',
        'last_error_code',
        'delete_attempts',
        'created_at',
        'confirmed_at',
        'moderated_at',
        'deleted_at',
        'full_etag',
        'thumb_etag',
        'served_at',
        'upload_cleaned_at',
        'approved_by_operator',
      ],
      photo_reports: [
        'id',
        'photo_id',
        'reporter_id',
        'reason',
        'note',
        'status',
        'created_at',
        'resolved_at',
      ],
      user_blocks: ['id', 'blocker_id', 'blocked_id', 'created_at'],
      photo_upload_bans: ['user_id', 'reason', 'created_at'],
      photo_upload_strikes: ['user_id', 'upheld_count', 'last_upheld_at'],
      photo_upload_counters: ['user_id', 'day', 'upload_count'],
      photo_usage_daily: [
        'day',
        'uploads',
        'upload_bytes',
        'harm_calls',
        'vision_calls',
        'vision_prompt_tokens',
        'vision_output_tokens',
        'rejections',
        'needs_review',
        'exif_present',
      ],
    };

    for (const [table, cols] of Object.entries(expectedTables)) {
      expect(db.getTable(table)).toBeDefined();
      const actualCols = db.public
        .many(`SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'`)
        .map((r: Record<string, unknown>) => r.column_name);
      for (const col of cols) {
        expect(actualCols).toContain(col);
      }
    }
  });

  it('enforces status and target_kind check constraints on photos', () => {
    const photoId = randomUUID();
    const targetId = randomUUID();
    const scopeId = randomUUID();

    // Valid uploading photo
    db.public.none(`
      INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, object_key, thumb_key, byte_size, thumb_byte_size, width, height, status)
      VALUES ('${photoId}', '${user1Id}', 'food_log', '${targetId}', '${scopeId}', 'u/${photoId}/full.jpg', 'u/${photoId}/thumb.jpg', 1024, 256, 800, 600, 'uploading');
    `);

    // Invalid status
    expect(() => {
      db.public.none(`
        UPDATE photos SET status = 'quarantined' WHERE id = '${photoId}';
      `);
    }).toThrow();

    // Invalid target_kind
    expect(() => {
      db.public.none(`
        UPDATE photos SET target_kind = 'invalid_kind' WHERE id = '${photoId}';
      `);
    }).toThrow();
  });

  it('enforces sizes and key distinctness check constraints on photos', () => {
    const photoId = randomUUID();
    const targetId = randomUUID();
    const scopeId = randomUUID();

    // byte_size <= 0
    expect(() => {
      db.public.none(`
        INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, object_key, thumb_key, byte_size, thumb_byte_size, width, height)
        VALUES ('${photoId}', '${user1Id}', 'food_log', '${targetId}', '${scopeId}', 'u/${photoId}/full.jpg', 'u/${photoId}/thumb.jpg', 0, 256, 800, 600);
      `);
    }).toThrow();

    // width > 4096
    expect(() => {
      db.public.none(`
        INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, object_key, thumb_key, byte_size, thumb_byte_size, width, height)
        VALUES ('${photoId}', '${user1Id}', 'food_log', '${targetId}', '${scopeId}', 'u/${photoId}/full.jpg', 'u/${photoId}/thumb.jpg', 1024, 256, 5000, 600);
      `);
    }).toThrow();

    // object_key == thumb_key
    expect(() => {
      db.public.none(`
        INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, object_key, thumb_key, byte_size, thumb_byte_size, width, height)
        VALUES ('${photoId}', '${user1Id}', 'food_log', '${targetId}', '${scopeId}', 'same_key', 'same_key', 1024, 256, 800, 600);
      `);
    }).toThrow();
  });

  it('enforces served invariant constraints (harm_pass, vision_pass, etags) for approved/hidden photos', () => {
    const photoId = randomUUID();
    const targetId = randomUUID();
    const scopeId = randomUUID();

    // Trying to approve without harm verdict pass
    expect(() => {
      db.public.none(`
        INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, object_key, thumb_key, byte_size, thumb_byte_size, width, height, status, harm_verdict, vision_verdict, full_etag, thumb_etag)
        VALUES ('${photoId}', '${user1Id}', 'food_log', '${targetId}', '${scopeId}', 'u/${photoId}/full.jpg', 'u/${photoId}/thumb.jpg', 1024, 256, 800, 600, 'approved', 'flag', 'pass', '"etag1"', '"etag2"');
      `);
    }).toThrow();

    // Trying to approve food_log photo without vision verdict pass
    expect(() => {
      db.public.none(`
        INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, object_key, thumb_key, byte_size, thumb_byte_size, width, height, status, harm_verdict, vision_verdict, full_etag, thumb_etag)
        VALUES ('${photoId}', '${user1Id}', 'food_log', '${targetId}', '${scopeId}', 'u/${photoId}/full.jpg', 'u/${photoId}/thumb.jpg', 1024, 256, 800, 600, 'approved', 'pass', 'reject', '"etag1"', '"etag2"');
      `);
    }).toThrow();

    // Trying to approve without etags
    expect(() => {
      db.public.none(`
        INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, object_key, thumb_key, byte_size, thumb_byte_size, width, height, status, harm_verdict, vision_verdict)
        VALUES ('${photoId}', '${user1Id}', 'food_log', '${targetId}', '${scopeId}', 'u/${photoId}/full.jpg', 'u/${photoId}/thumb.jpg', 1024, 256, 800, 600, 'approved', 'pass', 'pass');
      `);
    }).toThrow();

    // Valid approved food_log photo
    db.public.none(`
      INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, object_key, thumb_key, byte_size, thumb_byte_size, width, height, status, harm_verdict, vision_verdict, full_etag, thumb_etag)
      VALUES ('${photoId}', '${user1Id}', 'food_log', '${targetId}', '${scopeId}', 'u/${photoId}/full.jpg', 'u/${photoId}/thumb.jpg', 1024, 256, 800, 600, 'approved', 'pass', 'pass', '"etag1"', '"etag2"');
    `);
  });

  it('enforces check constraints on photo_reports reason and status', () => {
    const photoId = randomUUID();
    const targetId = randomUUID();
    const scopeId = randomUUID();
    const reportId = randomUUID();

    db.public.none(`
      INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, object_key, thumb_key, byte_size, thumb_byte_size, width, height)
      VALUES ('${photoId}', '${user1Id}', 'food_log', '${targetId}', '${scopeId}', 'u/${photoId}/full.jpg', 'u/${photoId}/thumb.jpg', 1024, 256, 800, 600);
    `);

    // Invalid reason
    expect(() => {
      db.public.none(`
        INSERT INTO photo_reports (id, photo_id, reporter_id, reason, status)
        VALUES ('${reportId}', '${photoId}', '${user2Id}', 'invalid_reason', 'open');
      `);
    }).toThrow();

    // Invalid status
    expect(() => {
      db.public.none(`
        INSERT INTO photo_reports (id, photo_id, reporter_id, reason, status)
        VALUES ('${reportId}', '${photoId}', '${user2Id}', 'spam', 'invalid_status');
      `);
    }).toThrow();

    // Valid report
    db.public.none(`
      INSERT INTO photo_reports (id, photo_id, reporter_id, reason, status, note)
      VALUES ('${reportId}', '${photoId}', '${user2Id}', 'spam', 'open', 'Looks like spam');
    `);
  });

  it('enforces counter check constraints', () => {
    // photo_upload_counters count >= 0
    expect(() => {
      db.public.none(`
        INSERT INTO photo_upload_counters (user_id, day, upload_count)
        VALUES ('${user1Id}', '2026-10-18', -1);
      `);
    }).toThrow();

    // photo_upload_strikes count >= 0
    expect(() => {
      db.public.none(`
        INSERT INTO photo_upload_strikes (user_id, upheld_count)
        VALUES ('${user1Id}', -1);
      `);
    }).toThrow();
  });

  it('enforces self-block prevention constraint on user_blocks', () => {
    expect(() => {
      db.public.none(`
        INSERT INTO user_blocks (blocker_id, blocked_id)
        VALUES ('${user1Id}', '${user1Id}');
      `);
    }).toThrow();

    // Valid block
    db.public.none(`
      INSERT INTO user_blocks (blocker_id, blocked_id)
      VALUES ('${user1Id}', '${user2Id}');
    `);
  });

  it('verifies ON DELETE SET NULL on photos.owner_id when user is deleted', () => {
    const photoId = randomUUID();
    const targetId = randomUUID();
    const scopeId = randomUUID();

    db.public.none(`
      INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, object_key, thumb_key, byte_size, thumb_byte_size, width, height)
      VALUES ('${photoId}', '${user1Id}', 'food_log', '${targetId}', '${scopeId}', 'u/${photoId}/full.jpg', 'u/${photoId}/thumb.jpg', 1024, 256, 800, 600);
    `);

    // Delete user
    db.public.none(`DELETE FROM users WHERE id = '${user1Id}';`);

    const photo = db.public.one(`SELECT owner_id, status FROM photos WHERE id = '${photoId}';`);
    expect(photo.owner_id).toBeNull();
  });

  it('verifies ON DELETE CASCADE on photo_upload_bans.user_id', () => {
    db.public.none(`
      INSERT INTO photo_upload_bans (user_id, reason)
      VALUES ('${user1Id}', 'Spam');
    `);

    expect(db.public.many(`SELECT * FROM photo_upload_bans WHERE user_id = '${user1Id}';`).length).toBe(1);

    db.public.none(`DELETE FROM users WHERE id = '${user1Id}';`);

    expect(db.public.many(`SELECT * FROM photo_upload_bans WHERE user_id = '${user1Id}';`).length).toBe(0);
  });

  it('verifies photo_reports.photo_id ON DELETE CASCADE', () => {
    const photoId = randomUUID();
    const targetId = randomUUID();
    const scopeId = randomUUID();
    const reportId = randomUUID();

    db.public.none(`
      INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, object_key, thumb_key, byte_size, thumb_byte_size, width, height)
      VALUES ('${photoId}', '${user1Id}', 'food_log', '${targetId}', '${scopeId}', 'u/${photoId}/full.jpg', 'u/${photoId}/thumb.jpg', 1024, 256, 800, 600);
      INSERT INTO photo_reports (id, photo_id, reporter_id, reason, status)
      VALUES ('${reportId}', '${photoId}', '${user2Id}', 'spam', 'open');
    `);

    expect(db.public.many(`SELECT * FROM photo_reports WHERE id = '${reportId}';`).length).toBe(1);

    db.public.none(`DELETE FROM photos WHERE id = '${photoId}';`);

    expect(db.public.many(`SELECT * FROM photo_reports WHERE id = '${reportId}';`).length).toBe(0);
  });

  it('verifies idempotence: running migration statements again does not throw', () => {
    expect(() => {
      applyMigration(db, '0062_photo_uploads.sql');
    }).not.toThrow();
  });
});

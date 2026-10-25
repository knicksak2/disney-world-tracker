import { describe, it, expect } from 'vitest';
import { SQL_MY_PHOTOS_FIRST_PAGE, SQL_MY_PHOTOS_NEXT_PAGE } from '../repo.js';

describe('My Photos SQL guard — no leakage, no wildcards, no blocks join', () => {
  const FORBIDDEN_TOKENS = [
    'object_key',
    'thumb_key',
    'vision_fields',
    'SELECT *',
    'RETURNING *',
    'JOIN',
    'user_blocks',
  ];

  function assertSqlClean(sql: string, name: string): void {
    const normalized = sql.toUpperCase();
    for (const token of FORBIDDEN_TOKENS) {
      const forbiddenNormalized = token.toUpperCase();
      expect(
        normalized.includes(forbiddenNormalized),
        `${name} must not contain "${token}"`
      ).toBe(false);
    }
  }

  it('SQL_MY_PHOTOS_FIRST_PAGE contains none of the forbidden tokens', () => {
    assertSqlClean(SQL_MY_PHOTOS_FIRST_PAGE, 'SQL_MY_PHOTOS_FIRST_PAGE');
  });

  it('SQL_MY_PHOTOS_NEXT_PAGE contains none of the forbidden tokens', () => {
    assertSqlClean(SQL_MY_PHOTOS_NEXT_PAGE, 'SQL_MY_PHOTOS_NEXT_PAGE');
  });

  it('negative fixture: fails if a query selects object_key or uses wildcards/joins', () => {
    const badStatements = [
      'SELECT id, object_key FROM photos WHERE owner_id = $1',
      'SELECT id, thumb_key FROM photos WHERE owner_id = $1',
      'SELECT id, vision_fields FROM photos WHERE owner_id = $1',
      'SELECT * FROM photos WHERE owner_id = $1',
      'UPDATE photos SET status = $1 RETURNING *',
      'SELECT p.id FROM photos p JOIN users u ON u.id = p.owner_id',
      'SELECT id FROM photos WHERE NOT EXISTS (SELECT 1 FROM user_blocks)',
    ];

    for (const badSql of badStatements) {
      expect(() => assertSqlClean(badSql, 'badSql')).toThrow();
    }
  });
});


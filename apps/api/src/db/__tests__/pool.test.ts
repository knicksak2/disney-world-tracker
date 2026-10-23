import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config.js', () => ({
  loadConfig: () => ({ database: { url: 'postgres://u:p@127.0.0.1:5432/db' } }),
}));

import { attachPoolErrorHandler, createPool } from '../pool.js';

describe('pg pool idle-client error handling', () => {
  it('does not throw when an idle client errors (Neon "Connection terminated unexpectedly")', async () => {
    const pool = createPool();
    try {
      // Before the fix, an unhandled 'error' event on the pool throws here
      // (and crashes the process in production).
      expect(() => pool.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();
    } finally {
      await pool.end();
    }
  });

  it('logs the error with the err field', () => {
    const handlers: Array<(err: Error) => void> = [];
    const log = { error: vi.fn() };
    attachPoolErrorHandler({ on: ((_: string, h: (err: Error) => void) => handlers.push(h)) as never }, log);
    const err = new Error('Connection terminated unexpectedly');
    handlers[0]!(err);
    expect(log.error).toHaveBeenCalledWith({ err }, expect.stringContaining('idle pg client error'));
  });
});

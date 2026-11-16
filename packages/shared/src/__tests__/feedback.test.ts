/**
 * Tests for the in-app feedback shared contract.
 *
 * Validates: Requirements 2.2, 8.2
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_DEVICE_FIELD_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_PLATFORMS,
  feedbackSubmitInputSchema,
} from '../index.js';

const device = { appVersion: '1.4.0', platform: 'ios', osVersion: '17.5' };

describe('feedbackSubmitInputSchema', () => {
  it('accepts a minimal body and defaults contactOk to false', () => {
    const parsed = feedbackSubmitInputSchema.parse({ kind: 'bug', message: 'It crashed' });
    expect(parsed).toEqual({ kind: 'bug', message: 'It crashed', contactOk: false });
  });

  it('accepts device info and contact consent, and trims the message', () => {
    const parsed = feedbackSubmitInputSchema.parse({
      kind: 'idea',
      message: '  Add a dark mode toggle  ',
      contactOk: true,
      device,
    });
    expect(parsed.message).toBe('Add a dark mode toggle');
    expect(parsed.contactOk).toBe(true);
    expect(parsed.device).toEqual(device);
  });

  it('rejects an unknown kind', () => {
    expect(feedbackSubmitInputSchema.safeParse({ kind: 'complaint', message: 'x' }).success).toBe(false);
  });

  it('rejects a message that is empty or only whitespace', () => {
    expect(feedbackSubmitInputSchema.safeParse({ kind: 'bug', message: '' }).success).toBe(false);
    expect(feedbackSubmitInputSchema.safeParse({ kind: 'bug', message: '   \n\t ' }).success).toBe(false);
  });

  it('accepts exactly the maximum message length and rejects one more', () => {
    const ok = 'a'.repeat(FEEDBACK_MESSAGE_MAX);
    expect(feedbackSubmitInputSchema.safeParse({ kind: 'other', message: ok }).success).toBe(true);
    expect(feedbackSubmitInputSchema.safeParse({ kind: 'other', message: `${ok}a` }).success).toBe(false);
  });

  it('rejects an unknown platform and an over-long version', () => {
    expect(feedbackSubmitInputSchema.safeParse({ kind: 'bug', message: 'x', device: { ...device, platform: 'windows' } }).success).toBe(false);
    expect(
      feedbackSubmitInputSchema.safeParse({
        kind: 'bug',
        message: 'x',
        device: { ...device, appVersion: 'v'.repeat(FEEDBACK_DEVICE_FIELD_MAX + 1) },
      }).success,
    ).toBe(false);
  });

  it('rejects a partial device object', () => {
    expect(feedbackSubmitInputSchema.safeParse({ kind: 'bug', message: 'x', device: { appVersion: '1.0.0' } }).success).toBe(false);
  });

  it('rejects unknown extra keys, including a client-supplied email or user id', () => {
    expect(feedbackSubmitInputSchema.safeParse({ kind: 'bug', message: 'x', contactEmail: 'a@b.co' }).success).toBe(false);
    expect(feedbackSubmitInputSchema.safeParse({ kind: 'bug', message: 'x', userId: 'abc' }).success).toBe(false);
  });
});

// Feature: in-app-feedback, Property 5: Validation accepts exactly the contract
describe('Property 5: validation accepts exactly the contract', () => {
  const versionArb = fc.string({ minLength: 1, maxLength: 40 });

  it('accepts iff kind, trimmed message length and device fields are all within the contract', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom(...FEEDBACK_KINDS), fc.constantFrom('x', 'BUG', '')),
        fc.string({ maxLength: FEEDBACK_MESSAGE_MAX + 20 }),
        fc.option(
          fc.record({
            appVersion: versionArb,
            platform: fc.oneof(fc.constantFrom(...FEEDBACK_PLATFORMS), fc.constantFrom('windows', 'IOS')),
            osVersion: versionArb,
          }),
          { nil: undefined },
        ),
        (kind, message, dev) => {
          const trimmed = message.trim();
          const deviceOk =
            dev === undefined ||
            ((FEEDBACK_PLATFORMS as readonly string[]).includes(dev.platform) &&
              dev.appVersion.trim().length >= 1 &&
              dev.appVersion.trim().length <= FEEDBACK_DEVICE_FIELD_MAX &&
              dev.osVersion.trim().length >= 1 &&
              dev.osVersion.trim().length <= FEEDBACK_DEVICE_FIELD_MAX);
          const expected =
            (FEEDBACK_KINDS as readonly string[]).includes(kind) &&
            trimmed.length >= 1 &&
            trimmed.length <= FEEDBACK_MESSAGE_MAX &&
            deviceOk;
          const body: Record<string, unknown> = { kind, message };
          if (dev !== undefined) body.device = dev;
          expect(feedbackSubmitInputSchema.safeParse(body).success).toBe(expected);
        },
      ),
      { numRuns: 300 },
    );
  });
});

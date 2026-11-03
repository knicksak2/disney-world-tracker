import { describe, expect, it } from 'vitest';
import { bpsOf, splitCentsEvenly } from '../index.js';

describe('money pure helpers (bpsOf and splitCentsEvenly)', () => {
  describe('bpsOf', () => {
    it('calculates exact zero and 100%', () => {
      expect(bpsOf(1000, 0)).toBe(0);
      expect(bpsOf(1000, 10000)).toBe(1000);
      expect(bpsOf(0, 650)).toBe(0);
    });

    it('rounds half up at 0.5 cents', () => {
      // 100 * 650 = 65000 -> (65000 + 5000) / 10000 = 70000 / 10000 = 7
      expect(bpsOf(100, 650)).toBe(7);
      // 10 * 650 = 6500 -> (6500 + 5000) / 10000 = 11500 / 10000 = 1 (1.15 -> 1)
      expect(bpsOf(10, 650)).toBe(1);
      // 1000 * 1800 (18% dining tip) = 1800000 -> 180
      expect(bpsOf(1000, 1800)).toBe(180);
    });
  });

  describe('splitCentsEvenly', () => {
    it('splits evenly with zero remainder', () => {
      expect(splitCentsEvenly(300, 3)).toEqual([100, 100, 100]);
      expect(splitCentsEvenly(100, 1)).toEqual([100]);
    });

    it('distributes remainder cents in list order (lower indices first)', () => {
      expect(splitCentsEvenly(100, 3)).toEqual([34, 33, 33]);
      expect(splitCentsEvenly(101, 3)).toEqual([34, 34, 33]);
      expect(splitCentsEvenly(1, 3)).toEqual([1, 0, 0]);
      expect(splitCentsEvenly(2, 3)).toEqual([1, 1, 0]);
      expect(splitCentsEvenly(0, 3)).toEqual([0, 0, 0]);
    });

    it('throws when count < 1 or not integer', () => {
      expect(() => splitCentsEvenly(100, 0)).toThrow('count must be an integer >= 1');
      expect(() => splitCentsEvenly(100, -1)).toThrow('count must be an integer >= 1');
      expect(() => splitCentsEvenly(100, 2.5)).toThrow('count must be an integer >= 1');
    });
  });
});


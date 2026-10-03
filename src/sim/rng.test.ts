import { describe, it, expect } from 'vitest';
import { mulberry32 } from './rng';

describe('mulberry32', () => {
  it('is deterministic for equal seeds', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs across seeds', () => {
    expect(mulberry32(1).next()).not.toBe(mulberry32(2).next());
  });

  it('next() stays in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(n) stays in [0, n)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('shuffle returns a permutation without mutating input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const r = mulberry32(3);
    const out = r.shuffle(input);
    expect(out).not.toBe(input);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('shuffle is deterministic', () => {
    expect(mulberry32(9).shuffle([1, 2, 3, 4])).toEqual(mulberry32(9).shuffle([1, 2, 3, 4]));
  });
});

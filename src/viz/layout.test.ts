import { describe, it, expect } from 'vitest';
import { arcPath, nodePositions, nodeRadius, VIEW } from './layout';

describe('nodePositions', () => {
  it('places N nodes evenly on the ring, first at 12 o-clock', () => {
    const pos = nodePositions([0, 1, 2, 3]);
    expect(pos.get(0)!.x).toBeCloseTo(VIEW.cx);
    expect(pos.get(0)!.y).toBeCloseTo(VIEW.cy - VIEW.r);
    expect(pos.get(1)!.x).toBeCloseTo(VIEW.cx + VIEW.r);
    expect(pos.get(1)!.y).toBeCloseTo(VIEW.cy);
  });

  it('all points lie on the ring radius', () => {
    for (const p of nodePositions([0, 1, 2, 3, 4, 5, 6]).values()) {
      expect(Math.hypot(p.x - VIEW.cx, p.y - VIEW.cy)).toBeCloseTo(VIEW.r);
    }
  });

  it('sorts ids so positions are stable regardless of input order', () => {
    expect(nodePositions([3, 0, 2, 1])).toEqual(nodePositions([0, 1, 2, 3]));
  });
});

describe('arcPath', () => {
  it('produces a quadratic path from a to b', () => {
    const d = arcPath({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(d).toMatch(/^M 0 0 Q [\d.-]+ [\d.-]+ 100 0$/);
  });

  it('bulges to the right of travel (A→B and B→A use different lanes)', () => {
    const ab = arcPath({ x: 0, y: 0 }, { x: 100, y: 0 });
    const ba = arcPath({ x: 100, y: 0 }, { x: 0, y: 0 });
    const ctrlY = (d: string) => Number(d.split(' ')[5]); // "M x y Q cx cy x2 y2" -> index 5 = cy
    expect(ctrlY(ab)).toBeLessThan(0);    // right of +x travel is -y (SVG y-down)
    expect(ctrlY(ba)).toBeGreaterThan(0);
  });
});

describe('nodeRadius', () => {
  it('is 22 for 12 nodes (small counts stay at the cap)', () => {
    expect(nodeRadius(12)).toBe(22);
  });

  it('is 11 for 50 nodes (large counts taper to the floor)', () => {
    expect(nodeRadius(50)).toBe(11);
  });

  it('is monotonically non-increasing as node count grows from 4 to 50', () => {
    let prev = nodeRadius(4);
    for (let n = 5; n <= 50; n++) {
      const r = nodeRadius(n);
      expect(r).toBeLessThanOrEqual(prev);
      prev = r;
    }
  });

  it('never leaves the [11, 22] clamp range', () => {
    for (let n = 1; n <= 100; n++) {
      const r = nodeRadius(n);
      expect(r).toBeGreaterThanOrEqual(11);
      expect(r).toBeLessThanOrEqual(22);
    }
  });
});

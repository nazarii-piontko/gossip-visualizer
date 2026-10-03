import type { NodeId } from '../sim/types';

export interface Pt { x: number; y: number; }

export const VIEW = { size: 800, cx: 400, cy: 400, r: 320 };

/** Nodes sit evenly spaced on the ring, ordered by id, starting at 12 o'clock. */
export function nodePositions(ids: NodeId[]): Map<NodeId, Pt> {
  const sorted = [...ids].sort((a, b) => a - b);
  const out = new Map<NodeId, Pt>();
  sorted.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / sorted.length - Math.PI / 2;
    out.set(id, { x: VIEW.cx + VIEW.r * Math.cos(angle), y: VIEW.cy + VIEW.r * Math.sin(angle) });
  });
  return out;
}

/** Node radius shrinks as the ring crowds (clamped 11–22px) so neighbors never overlap. */
export function nodeRadius(count: number): number {
  if (count <= 0) return 22;
  return Math.max(11, Math.min(22, Math.round((Math.PI * VIEW.r) / count / 2.4)));
}

/** Quadratic arc bowing right of travel, so A→B and B→A packets take visibly
 *  different curves instead of overlapping on one line. */
export function arcPath(a: Pt, b: Pt): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const k = 0.18 * len + 10;
  // perpendicular right-of-travel = (dy/len, -dx/len); control = mid + perp * k
  const cx = (a.x + b.x) / 2 + (dy / len) * k;
  const cy = (a.y + b.y) / 2 + (-dx / len) * k;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

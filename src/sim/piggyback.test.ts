import { describe, it, expect } from 'vitest';
import { PiggybackBuffer } from './piggyback';
import type { MembershipUpdate } from './types';

const u = (id: number, state: MembershipUpdate['state'] = 'alive', incarnation = 0): MembershipUpdate =>
  ({ id, state, incarnation });

describe('PiggybackBuffer', () => {
  it('draws at most max updates', () => {
    const b = new PiggybackBuffer();
    for (let i = 0; i < 10; i++) b.enqueue(u(i));
    expect(b.draw(6, 8)).toHaveLength(6);
  });

  it('prioritizes fewest-times-sent', () => {
    const b = new PiggybackBuffer();
    b.enqueue(u(1));
    b.enqueue(u(2));
    b.draw(1, 8); // sends id 1 (tie-break: lower id) -> timesSent {1:1, 2:0}
    expect(b.draw(1, 8)[0].id).toBe(2);
  });

  it('superseding update replaces entry and resets send count', () => {
    const b = new PiggybackBuffer();
    b.enqueue(u(1, 'alive', 0));
    b.draw(1, 8);
    b.enqueue(u(1, 'suspect', 0)); // supersedes -> reset
    const out = b.draw(1, 8);
    expect(out[0]).toEqual(u(1, 'suspect', 0));
  });

  it('non-superseding update is ignored', () => {
    const b = new PiggybackBuffer();
    b.enqueue(u(1, 'suspect', 5));
    b.enqueue(u(1, 'alive', 5)); // does not supersede
    expect(b.draw(1, 8)[0].state).toBe('suspect');
  });

  it('evicts after retransmitLimit sends', () => {
    const b = new PiggybackBuffer();
    b.enqueue(u(1));
    b.draw(6, 2);
    b.draw(6, 2); // second send reaches limit -> evicted
    expect(b.size()).toBe(0);
    expect(b.draw(6, 2)).toHaveLength(0);
  });

  it('returns copies, not shared references', () => {
    const b = new PiggybackBuffer();
    b.enqueue(u(1));
    const [first] = b.draw(1, 8);
    first.state = 'dead';
    expect(b.draw(1, 8)[0].state).toBe('alive');
  });
});

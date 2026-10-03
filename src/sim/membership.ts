import type { MemberState, MembershipUpdate } from './types';

const PRECEDENCE: Record<MemberState, number> = { alive: 0, suspect: 1, dead: 2 };

/**
 * SWIM gossip ordering: does `incoming` override `current`? Higher incarnation
 * always wins (only the subject itself increments it, so a refutation beats any
 * stale suspicion); at equal incarnation the graver claim wins (dead > suspect > alive).
 */
export function supersedes(
  incoming: MembershipUpdate,
  current: { state: MemberState; incarnation: number },
): boolean {
  if (incoming.incarnation !== current.incarnation) {
    return incoming.incarnation > current.incarnation;
  }
  return PRECEDENCE[incoming.state] > PRECEDENCE[current.state];
}

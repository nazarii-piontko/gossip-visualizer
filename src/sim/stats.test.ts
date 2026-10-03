import { describe, it, expect } from 'vitest';
import { computeConvergence, computeDissent, computeOpinions, computePerceived } from './stats';
import type { GroundTruth, MembershipEntry, NodeId } from './types';

const e = (id: number, state: MembershipEntry['state']): MembershipEntry =>
  ({ id, state, incarnation: 0, lastUpdateTick: 0 });

describe('computePerceived', () => {
  it('majority wins', () => {
    const views = [
      { viewer: 0, entries: [e(2, 'suspect')] },
      { viewer: 1, entries: [e(2, 'suspect')] },
      { viewer: 3, entries: [e(2, 'alive')] },
    ];
    expect(computePerceived(views, [2])[2]).toBe('suspect');
  });

  it('tie breaks by dead > suspect > alive', () => {
    const views = [
      { viewer: 0, entries: [e(2, 'alive')] },
      { viewer: 1, entries: [e(2, 'dead')] },
    ];
    expect(computePerceived(views, [2])[2]).toBe('dead');
  });

  it('majority without an entry for the node -> unknown', () => {
    const views = [
      { viewer: 0, entries: [] },
      { viewer: 1, entries: [] },
      { viewer: 3, entries: [e(2, 'alive')] },
    ];
    expect(computePerceived(views, [2])[2]).toBe('unknown');
  });

  it('tie between alive and unknown -> alive wins (informative states take precedence)', () => {
    const views = [
      { viewer: 0, entries: [] },
      { viewer: 1, entries: [e(2, 'alive')] },
    ];
    expect(computePerceived(views, [2])[2]).toBe('alive');
  });

  it('no other viewers at all defaults to alive', () => {
    expect(computePerceived([{ viewer: 5, entries: [] }], [5])[5]).toBe('alive');
  });
});

describe('computeConvergence', () => {
  const truth = (pairs: [NodeId, GroundTruth][]) => new Map(pairs);

  it('is 1 when every view matches ground truth', () => {
    const views = [
      { viewer: 0, entries: [e(1, 'alive')] },
      { viewer: 1, entries: [e(0, 'alive')] },
    ];
    expect(computeConvergence(views, truth([[0, 'running'], [1, 'running']]))).toBe(1);
  });

  it('counts missing entry for a running node as mismatch', () => {
    const views = [
      { viewer: 0, entries: [] },        // 0 does not know 1 -> mismatch
      { viewer: 1, entries: [e(0, 'alive')] },
    ];
    expect(computeConvergence(views, truth([[0, 'running'], [1, 'running']]))).toBe(0.5);
  });

  it('killed node: dead or absent both count as converged', () => {
    const views = [
      { viewer: 0, entries: [e(1, 'alive'), e(2, 'dead')] },
      { viewer: 1, entries: [e(0, 'alive')] }, // 2 absent -> also fine
    ];
    expect(computeConvergence(views, truth([[0, 'running'], [1, 'running'], [2, 'killed']]))).toBe(1);
  });

  it('suspect view of a running node is a mismatch', () => {
    const views = [
      { viewer: 0, entries: [e(1, 'suspect')] },
      { viewer: 1, entries: [e(0, 'alive')] },
    ];
    expect(computeConvergence(views, truth([[0, 'running'], [1, 'running']]))).toBe(0.5);
  });

  it('departed node still remembered as alive is a mismatch', () => {
    const views = [{ viewer: 0, entries: [e(9, 'alive')] }];
    expect(computeConvergence(views, truth([[0, 'running']]))).toBe(0);
  });
});

describe('computeOpinions', () => {
  it('3 viewers (none is the subject) all alive on id 2 -> all alive fraction 1', () => {
    const views = [
      { viewer: 0, entries: [e(2, 'alive')] },
      { viewer: 1, entries: [e(2, 'alive')] },
      { viewer: 3, entries: [e(2, 'alive')] },
    ];
    expect(computeOpinions(views, [2])[2]).toEqual({ alive: 1, suspect: 0, dead: 0, unknown: 0 });
  });

  it('votes 2 suspect / 1 alive / 1 dead (none is the subject) -> fractions of votes cast', () => {
    const views = [
      { viewer: 0, entries: [e(2, 'suspect')] },
      { viewer: 1, entries: [e(2, 'suspect')] },
      { viewer: 3, entries: [e(2, 'alive')] },
      { viewer: 4, entries: [e(2, 'dead')] },
    ];
    expect(computeOpinions(views, [2])[2]).toEqual({ alive: 0.25, suspect: 0.5, dead: 0.25, unknown: 0 });
  });

  it('viewers with no entry for the subject count as unknown', () => {
    const views = [
      { viewer: 0, entries: [e(2, 'suspect')] },
      { viewer: 1, entries: [] },
      { viewer: 3, entries: [] },
    ];
    expect(computeOpinions(views, [2])[2]).toEqual({ alive: 0, suspect: 1 / 3, dead: 0, unknown: 2 / 3 });
  });

  it('id nobody has an entry for -> fully unknown', () => {
    expect(computeOpinions([{ viewer: 0, entries: [] }], [5])[5]).toEqual({ alive: 0, suspect: 0, dead: 0, unknown: 1 });
  });

  it('no other viewers at all (single-node cluster) -> defaults to all-alive', () => {
    const views = [{ viewer: 2, entries: [] }];
    expect(computeOpinions(views, [2])[2]).toEqual({ alive: 1, suspect: 0, dead: 0, unknown: 0 });
  });

  it('excludes the subject\'s own self-view even when it claims everything is alive', () => {
    const views = [
      // subject X=2's own table: irrelevant to its own opinion donut, would vote alive if counted
      { viewer: 2, entries: [e(0, 'alive'), e(1, 'alive')] },
      { viewer: 0, entries: [e(2, 'suspect')] },
      { viewer: 1, entries: [e(2, 'suspect')] },
    ];
    expect(computeOpinions(views, [2])[2]).toEqual({ alive: 0, suspect: 1, dead: 0, unknown: 0 });
  });
});

describe('computeDissent', () => {
  it('lists viewers that suspect, see dead, or do not know the subject; alive viewers omitted', () => {
    const views = [
      { viewer: 0, entries: [e(2, 'suspect')] },
      { viewer: 1, entries: [e(2, 'dead')] },
      { viewer: 3, entries: [e(2, 'alive')] },
      { viewer: 4, entries: [] },
    ];
    expect(computeDissent(views, [2])[2]).toEqual([
      { viewer: 0, state: 'suspect' },
      { viewer: 1, state: 'dead' },
      { viewer: 4, state: 'unknown' },
    ]);
  });

  it('excludes the subject\'s own view and returns empty when all others see it alive', () => {
    const views = [
      { viewer: 2, entries: [] }, // subject's own table never counts
      { viewer: 0, entries: [e(2, 'alive')] },
    ];
    expect(computeDissent(views, [2])[2]).toEqual([]);
  });
});

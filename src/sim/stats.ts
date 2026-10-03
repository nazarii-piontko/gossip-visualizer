import type { SwimNode } from './node';
import type { DissentEntry, GlobalSnapshot, GroundTruth, MemberState, MembershipEntry, NodeId, Opinion, PerceivedState } from './types';

export interface SnapshotInput {
  tick: number;
  runningNodes: SwimNode[];
  groundTruth: Map<NodeId, GroundTruth>;
  messagesThisTick: number;
  totalMessages: number;
  totalDropped: number;
  lastDetectionLatency: number | null;
  nodeFailure: Map<NodeId, { in: number; out: number }>;
  globalFailureRate: number;
}

export interface View {
  viewer: NodeId;
  entries: MembershipEntry[];
}

const PRECEDENCE: Record<PerceivedState, number> = { unknown: 0, alive: 1, suspect: 2, dead: 3 };

/** Majority vote across running nodes on each node's state. A node votes 'alive'
 *  for itself; ties break toward the graver state (dead > suspect > alive > unknown).
 *  With no views at all (single-node cluster) the node counts as alive. */
export function computePerceived(views: View[], allIds: NodeId[]): Record<NodeId, PerceivedState> {
  const out: Record<NodeId, PerceivedState> = {};
  for (const id of allIds) {
    const votes: Record<PerceivedState, number> = { alive: 0, suspect: 0, dead: 0, unknown: 0 };
    for (const v of views) {
      if (v.viewer === id) {
        votes.alive++;
        continue;
      }
      const entry = v.entries.find((x) => x.id === id);
      if (entry) votes[entry.state]++;
      else votes.unknown++;
    }
    const best = (Object.keys(votes) as PerceivedState[]).reduce((a, b) =>
      votes[b] > votes[a] || (votes[b] === votes[a] && PRECEDENCE[b] > PRECEDENCE[a]) ? b : a,
    );
    out[id] = votes[best] === 0 ? 'alive' : best;
  }
  return out;
}

/** Per node, the fraction of *other* running nodes seeing it as alive / suspect /
 *  dead / unknown — the data behind each node's opinion donut ring. */
export function computeOpinions(
  views: View[],
  allIds: NodeId[],
): Record<NodeId, Opinion> {
  const out: Record<NodeId, Opinion> = {};
  for (const id of allIds) {
    const votes: Record<MemberState, number> = { alive: 0, suspect: 0, dead: 0 };
    let unknown = 0;
    let total = 0;
    for (const v of views) {
      if (v.viewer === id) continue; // self-view never contributes to the donut
      total++;
      const entry = v.entries.find((x) => x.id === id);
      if (entry) votes[entry.state]++;
      else unknown++;
    }
    out[id] = total === 0
      ? { alive: 1, suspect: 0, dead: 0, unknown: 0 }
      : {
          alive: votes.alive / total,
          suspect: votes.suspect / total,
          dead: votes.dead / total,
          unknown: unknown / total,
        };
  }
  return out;
}

/** Per node, which running peers do NOT see it as alive, and how ('unknown' = no entry). */
export function computeDissent(views: View[], allIds: NodeId[]): Record<NodeId, DissentEntry[]> {
  const out: Record<NodeId, DissentEntry[]> = {};
  for (const id of allIds) {
    const list: DissentEntry[] = [];
    for (const v of views) {
      if (v.viewer === id) continue;
      const entry = v.entries.find((x) => x.id === id);
      if (!entry) list.push({ viewer: v.viewer, state: 'unknown' });
      else if (entry.state !== 'alive') list.push({ viewer: v.viewer, state: entry.state });
    }
    list.sort((a, b) => a.viewer - b.viewer);
    out[id] = list;
  }
  return out;
}

/** Fraction of (viewer, subject) beliefs matching ground truth. A running subject
 *  should be seen 'alive'; a killed or departed one should be 'dead' or absent. */
export function computeConvergence(views: View[], truth: Map<NodeId, GroundTruth>): number {
  let comparisons = 0;
  let matches = 0;
  for (const v of views) {
    const ids = new Set<NodeId>([...truth.keys(), ...v.entries.map((e) => e.id)]);
    ids.delete(v.viewer);
    for (const id of ids) {
      comparisons++;
      const entry = v.entries.find((x) => x.id === id);
      const gt = truth.get(id); // undefined => departed
      if (gt === 'running') {
        if (entry?.state === 'alive') matches++;
      } else {
        if (!entry || entry.state === 'dead') matches++;
      }
    }
  }
  return comparisons === 0 ? 1 : matches / comparisons;
}

/** Assemble the omniscient per-tick snapshot the UI renders; read-only over node state. */
export function buildSnapshot(input: SnapshotInput): GlobalSnapshot {
  const views: View[] = input.runningNodes.map((n) => ({ viewer: n.id, entries: n.tableEntries() }));
  const truthIds = [...input.groundTruth.keys()];
  const perceived = computePerceived(views, truthIds);
  const opinions = computeOpinions(views, truthIds);
  const dissent = computeDissent(views, truthIds);

  const groundTruth: GlobalSnapshot['groundTruth'] = {};
  for (const [id, s] of input.groundTruth) groundTruth[id] = s;
  const failureRates: GlobalSnapshot['failureRates'] = {};
  for (const [id, f] of input.nodeFailure) failureRates[id] = { ...f };

  const counts = { alive: 0, suspect: 0, dead: 0, unknown: 0 };
  for (const id of truthIds) counts[perceived[id]]++;

  return {
    tick: input.tick,
    groundTruth,
    perceived,
    aliveCount: counts.alive,
    suspectCount: counts.suspect,
    deadCount: counts.dead,
    convergence: computeConvergence(views, input.groundTruth),
    messagesThisTick: input.messagesThisTick,
    totalMessages: input.totalMessages,
    totalDropped: input.totalDropped,
    lastDetectionLatency: input.lastDetectionLatency,
    failureRates,
    globalFailureRate: input.globalFailureRate,
    opinions,
    dissent,
  };
}

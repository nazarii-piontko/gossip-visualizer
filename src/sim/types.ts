export type NodeId = number;

/** SWIM member lifecycle as one node sees it: alive → suspect (probe failed) → dead (suspicion expired). */
export type MemberState = 'alive' | 'suspect' | 'dead';
/** Cluster-majority view of a node; 'unknown' when most viewers have no entry for it. */
export type PerceivedState = MemberState | 'unknown';

/** One row in a node's local membership table: its current belief about a peer. */
export interface MembershipEntry {
  id: NodeId;
  state: MemberState;
  /** Version counter owned by the subject node; only it may increment (to refute suspicion). */
  incarnation: number;
  /** Tick this entry last changed; drives suspect expiry and dead pruning. */
  lastUpdateTick: number;
}

/** Gossip payload: a claim about one node's state, ordered by `supersedes`. */
export interface MembershipUpdate {
  id: NodeId;
  state: MemberState;
  incarnation: number;
}

export type MessageType =
  | 'ping' | 'ack' | 'ping-req' | 'ping-req-ping' | 'ping-req-ack' | 'leave';

/** What a node emits; Simulator stamps the rest. */
export interface MessageDraft {
  type: MessageType;
  to: NodeId;
  subject?: NodeId; // probed node T on indirect legs
  origin?: NodeId;  // original prober A on indirect legs
  piggyback: MembershipUpdate[];
}

export interface Message extends MessageDraft {
  id: number;
  from: NodeId;
  sentTick: number;
  deliverTick: number; // sentTick + 1
  dropped: boolean;    // decided at send, applied at delivery
}

/** Protocol tuning knobs; all timing values are in simulation ticks. */
export interface SwimParams {
  /** Ticks between a node's probe rounds (LHM-scaled). Should be >= PROBE_DEADLINE
   *  so a full probe round, indirect leg included, completes within one period. */
  protocolPeriod: number;
  /** Relays asked to ping-req the target when a direct ping goes unanswered; 0 = direct pings only. */
  indirectProbes: number;
  /** Suspicion timeout = suspicionMult * log10(max(n, 10)) * protocolPeriod ticks (LHM-scaled),
   *  n = members the node knows of — grows with cluster size so refutations can spread
   *  (memberlist SuspicionMult). */
  suspicionMult: number;
  /** Max membership updates piggybacked on a single message. */
  maxPiggyback: number;
  /** Peers a joining node is introduced to. */
  seedCount: number;
  /** Ticks a dead entry lingers before removal from the table. */
  deadPruneTicks: number;
  /** Sends per buffered update before it stops being gossiped. */
  piggybackRetransmits: number;
  /** Lifeguard cap: LHM-scaled timeouts stretch by at most this factor, i.e. lhm <= lhmMax - 1
   *  (memberlist AwarenessMaxMultiplier); 0 or 1 disables local health scaling. */
  lhmMax: number;
}

export const DEFAULT_SWIM: SwimParams = {
  protocolPeriod: 6,
  indirectProbes: 3,
  suspicionMult: 4,
  maxPiggyback: 6,
  seedCount: 3,
  deadPruneTicks: 50,
  piggybackRetransmits: 8,
  lhmMax: 8,
};

/** Ticks without an ack before a probe escalates to indirect ping-req (LHM-scaled). */
export const ACK_DEADLINE = 2;
/** Ticks before an unanswered probe marks its target suspect (LHM-scaled). */
export const PROBE_DEADLINE = 6;

/** Viz-facing summary of a message sent this tick (enough to animate it). */
export interface PacketInfo {
  msgId: number;
  from: NodeId;
  to: NodeId;
  type: MessageType;
  willDrop: boolean;
  piggybackCount: number;
}

/** Everything observable that happened during one tick, for the event log. */
export type TickEvent =
  | { kind: 'sent' | 'delivered' | 'dropped'; msg: Message }
  | { kind: 'state-change'; nodeId: NodeId; subject: NodeId; from: MemberState | 'unknown'; to: MemberState }
  | { kind: 'joined' | 'left' | 'killed'; nodeId: NodeId };

/** Simulator-level truth about a node, independent of what peers believe. */
export type GroundTruth = 'running' | 'killed';

/** Fractions of other running nodes' views about a node; sums to 1. */
export interface Opinion {
  alive: number;
  suspect: number;
  dead: number;
  unknown: number; // viewer has no entry for the node
}

/** A running node whose view of a subject is not 'alive'. */
export interface DissentEntry {
  viewer: NodeId;
  state: 'suspect' | 'dead' | 'unknown';
}

/** Omniscient per-tick view of the whole cluster, computed for the UI —
 *  nothing in here feeds back into the protocol. */
export interface GlobalSnapshot {
  tick: number;
  groundTruth: Record<NodeId, GroundTruth>; // departed nodes absent
  perceived: Record<NodeId, PerceivedState>; // majority view across running nodes
  aliveCount: number;    // from perceived
  suspectCount: number;
  deadCount: number;
  /** Fraction of (viewer, subject) pairs whose belief matches ground truth, 0..1. */
  convergence: number;
  messagesThisTick: number;
  totalMessages: number;
  totalDropped: number;
  lastDetectionLatency: number | null; // ticks, from last kill
  failureRates: Record<NodeId, { in: number; out: number }>;
  globalFailureRate: number;
  opinions: Record<NodeId, Opinion>;
  dissent: Record<NodeId, DissentEntry[]>;
}

/** Return value of Simulator.tick: events and packets for animation, snapshot for stats. */
export interface TickReport {
  tick: number;
  events: TickEvent[];
  packets: PacketInfo[];
  snapshot: GlobalSnapshot;
}

/** Per-node message and protocol-health tallies shown in the inspector. */
export interface NodeCounters {
  sent: Partial<Record<MessageType, number>>;
  received: Partial<Record<MessageType, number>>;
  droppedOutbound: number;
  /** Times this node suspected a peer that was actually running. */
  falseSuspicions: number;
  /** Times this node bumped its incarnation to deny a suspicion about itself. */
  refutations: number;
}

/** Full internal state of one node, exposed for the inspector panel. */
export interface NodeDetail {
  id: NodeId;
  running: boolean;
  incarnation: number;
  lhm: number; // Lifeguard local health multiplier (0 = healthy)
  phaseOffset: number;
  failureIn: number;
  failureOut: number;
  table: MembershipEntry[]; // peers only, sorted by id
  probes: { target: NodeId; startTick: number; indirectSent: boolean }[];
  counters: NodeCounters;
}

export interface SimulatorConfig {
  /** PRNG seed; identical config + same operator actions replay identically. */
  seed: number;
  nodeCount: number;
  swim?: Partial<SwimParams>;
  /** Probability any message is dropped in transit, 0..1. */
  globalFailureRate?: number;
}

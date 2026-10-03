import { SwimNode, type StateChange } from './node';
import { mulberry32, type Rng } from './rng';
import {
  DEFAULT_SWIM,
  type GlobalSnapshot, type GroundTruth, type Message, type MessageDraft, type NodeDetail, type NodeId,
  type PacketInfo, type SimulatorConfig, type SwimParams, type TickEvent, type TickReport,
} from './types';
import { buildSnapshot } from './stats';

/**
 * Discrete-time SWIM cluster. Owns the nodes and everything between them:
 * message transit (fixed 1-tick latency), drop injection, membership churn
 * (join/leave/kill), and per-tick reporting for the UI. Fully deterministic
 * for a given seed and operator action sequence.
 */
export class Simulator {
  readonly params: SwimParams;

  private nodes = new Map<NodeId, SwimNode>();
  private killed = new Set<NodeId>();
  private departed = new Set<NodeId>();
  private inFlight: Message[] = [];
  private tickCount = 0;
  private nextNodeId = 0;
  private nextMsgId = 0;
  private rng: Rng;
  private globalFailureRate: number;
  private nodeFailure = new Map<NodeId, { in: number; out: number }>();
  private totalMessages = 0;
  private messagesThisTick = 0;
  private totalDropped = 0;
  private pendingDetection: { id: NodeId; tick: number } | null = null;
  private lastDetectionLatency: number | null = null;
  private pendingEvents: TickEvent[] = [];
  private pendingOutbox: Message[] = []; // e.g. leave messages queued between ticks

  constructor(config: SimulatorConfig) {
    this.rng = mulberry32(config.seed);
    this.params = { ...DEFAULT_SWIM, ...config.swim };
    this.globalFailureRate = config.globalFailureRate ?? 0;
    for (let i = 0; i < config.nodeCount; i++) this.addNode();
    this.pendingEvents = []; // initial joins are not reported
  }

  /** Advance the world one tick: deliver messages sent last tick, run every
   *  node's protocol phase, then put newly drafted messages in flight. */
  tick(): TickReport {
    this.tickCount++;
    const tick = this.tickCount;
    const events: TickEvent[] = [...this.pendingEvents];
    this.pendingEvents = [];
    const outbox: Message[] = [...this.pendingOutbox];
    this.pendingOutbox = [];
    const groundTruth = this.groundTruth();

    // 1. deliver
    const arriving = this.inFlight.filter((m) => m.deliverTick === tick);
    this.inFlight = this.inFlight.filter((m) => m.deliverTick > tick);
    for (const msg of arriving) {
      if (msg.dropped) {
        events.push({ kind: 'dropped', msg });
        continue;
      }
      const target = this.nodes.get(msg.to);
      if (!target || this.killed.has(msg.to)) continue;
      const { drafts, changes } = target.onMessage(msg, tick);
      events.push({ kind: 'delivered', msg });
      this.recordChanges(target, changes, events, groundTruth);
      for (const d of drafts) outbox.push(this.stamp(target.id, d, tick));
    }

    // 2. per-node phase, id order
    for (const node of this.runningNodes()) {
      const { drafts, changes } = node.onTick(tick);
      this.recordChanges(node, changes, events, groundTruth);
      for (const d of drafts) outbox.push(this.stamp(node.id, d, tick));
    }

    // 3. register outbox
    const packets: PacketInfo[] = [];
    for (const msg of outbox) {
      this.inFlight.push(msg);
      events.push({ kind: 'sent', msg });
      packets.push({
        msgId: msg.id, from: msg.from, to: msg.to, type: msg.type,
        willDrop: msg.dropped, piggybackCount: msg.piggyback.length,
      });
    }
    this.totalMessages += outbox.length;
    this.messagesThisTick = outbox.length;

    this.checkDetection(tick);

    return { tick, events, packets, snapshot: this.snapshot() };
  }

  /** Snapshot of the cluster as it stands now. Same as the last tick's unless an operator
   *  action (join, kill, leave, failure rates) has changed things since. */
  snapshot(): GlobalSnapshot {
    return buildSnapshot({
      tick: this.tickCount,
      runningNodes: this.runningNodes(),
      groundTruth: this.groundTruth(),
      messagesThisTick: this.messagesThisTick,
      totalMessages: this.totalMessages,
      totalDropped: this.totalDropped,
      lastDetectionLatency: this.lastDetectionLatency,
      nodeFailure: this.nodeFailure,
      globalFailureRate: this.globalFailureRate,
    });
  }

  /** Join a new node, seeded with a random sample of currently running peers. */
  addNode(): NodeId {
    const id = this.nextNodeId++;
    const candidates = this.runningNodes().map((n) => n.id);
    const seeds = this.rng.shuffle(candidates).slice(0, this.params.seedCount);
    this.nodes.set(id, new SwimNode(id, seeds, this.params, this.rng, this.tickCount));
    this.pendingEvents.push({ kind: 'joined', nodeId: id });
    return id;
  }

  /** Remove a node permanently. A running node departs gracefully (broadcasts
   *  'leave' so peers skip the suspicion cycle); a killed one just vanishes. */
  removeNode(id: NodeId): void {
    const node = this.nodes.get(id);
    if (!node) return;
    if (!this.killed.has(id)) {
      for (const d of node.leaveDrafts()) this.pendingOutbox.push(this.stamp(id, d, this.tickCount + 1));
    }
    this.nodes.delete(id);
    this.killed.delete(id);
    this.nodeFailure.delete(id);
    this.departed.add(id);
    this.pendingEvents.push({ kind: 'left', nodeId: id });
    if (this.pendingDetection?.id === id) this.pendingDetection = null;
  }

  /** Crash-stop a node: it stops sending and receiving without warning, and the
   *  cluster must detect it — detection latency is measured from this tick. */
  killNode(id: NodeId): void {
    if (!this.nodes.has(id) || this.killed.has(id)) return;
    this.killed.add(id);
    this.pendingDetection = { id, tick: this.tickCount };
    this.pendingEvents.push({ kind: 'killed', nodeId: id });
  }

  /** Manually re-introduce a running node to the cluster (rejoin via fresh seed list). */
  rejoinNode(id: NodeId): void {
    const node = this.nodes.get(id);
    if (!node || this.killed.has(id)) return;
    const candidates = this.runningNodes().filter((n) => n.id !== id).map((n) => n.id);
    if (candidates.length === 0) return;
    const seeds = this.rng.shuffle(candidates).slice(0, this.params.seedCount);
    node.rejoin(seeds, this.tickCount);
  }

  setGlobalFailureRate(p: number): void {
    this.globalFailureRate = p;
  }

  setNodeFailureRate(id: NodeId, rates: { in: number; out: number }): void {
    this.nodeFailure.set(id, { ...rates });
  }

  updateSwimParams(partial: Partial<SwimParams>): void {
    Object.assign(this.params, partial);
  }

  getNodeDetail(id: NodeId): NodeDetail | null {
    const node = this.nodes.get(id);
    if (!node) return null;
    const f = this.nodeFailure.get(id) ?? { in: 0, out: 0 };
    return {
      ...node.detail(this.tickCount),
      running: !this.killed.has(id),
      failureIn: f.in,
      failureOut: f.out,
    };
  }

  runningNodes(): SwimNode[] {
    return [...this.nodes.values()].filter((n) => !this.killed.has(n.id)).sort((a, b) => a.id - b.id);
  }

  groundTruth(): Map<NodeId, GroundTruth> {
    const truth = new Map<NodeId, GroundTruth>();
    for (const id of this.nodes.keys()) truth.set(id, this.killed.has(id) ? 'killed' : 'running');
    return truth;
  }

  currentTick(): number {
    return this.tickCount;
  }

  private stamp(from: NodeId, d: MessageDraft, tick: number): Message {
    const outRate = this.nodeFailure.get(from)?.out ?? 0;
    const inRate = this.nodeFailure.get(d.to)?.in ?? 0;
    // three independent drop chances: global link noise, sender egress, receiver ingress
    const pDrop = 1 - (1 - this.globalFailureRate) * (1 - outRate) * (1 - inRate);
    const dropped = this.rng.next() < pDrop;
    if (dropped) {
      this.totalDropped++;
      const sender = this.nodes.get(from);
      if (sender) sender.counters.droppedOutbound++;
    }
    return { ...d, id: this.nextMsgId++, from, sentTick: tick, deliverTick: tick + 1, dropped };
  }

  private recordChanges(node: SwimNode, changes: StateChange[], events: TickEvent[], groundTruth: Map<NodeId, GroundTruth>): void {
    for (const c of changes) {
      events.push({ kind: 'state-change', nodeId: node.id, subject: c.subject, from: c.from, to: c.to });
      if (c.to === 'suspect' && groundTruth.get(c.subject) === 'running') {
        node.counters.falseSuspicions++;
      }
    }
  }

  /** Detection completes when every running node considers the killed node dead
   *  (or has pruned it); latency = ticks since the kill. */
  private checkDetection(tick: number): void {
    if (!this.pendingDetection) return;
    const { id, tick: killTick } = this.pendingDetection;
    for (const n of this.runningNodes()) {
      if (n.id === id) continue;
      const e = n.getEntry(id);
      if (e && e.state !== 'dead') return;
    }
    this.lastDetectionLatency = tick - killTick;
    this.pendingDetection = null;
  }
}

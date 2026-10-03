import { supersedes } from './membership';
import { PiggybackBuffer } from './piggyback';
import type { Rng } from './rng';
import {
  ACK_DEADLINE,
  PROBE_DEADLINE,
  type MemberState, type MembershipEntry, type MembershipUpdate, type Message, type MessageDraft,
  type MessageType, type NodeCounters, type NodeDetail, type NodeId, type SwimParams,
} from './types';

/** A visible transition in this node's opinion about a peer ('unknown' = no prior entry). */
export interface StateChange {
  subject: NodeId;
  from: MemberState | 'unknown';
  to: MemberState;
}

/** Result of one node step: messages to send plus opinion changes for event reporting. */
export interface NodeOutput {
  drafts: MessageDraft[];
  changes: StateChange[];
}

interface PendingProbe {
  target: NodeId;
  startTick: number;
  /** Absolute ticks, LHM-scaled when the probe starts; later LHM changes leave them alone. */
  ackDeadline: number;
  probeDeadline: number;
  indirectSent: boolean;
}

/**
 * One SWIM protocol participant. Pure protocol logic: it never sends or receives
 * directly — the Simulator delivers messages via onMessage/onTick and transports
 * the returned drafts. All randomness comes from the shared seeded RNG, so runs
 * with the same seed replay identically.
 */
export class SwimNode {
  readonly id: NodeId;
  readonly phaseOffset: number;
  incarnation = 0;
  /** Lifeguard local health multiplier: failure-detector timeouts and the probe interval
   *  scale by 1 + lhm, so a node whose own probes keep failing backs off and grows slow
   *  to declare others dead. */
  lhm = 0;
  counters: NodeCounters = {
    sent: {}, received: {}, droppedOutbound: 0, falseSuspicions: 0, refutations: 0,
  };

  private table = new Map<NodeId, MembershipEntry>();
  private buffer = new PiggybackBuffer();
  private probes = new Map<NodeId, PendingProbe>(); // pending probes keyed by target, for indirect-ack escalation
  private probeQueue: NodeId[] = []; // shuffled round-robin queue of probe targets
  private params: SwimParams;
  private rng: Rng; // shared simulator PRNG for target/relay selection
  private nextProbeTick: number;

  constructor(id: NodeId, seeds: NodeId[], params: SwimParams, rng: Rng, joinTick: number) {
    this.id = id;
    this.params = params;
    this.rng = rng;
    this.phaseOffset = rng.int(params.protocolPeriod);
    this.nextProbeTick = joinTick + this.phaseOffset;
    for (const s of seeds) {
      this.table.set(s, { id: s, state: 'alive', incarnation: 0, lastUpdateTick: joinTick });
    }
    this.buffer.enqueue({ id, state: 'alive', incarnation: 0 });
  }

  /** Handle a delivered message: absorb piggybacked gossip, then react per protocol
   *  (answer pings, relay indirect probes, resolve pending probes on acks). */
  onMessage(msg: Message, tick: number): NodeOutput {
    this.counters.received[msg.type] = (this.counters.received[msg.type] ?? 0) + 1;
    const changes: StateChange[] = [];
    // any message proves its sender exists: learn unknown senders as alive.
    // applyUpdate keeps suspect/dead entries intact (alive@0 does not supersede them),
    // so this never resurrects a peer that must refute via incarnation instead.
    changes.push(...this.applyUpdate({ id: msg.from, state: 'alive', incarnation: 0 }, tick));
    for (const u of msg.piggyback) changes.push(...this.applyUpdate(u, tick));

    const drafts: MessageDraft[] = [];
    switch (msg.type) {
      case 'ping':
        drafts.push(this.draft('ack', msg.from));
        break;
      case 'ack':
        this.resolveProbe(msg.from);
        break;
      case 'ping-req':
        drafts.push(this.draft('ping-req-ping', msg.subject!, { subject: msg.subject, origin: msg.origin }));
        break;
      case 'ping-req-ping':
        drafts.push(this.draft('ping-req-ack', msg.from, { subject: msg.subject, origin: msg.origin }));
        break;
      case 'ping-req-ack':
        if (msg.origin === this.id) this.resolveProbe(msg.subject!);
        else drafts.push(this.draft('ping-req-ack', msg.origin!, { subject: msg.subject, origin: msg.origin }));
        break;
      case 'leave': {
        const inc = (this.table.get(msg.from)?.incarnation ?? 0) + 1;
        changes.push(...this.applyUpdate({ id: msg.from, state: 'dead', incarnation: inc }, tick));
        break;
      }
    }

    return { drafts, changes };
  }

  /** Advance one tick: escalate/expire pending probes, age suspects into dead,
   *  prune long-dead entries, and start a new probe when this node's phase comes up. */
  onTick(tick: number): NodeOutput {
    const drafts: MessageDraft[] = [];
    const changes: StateChange[] = [];

    // 1. escalate / expire pending probes
    for (const probe of [...this.probes.values()]) {
      // target declared dead (or pruned) mid-probe: no point asking relays about it. The
      // probe itself still runs to its deadline — an unanswered probe counts toward LHM
      // either way, and an isolated node relies on that to keep its timeouts inflated.
      const targetState = this.table.get(probe.target)?.state;
      const targetGone = targetState === undefined || targetState === 'dead';
      if (!probe.indirectSent && !targetGone && tick >= probe.ackDeadline) {
        probe.indirectSent = true;
        const relays = this.rng
          .shuffle(this.alivePeers().filter((p) => p !== probe.target))
          .slice(0, this.params.indirectProbes);
        for (const r of relays) {
          drafts.push(this.draft('ping-req', r, { subject: probe.target, origin: this.id }));
        }
      }
      if (tick >= probe.probeDeadline) {
        this.probes.delete(probe.target);
        this.bumpLhm(1); // my probe failed outright: distrust my own verdicts more
        const inc = this.table.get(probe.target)?.incarnation ?? 0;
        changes.push(...this.applyUpdate({ id: probe.target, state: 'suspect', incarnation: inc }, tick));
      }
    }

    // 2. suspect expiry and dead pruning
    for (const e of [...this.table.values()]) {
      if (e.state === 'suspect' && tick - e.lastUpdateTick >= this.suspicionTimeout() * this.lhmScale()) {
        changes.push(...this.applyUpdate({ id: e.id, state: 'dead', incarnation: e.incarnation }, tick));
      } else if (e.state === 'dead' && tick - e.lastUpdateTick >= this.params.deadPruneTicks) {
        this.table.delete(e.id);
      }
    }

    // 3. start a new probe when my (LHM-scaled) interval comes up
    if (tick >= this.nextProbeTick) {
      this.nextProbeTick = tick + this.params.protocolPeriod * this.lhmScale();
      const target = this.nextProbeTarget();
      if (target !== null) {
        this.probes.set(target, {
          target,
          startTick: tick,
          ackDeadline: tick + ACK_DEADLINE * this.lhmScale(),
          probeDeadline: tick + PROBE_DEADLINE * this.lhmScale(),
          indirectSent: false,
        });
        drafts.push(this.draft('ping', target));
      }
    }

    return { drafts, changes };
  }

  /** Next round-robin target. Peers that already have a probe in flight (periods can be
   *  shorter than a full probe round) are passed over, so the round still probes someone. */
  private nextProbeTarget(): NodeId | null {
    const candidates = this.probeablePeers();
    if (!candidates.some((id) => !this.probes.has(id))) return null;
    for (;;) {
      while (this.probeQueue.length > 0) {
        const candidate = this.probeQueue.shift()!;
        const state = this.table.get(candidate)?.state;
        if ((state === 'alive' || state === 'suspect') && !this.probes.has(candidate)) return candidate;
      }
      // a fresh shuffle holds a free candidate, so the next pass returns
      this.probeQueue = this.rng.shuffle(candidates);
    }
  }

  /** SWIM probes round-robin over all non-dead members — suspects included,
   *  so a suspect keeps hearing about its own suspicion and can refute it. */
  private probeablePeers(): NodeId[] {
    return [...this.table.values()]
      .filter((e) => e.state !== 'dead')
      .map((e) => e.id)
      .sort((a, b) => a - b);
  }

  /** Merge one gossip update into the local table (SWIM supersedence rules) and
   *  re-gossip it if accepted. An update doubting this node itself is refuted
   *  instead: bump own incarnation and gossip a fresher 'alive'. */
  applyUpdate(u: MembershipUpdate, tick: number): StateChange[] {
    if (u.id === this.id) {
      if (u.state !== 'alive' && u.incarnation >= this.incarnation) {
        this.incarnation = u.incarnation + 1;
        this.counters.refutations++;
        this.bumpLhm(1); // someone doubted me: a sign I am not communicating well
        this.buffer.enqueue({ id: this.id, state: 'alive', incarnation: this.incarnation });
      }
      return [];
    }
    const current = this.table.get(u.id);
    if (current && !supersedes(u, current)) return [];
    const from: MemberState | 'unknown' = current?.state ?? 'unknown';
    this.table.set(u.id, { id: u.id, state: u.state, incarnation: u.incarnation, lastUpdateTick: tick });
    this.buffer.enqueue({ ...u });
    return from === u.state ? [] : [{ subject: u.id, from, to: u.state }];
  }

  /** Operator-driven rejoin after the table emptied (all peers dead-pruned, e.g. long
   *  isolation): adopt fresh seeds and re-announce own aliveness so peers that pruned
   *  us re-add us. Existing entries are kept — rejoin never overrides learned state. */
  rejoin(seeds: NodeId[], tick: number): void {
    for (const s of seeds) {
      if (s === this.id || this.table.has(s)) continue;
      this.table.set(s, { id: s, state: 'alive', incarnation: 0, lastUpdateTick: tick });
    }
    this.buffer.enqueue({ id: this.id, state: 'alive', incarnation: this.incarnation });
  }

  /** Farewell messages for a graceful departure: tell every alive peer to mark us dead. */
  leaveDrafts(): MessageDraft[] {
    return this.alivePeers().map((p) => this.draft('leave', p));
  }

  /** This node's current view of a peer (copy), or undefined if it has no entry. */
  getEntry(id: NodeId): MembershipEntry | undefined {
    const e = this.table.get(id);
    return e ? { ...e } : undefined;
  }

  /** Full membership view as copies, sorted by peer id. */
  tableEntries(): MembershipEntry[] {
    return [...this.table.values()].map((e) => ({ ...e })).sort((a, b) => a.id - b.id);
  }

  /** Ids of peers this node currently believes alive, sorted. */
  alivePeers(): NodeId[] {
    return [...this.table.values()].filter((e) => e.state === 'alive').map((e) => e.id).sort((a, b) => a - b);
  }

  /** Deep-copied snapshot of internal state for the inspector UI. */
  detail(_tick: number): Omit<NodeDetail, 'running' | 'failureIn' | 'failureOut'> {
    return {
      id: this.id,
      incarnation: this.incarnation,
      lhm: this.lhm,
      phaseOffset: this.phaseOffset,
      table: this.tableEntries(),
      probes: [...this.probes.values()].map(({ target, startTick, indirectSent }) => ({ target, startTick, indirectSent })),
      counters: JSON.parse(JSON.stringify(this.counters)) as NodeCounters,
    };
  }

  private resolveProbe(target: NodeId): void {
    if (!this.probes.delete(target)) return;
    this.bumpLhm(-1); // successful probe round: regain confidence
  }

  private lhmScale(): number {
    return 1 + this.lhm;
  }

  /** Base (unscaled) suspicion timeout, sized by the members this node knows of. */
  private suspicionTimeout(): number {
    const n = this.table.size + 1; // peers + self
    return Math.ceil(this.params.suspicionMult * Math.log10(Math.max(n, 10)) * this.params.protocolPeriod);
  }

  private bumpLhm(delta: number): void {
    this.lhm = Math.max(0, Math.min(this.params.lhmMax - 1, this.lhm + delta));
  }

  private draft(type: MessageType, to: NodeId, extra: Pick<MessageDraft, 'subject' | 'origin'> = {}): MessageDraft {
    this.counters.sent[type] = (this.counters.sent[type] ?? 0) + 1;
    // state echo: a suspect/dead recipient must always hear about itself — even after
    // the buffered update exhausted its retransmits — or it could never refute.
    // It takes one of the maxPiggyback slots rather than adding one.
    const entry = this.table.get(to);
    const echo = entry && entry.state !== 'alive'
      ? { id: entry.id, state: entry.state, incarnation: entry.incarnation }
      : null;
    const drawn = this.buffer.draw(this.params.maxPiggyback - (echo ? 1 : 0), this.params.piggybackRetransmits);
    const piggyback = echo ? [echo, ...drawn.filter((u) => u.id !== echo.id)] : drawn;
    return { type, to, ...extra, piggyback };
  }
}

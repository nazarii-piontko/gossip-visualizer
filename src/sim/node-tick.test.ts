import { describe, it, expect } from 'vitest';
import { SwimNode } from './node';
import { mulberry32 } from './rng';
import { ACK_DEADLINE, DEFAULT_SWIM, PROBE_DEADLINE } from './types';
import type { Message, MessageType, NodeId } from './types';

const msg = (over: Partial<Message> & { type: MessageType; from: NodeId; to: NodeId }): Message => ({
  id: 0, piggyback: [], sentTick: 0, deliverTick: 1, dropped: false, ...over,
});

/** First tick >= from matching the node's probe phase. */
const probeTick = (n: SwimNode, from: number): number => {
  let t = Math.max(from, n.phaseOffset);
  while ((t - n.phaseOffset) % DEFAULT_SWIM.protocolPeriod !== 0) t++;
  return t;
};

describe('SwimNode.onTick', () => {
  it('starts a probe on its phase', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    const { drafts } = n.onTick(t);
    expect(drafts).toEqual([expect.objectContaining({ type: 'ping', to: 2 })]);
    expect(n.onTick(t + 1).drafts).toEqual([]); // off-phase, before ACK_DEADLINE
  });

  it('does nothing with no alive peers', () => {
    const n = new SwimNode(1, [], DEFAULT_SWIM, mulberry32(5), 0);
    for (let t = 0; t < 10; t++) expect(n.onTick(t).drafts).toEqual([]);
  });

  it('escalates to ping-req after ACK_DEADLINE without ack', () => {
    const n = new SwimNode(1, [2, 3, 4, 5, 6], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    const target = (n.onTick(t).drafts[0] as { to: number }).to;
    const { drafts } = n.onTick(t + ACK_DEADLINE);
    const reqs = drafts.filter((d) => d.type === 'ping-req');
    expect(reqs).toHaveLength(DEFAULT_SWIM.indirectProbes);
    for (const r of reqs) {
      expect(r.subject).toBe(target);
      expect(r.origin).toBe(1);
      expect(r.to).not.toBe(target);
    }
  });

  it('does not escalate when ack arrived in time', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    n.onTick(t);
    n.onMessage(msg({ type: 'ack', from: 2, to: 1 }), t + 2);
    const { drafts } = n.onTick(t + ACK_DEADLINE);
    expect(drafts.filter((d) => d.type === 'ping-req')).toEqual([]);
  });

  it('marks target suspect after PROBE_DEADLINE', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    n.onTick(t);
    let all = [] as { subject: number; to: string }[];
    for (let i = 1; i <= PROBE_DEADLINE; i++) {
      all = all.concat(n.onTick(t + i).changes.map((c) => ({ subject: c.subject, to: c.to })));
    }
    expect(all).toContainEqual({ subject: 2, to: 'suspect' });
    expect(n.getEntry(2)!.state).toBe('suspect');
  });

  it('indirect ack resolves the probe (no suspicion)', () => {
    const n = new SwimNode(1, [2, 3], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    const target = (n.onTick(t).drafts[0] as { to: number }).to;
    n.onMessage(msg({ type: 'ping-req-ack', from: 3, to: 1, subject: target, origin: 1 }), t + 5);
    for (let i = 1; i <= PROBE_DEADLINE + 1; i++) n.onTick(t + i);
    expect(n.getEntry(target)!.state).toBe('alive');
  });

  it('suspect becomes dead after suspicionMult * log10(10) * protocolPeriod in small clusters', () => {
    const params = { ...DEFAULT_SWIM, suspicionMult: 4, protocolPeriod: 6 };
    const n = new SwimNode(1, [2], params, mulberry32(5), 0); // 2 known members, floored to 10
    n.applyUpdate({ id: 2, state: 'suspect', incarnation: 0 }, 10);
    expect(n.onTick(10 + 23).changes.filter((c) => c.to === 'dead')).toEqual([]);
    expect(n.onTick(10 + 24).changes).toContainEqual({ subject: 2, from: 'suspect', to: 'dead' });
  });

  it('suspicion timeout grows with log10 of the known cluster size', () => {
    const params = { ...DEFAULT_SWIM, suspicionMult: 4, protocolPeriod: 6 };
    const peers = Array.from({ length: 99 }, (_, i) => i + 2); // 100 known members -> log10 = 2
    const n = new SwimNode(1, peers, params, mulberry32(5), 0);
    n.applyUpdate({ id: 2, state: 'suspect', incarnation: 0 }, 10);
    expect(n.onTick(10 + 47).changes.filter((c) => c.to === 'dead')).toEqual([]);
    expect(n.onTick(10 + 48).changes).toContainEqual({ subject: 2, from: 'suspect', to: 'dead' });
  });

  it('default protocol period fits a full probe round (direct + indirect)', () => {
    expect(DEFAULT_SWIM.protocolPeriod).toBeGreaterThanOrEqual(PROBE_DEADLINE);
  });

  it('scales the probe interval by 1 + lhm', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    n.applyUpdate({ id: 1, state: 'suspect', incarnation: 0 }, 0); // refute -> lhm 1
    const t = probeTick(n, 1);
    expect(n.onTick(t).drafts).toEqual([expect.objectContaining({ type: 'ping', to: 2 })]);
    const pingOffsets: number[] = [];
    for (let i = 1; i <= 2 * DEFAULT_SWIM.protocolPeriod; i++) {
      if (n.onTick(t + i).drafts.some((d) => d.type === 'ping')) pingOffsets.push(i);
    }
    expect(pingOffsets).toEqual([2 * DEFAULT_SWIM.protocolPeriod]);
  });

  it('prunes dead entries after deadPruneTicks', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    n.applyUpdate({ id: 2, state: 'dead', incarnation: 1 }, 10);
    n.onTick(10 + DEFAULT_SWIM.deadPruneTicks);
    expect(n.getEntry(2)).toBeUndefined();
  });

  it('probes suspect peers so they can be rescued', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    n.applyUpdate({ id: 2, state: 'suspect', incarnation: 0 }, 0);
    const t = probeTick(n, 1);
    const { drafts } = n.onTick(t);
    expect(drafts).toEqual([expect.objectContaining({ type: 'ping', to: 2 })]);
  });

  it('ping to a suspect target carries the suspicion even after buffer exhaustion', () => {
    const params = { ...DEFAULT_SWIM, piggybackRetransmits: 1 };
    const n = new SwimNode(1, [2], params, mulberry32(5), 0);
    n.applyUpdate({ id: 2, state: 'suspect', incarnation: 0 }, 0);
    const t1 = probeTick(n, 1);
    n.onTick(t1); // first ping consumes the buffered suspicion (retransmits: 1)
    n.onMessage(msg({ type: 'ack', from: 2, to: 1 }), t1 + 1);
    const { drafts } = n.onTick(t1 + params.protocolPeriod);
    const ping = drafts.find((d) => d.type === 'ping');
    expect(ping).toBeDefined();
    expect(ping!.piggyback).toContainEqual({ id: 2, state: 'suspect', incarnation: 0 });
  });

  it('lhm increments when a probe expires without ack', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    for (let i = 0; i <= PROBE_DEADLINE; i++) n.onTick(t + i);
    expect(n.lhm).toBe(1);
  });

  it('lhm decrements on a successful probe', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    for (let i = 0; i <= PROBE_DEADLINE; i++) n.onTick(t + i); // failed probe -> lhm 1
    const t2 = t + 2 * DEFAULT_SWIM.protocolPeriod; // next probe (suspects still probed)
    n.onTick(t2);
    n.onMessage(msg({ type: 'ack', from: 2, to: 1 }), t2 + 1);
    expect(n.lhm).toBe(0);
    n.onMessage(msg({ type: 'ack', from: 2, to: 1 }), t2 + 2); // ack without pending probe
    expect(n.lhm).toBe(0); // clamped at 0
  });

  it('lhm increments when refuting own suspicion', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    n.applyUpdate({ id: 1, state: 'suspect', incarnation: 0 }, 5);
    expect(n.lhm).toBe(1);
    expect(n.incarnation).toBe(1);
  });

  it('lhm clamps so the timeout multiplier 1 + lhm never exceeds lhmMax', () => {
    const params = { ...DEFAULT_SWIM, lhmMax: 3 };
    const n = new SwimNode(1, [2], params, mulberry32(5), 0);
    const t = probeTick(n, 0);
    for (let i = 0; i <= 200; i++) n.onTick(t + i); // repeated failed probes
    expect(n.lhm).toBe(2);
  });

  it('lhmMax 0 disables local health scaling', () => {
    const params = { ...DEFAULT_SWIM, lhmMax: 0 };
    const n = new SwimNode(1, [2], params, mulberry32(5), 0);
    n.applyUpdate({ id: 1, state: 'suspect', incarnation: 0 }, 0);
    const t = probeTick(n, 1);
    for (let i = 0; i <= 50; i++) n.onTick(t + i);
    expect(n.lhm).toBe(0);
  });

  it('scales the probe deadline by 1 + lhm', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    for (let i = 0; i < PROBE_DEADLINE; i++) n.onTick(t + i);
    const t2 = t + DEFAULT_SWIM.protocolPeriod; // first probe expires (lhm -> 1), second starts
    for (let i = 0; i <= PROBE_DEADLINE; i++) n.onTick(t2 + i);
    // base deadline passed, scaled (2x) deadline not yet: probe still pending
    expect(n.detail(t2 + PROBE_DEADLINE).probes).toEqual([expect.objectContaining({ startTick: t2 })]);
    for (let i = PROBE_DEADLINE + 1; i <= 2 * PROBE_DEADLINE; i++) n.onTick(t2 + i);
    // the t2 probe expired at the scaled deadline (a fresh one may already have started)
    expect(n.detail(t2 + 2 * PROBE_DEADLINE).probes.filter((p) => p.startTick === t2)).toEqual([]);
    expect(n.lhm).toBe(2);
  });

  it('scales the indirect-probe escalation deadline by 1 + lhm', () => {
    const n = new SwimNode(1, [2, 3, 4], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    n.onTick(t); // first probe; no acks ever
    const reqTicks: number[] = [];
    for (let i = 1; i <= PROBE_DEADLINE + 2 * ACK_DEADLINE; i++) {
      const { drafts } = n.onTick(t + i);
      if (drafts.some((d) => d.type === 'ping-req')) reqTicks.push(i);
    }
    expect(reqTicks[0]).toBe(ACK_DEADLINE); // first probe escalates at base deadline (lhm 0)
    // second probe starts at t+protocolPeriod... first expiry at t+PROBE_DEADLINE bumps lhm to 1,
    // so the probe pending at that point escalates at 2 * ACK_DEADLINE after its start
    const second = reqTicks[1];
    expect(second).toBeGreaterThan(PROBE_DEADLINE);
  });

  it('arms probe deadlines at probe start; later lhm changes do not move them', () => {
    const n = new SwimNode(1, [2, 3, 4, 5], DEFAULT_SWIM, mulberry32(5), 0);
    n.lhm = 3; // deadlines armed at 4x: escalate at +4*ACK_DEADLINE, suspect at +4*PROBE_DEADLINE
    const t = probeTick(n, 0);
    const target = (n.onTick(t).drafts[0] as { to: number }).to;
    n.lhm = 0; // health recovers mid-probe
    // past both base deadlines: neither ping-req nor suspicion may fire early
    const { drafts, changes } = n.onTick(t + PROBE_DEADLINE + 1);
    expect(drafts.filter((d) => d.type === 'ping-req')).toEqual([]);
    expect(changes).toEqual([]);
    expect(n.detail(t + PROBE_DEADLINE + 1).probes).toEqual([expect.objectContaining({ target, indirectSent: false })]);
    const esc = n.onTick(t + 4 * ACK_DEADLINE);
    expect(esc.drafts.filter((d) => d.type === 'ping-req').length).toBeGreaterThan(0);
  });

  it('sends no ping-req for a target learned dead mid-probe, but still counts the failed probe', () => {
    const n = new SwimNode(1, [2, 3, 4, 5], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    const target = (n.onTick(t).drafts[0] as { to: number }).to;
    n.applyUpdate({ id: target, state: 'dead', incarnation: 0 }, t + 1);
    const { drafts } = n.onTick(t + ACK_DEADLINE);
    expect(drafts.filter((d) => d.type === 'ping-req')).toEqual([]);
    for (let i = ACK_DEADLINE + 1; i <= PROBE_DEADLINE; i++) n.onTick(t + i);
    expect(n.detail(t + PROBE_DEADLINE).probes.filter((p) => p.target === target)).toEqual([]);
    expect(n.lhm).toBe(1); // unanswered probe still raises LHM
  });

  it('never skips a probe round while some peer has no probe pending', () => {
    // period 2 < PROBE_DEADLINE: probes overlap, so the queue head is often already pending
    const params = { ...DEFAULT_SWIM, protocolPeriod: 2, lhmMax: 0 };
    for (let seed = 1; seed <= 20; seed++) {
      const n = new SwimNode(1, [2, 3, 4, 5, 6], params, mulberry32(seed), 0);
      for (let tick = 0; tick <= 60; tick++) {
        const { drafts } = n.onTick(tick);
        if ((tick - n.phaseOffset) % params.protocolPeriod !== 0 || tick < n.phaseOffset) continue;
        if (drafts.some((d) => d.type === 'ping')) continue;
        // no ping this round: only allowed when every non-dead peer is already being probed
        const pending = new Set(n.detail(tick).probes.map((p) => p.target));
        const free = n.tableEntries().filter((e) => e.state !== 'dead' && !pending.has(e.id));
        expect(free, `seed ${seed} tick ${tick}`).toEqual([]);
      }
    }
  });

  it('scales the suspicion timeout by 1 + lhm', () => {
    const params = { ...DEFAULT_SWIM, suspicionMult: 4, protocolPeriod: 6 }; // base 24 ticks
    const n = new SwimNode(1, [2], params, mulberry32(5), 0);
    n.applyUpdate({ id: 1, state: 'suspect', incarnation: 0 }, 5); // refute -> lhm 1
    n.applyUpdate({ id: 2, state: 'suspect', incarnation: 0 }, 10);
    // past the base timeout, before the scaled (2x) one
    const early = n.onTick(10 + 2 * 24 - 1);
    expect(early.changes.filter((c) => c.to === 'dead')).toEqual([]);
    const late = n.onTick(10 + 2 * 24);
    expect(late.changes).toContainEqual({ subject: 2, from: 'suspect', to: 'dead' });
  });

  it('round-robin covers every alive peer before repeating', () => {
    const peers = [2, 3, 4, 5];
    const n = new SwimNode(1, peers, DEFAULT_SWIM, mulberry32(5), 0);
    const targets: number[] = [];
    let t = probeTick(n, 0);
    for (let i = 0; i < peers.length; i++) {
      for (const d of n.onTick(t).drafts) if (d.type === 'ping') targets.push(d.to);
      // resolve immediately so overlapping-probe skip logic never blocks
      n.onMessage(msg({ type: 'ack', from: targets[targets.length - 1], to: 1 }), t + 2);
      t += DEFAULT_SWIM.protocolPeriod;
    }
    expect([...targets].sort((a, b) => a - b)).toEqual(peers);
  });
});

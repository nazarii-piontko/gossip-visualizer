import { describe, it, expect } from 'vitest';
import { Simulator } from './simulator';

const mk = (over = {}) => new Simulator({ seed: 42, nodeCount: 8, ...over });

describe('Simulator', () => {
  it('creates nodeCount nodes with ids 0..n-1', () => {
    const sim = mk();
    expect(sim.runningNodes().map((n) => n.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('messages take exactly one tick to deliver', () => {
    const sim = mk();
    // run until something is sent, then verify it is delivered exactly next tick
    let report = sim.tick();
    while (report.packets.length === 0) report = sim.tick();
    const sent = report.packets.filter((p) => !p.willDrop).map((p) => p.msgId);
    expect(sent.length).toBeGreaterThan(0);
    const next = sim.tick();
    const delivered = next.events
      .filter((e) => e.kind === 'delivered')
      .map((e) => (e as { msg: { id: number } }).msg.id);
    for (const id of sent) expect(delivered).toContain(id);
  });

  it('is deterministic: same seed, same reports', () => {
    const a = mk();
    const b = mk();
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(a.tick())).toBe(JSON.stringify(b.tick()));
    }
  });

  it('global failure rate 1 drops every message', () => {
    const sim = mk({ globalFailureRate: 1 });
    for (let i = 0; i < 20; i++) {
      const r = sim.tick();
      expect(r.packets.every((p) => p.willDrop)).toBe(true);
      expect(r.events.filter((e) => e.kind === 'delivered')).toEqual([]);
    }
  });

  it('killNode stops the node and emits killed event', () => {
    const sim = mk();
    sim.killNode(3);
    const r = sim.tick();
    expect(r.events).toContainEqual({ kind: 'killed', nodeId: 3 });
    expect(sim.groundTruth().get(3)).toBe('killed');
    // killed node never sends
    for (let i = 0; i < 20; i++) {
      expect(sim.tick().packets.every((p) => p.from !== 3)).toBe(true);
    }
  });

  it('removeNode broadcasts leave and drops from ground truth', () => {
    const sim = mk();
    for (let i = 0; i < 40; i++) sim.tick(); // let views converge a bit
    sim.removeNode(2);
    const r = sim.tick();
    expect(r.events).toContainEqual({ kind: 'left', nodeId: 2 });
    expect(r.packets.some((p) => p.type === 'leave' && p.from === 2)).toBe(true);
    expect(sim.groundTruth().has(2)).toBe(false);
  });

  it('addNode joins with seeds and emits joined event', () => {
    const sim = mk();
    const id = sim.addNode();
    expect(id).toBe(8);
    const r = sim.tick();
    expect(r.events).toContainEqual({ kind: 'joined', nodeId: 8 });
    expect(sim.getNodeDetail(8)!.table.length).toBeGreaterThan(0);
  });

  it('getNodeDetail exposes failure rates and running flag', () => {
    const sim = mk();
    sim.setNodeFailureRate(1, { in: 0.5, out: 0.25 });
    const d = sim.getNodeDetail(1)!;
    expect(d.failureIn).toBe(0.5);
    expect(d.failureOut).toBe(0.25);
    expect(d.running).toBe(true);
    sim.killNode(1);
    expect(sim.getNodeDetail(1)!.running).toBe(false);
    expect(sim.getNodeDetail(999)).toBeNull();
  });

  it('updateSwimParams applies from next tick', () => {
    const sim = mk();
    sim.updateSwimParams({ protocolPeriod: 8 });
    expect(sim.params.protocolPeriod).toBe(8);
  });

  it('leave messages are actually delivered to peers', () => {
    const sim = mk();
    for (let i = 0; i < 40; i++) sim.tick();
    sim.removeNode(2);
    let delivered = false;
    for (let t = 0; t < 5 && !delivered; t++) {
      delivered = sim.tick().events.some(
        (e) => e.kind === 'delivered' && (e as { msg: { type: string; from: number } }).msg.type === 'leave' && (e as { msg: { from: number } }).msg.from === 2,
      );
    }
    expect(delivered).toBe(true);
  });
});

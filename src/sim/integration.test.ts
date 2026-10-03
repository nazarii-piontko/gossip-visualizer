import { describe, it, expect } from 'vitest';
import { Simulator } from './simulator';
import type { TickReport } from './types';

const run = (sim: Simulator, ticks: number): TickReport => {
  let r!: TickReport;
  for (let i = 0; i < ticks; i++) r = sim.tick();
  return r;
};

describe('protocol integration', () => {
  it('determinism over 500 ticks with mid-run actions', () => {
    const script = (sim: Simulator) => {
      const out: string[] = [];
      for (let t = 1; t <= 500; t++) {
        if (t === 50) sim.addNode();
        if (t === 100) sim.killNode(2);
        if (t === 200) sim.removeNode(5);
        if (t === 250) sim.setGlobalFailureRate(0.2);
        if (t === 350) sim.setGlobalFailureRate(0);
        out.push(JSON.stringify(sim.tick()));
      }
      return out.join('\n');
    };
    expect(script(new Simulator({ seed: 7, nodeCount: 12 })))
      .toBe(script(new Simulator({ seed: 7, nodeCount: 12 })));
  });

  it('converges to 100% with no failures (N=20)', () => {
    const sim = new Simulator({ seed: 42, nodeCount: 20 });
    let converged = false;
    for (let t = 0; t < 300 && !converged; t++) converged = sim.tick().snapshot.convergence === 1;
    expect(converged).toBe(true);
  });

  it('never issues false positives with zero failures', () => {
    const sim = new Simulator({ seed: 13, nodeCount: 15 });
    for (let t = 0; t < 400; t++) {
      const r = sim.tick();
      const suspicions = r.events.filter((e) => e.kind === 'state-change' && e.to === 'suspect');
      expect(suspicions).toEqual([]);
    }
  });

  it('detects a killed node cluster-wide within a bounded time', () => {
    const sim = new Simulator({ seed: 42, nodeCount: 12 });
    run(sim, 100); // converge
    sim.killNode(4);
    let latency: number | null = null;
    for (let t = 0; t < 120 && latency === null; t++) {
      latency = sim.tick().snapshot.lastDetectionLatency;
    }
    expect(latency).not.toBeNull();
    // period(6) + probe deadline(6) + suspicion timeout(⌈4·log10(12)·6⌉ = 26) + dissemination slack
    expect(latency!).toBeLessThanOrEqual(80);
  });

  it('isolated node is declared dead; healing revives it via refutation', () => {
    const sim = new Simulator({ seed: 42, nodeCount: 10 });
    run(sim, 100);
    sim.setNodeFailureRate(3, { in: 1, out: 1 });
    let dead = false;
    for (let t = 0; t < 200 && !dead; t++) {
      dead = sim.tick().snapshot.perceived[3] === 'dead';
    }
    expect(dead).toBe(true);

    sim.setNodeFailureRate(3, { in: 0, out: 0 });
    let revived = false;
    for (let t = 0; t < 400 && !revived; t++) {
      revived = sim.tick().snapshot.perceived[3] === 'alive';
    }
    expect(revived).toBe(true);
    expect(sim.getNodeDetail(3)!.incarnation).toBeGreaterThan(0);
  });

  it('manual rejoin recovers full convergence after a long isolation (tables pruned on both sides)', () => {
    const sim = new Simulator({ seed: 42, nodeCount: 10 });
    run(sim, 100);
    sim.setNodeFailureRate(3, { in: 1, out: 1 });
    // LHM inflates the isolated node's timeouts ~9x, so mutual dead + prune
    // in both directions takes far longer than the pre-LHM 120 ticks
    run(sim, 600);
    sim.setNodeFailureRate(3, { in: 0, out: 0 });
    run(sim, 50); // healing alone cannot fix a full split — node 3 is orphaned
    expect(sim.getNodeDetail(3)!.table).toEqual([]);
    sim.rejoinNode(3);
    let converged = false;
    for (let t = 0; t < 400 && !converged; t++) {
      converged = sim.tick().snapshot.convergence === 1;
    }
    expect(converged).toBe(true);
  });

  it('isolated node issues no dead verdicts and the cluster reconverges after heal (LHM)', () => {
    const sim = new Simulator({ seed: 42, nodeCount: 8 });
    run(sim, 60);
    sim.setNodeFailureRate(0, { in: 1, out: 1 });
    let converged = false;
    for (let t = 0; t < 230; t++) {
      const r = sim.tick();
      if (t === 30) sim.setNodeFailureRate(0, { in: 0, out: 0 });
      // LHM: the isolated node's timeouts inflate, so it never reaches a dead verdict while
      // isolated. (After the heal its LHM shrinks again, and a suspicion it raised while cut
      // off can still expire before the suspect hears of it: a transient false dead that
      // refutation repairs, hence the convergence check below.)
      if (t <= 30) {
        const deadVerdictsByIsolated = r.events.filter((e) =>
          e.kind === 'state-change' && e.nodeId === 0 && e.to === 'dead');
        expect(deadVerdictsByIsolated).toEqual([]);
      }
      if (t > 30) converged = r.snapshot.convergence === 1;
    }
    expect(converged).toBe(true);
  });

  it('graceful leave skips the suspect phase', () => {
    const sim = new Simulator({ seed: 42, nodeCount: 10 });
    run(sim, 100);
    sim.removeNode(6);
    for (let t = 0; t < 100; t++) {
      const r = sim.tick();
      const suspected6 = r.events.some((e) => e.kind === 'state-change' && e.subject === 6 && e.to === 'suspect');
      expect(suspected6).toBe(false);
    }
  });

  it('single-node cluster ticks without crashing', () => {
    const sim = new Simulator({ seed: 1, nodeCount: 1 });
    expect(() => run(sim, 50)).not.toThrow();
  });
});

import { useSyncExternalStore } from 'react';
import { Simulator } from '../sim/simulator';
import type { NodeDetail, NodeId, SwimParams, TickReport } from '../sim/types';

export interface SimState {
  report: TickReport;
  running: boolean;
  tickMs: number;
  seed: number;
  nodeCount: number;
  convergenceHistory: number[];
  params: SwimParams;
  globalFailureRate: number;
}

const clampTickMs = (ms: number) => Math.min(5000, Math.max(200, ms));

/**
 * Bridge between the pure Simulator and React. Owns the play/pause interval
 * timer and exposes immutable state snapshots through the external-store
 * contract (subscribe/getState) consumed by useSyncExternalStore.
 */
export class SimController {
  private sim: Simulator;
  private state: SimState;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private globalFailureRate = 0;

  constructor(seed = 1, nodeCount = 12) {
    this.sim = new Simulator({ seed, nodeCount });
    this.state = this.freshState(this.sim.tick(), seed, nodeCount, false, 2000, []);
  }

  getState = (): SimState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  play(): void {
    if (this.state.running) return;
    this.startTimer(this.state.tickMs);
    this.setState({ running: true });
  }

  pause(): void {
    this.stopTimer();
    if (this.state.running) this.setState({ running: false });
  }

  step(): void {
    if (this.state.running) return;
    this.advance();
  }

  setTickMs(ms: number): void {
    const tickMs = clampTickMs(ms);
    if (this.state.running) this.startTimer(tickMs);
    this.setState({ tickMs });
  }

  restart(seed: number, nodeCount: number): void {
    this.stopTimer();
    this.sim = new Simulator({ seed, nodeCount });
    this.globalFailureRate = 0;
    this.state = this.freshState(this.sim.tick(), seed, nodeCount, false, this.state.tickMs, []);
    this.emit();
  }

  addNode(): void {
    this.sim.addNode();
    this.setState({ report: this.refreshedReport() });
  }

  removeNode(id: NodeId): void {
    this.sim.removeNode(id);
    this.setState({ report: this.refreshedReport() });
  }

  killNode(id: NodeId): void {
    this.sim.killNode(id);
    this.setState({ report: this.refreshedReport() });
  }

  rejoinNode(id: NodeId): void {
    this.sim.rejoinNode(id);
    this.setState({ report: this.refreshedReport() });
  }

  setGlobalFailureRate(p: number): void {
    this.globalFailureRate = p;
    this.sim.setGlobalFailureRate(p);
    this.setState({ globalFailureRate: p, report: this.refreshedReport() });
  }

  setNodeFailureRate(id: NodeId, rates: { in: number; out: number }): void {
    this.sim.setNodeFailureRate(id, rates);
    this.setState({ report: this.refreshedReport() });
  }

  updateSwimParams(p: Partial<SwimParams>): void {
    this.sim.updateSwimParams(p);
    this.setState({ params: { ...this.sim.params } });
  }

  getNodeDetail(id: NodeId): NodeDetail | null {
    return this.sim.getNodeDetail(id);
  }

  dispose(): void {
    this.stopTimer();
  }

  private advance(): void {
    const report = this.sim.tick();
    const history = [...this.state.convergenceHistory, report.snapshot.convergence].slice(-100);
    this.setState({ report, convergenceHistory: history });
  }

  /** Current report with its snapshot rebuilt, so operator actions show up immediately
   *  (even while paused). Tick, events and packets stay as-is: nothing re-animates. */
  private refreshedReport(): TickReport {
    return { ...this.state.report, snapshot: this.sim.snapshot() };
  }

  private startTimer(tickMs: number): void {
    this.stopTimer();
    this.timer = setInterval(() => this.advance(), tickMs);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private freshState(
    report: TickReport, seed: number, nodeCount: number,
    running: boolean, tickMs: number, history: number[],
  ): SimState {
    return {
      report, running, tickMs, seed, nodeCount,
      convergenceHistory: [...history, report.snapshot.convergence].slice(-100),
      params: { ...this.sim.params },
      globalFailureRate: this.globalFailureRate,
    };
  }

  private setState(partial: Partial<SimState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private emit(): void {
    this.state = { ...this.state };
    for (const l of this.listeners) l();
  }
}

export function useSimulation(controller: SimController): SimState {
  return useSyncExternalStore(controller.subscribe, controller.getState);
}

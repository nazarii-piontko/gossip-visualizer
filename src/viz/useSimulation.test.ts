// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimController } from './useSimulation';

describe('SimController', () => {
  afterEach(() => vi.useRealTimers());

  it('starts paused with one initial report', () => {
    const c = new SimController(1, 12);
    expect(c.getState().running).toBe(false);
    expect(c.getState().report.tick).toBe(1);
    c.dispose();
  });

  it('step advances one tick and notifies subscribers', () => {
    const c = new SimController(1, 12);
    const spy = vi.fn();
    c.subscribe(spy);
    c.step();
    expect(c.getState().report.tick).toBe(2);
    expect(spy).toHaveBeenCalledOnce();
    c.dispose();
  });

  it('play ticks on the interval; pause stops it', () => {
    vi.useFakeTimers();
    const c = new SimController(1, 12);
    c.setTickMs(1000);
    c.play();
    vi.advanceTimersByTime(3000);
    expect(c.getState().report.tick).toBe(4); // 1 initial + 3
    c.pause();
    vi.advanceTimersByTime(3000);
    expect(c.getState().report.tick).toBe(4);
    c.dispose();
  });

  it('step is ignored while running', () => {
    vi.useFakeTimers();
    const c = new SimController(1, 12);
    c.play();
    const before = c.getState().report.tick;
    c.step();
    expect(c.getState().report.tick).toBe(before);
    c.dispose();
  });

  it('restart swaps in a fresh simulator', () => {
    const c = new SimController(1, 12);
    c.step();
    c.restart(99, 5);
    const s = c.getState();
    expect(s.report.tick).toBe(1);
    expect(s.seed).toBe(99);
    expect(Object.keys(s.report.snapshot.groundTruth)).toHaveLength(5);
    c.dispose();
  });

  it('tracks convergence history capped at 100', () => {
    const c = new SimController(1, 5);
    for (let i = 0; i < 150; i++) c.step();
    expect(c.getState().convergenceHistory.length).toBe(100);
    c.dispose();
  });

  it('operator actions refresh the snapshot without advancing the tick', () => {
    const c = new SimController(1, 5);
    const tick = c.getState().report.tick;
    const packets = c.getState().report.packets;
    c.addNode();
    expect(Object.keys(c.getState().report.snapshot.groundTruth)).toHaveLength(6);
    c.killNode(0);
    expect(c.getState().report.snapshot.groundTruth[0]).toBe('killed');
    c.setNodeFailureRate(1, { in: 0.5, out: 0 });
    expect(c.getState().report.snapshot.failureRates[1]).toEqual({ in: 0.5, out: 0 });
    c.setGlobalFailureRate(0.3);
    expect(c.getState().report.snapshot.globalFailureRate).toBe(0.3);
    c.removeNode(2);
    expect(c.getState().report.snapshot.groundTruth[2]).toBeUndefined();
    expect(c.getState().report.tick).toBe(tick);
    expect(c.getState().report.packets).toBe(packets); // same tick: nothing re-animates
    expect(c.getState().convergenceHistory).toHaveLength(1);
    c.dispose();
  });

  it('getState reference is stable until a mutation', () => {
    const c = new SimController(1, 5);
    const a = c.getState();
    expect(c.getState()).toBe(a);
    c.step();
    expect(c.getState()).not.toBe(a);
    c.dispose();
  });
});

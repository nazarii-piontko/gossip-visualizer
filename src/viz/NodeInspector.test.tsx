// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeInspector } from './NodeInspector';
import type { GlobalSnapshot, NodeDetail } from '../sim/types';

const detail = (over: Partial<NodeDetail> = {}): NodeDetail => ({
  id: 1, running: true, incarnation: 2, lhm: 3, phaseOffset: 3,
  failureIn: 0, failureOut: 0,
  table: [
    { id: 0, state: 'alive', incarnation: 0, lastUpdateTick: 90 },
    { id: 2, state: 'alive', incarnation: 0, lastUpdateTick: 80 }, // ground truth: killed -> mismatch
    { id: 3, state: 'suspect', incarnation: 1, lastUpdateTick: 95 }, // running -> mismatch (false positive)
  ],
  probes: [{ target: 0, startTick: 99, indirectSent: false }],
  counters: { sent: { ping: 5 }, received: { ack: 4 }, droppedOutbound: 1, falseSuspicions: 1, refutations: 0 },
  ...over,
});

const snapshot: GlobalSnapshot = {
  tick: 100,
  groundTruth: { 0: 'running', 1: 'running', 2: 'killed', 3: 'running' },
  perceived: { 0: 'alive', 1: 'alive', 2: 'alive', 3: 'alive' },
  aliveCount: 4, suspectCount: 0, deadCount: 0, convergence: 0.8,
  messagesThisTick: 0, totalMessages: 100, totalDropped: 3,
  lastDetectionLatency: null, failureRates: {}, globalFailureRate: 0,
  opinions: {},
  dissent: {
    1: [
      { viewer: 0, state: 'suspect' },
      { viewer: 3, state: 'dead' },
      { viewer: 4, state: 'unknown' },
    ],
  },
};

describe('NodeInspector', () => {
  it('shows identity and incarnation', () => {
    render(<NodeInspector detail={detail()} snapshot={snapshot} onClose={() => {}}
      onSetFailureRate={() => {}} onKill={() => {}} onRemove={() => {}} onRejoin={() => {}} />);
    expect(screen.getByText(/Node 1/)).toBeTruthy();
    expect(screen.getByText(/incarnation/i).nextElementSibling?.textContent).toBe('2');
  });

  it('shows the local health multiplier', () => {
    render(<NodeInspector detail={detail()} snapshot={snapshot} onClose={() => {}}
      onSetFailureRate={() => {}} onKill={() => {}} onRemove={() => {}} onRejoin={() => {}} />);
    expect(screen.getByText(/local health/i).nextElementSibling?.textContent).toBe('3');
  });

  it('marks rows that disagree with ground truth', () => {
    render(<NodeInspector detail={detail()} snapshot={snapshot} onClose={() => {}}
      onSetFailureRate={() => {}} onKill={() => {}} onRemove={() => {}} onRejoin={() => {}} />);
    const rows = screen.getAllByTestId('member-row');
    expect(rows[0].getAttribute('class') ?? '').not.toContain('mismatch'); // 0 alive, running
    expect(rows[1].getAttribute('class')).toContain('mismatch');           // 2 alive, killed
    expect(rows[2].getAttribute('class')).toContain('mismatch');           // 3 suspect, running
  });

  it('isolate button sets both rates to 1', () => {
    const onSet = vi.fn();
    render(<NodeInspector detail={detail()} snapshot={snapshot} onClose={() => {}}
      onSetFailureRate={onSet} onKill={() => {}} onRemove={() => {}} onRejoin={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /isolate/i }));
    expect(onSet).toHaveBeenCalledWith(1, { in: 1, out: 1 });
  });

  it('rejoin button dispatches with node id', () => {
    const onRejoin = vi.fn();
    render(<NodeInspector detail={detail({ table: [] })} snapshot={snapshot} onClose={() => {}}
      onSetFailureRate={() => {}} onKill={() => {}} onRemove={() => {}} onRejoin={onRejoin} />);
    fireEvent.click(screen.getByRole('button', { name: /rejoin/i }));
    expect(onRejoin).toHaveBeenCalledWith(1);
  });

  it('lists nodes that suspect, see dead, or do not know this node', () => {
    render(<NodeInspector detail={detail()} snapshot={snapshot} onClose={() => {}}
      onSetFailureRate={() => {}} onKill={() => {}} onRemove={() => {}} onRejoin={() => {}} />);
    const rows = screen.getAllByTestId('dissent-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('0');
    expect(rows[0].textContent).toContain('suspect');
    expect(rows[1].textContent).toContain('3');
    expect(rows[1].textContent).toContain('dead');
    expect(rows[2].textContent).toContain('4');
    expect(rows[2].textContent).toContain('unknown');
  });

  it('shows none when every other node sees this node alive', () => {
    render(<NodeInspector detail={detail()} snapshot={{ ...snapshot, dissent: {} }} onClose={() => {}}
      onSetFailureRate={() => {}} onKill={() => {}} onRemove={() => {}} onRejoin={() => {}} />);
    expect(screen.queryAllByTestId('dissent-row')).toHaveLength(0);
  });

  it('kill and leave dispatch with node id', () => {
    const onKill = vi.fn();
    const onRemove = vi.fn();
    render(<NodeInspector detail={detail()} snapshot={snapshot} onClose={() => {}}
      onSetFailureRate={() => {}} onKill={onKill} onRemove={onRemove} onRejoin={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^kill$/i }));
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(onKill).toHaveBeenCalledWith(1);
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});

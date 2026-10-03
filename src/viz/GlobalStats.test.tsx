// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GlobalStats, sparklinePoints } from './GlobalStats';
import type { GlobalSnapshot } from '../sim/types';

const snapshot: GlobalSnapshot = {
  tick: 42, groundTruth: {}, perceived: {},
  aliveCount: 10, suspectCount: 1, deadCount: 2,
  convergence: 0.876,
  messagesThisTick: 7, totalMessages: 500, totalDropped: 12,
  lastDetectionLatency: 18, failureRates: {}, globalFailureRate: 0.1,
  opinions: {},
  dissent: {},
};

describe('GlobalStats', () => {
  it('renders the headline numbers', () => {
    render(<GlobalStats snapshot={snapshot} history={[0.5, 0.876]} />);
    expect(screen.getByText('42')).toBeTruthy();          // tick
    expect(screen.getByText('87.6%')).toBeTruthy();       // convergence
    expect(screen.getByText('18')).toBeTruthy();          // detection latency
    expect(screen.getByText('10')).toBeTruthy();          // alive
  });

  it('shows dash when no detection has happened', () => {
    render(<GlobalStats snapshot={{ ...snapshot, lastDetectionLatency: null }} history={[]} />);
    expect(screen.getByTestId('latency').textContent).toBe('—');
  });
});

describe('sparklinePoints', () => {
  it('spreads points over the width and inverts y', () => {
    expect(sparklinePoints([0, 1], 100, 20)).toBe('0,20 100,0');
  });

  it('handles a single sample as a flat line', () => {
    expect(sparklinePoints([0.5], 100, 20)).toBe('0,10 100,10');
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Ring } from './Ring';
import type { GlobalSnapshot } from '../sim/types';

const snapshot = (over: Partial<GlobalSnapshot> = {}): GlobalSnapshot => ({
  tick: 1,
  groundTruth: { 0: 'running', 1: 'running', 2: 'killed' },
  perceived: { 0: 'alive', 1: 'suspect', 2: 'alive' },
  aliveCount: 2, suspectCount: 1, deadCount: 0,
  convergence: 0.9,
  messagesThisTick: 0, totalMessages: 0, totalDropped: 0,
  lastDetectionLatency: null,
  failureRates: { 1: { in: 0.5, out: 0 } },
  globalFailureRate: 0,
  opinions: {
    0: { alive: 1, suspect: 0, dead: 0, unknown: 0 },
    1: { alive: 0, suspect: 1, dead: 0, unknown: 0 },
    2: { alive: 1, suspect: 0, dead: 0, unknown: 0 },
  },
  dissent: {},
  ...over,
});

describe('Ring', () => {
  it('renders one node per ground-truth entry', () => {
    render(<svg><Ring snapshot={snapshot()} selected={null} onSelect={() => {}} /></svg>);
    expect(screen.getAllByTestId('node')).toHaveLength(3);
  });

  it('applies perceived state as class and skull for undetected kill', () => {
    render(<svg><Ring snapshot={snapshot()} selected={null} onSelect={() => {}} /></svg>);
    const nodes = screen.getAllByTestId('node');
    expect(nodes[1].getAttribute('class')).toContain('suspect');
    expect(nodes[2].getAttribute('class')).toContain('killed-undetected');
  });

  it('click selects a node', () => {
    const onSelect = vi.fn();
    render(<svg><Ring snapshot={snapshot()} selected={null} onSelect={onSelect} /></svg>);
    fireEvent.click(screen.getAllByTestId('node')[0]);
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('renders with circles and labels', () => {
    render(<svg><Ring snapshot={snapshot()} selected={null} onSelect={() => {}} /></svg>);
    const nodes = screen.getAllByTestId('node');
    // Each node should have at least a circle and text element
    nodes.forEach((node) => {
      const circles = node.querySelectorAll('circle');
      const texts = node.querySelectorAll('text');
      expect(circles.length).toBeGreaterThan(0); // node-body circle
      expect(texts.length).toBeGreaterThan(0); // id label
    });
  });

  it('renders a 4-segment opinion donut for a split node', () => {
    render(
      <svg>
        <Ring
          snapshot={snapshot({
            opinions: {
              0: { alive: 0.5, suspect: 0.25, dead: 0.15, unknown: 0.1 },
              1: { alive: 0, suspect: 1, dead: 0, unknown: 0 },
              2: { alive: 1, suspect: 0, dead: 0, unknown: 0 },
            },
          })}
          selected={null}
          onSelect={() => {}}
        />
      </svg>,
    );
    const nodes = screen.getAllByTestId('node');
    const segs = nodes[0].querySelectorAll('[data-testid="opinion-seg"]');
    expect(segs).toHaveLength(4);
    const classes = [...segs].map((s) => s.getAttribute('class'));
    expect(classes.some((c) => c?.includes('alive'))).toBe(true);
    expect(classes.some((c) => c?.includes('suspect'))).toBe(true);
    expect(classes.some((c) => c?.includes('dead'))).toBe(true);
    expect(classes.some((c) => c?.includes('unknown'))).toBe(true);
  });

  it('renders exactly 1 segment for an all-alive node', () => {
    render(
      <svg>
        <Ring
          snapshot={snapshot({
            opinions: {
              0: { alive: 1, suspect: 0, dead: 0, unknown: 0 },
              1: { alive: 0, suspect: 1, dead: 0, unknown: 0 },
              2: { alive: 1, suspect: 0, dead: 0, unknown: 0 },
            },
          })}
          selected={null}
          onSelect={() => {}}
        />
      </svg>,
    );
    const nodes = screen.getAllByTestId('node');
    const segs = nodes[0].querySelectorAll('[data-testid="opinion-seg"]');
    expect(segs).toHaveLength(1);
    expect(segs[0].getAttribute('class')).toContain('alive');
  });
});

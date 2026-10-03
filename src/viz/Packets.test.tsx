// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Packets } from './Packets';
import { arcPath, nodePositions } from './layout';
import type { PacketInfo } from '../sim/types';

const pkt = (over: Partial<PacketInfo> = {}): PacketInfo => ({
  msgId: 1, from: 0, to: 1, type: 'ping', willDrop: false, piggybackCount: 2, ...over,
});

describe('Packets', () => {
  it('renders one packet per PacketInfo with type class', () => {
    render(
      <svg>
        <Packets packets={[pkt(), pkt({ msgId: 2, type: 'ack', from: 1, to: 0 })]} ids={[0, 1, 2]} tick={5} tickMs={2000} />
      </svg>,
    );
    const packets = screen.getAllByTestId('packet');
    expect(packets).toHaveLength(2);
    expect(packets[0].getAttribute('class')).toContain('ping');
    expect(packets[1].getAttribute('class')).toContain('ack');
  });

  it('skips packets touching a node off the ring without shifting the others', () => {
    // node 5 has left: its leave packet must not reslot the ring for the rest
    const { container } = render(
      <svg>
        <Packets packets={[pkt(), pkt({ msgId: 2, type: 'leave', from: 5, to: 0 })]} ids={[0, 1]} tick={5} tickMs={2000} />
      </svg>,
    );
    expect(screen.getAllByTestId('packet')).toHaveLength(1);
    const pos = nodePositions([0, 1]);
    expect(container.querySelector('animateMotion')!.getAttribute('path')).toBe(arcPath(pos.get(0)!, pos.get(1)!));
  });

  it('drop packets animate to 60% and fade', () => {
    const { container } = render(
      <svg><Packets packets={[pkt({ willDrop: true })]} ids={[0, 1]} tick={5} tickMs={2000} /></svg>,
    );
    const motion = container.querySelector('animateMotion')!;
    expect(motion.getAttribute('keyPoints')).toBe('0;0.6');
    expect(container.querySelector('animate[attributeName="opacity"]')).not.toBeNull();
  });

  it('sets duration from tickMs', () => {
    const { container } = render(
      <svg><Packets packets={[pkt()]} ids={[0, 1]} tick={5} tickMs={750} /></svg>,
    );
    expect(container.querySelector('animateMotion')!.getAttribute('dur')).toBe('750ms');
  });

  it('animateMotion elements have begin="indefinite" for timing control', () => {
    const { container } = render(
      <svg><Packets packets={[pkt(), pkt({ msgId: 2, willDrop: true })]} ids={[0, 1]} tick={5} tickMs={2000} /></svg>,
    );
    const motions = container.querySelectorAll('animateMotion');
    expect(motions.length).toBeGreaterThan(0);
    motions.forEach((motion) => {
      expect(motion.getAttribute('begin')).toBe('indefinite');
    });
  });

  it('renders a letter glyph for a ping packet', () => {
    render(
      <svg><Packets packets={[pkt({ type: 'ping' })]} ids={[0, 1]} tick={5} tickMs={2000} /></svg>,
    );
    expect(screen.getByText('P')).toBeTruthy();
  });

  it('renders a letter glyph for an ack packet', () => {
    render(
      <svg><Packets packets={[pkt({ type: 'ack' })]} ids={[0, 1]} tick={5} tickMs={2000} /></svg>,
    );
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('scales the dot radius from piggyback count with the larger base', () => {
    const { container } = render(
      <svg><Packets packets={[pkt({ piggybackCount: 4 })]} ids={[0, 1]} tick={5} tickMs={2000} /></svg>,
    );
    const circle = container.querySelector('circle')!;
    expect(circle.getAttribute('r')).toBe(String(5 + 4 * 0.5));
  });
});

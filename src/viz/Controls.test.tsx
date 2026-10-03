// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Controls } from './Controls';
import { DEFAULT_SWIM } from '../sim/types';
import type { SimState } from './useSimulation';

const state = {
  running: false, tickMs: 2000, seed: 1, nodeCount: 12, globalFailureRate: 0,
  params: { ...DEFAULT_SWIM },
} as unknown as SimState;

const renderControls = (onParams = vi.fn(), onRestart = vi.fn()) => {
  const noop = () => {};
  render(<Controls state={state} onPlay={noop} onPause={noop} onStep={noop} onTickMs={noop}
    onRestart={onRestart} onAddNode={noop} onGlobalFailureRate={noop} onParams={onParams} />);
  return onParams;
};

/** Type a value and leave the field, which is when it commits. */
const enter = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe('Controls SWIM params', () => {
  it.each(['lhmMax', 'indirectProbes'])('accepts 0 for %s', (key) => {
    const onParams = renderControls();
    enter(key, '0');
    expect(onParams).toHaveBeenCalledWith({ [key]: 0 });
  });

  it('clamps protocolPeriod to its minimum of 1', () => {
    const onParams = renderControls();
    enter('protocolPeriod', '0');
    expect(onParams).toHaveBeenCalledWith({ protocolPeriod: 1 });
  });

  it('does not apply while typing, only on blur', () => {
    const onParams = renderControls();
    const input = screen.getByLabelText('protocolPeriod');
    fireEvent.change(input, { target: { value: '1' } });
    expect(onParams).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.blur(input);
    expect(onParams).toHaveBeenCalledTimes(1);
    expect(onParams).toHaveBeenCalledWith({ protocolPeriod: 10 });
  });

  it('applies on Enter', () => {
    const onParams = renderControls();
    const input = screen.getByLabelText('maxPiggyback');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onParams).toHaveBeenCalledWith({ maxPiggyback: 9 });
  });

  it('rounds fractional values to integers', () => {
    const onParams = renderControls();
    enter('indirectProbes', '4.6');
    expect(onParams).toHaveBeenCalledWith({ indirectProbes: 5 });
  });

  it('reverts an empty field instead of applying it', () => {
    const onParams = renderControls();
    enter('protocolPeriod', '');
    expect(onParams).not.toHaveBeenCalled();
    expect((screen.getByLabelText('protocolPeriod') as HTMLInputElement).value).toBe(String(DEFAULT_SWIM.protocolPeriod));
  });

  it('exposes suspicionMult instead of a fixed suspect timeout', () => {
    renderControls();
    expect(screen.getByLabelText('suspicionMult')).toBeTruthy();
    expect(screen.queryByLabelText('suspectTimeout')).toBeNull();
  });
});

describe('Controls restart inputs', () => {
  it('clamps node count to 1..50 and ignores an empty seed', () => {
    const onRestart = vi.fn();
    renderControls(vi.fn(), onRestart);
    enter('nodes', '500');
    enter('seed', '');
    fireEvent.click(screen.getByText('Restart'));
    expect(onRestart).toHaveBeenCalledWith(1, 50);
  });

  it('never restarts with a zero-node cluster', () => {
    const onRestart = vi.fn();
    renderControls(vi.fn(), onRestart);
    enter('nodes', '0');
    fireEvent.click(screen.getByText('Restart'));
    expect(onRestart).toHaveBeenCalledWith(1, 1);
  });
});

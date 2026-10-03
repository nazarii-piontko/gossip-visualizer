// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Legend } from './Legend';

describe('Legend', () => {
  it('explains node states, markers and packet types', () => {
    const { container } = render(<Legend />);
    expect(screen.getByText('Legend')).toBeTruthy();
    for (const label of ['alive', 'suspect', 'dead', 'unknown', 'ping', 'ack', 'ping-req', 'leave']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText(/killed, not yet detected/)).toBeTruthy();
    expect(container.querySelector('details')?.open).toBe(true);
  });
});

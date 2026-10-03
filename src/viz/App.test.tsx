// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

describe('App', () => {
  it('renders 12 nodes, stats bar and controls', () => {
    render(<App />);
    expect(screen.getAllByTestId('node')).toHaveLength(12);
    expect(screen.getByText(/convergence/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /play/i })).toBeTruthy();
  });

  it('clicking a node opens the inspector; close hides it', () => {
    render(<App />);
    fireEvent.click(screen.getAllByTestId('node')[0]);
    expect(screen.getByText(/Node 0/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('close'));
    expect(screen.queryByText(/Node 0/)).toBeNull();
  });

  it('step advances the tick counter', () => {
    render(<App />);
    const before = screen.getByTestId('tick')?.textContent;
    fireEvent.click(screen.getByRole('button', { name: /step/i }));
    expect(screen.getByTestId('tick').textContent).not.toBe(before);
  });

  it('add node grows the ring', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /add node/i }));
    fireEvent.click(screen.getByRole('button', { name: /step/i }));
    expect(screen.getAllByTestId('node')).toHaveLength(13);
  });
});

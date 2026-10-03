import { describe, it, expect } from 'vitest';
import { supersedes } from './membership';
import type { MemberState } from './types';

const u = (state: MemberState, incarnation: number) => ({ id: 1, state, incarnation });

describe('supersedes', () => {
  it('higher incarnation always wins', () => {
    expect(supersedes(u('alive', 2), u('dead', 1))).toBe(true);
    expect(supersedes(u('dead', 1), u('alive', 2))).toBe(false);
  });

  it('equal incarnation: dead > suspect > alive', () => {
    expect(supersedes(u('suspect', 1), u('alive', 1))).toBe(true);
    expect(supersedes(u('dead', 1), u('suspect', 1))).toBe(true);
    expect(supersedes(u('dead', 1), u('alive', 1))).toBe(true);
    expect(supersedes(u('alive', 1), u('suspect', 1))).toBe(false);
    expect(supersedes(u('suspect', 1), u('dead', 1))).toBe(false);
  });

  it('identical state and incarnation does not supersede', () => {
    expect(supersedes(u('alive', 1), u('alive', 1))).toBe(false);
    expect(supersedes(u('dead', 3), u('dead', 3))).toBe(false);
  });
});

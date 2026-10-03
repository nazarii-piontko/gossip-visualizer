import { describe, it, expect, beforeEach } from 'vitest';
import { SwimNode } from './node';
import { mulberry32 } from './rng';
import { DEFAULT_SWIM } from './types';
import type { Message, MessageDraft, MessageType, NodeId } from './types';

const msg = (over: Partial<Message> & { type: MessageType; from: NodeId; to: NodeId }): Message => ({
  id: 0, piggyback: [], sentTick: 0, deliverTick: 1, dropped: false, ...over,
});

describe('SwimNode message handling', () => {
  let node: SwimNode;
  beforeEach(() => {
    node = new SwimNode(1, [2, 3], DEFAULT_SWIM, mulberry32(1), 0);
  });

  it('starts with seeds alive and self excluded from table', () => {
    expect(node.tableEntries().map((e) => e.id)).toEqual([2, 3]);
    expect(node.tableEntries().every((e) => e.state === 'alive')).toBe(true);
    expect(node.getEntry(1)).toBeUndefined();
  });

  it('replies ack to ping', () => {
    const { drafts } = node.onMessage(msg({ type: 'ping', from: 2, to: 1 }), 5);
    expect(drafts).toEqual([expect.objectContaining({ type: 'ack', to: 2 })]);
  });

  it('relays ping-req as ping-req-ping preserving subject/origin', () => {
    const { drafts } = node.onMessage(msg({ type: 'ping-req', from: 9, to: 1, subject: 3, origin: 9 }), 5);
    expect(drafts).toEqual([
      expect.objectContaining({ type: 'ping-req-ping', to: 3, subject: 3, origin: 9 }),
    ]);
  });

  it('answers ping-req-ping with ping-req-ack to the relay', () => {
    const { drafts } = node.onMessage(msg({ type: 'ping-req-ping', from: 2, to: 1, subject: 1, origin: 9 }), 5);
    expect(drafts).toEqual([
      expect.objectContaining({ type: 'ping-req-ack', to: 2, subject: 1, origin: 9 }),
    ]);
  });

  it('forwards ping-req-ack toward origin when not the origin', () => {
    const { drafts } = node.onMessage(msg({ type: 'ping-req-ack', from: 3, to: 1, subject: 3, origin: 9 }), 5);
    expect(drafts).toEqual([
      expect.objectContaining({ type: 'ping-req-ack', to: 9, subject: 3, origin: 9 }),
    ]);
  });

  it('consumes ping-req-ack when it is the origin', () => {
    const { drafts } = node.onMessage(msg({ type: 'ping-req-ack', from: 2, to: 1, subject: 3, origin: 1 }), 5);
    expect(drafts).toEqual([]);
  });

  it('merges piggyback updates and gossips them onward', () => {
    node.onMessage(msg({ type: 'ping', from: 2, to: 1, piggyback: [{ id: 4, state: 'alive', incarnation: 0 }] }), 5);
    expect(node.getEntry(4)).toMatchObject({ state: 'alive', incarnation: 0, lastUpdateTick: 5 });
    // the learned update must be forwarded on the next outgoing message
    const { drafts } = node.onMessage(msg({ type: 'ping', from: 3, to: 1 }), 6);
    expect(drafts[0].piggyback.some((u) => u.id === 4)).toBe(true);
  });

  it('emits state-change when a peer transitions', () => {
    const { changes } = node.onMessage(
      msg({ type: 'ping', from: 2, to: 1, piggyback: [{ id: 3, state: 'suspect', incarnation: 0 }] }), 5,
    );
    expect(changes).toEqual([{ subject: 3, from: 'alive', to: 'suspect' }]);
  });

  it('ignores stale updates', () => {
    node.onMessage(msg({ type: 'ping', from: 2, to: 1, piggyback: [{ id: 3, state: 'dead', incarnation: 2 }] }), 5);
    const { changes } = node.onMessage(
      msg({ type: 'ping', from: 2, to: 1, piggyback: [{ id: 3, state: 'alive', incarnation: 1 }] }), 6,
    );
    expect(changes).toEqual([]);
    expect(node.getEntry(3)!.state).toBe('dead');
  });

  it('refutes suspicion about itself by bumping incarnation', () => {
    node.onMessage(msg({ type: 'ping', from: 2, to: 1, piggyback: [{ id: 1, state: 'suspect', incarnation: 0 }] }), 5);
    expect(node.incarnation).toBe(1);
    expect(node.counters.refutations).toBe(1);
    const { drafts } = node.onMessage(msg({ type: 'ping', from: 3, to: 1 }), 6);
    expect(drafts[0].piggyback).toContainEqual({ id: 1, state: 'alive', incarnation: 1 });
  });

  it('echoes its view of a suspect/dead sender back in the reply piggyback', () => {
    node.applyUpdate({ id: 2, state: 'dead', incarnation: 0 }, 3);
    const { drafts } = node.onMessage(msg({ type: 'ping', from: 2, to: 1 }), 5);
    expect(drafts[0].type).toBe('ack');
    expect(drafts[0].piggyback[0]).toEqual({ id: 2, state: 'dead', incarnation: 0 });
  });

  it('keeps the echo within maxPiggyback', () => {
    // suspect peer 9 sorts last in the buffer, so a full draw would not already contain it
    const n = new SwimNode(1, [9], { ...DEFAULT_SWIM, maxPiggyback: 2 }, mulberry32(1), 0);
    for (const id of [5, 6, 7]) n.applyUpdate({ id, state: 'alive', incarnation: 0 }, 1);
    n.applyUpdate({ id: 9, state: 'suspect', incarnation: 0 }, 2);
    const { drafts } = n.onMessage(msg({ type: 'ping', from: 9, to: 1 }), 5);
    expect(drafts[0].piggyback).toHaveLength(2);
    expect(drafts[0].piggyback[0]).toEqual({ id: 9, state: 'suspect', incarnation: 0 });
  });

  it('learns an unknown sender as alive from any message', () => {
    const { changes } = node.onMessage(msg({ type: 'ping', from: 7, to: 1 }), 5);
    expect(node.getEntry(7)).toMatchObject({ state: 'alive', incarnation: 0 });
    expect(changes).toContainEqual({ subject: 7, from: 'unknown', to: 'alive' });
  });

  it('does not resurrect a dead sender on contact', () => {
    node.applyUpdate({ id: 2, state: 'dead', incarnation: 1 }, 3);
    node.onMessage(msg({ type: 'ping', from: 2, to: 1 }), 5);
    expect(node.getEntry(2)!.state).toBe('dead');
  });

  it('marks a leaving node dead with a dominating incarnation', () => {
    const { changes } = node.onMessage(msg({ type: 'leave', from: 2, to: 1 }), 5);
    expect(changes).toEqual([{ subject: 2, from: 'alive', to: 'dead' }]);
    expect(node.getEntry(2)).toMatchObject({ state: 'dead', incarnation: 1 });
  });

  it('rejoin adds unknown seeds as alive and re-announces itself', () => {
    const orphan = new SwimNode(1, [], DEFAULT_SWIM, mulberry32(1), 0);
    orphan.incarnation = 2;
    orphan.rejoin([2, 3], 10);
    expect(orphan.tableEntries().map((e) => e.id)).toEqual([2, 3]);
    expect(orphan.tableEntries().every((e) => e.state === 'alive')).toBe(true);
    const { drafts } = orphan.onMessage(msg({ type: 'ping', from: 2, to: 1 }), 11);
    expect(drafts[0].piggyback).toContainEqual({ id: 1, state: 'alive', incarnation: 2 });
  });

  it('rejoin does not clobber existing entries', () => {
    node.applyUpdate({ id: 2, state: 'dead', incarnation: 1 }, 3);
    node.rejoin([2, 3], 10);
    expect(node.getEntry(2)).toMatchObject({ state: 'dead', incarnation: 1 });
  });

  it('leaveDrafts sends leave to every alive peer', () => {
    const drafts = node.leaveDrafts();
    expect(drafts.map((d: MessageDraft) => d.to).sort()).toEqual([2, 3]);
    expect(drafts.every((d) => d.type === 'leave')).toBe(true);
  });

  it('counts sent and received per type', () => {
    node.onMessage(msg({ type: 'ping', from: 2, to: 1 }), 5);
    expect(node.counters.received.ping).toBe(1);
    expect(node.counters.sent.ack).toBe(1);
  });
});

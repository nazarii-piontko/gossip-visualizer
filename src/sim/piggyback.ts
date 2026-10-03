import { supersedes } from './membership';
import type { MembershipUpdate, NodeId } from './types';

interface Slot {
  update: MembershipUpdate;
  timesSent: number;
}

/**
 * Dissemination queue for gossip updates. Holds at most one update per subject
 * (a superseding update replaces the old one and resets its send count).
 */
export class PiggybackBuffer {
  private slots = new Map<NodeId, Slot>();

  /** Add an update for gossiping; ignored if the buffered one already supersedes it. */
  enqueue(update: MembershipUpdate): void {
    const existing = this.slots.get(update.id);
    if (existing && !supersedes(update, existing.update)) return;
    this.slots.set(update.id, { update: { ...update }, timesSent: 0 });
  }

  /** Pick up to `max` updates for one outgoing message, least-sent first so fresh
   *  news spreads widest; updates retire after `retransmitLimit` sends. */
  draw(max: number, retransmitLimit: number): MembershipUpdate[] {
    const chosen = [...this.slots.values()]
      .sort((a, b) => a.timesSent - b.timesSent || a.update.id - b.update.id)
      .slice(0, max);
    const out: MembershipUpdate[] = [];
    for (const slot of chosen) {
      out.push({ ...slot.update });
      slot.timesSent++;
      if (slot.timesSent >= retransmitLimit) this.slots.delete(slot.update.id);
    }
    return out;
  }

  size(): number {
    return this.slots.size;
  }
}

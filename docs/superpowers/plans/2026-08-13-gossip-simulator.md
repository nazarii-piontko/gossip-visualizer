# Gossip Simulator & Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a SWIM gossip-protocol simulator (pure TS engine) with an animated SVG ring visualization in React.

**Architecture:** Two hard-bounded layers. `src/sim/` is a pure-TypeScript, deterministic, tick-based SWIM engine with zero React/DOM imports, driven by `Simulator.tick(): TickReport`. `src/viz/` is a React layer that renders the ring, animates packets with SMIL `<animateMotion>`, and drives ticks with `setInterval`.

**Tech Stack:** Vite, React 19, TypeScript (strict), vitest, @testing-library/react, jsdom. Zero runtime deps beyond React.

**Spec:** `docs/superpowers/specs/2026-08-13-gossip-simulator-design.md`

## Global Constraints

- `src/sim/**` must never import from React, `src/viz/**`, or any DOM API.
- All randomness flows through one mulberry32 stream owned by `Simulator` (`seed` in config). Same seed + same action sequence → identical `TickReport` stream.
- 1 tick = 1 network hop; `deliverTick = sentTick + 1`. The engine never touches wall-clock time.
- Defaults (from spec §10): protocolPeriod 4, indirectProbes 3, suspectTimeout 12, maxPiggyback 6, seedCount 3, deadPruneTicks 50, piggybackRetransmits 8, initial cluster 12 nodes, tick 2000 ms.
- Deadlines: ack by `startTick + 2`; indirect ack by `startTick + 6` (constants `ACK_DEADLINE = 2`, `PROBE_DEADLINE = 6`).
- TDD for every sim-layer task: failing test first, then minimal implementation.
- Commit after every task (at minimum).

---

### Task 1: Project scaffold

**Files:**
- Create: Vite scaffold (`package.json`, `tsconfig*.json`, `index.html`, `src/main.tsx`, …)
- Create: `vitest.config.ts`
- Test: `src/sim/smoke.test.ts` (temporary, deleted in Task 2)

**Interfaces:**
- Produces: working `npm run dev`, `npm test` (vitest), strict TS build, `src/sim/` and `src/viz/` directories.

- [ ] **Step 1: Scaffold Vite app in repo root**

```bash
cd /home/npiontko/Projects/gossip-visualizator
npm create vite@latest . -- --template react-ts
npm install
```

If the scaffolder complains about existing files (`docs/`, `.git`), let it scaffold anyway / choose "ignore existing files"; it does not touch `docs/`.

- [ ] **Step 2: Add test tooling**

```bash
npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

Add to `package.json` scripts: `"test": "vitest run", "test:watch": "vitest"`.

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node', // viz tests opt into jsdom via // @vitest-environment jsdom
  },
});
```

- [ ] **Step 4: Create layer directories and smoke test**

```bash
mkdir -p src/sim src/viz
```

`src/sim/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Verify**

Run: `npm test` → 1 passing. Run: `npm run build` → succeeds (tsc strict + vite build).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite react-ts app with vitest"
```

---

### Task 2: Seeded PRNG (`sim/rng.ts`)

**Files:**
- Create: `src/sim/rng.ts`
- Test: `src/sim/rng.test.ts`
- Delete: `src/sim/smoke.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Rng {
    next(): number;                 // [0, 1)
    int(maxExclusive: number): number;
    pick<T>(arr: readonly T[]): T;  // arr must be non-empty
    shuffle<T>(arr: readonly T[]): T[]; // new array, Fisher-Yates
  }
  function mulberry32(seed: number): Rng;
  ```

- [ ] **Step 1: Write failing tests** — `src/sim/rng.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from './rng';

describe('mulberry32', () => {
  it('is deterministic for equal seeds', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs across seeds', () => {
    expect(mulberry32(1).next()).not.toBe(mulberry32(2).next());
  });

  it('next() stays in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(n) stays in [0, n)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('shuffle returns a permutation without mutating input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const r = mulberry32(3);
    const out = r.shuffle(input);
    expect(out).not.toBe(input);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('shuffle is deterministic', () => {
    expect(mulberry32(9).shuffle([1, 2, 3, 4])).toEqual(mulberry32(9).shuffle([1, 2, 3, 4]));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sim/rng.test.ts` — FAIL (module not found).

- [ ] **Step 3: Implement** — `src/sim/rng.ts`:

```ts
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: readonly T[]): T[];
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return rng;
}
```

- [ ] **Step 4: Verify pass, delete smoke test**

Run: `npx vitest run src/sim/rng.test.ts` — PASS. Delete `src/sim/smoke.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(sim): mulberry32 seeded PRNG"
```

---

### Task 3: Core types + membership merge rule

**Files:**
- Create: `src/sim/types.ts`, `src/sim/membership.ts`
- Test: `src/sim/membership.test.ts`

**Interfaces:**
- Produces (in `types.ts`, consumed by every later task):

```ts
export type NodeId = number;
export type MemberState = 'alive' | 'suspect' | 'dead';

export interface MembershipEntry {
  id: NodeId;
  state: MemberState;
  incarnation: number;
  lastUpdateTick: number;
}

export interface MembershipUpdate {
  id: NodeId;
  state: MemberState;
  incarnation: number;
}

export type MessageType =
  | 'ping' | 'ack' | 'ping-req' | 'ping-req-ping' | 'ping-req-ack' | 'leave';

/** What a node emits; Simulator stamps the rest. */
export interface MessageDraft {
  type: MessageType;
  to: NodeId;
  subject?: NodeId; // probed node T on indirect legs
  origin?: NodeId;  // original prober A on indirect legs
  piggyback: MembershipUpdate[];
}

export interface Message extends MessageDraft {
  id: number;
  from: NodeId;
  sentTick: number;
  deliverTick: number; // sentTick + 1
  dropped: boolean;    // decided at send, applied at delivery
}

export interface SwimParams {
  protocolPeriod: number;
  indirectProbes: number;
  suspectTimeout: number;
  maxPiggyback: number;
  seedCount: number;
  deadPruneTicks: number;
  piggybackRetransmits: number;
}

export const DEFAULT_SWIM: SwimParams = {
  protocolPeriod: 4,
  indirectProbes: 3,
  suspectTimeout: 12,
  maxPiggyback: 6,
  seedCount: 3,
  deadPruneTicks: 50,
  piggybackRetransmits: 8,
};

export const ACK_DEADLINE = 2;
export const PROBE_DEADLINE = 6;

export interface PacketInfo {
  msgId: number;
  from: NodeId;
  to: NodeId;
  type: MessageType;
  willDrop: boolean;
  piggybackCount: number;
}

export type TickEvent =
  | { kind: 'sent' | 'delivered' | 'dropped'; msg: Message }
  | { kind: 'state-change'; nodeId: NodeId; subject: NodeId; from: MemberState | 'unknown'; to: MemberState }
  | { kind: 'joined' | 'left' | 'killed'; nodeId: NodeId };

export type GroundTruth = 'running' | 'killed';

export interface GlobalSnapshot {
  tick: number;
  groundTruth: Record<NodeId, GroundTruth>; // departed nodes absent
  perceived: Record<NodeId, MemberState>;   // majority view across running nodes
  aliveCount: number;    // from perceived
  suspectCount: number;
  deadCount: number;
  convergence: number;   // 0..1
  messagesThisTick: number;
  totalMessages: number;
  totalDropped: number;
  lastDetectionLatency: number | null; // ticks, from last kill
  failureRates: Record<NodeId, { in: number; out: number }>;
  globalFailureRate: number;
}

export interface TickReport {
  tick: number;
  events: TickEvent[];
  packets: PacketInfo[];
  snapshot: GlobalSnapshot;
}

export interface NodeCounters {
  sent: Partial<Record<MessageType, number>>;
  received: Partial<Record<MessageType, number>>;
  droppedOutbound: number;
  falseSuspicions: number;
  refutations: number;
}

export interface NodeDetail {
  id: NodeId;
  running: boolean;
  incarnation: number;
  phaseOffset: number;
  failureIn: number;
  failureOut: number;
  table: MembershipEntry[]; // peers only, sorted by id
  probes: { target: NodeId; startTick: number; indirectSent: boolean }[];
  counters: NodeCounters;
}

export interface SimulatorConfig {
  seed: number;
  nodeCount: number;
  swim?: Partial<SwimParams>;
  globalFailureRate?: number;
}
```

- Produces (in `membership.ts`):

```ts
export function supersedes(
  incoming: MembershipUpdate,
  current: { state: MemberState; incarnation: number },
): boolean;
```

Rule (spec §4.1): higher incarnation wins; equal incarnation → `dead > suspect > alive`; otherwise false (equal state+incarnation does NOT supersede).

- [ ] **Step 1: Write failing tests** — `src/sim/membership.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sim/membership.test.ts` — FAIL.

- [ ] **Step 3: Implement**

Create `src/sim/types.ts` exactly as in the Interfaces block above. Create `src/sim/membership.ts`:

```ts
import type { MemberState, MembershipUpdate } from './types';

const PRECEDENCE: Record<MemberState, number> = { alive: 0, suspect: 1, dead: 2 };

export function supersedes(
  incoming: MembershipUpdate,
  current: { state: MemberState; incarnation: number },
): boolean {
  if (incoming.incarnation !== current.incarnation) {
    return incoming.incarnation > current.incarnation;
  }
  return PRECEDENCE[incoming.state] > PRECEDENCE[current.state];
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/sim/membership.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(sim): core types and membership merge rule"
```

---

### Task 4: Piggyback buffer

**Files:**
- Create: `src/sim/piggyback.ts`
- Test: `src/sim/piggyback.test.ts`

**Interfaces:**
- Consumes: `supersedes` from Task 3, `MembershipUpdate`, `NodeId` types.
- Produces:

```ts
export class PiggybackBuffer {
  enqueue(update: MembershipUpdate): void;
  // Returns up to `max` updates, fewest-times-sent first (ties: lower id first).
  // Increments timesSent on returned entries; evicts entries reaching retransmitLimit.
  draw(max: number, retransmitLimit: number): MembershipUpdate[];
  size(): number;
}
```

Semantics: one slot per node id. `enqueue` replaces the stored update (and resets its timesSent to 0) only if the new update `supersedes` the stored one, or no entry exists.

- [ ] **Step 1: Write failing tests** — `src/sim/piggyback.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PiggybackBuffer } from './piggyback';
import type { MembershipUpdate } from './types';

const u = (id: number, state: MembershipUpdate['state'] = 'alive', incarnation = 0): MembershipUpdate =>
  ({ id, state, incarnation });

describe('PiggybackBuffer', () => {
  it('draws at most max updates', () => {
    const b = new PiggybackBuffer();
    for (let i = 0; i < 10; i++) b.enqueue(u(i));
    expect(b.draw(6, 8)).toHaveLength(6);
  });

  it('prioritizes fewest-times-sent', () => {
    const b = new PiggybackBuffer();
    b.enqueue(u(1));
    b.enqueue(u(2));
    b.draw(1, 8); // sends id 1 (tie-break: lower id) -> timesSent {1:1, 2:0}
    expect(b.draw(1, 8)[0].id).toBe(2);
  });

  it('superseding update replaces entry and resets send count', () => {
    const b = new PiggybackBuffer();
    b.enqueue(u(1, 'alive', 0));
    b.draw(1, 8);
    b.enqueue(u(1, 'suspect', 0)); // supersedes -> reset
    const out = b.draw(1, 8);
    expect(out[0]).toEqual(u(1, 'suspect', 0));
  });

  it('non-superseding update is ignored', () => {
    const b = new PiggybackBuffer();
    b.enqueue(u(1, 'suspect', 5));
    b.enqueue(u(1, 'alive', 5)); // does not supersede
    expect(b.draw(1, 8)[0].state).toBe('suspect');
  });

  it('evicts after retransmitLimit sends', () => {
    const b = new PiggybackBuffer();
    b.enqueue(u(1));
    b.draw(6, 2);
    b.draw(6, 2); // second send reaches limit -> evicted
    expect(b.size()).toBe(0);
    expect(b.draw(6, 2)).toHaveLength(0);
  });

  it('returns copies, not shared references', () => {
    const b = new PiggybackBuffer();
    b.enqueue(u(1));
    const [first] = b.draw(1, 8);
    first.state = 'dead';
    expect(b.draw(1, 8)[0].state).toBe('alive');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sim/piggyback.test.ts` — FAIL.

- [ ] **Step 3: Implement** — `src/sim/piggyback.ts`:

```ts
import { supersedes } from './membership';
import type { MembershipUpdate, NodeId } from './types';

interface Slot {
  update: MembershipUpdate;
  timesSent: number;
}

export class PiggybackBuffer {
  private slots = new Map<NodeId, Slot>();

  enqueue(update: MembershipUpdate): void {
    const existing = this.slots.get(update.id);
    if (existing && !supersedes(update, existing.update)) return;
    this.slots.set(update.id, { update: { ...update }, timesSent: 0 });
  }

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
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/sim/piggyback.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(sim): piggyback buffer with fewest-times-sent priority"
```

---

### Task 5: SwimNode — message handling

**Files:**
- Create: `src/sim/node.ts`
- Test: `src/sim/node.test.ts`

**Interfaces:**
- Consumes: `PiggybackBuffer`, `supersedes`, `Rng`, all types.
- Produces (probe/tick logic is added in Task 6; this task creates the class with these members):

```ts
export interface StateChange {
  subject: NodeId;
  from: MemberState | 'unknown';
  to: MemberState;
}

export interface NodeOutput {
  drafts: MessageDraft[];
  changes: StateChange[];
}

export class SwimNode {
  readonly id: NodeId;
  readonly phaseOffset: number; // rng.int(params.protocolPeriod) at construction
  incarnation: number;          // starts 0
  counters: NodeCounters;
  constructor(id: NodeId, seeds: NodeId[], params: SwimParams, rng: Rng, joinTick: number);
  onMessage(msg: Message, tick: number): NodeOutput;
  onTick(tick: number): NodeOutput;            // Task 6 (stub returns empty here)
  applyUpdate(u: MembershipUpdate, tick: number): StateChange[];
  leaveDrafts(): MessageDraft[];               // 'leave' to every alive peer
  getEntry(id: NodeId): MembershipEntry | undefined;
  tableEntries(): MembershipEntry[];           // copies, sorted by id
  alivePeers(): NodeId[];
  detail(tick: number): Omit<NodeDetail, 'running' | 'failureIn' | 'failureOut'>;
}
```

Construction: seeds inserted as `alive, incarnation 0`; own alive announcement (`{id, state:'alive', incarnation: 0}`) enqueued to the piggyback buffer. The node's own entry is NOT in the table.

`applyUpdate` semantics (spec §4.1, §4.5):
- Update about self with state ≠ alive and `incarnation >= own` → refutation: `own = incoming + 1`, enqueue own alive update, `counters.refutations++`. Returns no change.
- Update about self otherwise → ignored.
- Update about peer: apply iff no entry or `supersedes`; set `lastUpdateTick = tick`; enqueue the update for further gossip. Return a `StateChange` only when the state actually changed (incarnation-only bumps return none).

`onMessage` semantics (spec §4.2, §4.3): first merge piggyback, then per type:
- `ping` → reply `ack` to sender.
- `ack` → resolve pending probe on sender (Task 6 wires this; store ack'd ids in a `Set<NodeId>` consumed by probe logic).
- `ping-req {subject, origin}` → send `ping-req-ping` to subject, carrying same subject/origin.
- `ping-req-ping {subject, origin}` → reply `ping-req-ack` to sender, same subject/origin.
- `ping-req-ack {subject, origin}` → if `origin === this.id` resolve probe on subject; else forward `ping-req-ack` to origin, same subject/origin.
- `leave` → apply `{ id: from, state: 'dead', incarnation: knownIncarnation(from) + 1 }`.

Every outgoing draft pulls piggyback via a private `draft(type, to, extra?)` helper that also increments `counters.sent[type]`.

**Sender-state echo (spec §4.5):** after the switch, if the sender of the processed message is marked `suspect` or `dead` in this node's table, prepend that entry (as a `MembershipUpdate`) to the piggyback of every reply draft addressed to that sender (dedupe by id). This is the deterministic refutation trigger for recovered/isolated nodes.

- [ ] **Step 1: Write failing tests** — `src/sim/node.test.ts`:

```ts
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

  it('marks a leaving node dead with a dominating incarnation', () => {
    const { changes } = node.onMessage(msg({ type: 'leave', from: 2, to: 1 }), 5);
    expect(changes).toEqual([{ subject: 2, from: 'alive', to: 'dead' }]);
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sim/node.test.ts` — FAIL.

- [ ] **Step 3: Implement** — `src/sim/node.ts`:

```ts
import { supersedes } from './membership';
import { PiggybackBuffer } from './piggyback';
import type { Rng } from './rng';
import type {
  MemberState, MembershipEntry, MembershipUpdate, Message, MessageDraft,
  MessageType, NodeCounters, NodeDetail, NodeId, SwimParams,
} from './types';

export interface StateChange {
  subject: NodeId;
  from: MemberState | 'unknown';
  to: MemberState;
}

export interface NodeOutput {
  drafts: MessageDraft[];
  changes: StateChange[];
}

interface PendingProbe {
  target: NodeId;
  startTick: number;
  indirectSent: boolean;
}

export class SwimNode {
  readonly id: NodeId;
  readonly phaseOffset: number;
  incarnation = 0;
  counters: NodeCounters = {
    sent: {}, received: {}, droppedOutbound: 0, falseSuspicions: 0, refutations: 0,
  };

  private table = new Map<NodeId, MembershipEntry>();
  private buffer = new PiggybackBuffer();
  private probes = new Map<NodeId, PendingProbe>(); // used from Task 6
  private probeQueue: NodeId[] = [];
  private params: SwimParams;
  private rng: Rng;

  constructor(id: NodeId, seeds: NodeId[], params: SwimParams, rng: Rng, joinTick: number) {
    this.id = id;
    this.params = params;
    this.rng = rng;
    this.phaseOffset = rng.int(params.protocolPeriod);
    for (const s of seeds) {
      this.table.set(s, { id: s, state: 'alive', incarnation: 0, lastUpdateTick: joinTick });
    }
    this.buffer.enqueue({ id, state: 'alive', incarnation: 0 });
  }

  onMessage(msg: Message, tick: number): NodeOutput {
    this.counters.received[msg.type] = (this.counters.received[msg.type] ?? 0) + 1;
    const changes: StateChange[] = [];
    for (const u of msg.piggyback) changes.push(...this.applyUpdate(u, tick));

    const drafts: MessageDraft[] = [];
    switch (msg.type) {
      case 'ping':
        drafts.push(this.draft('ack', msg.from));
        break;
      case 'ack':
        this.resolveProbe(msg.from);
        break;
      case 'ping-req':
        drafts.push(this.draft('ping-req-ping', msg.subject!, { subject: msg.subject, origin: msg.origin }));
        break;
      case 'ping-req-ping':
        drafts.push(this.draft('ping-req-ack', msg.from, { subject: msg.subject, origin: msg.origin }));
        break;
      case 'ping-req-ack':
        if (msg.origin === this.id) this.resolveProbe(msg.subject!);
        else drafts.push(this.draft('ping-req-ack', msg.origin!, { subject: msg.subject, origin: msg.origin }));
        break;
      case 'leave': {
        const inc = (this.table.get(msg.from)?.incarnation ?? 0) + 1;
        changes.push(...this.applyUpdate({ id: msg.from, state: 'dead', incarnation: inc }, tick));
        break;
      }
    }

    // sender-state echo (spec §4.5): a suspect/dead sender must hear about itself
    const senderEntry = this.table.get(msg.from);
    if (senderEntry && senderEntry.state !== 'alive') {
      const echo = { id: senderEntry.id, state: senderEntry.state, incarnation: senderEntry.incarnation };
      for (const d of drafts) {
        if (d.to === msg.from) {
          d.piggyback = [echo, ...d.piggyback.filter((u) => u.id !== echo.id)];
        }
      }
    }

    return { drafts, changes };
  }

  onTick(_tick: number): NodeOutput {
    return { drafts: [], changes: [] }; // Task 6
  }

  applyUpdate(u: MembershipUpdate, tick: number): StateChange[] {
    if (u.id === this.id) {
      if (u.state !== 'alive' && u.incarnation >= this.incarnation) {
        this.incarnation = u.incarnation + 1;
        this.counters.refutations++;
        this.buffer.enqueue({ id: this.id, state: 'alive', incarnation: this.incarnation });
      }
      return [];
    }
    const current = this.table.get(u.id);
    if (current && !supersedes(u, current)) return [];
    const from: MemberState | 'unknown' = current?.state ?? 'unknown';
    this.table.set(u.id, { id: u.id, state: u.state, incarnation: u.incarnation, lastUpdateTick: tick });
    this.buffer.enqueue({ ...u });
    return from === u.state ? [] : [{ subject: u.id, from, to: u.state }];
  }

  leaveDrafts(): MessageDraft[] {
    return this.alivePeers().map((p) => this.draft('leave', p));
  }

  getEntry(id: NodeId): MembershipEntry | undefined {
    const e = this.table.get(id);
    return e ? { ...e } : undefined;
  }

  tableEntries(): MembershipEntry[] {
    return [...this.table.values()].map((e) => ({ ...e })).sort((a, b) => a.id - b.id);
  }

  alivePeers(): NodeId[] {
    return [...this.table.values()].filter((e) => e.state === 'alive').map((e) => e.id).sort((a, b) => a - b);
  }

  detail(_tick: number): Omit<NodeDetail, 'running' | 'failureIn' | 'failureOut'> {
    return {
      id: this.id,
      incarnation: this.incarnation,
      phaseOffset: this.phaseOffset,
      table: this.tableEntries(),
      probes: [...this.probes.values()].map((p) => ({ ...p })),
      counters: JSON.parse(JSON.stringify(this.counters)) as NodeCounters,
    };
  }

  private resolveProbe(target: NodeId): void {
    this.probes.delete(target);
  }

  private draft(type: MessageType, to: NodeId, extra: Pick<MessageDraft, 'subject' | 'origin'> = {}): MessageDraft {
    this.counters.sent[type] = (this.counters.sent[type] ?? 0) + 1;
    return {
      type, to, ...extra,
      piggyback: this.buffer.draw(this.params.maxPiggyback, this.params.piggybackRetransmits),
    };
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/sim/node.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(sim): SwimNode message handling, refutation, leave"
```

---

### Task 6: SwimNode — probe cycle and timers (`onTick`)

**Files:**
- Modify: `src/sim/node.ts` (replace the `onTick` stub; add probe helpers)
- Test: `src/sim/node-tick.test.ts`

**Interfaces:**
- Consumes: everything from Task 5.
- Produces: real `onTick(tick): NodeOutput` implementing spec §4.2:
  1. **Escalation:** for each pending probe: if `!indirectSent && tick - startTick >= ACK_DEADLINE` → mark indirectSent, emit `ping-req` to `min(k, |alive peers ≠ target|)` shuffled alive peers. If `tick - startTick >= PROBE_DEADLINE` → delete probe, apply `{target, suspect, knownIncarnation(target)}`.
  2. **Timers:** suspect entries with `tick - lastUpdateTick >= suspectTimeout` → apply dead (same incarnation; dead supersedes suspect). Dead entries with `tick - lastUpdateTick >= deadPruneTicks` → remove from table silently.
  3. **Probe start:** if `tick >= phaseOffset && (tick - phaseOffset) % protocolPeriod === 0` and no pending probe already targets the chosen node → pick next target from a shuffled round-robin queue of alive peers (rebuild+reshuffle when exhausted; skip entries no longer alive), register pending probe, emit `ping`.
  - Probes may overlap across periods (PROBE_DEADLINE 6 > period 4); `probes` map keys by target.

- [ ] **Step 1: Write failing tests** — `src/sim/node-tick.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SwimNode } from './node';
import { mulberry32 } from './rng';
import { ACK_DEADLINE, DEFAULT_SWIM, PROBE_DEADLINE } from './types';
import type { Message, MessageType, NodeId } from './types';

const msg = (over: Partial<Message> & { type: MessageType; from: NodeId; to: NodeId }): Message => ({
  id: 0, piggyback: [], sentTick: 0, deliverTick: 1, dropped: false, ...over,
});

/** First tick >= from matching the node's probe phase. */
const probeTick = (n: SwimNode, from: number): number => {
  let t = Math.max(from, n.phaseOffset);
  while ((t - n.phaseOffset) % DEFAULT_SWIM.protocolPeriod !== 0) t++;
  return t;
};

describe('SwimNode.onTick', () => {
  it('starts a probe on its phase', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    const { drafts } = n.onTick(t);
    expect(drafts).toEqual([expect.objectContaining({ type: 'ping', to: 2 })]);
    expect(n.onTick(t + 1).drafts).toEqual([]); // off-phase, before ACK_DEADLINE
  });

  it('does nothing with no alive peers', () => {
    const n = new SwimNode(1, [], DEFAULT_SWIM, mulberry32(5), 0);
    for (let t = 0; t < 10; t++) expect(n.onTick(t).drafts).toEqual([]);
  });

  it('escalates to ping-req after ACK_DEADLINE without ack', () => {
    const n = new SwimNode(1, [2, 3, 4, 5, 6], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    const target = (n.onTick(t).drafts[0] as { to: number }).to;
    const { drafts } = n.onTick(t + ACK_DEADLINE);
    const reqs = drafts.filter((d) => d.type === 'ping-req');
    expect(reqs).toHaveLength(DEFAULT_SWIM.indirectProbes);
    for (const r of reqs) {
      expect(r.subject).toBe(target);
      expect(r.origin).toBe(1);
      expect(r.to).not.toBe(target);
    }
  });

  it('does not escalate when ack arrived in time', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    n.onTick(t);
    n.onMessage(msg({ type: 'ack', from: 2, to: 1 }), t + 2);
    const { drafts } = n.onTick(t + ACK_DEADLINE);
    expect(drafts.filter((d) => d.type === 'ping-req')).toEqual([]);
  });

  it('marks target suspect after PROBE_DEADLINE', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    n.onTick(t);
    let all = [] as { subject: number; to: string }[];
    for (let i = 1; i <= PROBE_DEADLINE; i++) {
      all = all.concat(n.onTick(t + i).changes.map((c) => ({ subject: c.subject, to: c.to })));
    }
    expect(all).toContainEqual({ subject: 2, to: 'suspect' });
    expect(n.getEntry(2)!.state).toBe('suspect');
  });

  it('indirect ack resolves the probe (no suspicion)', () => {
    const n = new SwimNode(1, [2, 3], DEFAULT_SWIM, mulberry32(5), 0);
    const t = probeTick(n, 0);
    const target = (n.onTick(t).drafts[0] as { to: number }).to;
    n.onMessage(msg({ type: 'ping-req-ack', from: 3, to: 1, subject: target, origin: 1 }), t + 5);
    for (let i = 1; i <= PROBE_DEADLINE + 1; i++) n.onTick(t + i);
    expect(n.getEntry(target)!.state).toBe('alive');
  });

  it('suspect becomes dead after suspectTimeout', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    n.applyUpdate({ id: 2, state: 'suspect', incarnation: 0 }, 10);
    const { changes } = n.onTick(10 + DEFAULT_SWIM.suspectTimeout);
    expect(changes).toContainEqual({ subject: 2, from: 'suspect', to: 'dead' });
  });

  it('prunes dead entries after deadPruneTicks', () => {
    const n = new SwimNode(1, [2], DEFAULT_SWIM, mulberry32(5), 0);
    n.applyUpdate({ id: 2, state: 'dead', incarnation: 1 }, 10);
    n.onTick(10 + DEFAULT_SWIM.deadPruneTicks);
    expect(n.getEntry(2)).toBeUndefined();
  });

  it('round-robin covers every alive peer before repeating', () => {
    const peers = [2, 3, 4, 5];
    const n = new SwimNode(1, peers, DEFAULT_SWIM, mulberry32(5), 0);
    const targets: number[] = [];
    let t = probeTick(n, 0);
    for (let i = 0; i < peers.length; i++) {
      for (const d of n.onTick(t).drafts) if (d.type === 'ping') targets.push(d.to);
      // resolve immediately so overlapping-probe skip logic never blocks
      n.onMessage(msg({ type: 'ack', from: targets[targets.length - 1], to: 1 }), t + 2);
      t += DEFAULT_SWIM.protocolPeriod;
    }
    expect([...targets].sort((a, b) => a - b)).toEqual(peers);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sim/node-tick.test.ts` — FAIL.

- [ ] **Step 3: Implement** — replace `onTick` in `src/sim/node.ts` and add `nextProbeTarget`:

```ts
  onTick(tick: number): NodeOutput {
    const drafts: MessageDraft[] = [];
    const changes: StateChange[] = [];

    // 1. escalate / expire pending probes
    for (const probe of [...this.probes.values()]) {
      if (!probe.indirectSent && tick - probe.startTick >= ACK_DEADLINE) {
        probe.indirectSent = true;
        const relays = this.rng
          .shuffle(this.alivePeers().filter((p) => p !== probe.target))
          .slice(0, this.params.indirectProbes);
        for (const r of relays) {
          drafts.push(this.draft('ping-req', r, { subject: probe.target, origin: this.id }));
        }
      }
      if (tick - probe.startTick >= PROBE_DEADLINE) {
        this.probes.delete(probe.target);
        const inc = this.table.get(probe.target)?.incarnation ?? 0;
        changes.push(...this.applyUpdate({ id: probe.target, state: 'suspect', incarnation: inc }, tick));
      }
    }

    // 2. suspect expiry and dead pruning
    for (const e of [...this.table.values()]) {
      if (e.state === 'suspect' && tick - e.lastUpdateTick >= this.params.suspectTimeout) {
        changes.push(...this.applyUpdate({ id: e.id, state: 'dead', incarnation: e.incarnation }, tick));
      } else if (e.state === 'dead' && tick - e.lastUpdateTick >= this.params.deadPruneTicks) {
        this.table.delete(e.id);
      }
    }

    // 3. start a new probe on my phase
    if (tick >= this.phaseOffset && (tick - this.phaseOffset) % this.params.protocolPeriod === 0) {
      const target = this.nextProbeTarget();
      if (target !== null && !this.probes.has(target)) {
        this.probes.set(target, { target, startTick: tick, indirectSent: false });
        drafts.push(this.draft('ping', target));
      }
    }

    return { drafts, changes };
  }

  private nextProbeTarget(): NodeId | null {
    const alive = this.alivePeers();
    if (alive.length === 0) return null;
    while (this.probeQueue.length > 0) {
      const candidate = this.probeQueue.shift()!;
      if (this.table.get(candidate)?.state === 'alive') return candidate;
    }
    this.probeQueue = this.rng.shuffle(alive);
    return this.probeQueue.shift()!;
  }
```

Also add the imports `ACK_DEADLINE, PROBE_DEADLINE` from `./types` (value imports, not type-only).

- [ ] **Step 4: Verify pass — full sim suite**

Run: `npx vitest run src/sim` — ALL PASS (Task 5 tests must still pass).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(sim): probe cycle with indirect probes and suspect/dead timers"
```

---

### Task 7: Simulator — tick loop, delivery, failure injection, lifecycle

**Files:**
- Create: `src/sim/simulator.ts`
- Test: `src/sim/simulator.test.ts`

**Interfaces:**
- Consumes: `SwimNode`, `mulberry32`, all types.
- Produces:

```ts
export class Simulator {
  readonly params: SwimParams; // live object, mutated by updateSwimParams
  constructor(config: SimulatorConfig);
  tick(): TickReport;
  addNode(): NodeId;
  removeNode(id: NodeId): void;  // graceful leave; allowed on any existing node
  killNode(id: NodeId): void;
  setGlobalFailureRate(p: number): void;
  setNodeFailureRate(id: NodeId, rates: { in: number; out: number }): void;
  updateSwimParams(partial: Partial<SwimParams>): void;
  getNodeDetail(id: NodeId): NodeDetail | null;
  // introspection used by stats + tests:
  runningNodes(): SwimNode[];               // not killed, id order
  groundTruth(): Map<NodeId, GroundTruth>;
  currentTick(): number;
}
```

Behavior:
- Constructor: create rng from seed; `params = { ...DEFAULT_SWIM, ...config.swim }`; call `addNode()` `config.nodeCount` times (join events from construction are discarded, not reported).
- `addNode`: id = counter++; seeds = up to `seedCount` distinct random running nodes (shuffle, slice); node constructed with the shared rng and current tick; queue `{kind:'joined'}` event for next report.
- `killNode`: add to killed set; set `pendingDetection = { id, tick }`; queue `killed` event. Killed nodes stay in the node map (they appear in ground truth as `'killed'`) but never process messages or ticks.
- `removeNode`: stamp+queue the node's `leaveDrafts()` as outgoing messages (they animate next tick), delete node from map, remember id in `departed` set, queue `left` event. Ground truth no longer contains it.
- `tick()` order (spec §6.2): increment tick → deliver arriving messages (dropped → `dropped` event; killed/absent target → silently discarded; else `onMessage`, queue reply drafts) → per running node in id order `onTick` → stamp all new drafts (failure injection, `deliverTick = tick + 1`), emit `sent` events and `PacketInfo`s → check detection → build snapshot (Task 8; until then a placeholder inline snapshot is fine, see Step 3).
- Failure injection at stamp time: `p = 1 - (1-global) * (1-out_from) * (1-in_to)`; `dropped = rng.next() < p`; increment counters.
- `recordChanges` helper: converts `StateChange`s to `state-change` events; when `to === 'suspect'` and subject is running in ground truth → `falseSuspicions++` on the observing node.
- Detection check: if `pendingDetection` set and every running node except the victim has entry for victim `dead` or absent → `lastDetectionLatency = tick - killTick`, clear pending.

- [ ] **Step 1: Write failing tests** — `src/sim/simulator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Simulator } from './simulator';

const mk = (over = {}) => new Simulator({ seed: 42, nodeCount: 8, ...over });

describe('Simulator', () => {
  it('creates nodeCount nodes with ids 0..n-1', () => {
    const sim = mk();
    expect(sim.runningNodes().map((n) => n.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('messages take exactly one tick to deliver', () => {
    const sim = mk();
    // run until something is sent, then verify it is delivered exactly next tick
    let report = sim.tick();
    while (report.packets.length === 0) report = sim.tick();
    const sent = report.packets.filter((p) => !p.willDrop).map((p) => p.msgId);
    expect(sent.length).toBeGreaterThan(0);
    const next = sim.tick();
    const delivered = next.events
      .filter((e) => e.kind === 'delivered')
      .map((e) => (e as { msg: { id: number } }).msg.id);
    for (const id of sent) expect(delivered).toContain(id);
  });

  it('is deterministic: same seed, same reports', () => {
    const a = mk();
    const b = mk();
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(a.tick())).toBe(JSON.stringify(b.tick()));
    }
  });

  it('global failure rate 1 drops every message', () => {
    const sim = mk({ globalFailureRate: 1 });
    for (let i = 0; i < 20; i++) {
      const r = sim.tick();
      expect(r.packets.every((p) => p.willDrop)).toBe(true);
      expect(r.events.filter((e) => e.kind === 'delivered')).toEqual([]);
    }
  });

  it('killNode stops the node and emits killed event', () => {
    const sim = mk();
    sim.killNode(3);
    const r = sim.tick();
    expect(r.events).toContainEqual({ kind: 'killed', nodeId: 3 });
    expect(sim.groundTruth().get(3)).toBe('killed');
    // killed node never sends
    for (let i = 0; i < 20; i++) {
      expect(sim.tick().packets.every((p) => p.from !== 3)).toBe(true);
    }
  });

  it('removeNode broadcasts leave and drops from ground truth', () => {
    const sim = mk();
    for (let i = 0; i < 40; i++) sim.tick(); // let views converge a bit
    sim.removeNode(2);
    const r = sim.tick();
    expect(r.events).toContainEqual({ kind: 'left', nodeId: 2 });
    expect(r.packets.some((p) => p.type === 'leave' && p.from === 2)).toBe(true);
    expect(sim.groundTruth().has(2)).toBe(false);
  });

  it('addNode joins with seeds and emits joined event', () => {
    const sim = mk();
    const id = sim.addNode();
    expect(id).toBe(8);
    const r = sim.tick();
    expect(r.events).toContainEqual({ kind: 'joined', nodeId: 8 });
    expect(sim.getNodeDetail(8)!.table.length).toBeGreaterThan(0);
  });

  it('getNodeDetail exposes failure rates and running flag', () => {
    const sim = mk();
    sim.setNodeFailureRate(1, { in: 0.5, out: 0.25 });
    const d = sim.getNodeDetail(1)!;
    expect(d.failureIn).toBe(0.5);
    expect(d.failureOut).toBe(0.25);
    expect(d.running).toBe(true);
    sim.killNode(1);
    expect(sim.getNodeDetail(1)!.running).toBe(false);
    expect(sim.getNodeDetail(999)).toBeNull();
  });

  it('updateSwimParams applies from next tick', () => {
    const sim = mk();
    sim.updateSwimParams({ protocolPeriod: 8 });
    expect(sim.params.protocolPeriod).toBe(8);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sim/simulator.test.ts` — FAIL.

- [ ] **Step 3: Implement** — `src/sim/simulator.ts`:

```ts
import { SwimNode, type StateChange } from './node';
import { mulberry32, type Rng } from './rng';
import {
  DEFAULT_SWIM,
  type GroundTruth, type Message, type MessageDraft, type NodeDetail, type NodeId,
  type PacketInfo, type SimulatorConfig, type SwimParams, type TickEvent, type TickReport,
} from './types';
import { buildSnapshot } from './stats';

export class Simulator {
  readonly params: SwimParams;

  private nodes = new Map<NodeId, SwimNode>();
  private killed = new Set<NodeId>();
  private departed = new Set<NodeId>();
  private inFlight: Message[] = [];
  private tickCount = 0;
  private nextNodeId = 0;
  private nextMsgId = 0;
  private rng: Rng;
  private globalFailureRate: number;
  private nodeFailure = new Map<NodeId, { in: number; out: number }>();
  private totalMessages = 0;
  private totalDropped = 0;
  private pendingDetection: { id: NodeId; tick: number } | null = null;
  private lastDetectionLatency: number | null = null;
  private pendingEvents: TickEvent[] = [];
  private pendingOutbox: Message[] = []; // e.g. leave messages queued between ticks

  constructor(config: SimulatorConfig) {
    this.rng = mulberry32(config.seed);
    this.params = { ...DEFAULT_SWIM, ...config.swim };
    this.globalFailureRate = config.globalFailureRate ?? 0;
    for (let i = 0; i < config.nodeCount; i++) this.addNode();
    this.pendingEvents = []; // initial joins are not reported
  }

  tick(): TickReport {
    this.tickCount++;
    const tick = this.tickCount;
    const events: TickEvent[] = [...this.pendingEvents];
    this.pendingEvents = [];
    const outbox: Message[] = [...this.pendingOutbox];
    this.pendingOutbox = [];

    // 1. deliver
    const arriving = this.inFlight.filter((m) => m.deliverTick === tick);
    this.inFlight = this.inFlight.filter((m) => m.deliverTick > tick);
    for (const msg of arriving) {
      if (msg.dropped) {
        events.push({ kind: 'dropped', msg });
        continue;
      }
      const target = this.nodes.get(msg.to);
      if (!target || this.killed.has(msg.to)) continue;
      const { drafts, changes } = target.onMessage(msg, tick);
      events.push({ kind: 'delivered', msg });
      this.recordChanges(target, changes, events);
      for (const d of drafts) outbox.push(this.stamp(target.id, d, tick));
    }

    // 2. per-node phase, id order
    for (const node of this.runningNodes()) {
      const { drafts, changes } = node.onTick(tick);
      this.recordChanges(node, changes, events);
      for (const d of drafts) outbox.push(this.stamp(node.id, d, tick));
    }

    // 3. register outbox
    const packets: PacketInfo[] = [];
    for (const msg of outbox) {
      this.inFlight.push(msg);
      events.push({ kind: 'sent', msg });
      packets.push({
        msgId: msg.id, from: msg.from, to: msg.to, type: msg.type,
        willDrop: msg.dropped, piggybackCount: msg.piggyback.length,
      });
    }
    this.totalMessages += outbox.length;

    this.checkDetection(tick);

    const snapshot = buildSnapshot({
      tick,
      runningNodes: this.runningNodes(),
      groundTruth: this.groundTruth(),
      messagesThisTick: outbox.length,
      totalMessages: this.totalMessages,
      totalDropped: this.totalDropped,
      lastDetectionLatency: this.lastDetectionLatency,
      nodeFailure: this.nodeFailure,
      globalFailureRate: this.globalFailureRate,
    });

    return { tick, events, packets, snapshot };
  }

  addNode(): NodeId {
    const id = this.nextNodeId++;
    const candidates = this.runningNodes().map((n) => n.id);
    const seeds = this.rng.shuffle(candidates).slice(0, this.params.seedCount);
    this.nodes.set(id, new SwimNode(id, seeds, this.params, this.rng, this.tickCount));
    this.pendingEvents.push({ kind: 'joined', nodeId: id });
    return id;
  }

  removeNode(id: NodeId): void {
    const node = this.nodes.get(id);
    if (!node) return;
    if (!this.killed.has(id)) {
      for (const d of node.leaveDrafts()) this.pendingOutbox.push(this.stamp(id, d, this.tickCount));
    }
    this.nodes.delete(id);
    this.killed.delete(id);
    this.nodeFailure.delete(id);
    this.departed.add(id);
    this.pendingEvents.push({ kind: 'left', nodeId: id });
    if (this.pendingDetection?.id === id) this.pendingDetection = null;
  }

  killNode(id: NodeId): void {
    if (!this.nodes.has(id) || this.killed.has(id)) return;
    this.killed.add(id);
    this.pendingDetection = { id, tick: this.tickCount };
    this.pendingEvents.push({ kind: 'killed', nodeId: id });
  }

  setGlobalFailureRate(p: number): void {
    this.globalFailureRate = p;
  }

  setNodeFailureRate(id: NodeId, rates: { in: number; out: number }): void {
    this.nodeFailure.set(id, { ...rates });
  }

  updateSwimParams(partial: Partial<SwimParams>): void {
    Object.assign(this.params, partial);
  }

  getNodeDetail(id: NodeId): NodeDetail | null {
    const node = this.nodes.get(id);
    if (!node) return null;
    const f = this.nodeFailure.get(id) ?? { in: 0, out: 0 };
    return {
      ...node.detail(this.tickCount),
      running: !this.killed.has(id),
      failureIn: f.in,
      failureOut: f.out,
    };
  }

  runningNodes(): SwimNode[] {
    return [...this.nodes.values()].filter((n) => !this.killed.has(n.id)).sort((a, b) => a.id - b.id);
  }

  groundTruth(): Map<NodeId, GroundTruth> {
    const truth = new Map<NodeId, GroundTruth>();
    for (const id of this.nodes.keys()) truth.set(id, this.killed.has(id) ? 'killed' : 'running');
    return truth;
  }

  currentTick(): number {
    return this.tickCount;
  }

  private stamp(from: NodeId, d: MessageDraft, tick: number): Message {
    const outRate = this.nodeFailure.get(from)?.out ?? 0;
    const inRate = this.nodeFailure.get(d.to)?.in ?? 0;
    const pDrop = 1 - (1 - this.globalFailureRate) * (1 - outRate) * (1 - inRate);
    const dropped = this.rng.next() < pDrop;
    if (dropped) {
      this.totalDropped++;
      const sender = this.nodes.get(from);
      if (sender) sender.counters.droppedOutbound++;
    }
    return { ...d, id: this.nextMsgId++, from, sentTick: tick, deliverTick: tick + 1, dropped };
  }

  private recordChanges(node: SwimNode, changes: StateChange[], events: TickEvent[]): void {
    for (const c of changes) {
      events.push({ kind: 'state-change', nodeId: node.id, subject: c.subject, from: c.from, to: c.to });
      if (c.to === 'suspect' && this.groundTruth().get(c.subject) === 'running') {
        node.counters.falseSuspicions++;
      }
    }
  }

  private checkDetection(tick: number): void {
    if (!this.pendingDetection) return;
    const { id, tick: killTick } = this.pendingDetection;
    for (const n of this.runningNodes()) {
      if (n.id === id) continue;
      const e = n.getEntry(id);
      if (e && e.state !== 'dead') return;
    }
    this.lastDetectionLatency = tick - killTick;
    this.pendingDetection = null;
  }
}
```

Until Task 8 exists, create a **temporary** `src/sim/stats.ts` so this task compiles (Task 8 replaces it with the real implementation and tests):

```ts
import type { SwimNode } from './node';
import type { GlobalSnapshot, GroundTruth, NodeId } from './types';

export interface SnapshotInput {
  tick: number;
  runningNodes: SwimNode[];
  groundTruth: Map<NodeId, GroundTruth>;
  messagesThisTick: number;
  totalMessages: number;
  totalDropped: number;
  lastDetectionLatency: number | null;
  nodeFailure: Map<NodeId, { in: number; out: number }>;
  globalFailureRate: number;
}

export function buildSnapshot(input: SnapshotInput): GlobalSnapshot {
  const groundTruth: GlobalSnapshot['groundTruth'] = {};
  for (const [id, s] of input.groundTruth) groundTruth[id] = s;
  const failureRates: GlobalSnapshot['failureRates'] = {};
  for (const [id, f] of input.nodeFailure) failureRates[id] = { ...f };
  return {
    tick: input.tick,
    groundTruth,
    perceived: {},
    aliveCount: 0, suspectCount: 0, deadCount: 0,
    convergence: 0,
    messagesThisTick: input.messagesThisTick,
    totalMessages: input.totalMessages,
    totalDropped: input.totalDropped,
    lastDetectionLatency: input.lastDetectionLatency,
    failureRates,
    globalFailureRate: input.globalFailureRate,
  };
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/sim` — ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(sim): Simulator tick loop, failure injection, node lifecycle"
```

---

### Task 8: Stats — perceived states, convergence, counts

**Files:**
- Modify: `src/sim/stats.ts` (replace placeholder logic; keep `SnapshotInput` shape)
- Test: `src/sim/stats.test.ts`

**Interfaces:**
- Consumes: `SwimNode.tableEntries()`, `SnapshotInput` from Task 7.
- Produces: real `buildSnapshot` plus two exported pure helpers (unit-tested directly):

```ts
export function computePerceived(
  views: { viewer: NodeId; entries: MembershipEntry[] }[],
  allIds: NodeId[],
): Record<NodeId, MemberState>;

export function computeConvergence(
  views: { viewer: NodeId; entries: MembershipEntry[] }[],
  truth: Map<NodeId, GroundTruth>,
): number;
```

Semantics:
- `computePerceived`: for each id in `allIds`, tally states across all viewers' entries (a viewer counts its own id as `alive`; missing entries don't vote). Majority state wins; ties broken by precedence `dead > suspect > alive`. Id with zero votes → `alive`.
- `computeConvergence` (spec §7.5): viewers = running nodes. For each viewer V and each id X ≠ V where X ∈ truth or X ∈ V's table: expected `running → alive`; `killed → dead or absent`. A `suspect` view of a running node is a mismatch. Result = matches / comparisons (1 if no comparisons).
- `buildSnapshot`: uses both helpers; `aliveCount/suspectCount/deadCount` derived from `perceived` over ids in ground truth.

- [ ] **Step 1: Write failing tests** — `src/sim/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeConvergence, computePerceived } from './stats';
import type { GroundTruth, MembershipEntry, NodeId } from './types';

const e = (id: number, state: MembershipEntry['state']): MembershipEntry =>
  ({ id, state, incarnation: 0, lastUpdateTick: 0 });

describe('computePerceived', () => {
  it('majority wins', () => {
    const views = [
      { viewer: 0, entries: [e(2, 'suspect')] },
      { viewer: 1, entries: [e(2, 'suspect')] },
      { viewer: 3, entries: [e(2, 'alive')] },
    ];
    expect(computePerceived(views, [2])[2]).toBe('suspect');
  });

  it('tie breaks by dead > suspect > alive', () => {
    const views = [
      { viewer: 0, entries: [e(2, 'alive')] },
      { viewer: 1, entries: [e(2, 'dead')] },
    ];
    expect(computePerceived(views, [2])[2]).toBe('dead');
  });

  it('unknown id defaults to alive', () => {
    expect(computePerceived([{ viewer: 0, entries: [] }], [5])[5]).toBe('alive');
  });
});

describe('computeConvergence', () => {
  const truth = (pairs: [NodeId, GroundTruth][]) => new Map(pairs);

  it('is 1 when every view matches ground truth', () => {
    const views = [
      { viewer: 0, entries: [e(1, 'alive')] },
      { viewer: 1, entries: [e(0, 'alive')] },
    ];
    expect(computeConvergence(views, truth([[0, 'running'], [1, 'running']]))).toBe(1);
  });

  it('counts missing entry for a running node as mismatch', () => {
    const views = [
      { viewer: 0, entries: [] },        // 0 does not know 1 -> mismatch
      { viewer: 1, entries: [e(0, 'alive')] },
    ];
    expect(computeConvergence(views, truth([[0, 'running'], [1, 'running']]))).toBe(0.5);
  });

  it('killed node: dead or absent both count as converged', () => {
    const views = [
      { viewer: 0, entries: [e(1, 'alive'), e(2, 'dead')] },
      { viewer: 1, entries: [e(0, 'alive')] }, // 2 absent -> also fine
    ];
    expect(computeConvergence(views, truth([[0, 'running'], [1, 'running'], [2, 'killed']]))).toBe(1);
  });

  it('suspect view of a running node is a mismatch', () => {
    const views = [
      { viewer: 0, entries: [e(1, 'suspect')] },
      { viewer: 1, entries: [e(0, 'alive')] },
    ];
    expect(computeConvergence(views, truth([[0, 'running'], [1, 'running']]))).toBe(0.5);
  });

  it('departed node still remembered as alive is a mismatch', () => {
    const views = [{ viewer: 0, entries: [e(9, 'alive')] }];
    expect(computeConvergence(views, truth([[0, 'running']]))).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sim/stats.test.ts` — FAIL.

- [ ] **Step 3: Implement** — replace `src/sim/stats.ts` body (keep `SnapshotInput`):

```ts
import type { SwimNode } from './node';
import type { GlobalSnapshot, GroundTruth, MemberState, MembershipEntry, NodeId } from './types';

export interface SnapshotInput {
  tick: number;
  runningNodes: SwimNode[];
  groundTruth: Map<NodeId, GroundTruth>;
  messagesThisTick: number;
  totalMessages: number;
  totalDropped: number;
  lastDetectionLatency: number | null;
  nodeFailure: Map<NodeId, { in: number; out: number }>;
  globalFailureRate: number;
}

export interface View {
  viewer: NodeId;
  entries: MembershipEntry[];
}

const PRECEDENCE: Record<MemberState, number> = { alive: 0, suspect: 1, dead: 2 };

export function computePerceived(views: View[], allIds: NodeId[]): Record<NodeId, MemberState> {
  const out: Record<NodeId, MemberState> = {};
  for (const id of allIds) {
    const votes: Record<MemberState, number> = { alive: 0, suspect: 0, dead: 0 };
    for (const v of views) {
      if (v.viewer === id) {
        votes.alive++;
        continue;
      }
      const entry = v.entries.find((x) => x.id === id);
      if (entry) votes[entry.state]++;
    }
    const best = (Object.keys(votes) as MemberState[]).reduce((a, b) =>
      votes[b] > votes[a] || (votes[b] === votes[a] && PRECEDENCE[b] > PRECEDENCE[a]) ? b : a,
    );
    out[id] = votes[best] === 0 ? 'alive' : best;
  }
  return out;
}

export function computeConvergence(views: View[], truth: Map<NodeId, GroundTruth>): number {
  let comparisons = 0;
  let matches = 0;
  for (const v of views) {
    const ids = new Set<NodeId>([...truth.keys(), ...v.entries.map((e) => e.id)]);
    ids.delete(v.viewer);
    for (const id of ids) {
      comparisons++;
      const entry = v.entries.find((x) => x.id === id);
      const gt = truth.get(id); // undefined => departed
      if (gt === 'running') {
        if (entry?.state === 'alive') matches++;
      } else {
        if (!entry || entry.state === 'dead') matches++;
      }
    }
  }
  return comparisons === 0 ? 1 : matches / comparisons;
}

export function buildSnapshot(input: SnapshotInput): GlobalSnapshot {
  const views: View[] = input.runningNodes.map((n) => ({ viewer: n.id, entries: n.tableEntries() }));
  const truthIds = [...input.groundTruth.keys()];
  const perceived = computePerceived(views, truthIds);

  const groundTruth: GlobalSnapshot['groundTruth'] = {};
  for (const [id, s] of input.groundTruth) groundTruth[id] = s;
  const failureRates: GlobalSnapshot['failureRates'] = {};
  for (const [id, f] of input.nodeFailure) failureRates[id] = { ...f };

  const counts = { alive: 0, suspect: 0, dead: 0 };
  for (const id of truthIds) counts[perceived[id]]++;

  return {
    tick: input.tick,
    groundTruth,
    perceived,
    aliveCount: counts.alive,
    suspectCount: counts.suspect,
    deadCount: counts.dead,
    convergence: computeConvergence(views, input.groundTruth),
    messagesThisTick: input.messagesThisTick,
    totalMessages: input.totalMessages,
    totalDropped: input.totalDropped,
    lastDetectionLatency: input.lastDetectionLatency,
    failureRates,
    globalFailureRate: input.globalFailureRate,
  };
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/sim` — ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(sim): convergence, perceived-state and snapshot stats"
```

---

### Task 9: Integration tests — protocol end-to-end

**Files:**
- Test: `src/sim/integration.test.ts`

**Interfaces:**
- Consumes: `Simulator` public API only. No production code changes expected; if a test exposes a bug, fix the bug (with the failing test as the guard).

- [ ] **Step 1: Write the tests** — `src/sim/integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Simulator } from './simulator';
import type { TickReport } from './types';

const run = (sim: Simulator, ticks: number): TickReport => {
  let r!: TickReport;
  for (let i = 0; i < ticks; i++) r = sim.tick();
  return r;
};

describe('protocol integration', () => {
  it('determinism over 500 ticks with mid-run actions', () => {
    const script = (sim: Simulator) => {
      const out: string[] = [];
      for (let t = 1; t <= 500; t++) {
        if (t === 50) sim.addNode();
        if (t === 100) sim.killNode(2);
        if (t === 200) sim.removeNode(5);
        if (t === 250) sim.setGlobalFailureRate(0.2);
        if (t === 350) sim.setGlobalFailureRate(0);
        out.push(JSON.stringify(sim.tick()));
      }
      return out.join('\n');
    };
    expect(script(new Simulator({ seed: 7, nodeCount: 12 })))
      .toBe(script(new Simulator({ seed: 7, nodeCount: 12 })));
  });

  it('converges to 100% with no failures (N=20)', () => {
    const sim = new Simulator({ seed: 42, nodeCount: 20 });
    let converged = false;
    for (let t = 0; t < 300 && !converged; t++) converged = sim.tick().snapshot.convergence === 1;
    expect(converged).toBe(true);
  });

  it('never issues false positives with zero failures', () => {
    const sim = new Simulator({ seed: 13, nodeCount: 15 });
    for (let t = 0; t < 400; t++) {
      const r = sim.tick();
      const suspicions = r.events.filter((e) => e.kind === 'state-change' && e.to === 'suspect');
      expect(suspicions).toEqual([]);
    }
  });

  it('detects a killed node cluster-wide within a bounded time', () => {
    const sim = new Simulator({ seed: 42, nodeCount: 12 });
    run(sim, 100); // converge
    sim.killNode(4);
    let latency: number | null = null;
    for (let t = 0; t < 120 && latency === null; t++) {
      latency = sim.tick().snapshot.lastDetectionLatency;
    }
    expect(latency).not.toBeNull();
    // period(4) + probe deadline(6) + suspectTimeout(12) + dissemination slack
    expect(latency!).toBeLessThanOrEqual(80);
  });

  it('isolated node is declared dead; healing revives it via refutation', () => {
    const sim = new Simulator({ seed: 42, nodeCount: 10 });
    run(sim, 100);
    sim.setNodeFailureRate(3, { in: 1, out: 1 });
    let dead = false;
    for (let t = 0; t < 200 && !dead; t++) {
      dead = sim.tick().snapshot.perceived[3] === 'dead';
    }
    expect(dead).toBe(true);

    sim.setNodeFailureRate(3, { in: 0, out: 0 });
    let revived = false;
    for (let t = 0; t < 400 && !revived; t++) {
      revived = sim.tick().snapshot.perceived[3] === 'alive';
    }
    expect(revived).toBe(true);
    expect(sim.getNodeDetail(3)!.incarnation).toBeGreaterThan(0);
  });

  it('graceful leave skips the suspect phase', () => {
    const sim = new Simulator({ seed: 42, nodeCount: 10 });
    run(sim, 100);
    sim.removeNode(6);
    for (let t = 0; t < 100; t++) {
      const r = sim.tick();
      const suspected6 = r.events.some((e) => e.kind === 'state-change' && e.subject === 6 && e.to === 'suspect');
      expect(suspected6).toBe(false);
    }
  });

  it('single-node cluster ticks without crashing', () => {
    const sim = new Simulator({ seed: 1, nodeCount: 1 });
    expect(() => run(sim, 50)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run src/sim/integration.test.ts`.

Expectation: these SHOULD pass against Tasks 2–8. If any fail, debug the engine (systematic-debugging skill), fix, and keep the test. Do not weaken assertions to pass; the bounds (300 ticks to converge, ≤80 latency, 400 to revive) have headroom by design. One caveat: the isolated-node revival depends on peers reaching out to the healed node (a healed node is `dead` in peers' views, so nobody probes it — it revives because IT still probes OTHERS and its acks/piggyback spread the refutation). If revival genuinely cannot happen within the bound, the deadPruneTicks GC (peers prune the dead entry, then re-learn the node as alive from its own announcements) is the designed recovery path — verify it engages rather than relaxing the test.

- [ ] **Step 3: Full suite + build**

Run: `npm test && npm run build` — ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(sim): end-to-end protocol integration tests"
```

---

### Task 10: SimController + useSimulation hook

**Files:**
- Create: `src/viz/useSimulation.ts`
- Test: `src/viz/useSimulation.test.ts`

**Interfaces:**
- Consumes: `Simulator` API.
- Produces:

```ts
export interface SimState {
  report: TickReport;
  running: boolean;
  tickMs: number;
  seed: number;
  nodeCount: number;              // initial count for restart
  convergenceHistory: number[];   // last 100 convergence values
  params: SwimParams;             // snapshot copy
  globalFailureRate: number;
}

export class SimController {
  constructor(seed?: number, nodeCount?: number);        // default 1, 12; runs 1 initial tick
  getState(): SimState;                                   // stable reference between emits
  subscribe(listener: () => void): () => void;
  play(): void; pause(): void; step(): void;              // step works only while paused
  setTickMs(ms: number): void;                            // clamp 200..5000; restart interval if running
  restart(seed: number, nodeCount: number): void;
  addNode(): void;
  removeNode(id: NodeId): void;
  killNode(id: NodeId): void;
  setGlobalFailureRate(p: number): void;
  setNodeFailureRate(id: NodeId, rates: { in: number; out: number }): void;
  updateSwimParams(p: Partial<SwimParams>): void;
  getNodeDetail(id: NodeId): NodeDetail | null;
  dispose(): void;                                        // clear interval
}

export function useSimulation(controller: SimController): SimState;
```

Implementation notes: state object replaced wholesale on every mutation (immutability for `useSyncExternalStore`); interval via `setInterval(() => this.step(true), tickMs)` where the private tick path ignores the paused guard; `subscribe`/`getState` must be arrow-bound. The hook is one line: `useSyncExternalStore(controller.subscribe, controller.getState)`.

- [ ] **Step 1: Write failing tests** — `src/viz/useSimulation.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimController } from './useSimulation';

describe('SimController', () => {
  afterEach(() => vi.useRealTimers());

  it('starts paused with one initial report', () => {
    const c = new SimController(1, 12);
    expect(c.getState().running).toBe(false);
    expect(c.getState().report.tick).toBe(1);
    c.dispose();
  });

  it('step advances one tick and notifies subscribers', () => {
    const c = new SimController(1, 12);
    const spy = vi.fn();
    c.subscribe(spy);
    c.step();
    expect(c.getState().report.tick).toBe(2);
    expect(spy).toHaveBeenCalledOnce();
    c.dispose();
  });

  it('play ticks on the interval; pause stops it', () => {
    vi.useFakeTimers();
    const c = new SimController(1, 12);
    c.setTickMs(1000);
    c.play();
    vi.advanceTimersByTime(3000);
    expect(c.getState().report.tick).toBe(4); // 1 initial + 3
    c.pause();
    vi.advanceTimersByTime(3000);
    expect(c.getState().report.tick).toBe(4);
    c.dispose();
  });

  it('step is ignored while running', () => {
    vi.useFakeTimers();
    const c = new SimController(1, 12);
    c.play();
    const before = c.getState().report.tick;
    c.step();
    expect(c.getState().report.tick).toBe(before);
    c.dispose();
  });

  it('restart swaps in a fresh simulator', () => {
    const c = new SimController(1, 12);
    c.step();
    c.restart(99, 5);
    const s = c.getState();
    expect(s.report.tick).toBe(1);
    expect(s.seed).toBe(99);
    expect(Object.keys(s.report.snapshot.groundTruth)).toHaveLength(5);
    c.dispose();
  });

  it('tracks convergence history capped at 100', () => {
    const c = new SimController(1, 5);
    for (let i = 0; i < 150; i++) c.step();
    expect(c.getState().convergenceHistory.length).toBe(100);
    c.dispose();
  });

  it('getState reference is stable until a mutation', () => {
    const c = new SimController(1, 5);
    const a = c.getState();
    expect(c.getState()).toBe(a);
    c.step();
    expect(c.getState()).not.toBe(a);
    c.dispose();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/viz/useSimulation.test.ts` — FAIL.

- [ ] **Step 3: Implement** — `src/viz/useSimulation.ts`:

```ts
import { useSyncExternalStore } from 'react';
import { Simulator } from '../sim/simulator';
import type { NodeDetail, NodeId, SwimParams, TickReport } from '../sim/types';

export interface SimState {
  report: TickReport;
  running: boolean;
  tickMs: number;
  seed: number;
  nodeCount: number;
  convergenceHistory: number[];
  params: SwimParams;
  globalFailureRate: number;
}

const clampTickMs = (ms: number) => Math.min(5000, Math.max(200, ms));

export class SimController {
  private sim: Simulator;
  private state: SimState;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private globalFailureRate = 0;

  constructor(seed = 1, nodeCount = 12) {
    this.sim = new Simulator({ seed, nodeCount });
    this.state = this.freshState(this.sim.tick(), seed, nodeCount, false, 2000, []);
  }

  getState = (): SimState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  play(): void {
    if (this.state.running) return;
    this.startTimer(this.state.tickMs);
    this.setState({ running: true });
  }

  pause(): void {
    this.stopTimer();
    if (this.state.running) this.setState({ running: false });
  }

  step(): void {
    if (this.state.running) return;
    this.advance();
  }

  setTickMs(ms: number): void {
    const tickMs = clampTickMs(ms);
    if (this.state.running) this.startTimer(tickMs);
    this.setState({ tickMs });
  }

  restart(seed: number, nodeCount: number): void {
    this.stopTimer();
    this.sim = new Simulator({ seed, nodeCount });
    this.globalFailureRate = 0;
    this.state = this.freshState(this.sim.tick(), seed, nodeCount, false, this.state.tickMs, []);
    this.emit();
  }

  addNode(): void {
    this.sim.addNode();
    this.emit();
  }

  removeNode(id: NodeId): void {
    this.sim.removeNode(id);
    this.emit();
  }

  killNode(id: NodeId): void {
    this.sim.killNode(id);
    this.emit();
  }

  setGlobalFailureRate(p: number): void {
    this.globalFailureRate = p;
    this.sim.setGlobalFailureRate(p);
    this.setState({ globalFailureRate: p });
  }

  setNodeFailureRate(id: NodeId, rates: { in: number; out: number }): void {
    this.sim.setNodeFailureRate(id, rates);
    this.emit();
  }

  updateSwimParams(p: Partial<SwimParams>): void {
    this.sim.updateSwimParams(p);
    this.setState({ params: { ...this.sim.params } });
  }

  getNodeDetail(id: NodeId): NodeDetail | null {
    return this.sim.getNodeDetail(id);
  }

  dispose(): void {
    this.stopTimer();
  }

  private advance(): void {
    const report = this.sim.tick();
    const history = [...this.state.convergenceHistory, report.snapshot.convergence].slice(-100);
    this.setState({ report, convergenceHistory: history });
  }

  private startTimer(tickMs: number): void {
    this.stopTimer();
    this.timer = setInterval(() => this.advance(), tickMs);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private freshState(
    report: TickReport, seed: number, nodeCount: number,
    running: boolean, tickMs: number, history: number[],
  ): SimState {
    return {
      report, running, tickMs, seed, nodeCount,
      convergenceHistory: [...history, report.snapshot.convergence].slice(-100),
      params: { ...this.sim.params },
      globalFailureRate: this.globalFailureRate,
    };
  }

  private setState(partial: Partial<SimState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private emit(): void {
    this.state = { ...this.state };
    for (const l of this.listeners) l();
  }
}

export function useSimulation(controller: SimController): SimState {
  return useSyncExternalStore(controller.subscribe, controller.getState);
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/viz/useSimulation.test.ts` — PASS. Full suite: `npm test` — PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(viz): SimController and useSimulation hook"
```

---

### Task 11: Ring layout + node rendering + base styles

**Files:**
- Create: `src/viz/layout.ts`, `src/viz/Ring.tsx`, `src/viz/viz.css`
- Modify: `src/main.tsx` (import `viz.css`), delete Vite boilerplate (`src/App.css`, `src/index.css`, logo assets, boilerplate `App.tsx` content — App gets rewritten in Task 15; for now render `<div />`)
- Test: `src/viz/layout.test.ts`, `src/viz/Ring.test.tsx`

**Interfaces:**
- Consumes: `GlobalSnapshot`, `NodeId`, `MemberState`.
- Produces:

```ts
// layout.ts — pure geometry, unit-testable
export interface Pt { x: number; y: number; }
export const VIEW = { size: 800, cx: 400, cy: 400, r: 320 };
export function nodePositions(ids: NodeId[]): Map<NodeId, Pt>; // ids sorted asc; angle 2π·i/N − π/2
export function arcPath(a: Pt, b: Pt): string; // quadratic Bézier, bulge right-of-travel: k = 0.18·len + 10

// Ring.tsx
export function Ring(props: {
  snapshot: GlobalSnapshot;
  selected: NodeId | null;
  onSelect: (id: NodeId | null) => void;
  children?: React.ReactNode;  // Packets layer renders inside the same SVG
  svgRef?: React.Ref<SVGSVGElement>;
}): JSX.Element;
```

Ring renders one `<svg viewBox="0 0 800 800">`: a faint guide circle, `children`, then one `<g class="node" data-testid="node">` per id in `snapshot.groundTruth` — circle styled by `perceived[id]`, class `killed-undetected` when ground truth is `killed` but perceived is `alive` (renders a ☠ text badge), a dashed outer circle with opacity `max(in,out)` when the node has failure rates > 0, and an id `<text>` label. Click toggles selection via `onSelect`. Node positions transition smoothly (CSS `transition` on transform; position applied as `transform: translate(x, y)` on the `<g>`).

- [ ] **Step 1: Write failing layout tests** — `src/viz/layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { arcPath, nodePositions, VIEW } from './layout';

describe('nodePositions', () => {
  it('places N nodes evenly on the ring, first at 12 o-clock', () => {
    const pos = nodePositions([0, 1, 2, 3]);
    expect(pos.get(0)!.x).toBeCloseTo(VIEW.cx);
    expect(pos.get(0)!.y).toBeCloseTo(VIEW.cy - VIEW.r);
    expect(pos.get(1)!.x).toBeCloseTo(VIEW.cx + VIEW.r);
    expect(pos.get(1)!.y).toBeCloseTo(VIEW.cy);
  });

  it('all points lie on the ring radius', () => {
    for (const p of nodePositions([0, 1, 2, 3, 4, 5, 6]).values()) {
      expect(Math.hypot(p.x - VIEW.cx, p.y - VIEW.cy)).toBeCloseTo(VIEW.r);
    }
  });

  it('sorts ids so positions are stable regardless of input order', () => {
    expect(nodePositions([3, 0, 2, 1])).toEqual(nodePositions([0, 1, 2, 3]));
  });
});

describe('arcPath', () => {
  it('produces a quadratic path from a to b', () => {
    const d = arcPath({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(d).toMatch(/^M 0 0 Q [\d.-]+ [\d.-]+ 100 0$/);
  });

  it('bulges to the right of travel (A→B and B→A use different lanes)', () => {
    const ab = arcPath({ x: 0, y: 0 }, { x: 100, y: 0 });
    const ba = arcPath({ x: 100, y: 0 }, { x: 0, y: 0 });
    const ctrlY = (d: string) => Number(d.split(' ')[5]); // "M x y Q cx cy x2 y2" -> index 5 = cy
    expect(ctrlY(ab)).toBeLessThan(0);    // right of +x travel is -y (SVG y-down)
    expect(ctrlY(ba)).toBeGreaterThan(0);
  });
});
```

Note on the right-of-travel convention: with perpendicular `(py, -px)` for direction `(px, py)`, travel along +x gives perpendicular `(0, -1)` — upward on screen. Both tests and implementation must use this convention.

- [ ] **Step 2: Run to verify failure, implement layout** — `src/viz/layout.ts`:

```ts
import type { NodeId } from '../sim/types';

export interface Pt { x: number; y: number; }

export const VIEW = { size: 800, cx: 400, cy: 400, r: 320 };

export function nodePositions(ids: NodeId[]): Map<NodeId, Pt> {
  const sorted = [...ids].sort((a, b) => a - b);
  const out = new Map<NodeId, Pt>();
  sorted.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / sorted.length - Math.PI / 2;
    out.set(id, { x: VIEW.cx + VIEW.r * Math.cos(angle), y: VIEW.cy + VIEW.r * Math.sin(angle) });
  });
  return out;
}

export function arcPath(a: Pt, b: Pt): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const k = 0.18 * len + 10;
  // perpendicular right-of-travel = (dy/len, -dx/len); control = mid + perp * k
  const cx = (a.x + b.x) / 2 + (dy / len) * k;
  const cy = (a.y + b.y) / 2 + (-dx / len) * k;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}
```

Run: `npx vitest run src/viz/layout.test.ts` — PASS.

- [ ] **Step 3: Write failing Ring test** — `src/viz/Ring.test.tsx`:

```tsx
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
});
```

Design note: make `Ring` return a `<g>` (not the `<svg>`) so the test wraps it and Task 15's App owns the single `<svg>` element (needed for `pauseAnimations`). Export a companion `RingSvg` wrapper if convenient — but App composing `<svg><Ring/><Packets/></svg>` directly is simplest.

- [ ] **Step 4: Implement Ring** — `src/viz/Ring.tsx`:

```tsx
import type { GlobalSnapshot, NodeId } from '../sim/types';
import { nodePositions, VIEW } from './layout';

interface RingProps {
  snapshot: GlobalSnapshot;
  selected: NodeId | null;
  onSelect: (id: NodeId | null) => void;
}

export function Ring({ snapshot, selected, onSelect }: RingProps) {
  const ids = Object.keys(snapshot.groundTruth).map(Number);
  const positions = nodePositions(ids);

  return (
    <g>
      <circle className="ring-guide" cx={VIEW.cx} cy={VIEW.cy} r={VIEW.r} />
      {ids.map((id) => {
        const p = positions.get(id)!;
        const perceived = snapshot.perceived[id];
        const undetectedKill = snapshot.groundTruth[id] === 'killed' && perceived !== 'dead';
        const f = snapshot.failureRates[id];
        const failureOpacity = f ? Math.max(f.in, f.out) : 0;
        const cls = [
          'node', perceived,
          undetectedKill ? 'killed-undetected' : '',
          selected === id ? 'selected' : '',
        ].filter(Boolean).join(' ');
        return (
          <g
            key={id}
            data-testid="node"
            className={cls}
            style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
            onClick={() => onSelect(selected === id ? null : id)}
          >
            {failureOpacity > 0 && (
              <circle className="failure-ring" r={22} style={{ opacity: failureOpacity }} />
            )}
            <circle className="node-body" r={14} />
            <text className="node-label" dy="4">{id}</text>
            {undetectedKill && <text className="skull" y={-20}>&#9760;</text>}
          </g>
        );
      })}
    </g>
  );
}
```

- [ ] **Step 5: Base styles** — `src/viz/viz.css` (imported from `src/main.tsx`; delete `src/index.css`, `src/App.css`, `src/assets/`, and reduce `src/App.tsx` to `export default function App() { return <div />; }` until Task 15):

```css
:root {
  --bg: #0f1218;
  --panel: #181d26;
  --panel-border: #2a3140;
  --text: #d7dde8;
  --text-dim: #8a93a5;
  --alive: #43d17a;
  --suspect: #f5b942;
  --dead: #5b6372;
  --ping: #4f9cf9;
  --ack: #43d17a;
  --ping-req: #a78bfa;
  --leave: #9ca3af;
  --danger: #ef5350;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 system-ui, sans-serif;
}

.ring-guide { fill: none; stroke: var(--panel-border); stroke-dasharray: 3 6; }

.node { cursor: pointer; transition: transform 600ms ease; }
.node .node-body { stroke-width: 2; }
.node.alive .node-body { fill: var(--alive); stroke: #2a7d4d; }
.node.suspect .node-body { fill: var(--suspect); stroke: #a1782a; animation: pulse 1s ease-in-out infinite; }
.node.dead .node-body { fill: none; stroke: var(--dead); }
.node.selected .node-body { stroke: #fff; stroke-width: 3; }
.node-label { fill: #0f1218; font-size: 12px; font-weight: 700; text-anchor: middle; }
.node.dead .node-label { fill: var(--dead); }
.skull { font-size: 14px; text-anchor: middle; }
.failure-ring { fill: none; stroke: var(--danger); stroke-dasharray: 4 4; }

@keyframes pulse {
  50% { opacity: 0.55; }
}

.packet.ping { fill: var(--ping); }
.packet.ack { fill: var(--ack); }
.packet.ping-req { fill: var(--ping-req); }
.packet.ping-req-ping { fill: var(--ping-req); opacity: 0.75; }
.packet.ping-req-ack { fill: var(--ack); opacity: 0.75; }
.packet.leave { fill: var(--leave); }
```

- [ ] **Step 6: Verify**

Run: `npx vitest run src/viz` — PASS. `npm run build` — PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(viz): ring layout, node rendering, base styles"
```

---

### Task 12: Packets — SMIL arc animation

**Files:**
- Create: `src/viz/Packets.tsx`
- Test: `src/viz/Packets.test.tsx`

**Interfaces:**
- Consumes: `PacketInfo[]`, `nodePositions`, `arcPath`, `tickMs`.
- Produces:

```tsx
export function Packets(props: {
  packets: PacketInfo[];
  ids: NodeId[];     // current ground-truth ids for positioning
  tick: number;      // report tick, part of the element key -> remount per tick
  tickMs: number;
}): JSX.Element;
```

Each packet renders (inside the parent SVG):

```tsx
<g key={`${tick}-${p.msgId}`} data-testid="packet" className={`packet ${p.type}`}>
  <circle r={3 + p.piggybackCount * 0.5} />
  {p.willDrop ? (
    <>
      <animateMotion dur={`${tickMs}ms`} path={d} keyPoints="0;0.6" keyTimes="0;1"
        calcMode="linear" fill="freeze" />
      <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.8;1"
        dur={`${tickMs}ms`} fill="freeze" />
    </>
  ) : (
    <animateMotion dur={`${tickMs}ms`} path={d} fill="freeze" />
  )}
</g>
```

where `d = arcPath(positions.get(p.from)!, positions.get(p.to)!)`. Packets whose endpoints are no longer in `ids` (node just removed) are skipped. Sender endpoint of a `leave` message is already gone from ground truth in the same report — so `Packets` must accept a position map covering both current ids and the packet endpoints: compute positions from `ids ∪ {p.from, p.to}` (departed node keeps its last slot for one tick; minor visual approximation, acceptable).

- [ ] **Step 1: Write failing tests** — `src/viz/Packets.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Packets } from './Packets';
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/viz/Packets.test.tsx` — FAIL.

- [ ] **Step 3: Implement** — `src/viz/Packets.tsx`:

```tsx
import type { NodeId, PacketInfo } from '../sim/types';
import { arcPath, nodePositions } from './layout';

interface PacketsProps {
  packets: PacketInfo[];
  ids: NodeId[];
  tick: number;
  tickMs: number;
}

export function Packets({ packets, ids, tick, tickMs }: PacketsProps) {
  const allIds = new Set<NodeId>(ids);
  for (const p of packets) {
    allIds.add(p.from);
    allIds.add(p.to);
  }
  const positions = nodePositions([...allIds]);

  return (
    <g>
      {packets.map((p) => {
        const from = positions.get(p.from);
        const to = positions.get(p.to);
        if (!from || !to) return null;
        const d = arcPath(from, to);
        const dur = `${tickMs}ms`;
        return (
          <g key={`${tick}-${p.msgId}`} data-testid="packet" className={`packet ${p.type}`}>
            <circle r={3 + p.piggybackCount * 0.5} />
            {p.willDrop ? (
              <>
                <animateMotion dur={dur} path={d} keyPoints="0;0.6" keyTimes="0;1" calcMode="linear" fill="freeze" />
                <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.8;1" dur={dur} fill="freeze" />
              </>
            ) : (
              <animateMotion dur={dur} path={d} fill="freeze" />
            )}
          </g>
        );
      })}
    </g>
  );
}
```

Caveat: `nodePositions` over `ids ∪ endpoints` can shift slots when a departed endpoint id sorts into the middle — accepted single-tick visual approximation (spec: departed nodes leave the ring; their final messages fly from the recomputed slot).

TypeScript may not know `keyPoints`/`keyTimes` props on `animateMotion` in older React types; React 19 types include them. If the build complains, use `React.createElement('animateMotion', {...})` — do NOT add `@ts-ignore` scattered casts; a single typed helper is acceptable.

- [ ] **Step 4: Verify pass**

Run: `npx vitest run src/viz/Packets.test.tsx` — PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(viz): packet arc animation with SMIL animateMotion"
```

---

### Task 13: NodeInspector panel

**Files:**
- Create: `src/viz/NodeInspector.tsx`
- Test: `src/viz/NodeInspector.test.tsx`

**Interfaces:**
- Consumes: `NodeDetail`, `GlobalSnapshot`, controller callbacks.
- Produces:

```tsx
export function NodeInspector(props: {
  detail: NodeDetail;
  snapshot: GlobalSnapshot;
  onClose: () => void;
  onSetFailureRate: (id: NodeId, rates: { in: number; out: number }) => void;
  onKill: (id: NodeId) => void;
  onRemove: (id: NodeId) => void;
}): JSX.Element;
```

Renders a side panel (`<aside class="inspector">`):
- Header: `Node {id}`, running/killed badge, close button (`aria-label="close"`).
- Facts: incarnation, phase offset.
- Failure controls: two `<input type="range" min="0" max="1" step="0.05">` (labels "in", "out") calling `onSetFailureRate` with the changed axis; "Isolate" button → `onSetFailureRate(id, {in: 1, out: 1})`; "Heal" button → `{in: 0, out: 0}`.
- Actions: "Kill" → `onKill(id)`; "Leave (graceful)" → `onRemove(id)`.
- Membership table: one row per entry — peer id, state, incarnation, staleness (`snapshot.tick − lastUpdateTick`). Row gets class `mismatch` when the view disagrees with ground truth (running but not alive; killed but not dead; departed [absent from ground truth] but not dead).
- Counters: sent/received per message type, droppedOutbound, falseSuspicions, refutations.
- Probes in flight: target + startTick + direct/indirect stage.

- [ ] **Step 1: Write failing tests** — `src/viz/NodeInspector.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeInspector } from './NodeInspector';
import type { GlobalSnapshot, NodeDetail } from '../sim/types';

const detail = (over: Partial<NodeDetail> = {}): NodeDetail => ({
  id: 1, running: true, incarnation: 2, phaseOffset: 3,
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
};

describe('NodeInspector', () => {
  it('shows identity and incarnation', () => {
    render(<NodeInspector detail={detail()} snapshot={snapshot} onClose={() => {}}
      onSetFailureRate={() => {}} onKill={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/Node 1/)).toBeTruthy();
    expect(screen.getByText(/incarnation/i).nextElementSibling?.textContent).toBe('2');
  });

  it('marks rows that disagree with ground truth', () => {
    render(<NodeInspector detail={detail()} snapshot={snapshot} onClose={() => {}}
      onSetFailureRate={() => {}} onKill={() => {}} onRemove={() => {}} />);
    const rows = screen.getAllByTestId('member-row');
    expect(rows[0].getAttribute('class') ?? '').not.toContain('mismatch'); // 0 alive, running
    expect(rows[1].getAttribute('class')).toContain('mismatch');           // 2 alive, killed
    expect(rows[2].getAttribute('class')).toContain('mismatch');           // 3 suspect, running
  });

  it('isolate button sets both rates to 1', () => {
    const onSet = vi.fn();
    render(<NodeInspector detail={detail()} snapshot={snapshot} onClose={() => {}}
      onSetFailureRate={onSet} onKill={() => {}} onRemove={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /isolate/i }));
    expect(onSet).toHaveBeenCalledWith(1, { in: 1, out: 1 });
  });

  it('kill and leave dispatch with node id', () => {
    const onKill = vi.fn();
    const onRemove = vi.fn();
    render(<NodeInspector detail={detail()} snapshot={snapshot} onClose={() => {}}
      onSetFailureRate={() => {}} onKill={onKill} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /^kill$/i }));
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(onKill).toHaveBeenCalledWith(1);
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run to verify failure, implement** — `src/viz/NodeInspector.tsx`:

```tsx
import type { GlobalSnapshot, MembershipEntry, NodeDetail, NodeId } from '../sim/types';

interface Props {
  detail: NodeDetail;
  snapshot: GlobalSnapshot;
  onClose: () => void;
  onSetFailureRate: (id: NodeId, rates: { in: number; out: number }) => void;
  onKill: (id: NodeId) => void;
  onRemove: (id: NodeId) => void;
}

function isMismatch(entry: MembershipEntry, snapshot: GlobalSnapshot): boolean {
  const gt = snapshot.groundTruth[entry.id]; // undefined => departed
  if (gt === 'running') return entry.state !== 'alive';
  return entry.state !== 'dead';
}

export function NodeInspector({ detail, snapshot, onClose, onSetFailureRate, onKill, onRemove }: Props) {
  const d = detail;
  return (
    <aside className="inspector">
      <header>
        <h2>Node {d.id} <span className={d.running ? 'badge running' : 'badge killed'}>{d.running ? 'running' : 'killed'}</span></h2>
        <button aria-label="close" onClick={onClose}>×</button>
      </header>

      <dl className="facts">
        <dt>incarnation</dt><dd>{d.incarnation}</dd>
        <dt>phase offset</dt><dd>{d.phaseOffset}</dd>
      </dl>

      <section>
        <h3>Failure rates</h3>
        <label>in {d.failureIn.toFixed(2)}
          <input type="range" min="0" max="1" step="0.05" value={d.failureIn}
            onChange={(e) => onSetFailureRate(d.id, { in: Number(e.target.value), out: d.failureOut })} />
        </label>
        <label>out {d.failureOut.toFixed(2)}
          <input type="range" min="0" max="1" step="0.05" value={d.failureOut}
            onChange={(e) => onSetFailureRate(d.id, { in: d.failureIn, out: Number(e.target.value) })} />
        </label>
        <div className="row">
          <button onClick={() => onSetFailureRate(d.id, { in: 1, out: 1 })}>Isolate</button>
          <button onClick={() => onSetFailureRate(d.id, { in: 0, out: 0 })}>Heal</button>
        </div>
      </section>

      <section className="row">
        <button className="danger" onClick={() => onKill(d.id)} disabled={!d.running}>Kill</button>
        <button onClick={() => onRemove(d.id)}>Leave (graceful)</button>
      </section>

      <section>
        <h3>Membership view</h3>
        <table>
          <thead><tr><th>peer</th><th>state</th><th>inc</th><th>stale</th></tr></thead>
          <tbody>
            {d.table.map((e) => (
              <tr key={e.id} data-testid="member-row" className={isMismatch(e, snapshot) ? 'mismatch' : ''}>
                <td>{e.id}</td><td>{e.state}</td><td>{e.incarnation}</td>
                <td>{snapshot.tick - e.lastUpdateTick}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Probes in flight</h3>
        {d.probes.length === 0 ? <p className="dim">none</p> : (
          <ul>
            {d.probes.map((p) => (
              <li key={p.target}>→ {p.target} (t{p.startTick}, {p.indirectSent ? 'indirect' : 'direct'})</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Counters</h3>
        <dl className="facts">
          {Object.entries(d.counters.sent).map(([t, n]) => (
            <span key={t}><dt>sent {t}</dt><dd>{n}</dd></span>
          ))}
          {Object.entries(d.counters.received).map(([t, n]) => (
            <span key={t}><dt>recv {t}</dt><dd>{n}</dd></span>
          ))}
          <dt>dropped out</dt><dd>{d.counters.droppedOutbound}</dd>
          <dt>false suspicions</dt><dd>{d.counters.falseSuspicions}</dd>
          <dt>refutations</dt><dd>{d.counters.refutations}</dd>
        </dl>
      </section>
    </aside>
  );
}
```

Add inspector styles to `src/viz/viz.css`:

```css
.inspector {
  background: var(--panel);
  border-left: 1px solid var(--panel-border);
  padding: 12px 16px;
  overflow-y: auto;
}
.inspector header { display: flex; justify-content: space-between; align-items: center; }
.inspector h2 { font-size: 16px; margin: 0; }
.inspector h3 { font-size: 12px; text-transform: uppercase; color: var(--text-dim); margin: 14px 0 6px; }
.inspector table { width: 100%; border-collapse: collapse; font-size: 12px; }
.inspector th, .inspector td { text-align: left; padding: 2px 6px; border-bottom: 1px solid var(--panel-border); }
.inspector tr.mismatch td { color: var(--danger); }
.badge { font-size: 11px; padding: 1px 6px; border-radius: 8px; margin-left: 6px; }
.badge.running { background: #1d3b2a; color: var(--alive); }
.badge.killed { background: #3b1d1d; color: var(--danger); }
.facts { display: grid; grid-template-columns: auto auto; gap: 2px 10px; font-size: 12px; }
.facts dt { color: var(--text-dim); }
.facts dd { margin: 0; }
.row { display: flex; gap: 8px; margin: 6px 0; }
.dim { color: var(--text-dim); }
button.danger { background: #3b1d1d; color: var(--danger); }
.inspector label { display: block; font-size: 12px; margin: 4px 0; }
.inspector input[type='range'] { width: 100%; }
```

- [ ] **Step 3: Verify pass**

Run: `npx vitest run src/viz/NodeInspector.test.tsx` — PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(viz): node inspector panel"
```

---

### Task 14: GlobalStats bar + convergence sparkline

**Files:**
- Create: `src/viz/GlobalStats.tsx`
- Test: `src/viz/GlobalStats.test.tsx`

**Interfaces:**
- Consumes: `GlobalSnapshot`, `convergenceHistory: number[]`.
- Produces:

```tsx
export function GlobalStats(props: { snapshot: GlobalSnapshot; history: number[] }): JSX.Element;
export function sparklinePoints(history: number[], w: number, h: number): string; // exported for tests
```

`sparklinePoints`: maps history values (0..1) onto an SVG `<polyline>` points string, x spread over width, y inverted (1 → top). Single value → flat segment.

Bar shows: tick, alive/suspect/dead counts, convergence % (1 decimal), msgs this tick, total msgs, dropped, last detection latency (or —), and the sparkline `<svg width="120" height="28">`.

- [ ] **Step 1: Write failing tests** — `src/viz/GlobalStats.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run to verify failure, implement** — `src/viz/GlobalStats.tsx`:

```tsx
import type { GlobalSnapshot } from '../sim/types';

export function sparklinePoints(history: number[], w: number, h: number): string {
  if (history.length === 0) return '';
  const vals = history.length === 1 ? [history[0], history[0]] : history;
  return vals
    .map((v, i) => `${(i / (vals.length - 1)) * w},${(1 - v) * h}`)
    .join(' ');
}

function Stat({ label, value, testId }: { label: string; value: string | number; testId?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value" data-testid={testId}>{value}</span>
    </div>
  );
}

export function GlobalStats({ snapshot, history }: { snapshot: GlobalSnapshot; history: number[] }) {
  const s = snapshot;
  return (
    <div className="global-stats">
      <Stat label="tick" value={s.tick} />
      <Stat label="alive" value={s.aliveCount} />
      <Stat label="suspect" value={s.suspectCount} />
      <Stat label="dead" value={s.deadCount} />
      <Stat label="convergence" value={`${(s.convergence * 100).toFixed(1)}%`} />
      <Stat label="msgs/tick" value={s.messagesThisTick} />
      <Stat label="total msgs" value={s.totalMessages} />
      <Stat label="dropped" value={s.totalDropped} />
      <Stat label="detect latency" value={s.lastDetectionLatency ?? '—'} testId="latency" />
      <svg className="sparkline" width="120" height="28" viewBox="0 0 120 28">
        <polyline points={sparklinePoints(history, 120, 28)} fill="none" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
```

Add to `viz.css`:

```css
.global-stats {
  display: flex; gap: 18px; align-items: center;
  background: var(--panel); border-bottom: 1px solid var(--panel-border);
  padding: 8px 16px;
}
.stat { display: flex; flex-direction: column; }
.stat-label { font-size: 10px; text-transform: uppercase; color: var(--text-dim); }
.stat-value { font-size: 15px; font-variant-numeric: tabular-nums; }
.sparkline polyline { stroke: var(--alive); }
```

- [ ] **Step 3: Verify pass**

Run: `npx vitest run src/viz/GlobalStats.test.tsx` — PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(viz): global stats bar with convergence sparkline"
```

---

### Task 15: Controls + App composition

**Files:**
- Create: `src/viz/Controls.tsx`
- Modify: `src/App.tsx` (full rewrite), `src/viz/viz.css` (layout styles)
- Test: `src/viz/App.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces:

```tsx
export function Controls(props: {
  state: SimState;
  onPlay: () => void; onPause: () => void; onStep: () => void;
  onTickMs: (ms: number) => void;
  onRestart: (seed: number, nodeCount: number) => void;
  onAddNode: () => void;
  onGlobalFailureRate: (p: number) => void;
  onParams: (p: Partial<SwimParams>) => void;
}): JSX.Element;
```

Controls bar: Play/Pause toggle button (label reflects state), Step button (disabled while running), tick-ms slider (200–5000 step 100, shows value), seed number input + node-count number input + Restart button, Add node button, global failure slider (0–1 step 0.05, shows value), and a `<details>` drawer "SWIM params" with number inputs for protocolPeriod, indirectProbes, suspectTimeout, maxPiggyback, seedCount (each `onChange` → `onParams({key: Number(value)})`).

`App.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { SimController, useSimulation } from './viz/useSimulation';
import { Ring } from './viz/Ring';
import { Packets } from './viz/Packets';
import { NodeInspector } from './viz/NodeInspector';
import { GlobalStats } from './viz/GlobalStats';
import { Controls } from './viz/Controls';
import { VIEW } from './viz/layout';
import type { NodeId } from './sim/types';

export default function App() {
  const controllerRef = useRef<SimController | null>(null);
  controllerRef.current ??= new SimController();
  const controller = controllerRef.current;

  const state = useSimulation(controller);
  const [selected, setSelected] = useState<NodeId | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // SMIL pause/resume follows sim state; step un-pauses for one tick duration
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (state.running) svg.unpauseAnimations();
    else {
      svg.unpauseAnimations(); // let the freshly stepped tick animate...
      const t = setTimeout(() => svg.pauseAnimations(), state.tickMs);
      return () => clearTimeout(t);
    }
  }, [state.report.tick, state.running, state.tickMs]);

  useEffect(() => () => controller.dispose(), [controller]);

  const detail = selected !== null ? controller.getNodeDetail(selected) : null;
  const ids = Object.keys(state.report.snapshot.groundTruth).map(Number);

  return (
    <div className={`app ${detail ? 'with-inspector' : ''}`}>
      <GlobalStats snapshot={state.report.snapshot} history={state.convergenceHistory} />
      <main>
        <svg ref={svgRef} viewBox={`0 0 ${VIEW.size} ${VIEW.size}`} className="ring-svg">
          <Packets packets={state.report.packets} ids={ids} tick={state.report.tick} tickMs={state.tickMs} />
          <Ring snapshot={state.report.snapshot} selected={selected} onSelect={setSelected} />
        </svg>
      </main>
      {detail && (
        <NodeInspector
          detail={detail}
          snapshot={state.report.snapshot}
          onClose={() => setSelected(null)}
          onSetFailureRate={(id, r) => controller.setNodeFailureRate(id, r)}
          onKill={(id) => { controller.killNode(id); }}
          onRemove={(id) => { controller.removeNode(id); setSelected(null); }}
        />
      )}
      <Controls
        state={state}
        onPlay={() => controller.play()}
        onPause={() => controller.pause()}
        onStep={() => controller.step()}
        onTickMs={(ms) => controller.setTickMs(ms)}
        onRestart={(seed, n) => { setSelected(null); controller.restart(seed, n); }}
        onAddNode={() => controller.addNode()}
        onGlobalFailureRate={(p) => controller.setGlobalFailureRate(p)}
        onParams={(p) => controller.updateSwimParams(p)}
      />
    </div>
  );
}
```

Layout CSS (add to `viz.css`):

```css
.app {
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-columns: 1fr;
  height: 100vh;
}
.app.with-inspector { grid-template-columns: 1fr 320px; }
.app.with-inspector .global-stats, .app.with-inspector .controls { grid-column: 1 / -1; }
.app.with-inspector .inspector { grid-row: 2; grid-column: 2; }
main { grid-row: 2; grid-column: 1; display: flex; justify-content: center; min-height: 0; }
.ring-svg { height: 100%; max-width: 100%; }
.controls {
  display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
  background: var(--panel); border-top: 1px solid var(--panel-border);
  padding: 8px 16px; font-size: 12px;
}
.controls label { display: flex; gap: 6px; align-items: center; }
.controls button {
  background: #232a38; color: var(--text); border: 1px solid var(--panel-border);
  border-radius: 4px; padding: 4px 12px; cursor: pointer;
}
.controls button:hover { background: #2c3547; }
.controls input[type='number'] { width: 64px; background: #232a38; color: var(--text); border: 1px solid var(--panel-border); }
.controls details { position: relative; }
.controls details > div { display: flex; gap: 10px; padding: 6px 0; }
```

`Controls.tsx`:

```tsx
import { useState } from 'react';
import type { SwimParams } from '../sim/types';
import type { SimState } from './useSimulation';

interface Props {
  state: SimState;
  onPlay: () => void; onPause: () => void; onStep: () => void;
  onTickMs: (ms: number) => void;
  onRestart: (seed: number, nodeCount: number) => void;
  onAddNode: () => void;
  onGlobalFailureRate: (p: number) => void;
  onParams: (p: Partial<SwimParams>) => void;
}

const PARAM_KEYS: (keyof SwimParams)[] = [
  'protocolPeriod', 'indirectProbes', 'suspectTimeout', 'maxPiggyback', 'seedCount',
];

export function Controls({ state, onPlay, onPause, onStep, onTickMs, onRestart, onAddNode, onGlobalFailureRate, onParams }: Props) {
  const [seed, setSeed] = useState(state.seed);
  const [nodeCount, setNodeCount] = useState(state.nodeCount);

  return (
    <div className="controls">
      <button onClick={state.running ? onPause : onPlay}>{state.running ? 'Pause' : 'Play'}</button>
      <button onClick={onStep} disabled={state.running}>Step</button>
      <label>
        tick {state.tickMs}ms
        <input type="range" min="200" max="5000" step="100" value={state.tickMs}
          onChange={(e) => onTickMs(Number(e.target.value))} />
      </label>
      <label>seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></label>
      <label>nodes <input type="number" min="1" max="50" value={nodeCount} onChange={(e) => setNodeCount(Number(e.target.value))} /></label>
      <button onClick={() => onRestart(seed, nodeCount)}>Restart</button>
      <button onClick={onAddNode}>Add node</button>
      <label>
        global fail {state.globalFailureRate.toFixed(2)}
        <input type="range" min="0" max="1" step="0.05" value={state.globalFailureRate}
          onChange={(e) => onGlobalFailureRate(Number(e.target.value))} />
      </label>
      <details>
        <summary>SWIM params</summary>
        <div>
          {PARAM_KEYS.map((k) => (
            <label key={k}>{k}
              <input type="number" min="1" value={state.params[k]}
                onChange={(e) => onParams({ [k]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
```

- [ ] **Step 1: Write failing smoke tests** — `src/viz/App.test.tsx`:

```tsx
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
```

Note: the tick stat needs `data-testid="tick"` — pass `testId="tick"` from the `Stat` for the tick entry in `GlobalStats.tsx` (adjust Task 14 component accordingly: `<Stat label="tick" value={s.tick} testId="tick" />`).

jsdom note: `SVGSVGElement.pauseAnimations` does not exist in jsdom. Guard the calls: `svg.pauseAnimations?.()` / `svg.unpauseAnimations?.()` (optional-call syntax) so tests don't crash.

Also note: each `render(<App />)` creates a fresh `SimController` (paused), so tests are deterministic; no fake timers needed.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/viz/App.test.tsx` — FAIL.

- [ ] **Step 3: Implement**

Create `Controls.tsx`, rewrite `App.tsx`, adjust `GlobalStats` tick testId, add layout CSS — all as specified above. Ensure `src/main.tsx` imports `./viz/viz.css` and renders `<App />`.

- [ ] **Step 4: Verify pass — full suite + build**

Run: `npm test && npm run build` — ALL PASS.

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev`, open the app: nodes on a ring, packets flying arcs each tick, click node → inspector, kill a node → skull → suspicion propagates (amber) → dead (gray), convergence dips and recovers. Fix anything visually broken (styling only; behavior is test-covered).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(viz): controls, app composition and layout"
```

---

### Task 16: README + final verification

**Files:**
- Create: `README.md` (replace Vite boilerplate)

**Interfaces:** none new.

- [ ] **Step 1: Write README**

Content: what it is (SWIM gossip simulator/visualizer), screenshot placeholder omitted, quick start (`npm install`, `npm run dev`, `npm test`), a compact "how the protocol works" section (probe cycle, indirect probes, suspicion/incarnation, piggyback dissemination — link to the spec in `docs/`), UI guide (controls, inspector, what colors/arcs mean), and the defaults table from spec §10.

- [ ] **Step 2: Full verification (verification-before-completion skill)**

Run and confirm output:

```bash
npm test        # all suites pass
npm run build   # tsc + vite clean
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: README with usage and protocol guide"
```

---

## Self-Review Notes

- **Spec coverage:** time model (T2/T6/T7), SWIM mechanics §4 (T5/T6), failure injection §5 (T7), engine §6 (T7), stats §7.5 (T8, T14), ring/packets/inspector/controls §7 (T11–T15), edge cases §8 (T7 lifecycle + T9 integration), testing §9 (T9 sim, T15 viz smoke), defaults §10 (T3 `DEFAULT_SWIM`).
- **Right-click node menu** (spec §7.6): dropped — kill/leave live in the inspector, which is one click away; context menus add browser-default-suppression complexity with no protocol value. Deviation noted deliberately (YAGNI).
- **Type consistency check:** `MessageDraft`/`Message` split used consistently (node emits drafts, Simulator stamps); `subject`/`origin` naming uniform across node/tests; `SnapshotInput` shared between T7 placeholder and T8 final; `Stat testId` adjustment called out in T15.

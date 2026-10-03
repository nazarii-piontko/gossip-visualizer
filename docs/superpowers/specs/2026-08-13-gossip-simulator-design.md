# Gossip Protocol Simulator & Visualizer — Design Spec

**Date:** 2026-08-13
**Status:** Approved design, pending implementation plan

## 1. Overview

A browser-based teaching/exploration tool that simulates SWIM-style gossip membership
across a cluster of virtual nodes and animates the protocol traffic in real time.

- **Protocol:** SWIM (ping/ack failure detection with indirect probes), membership-only
  gossip. Updates disseminate by piggybacking on protocol messages.
- **Stack:** Vite + React 19 + TypeScript (strict), no CSS framework, no state library.
  Vitest for tests. Zero runtime deps beyond React.
- **Scale target:** 10–50 nodes, SVG rendering.
- **Two hard-bounded layers:** a pure-TS simulation engine (no React/DOM imports) and a
  React visualization layer that consumes immutable per-tick reports.

## 2. Time model

- **1 tick = 1 network hop.** A message sent at tick T is delivered at T+1.
- Tick length in wall-clock ms is a visualization concern only (default 2000 ms,
  configurable 200–5000 ms). The engine is wall-clock-agnostic; `setInterval` in the viz
  layer drives `sim.tick()`. Step mode = manual single call.
- **SWIM protocol period P = 4 ticks (default).** Each node runs one probe cycle per
  period.
- **Desynchronized probes:** each node draws a seeded random phase offset
  `offset_i ∈ [0, P)` at join, and starts probe cycles at `offset_i + k·P`. Traffic
  spreads across ticks instead of pulsing.

## 3. Module layout

```
src/
  sim/            # pure TS, zero React/DOM imports
    types.ts      # NodeId, MemberState, Message, TickReport, config types
    rng.ts        # mulberry32 seeded PRNG
    node.ts       # SwimNode: membership table, probe state machine
    simulator.ts  # Simulator: owns nodes, tick(), failure injection, add/remove/kill
    stats.ts      # per-node + global stats derivation
  viz/            # React
    App.tsx
    useSimulation.ts   # wraps Simulator; setInterval(tickMs); useSyncExternalStore
    Ring.tsx           # circle layout, node dots
    Packets.tsx        # per-tick in-flight messages, arc animation
    NodeInspector.tsx  # click node → internal state panel
    GlobalStats.tsx
    Controls.tsx
```

**Contract:** the viz layer only consumes `TickReport` and read-only snapshots
(`getNodeDetail`). The sim layer is fully testable headless.

## 4. SWIM protocol mechanics

### 4.1 Membership entry

Per node, per known peer:

```ts
{ id: NodeId, state: 'alive' | 'suspect' | 'dead', incarnation: number, lastUpdateTick: number }
```

- **Incarnation:** refutation counter. Only node X may increment X's own incarnation
  (when it learns it is suspected).
- **Merge rule:** higher incarnation wins; equal incarnation → `dead > suspect > alive`.

### 4.2 Probe cycle

Per node, once per protocol period (phase-offset):

1. Tick T: pick target via round-robin over a shuffled list of non-dead peers —
   suspects included, per the SWIM paper (SWIM-style fair coverage; probing a suspect
   keeps delivering its suspicion so it can refute, see §4.5) — send `ping`.
2. Target receives at T+1, replies `ack`.
3. Ack expected by T+2. If missing → send `ping-req` to `k = 3` (default) random alive
   peers.
4. Relays receive at T+3 and forward as `ping-req-ping` (arrives at target T+4); the
   target replies `ping-req-ack` through the relay (relay receives T+5, origin receives
   T+6 worst case).
5. No direct or indirect ack by T+6 → mark target **suspect**, gossip it.
   Because the indirect round trip (6 ticks) exceeds the protocol period (4 ticks),
   probes may overlap: a node keeps a set of pending probes, one per target.
6. A suspect entry that survives `suspectTimeout` (default 12 ticks) without refutation
   → **dead**, gossip it.

### 4.3 Message types

`ping`, `ack`, `ping-req`, `ping-req-ping`, `ping-req-ack`, `leave`.

The relay legs are deliberately distinct types (not plain ping/ack with correlation
IDs): distinct animation styling, and no correlation bookkeeping in node logic.
Semantics are identical to standard SWIM.

### 4.4 Dissemination (piggyback)

Every message carries up to `maxPiggyback` (default 6) membership updates, prioritized
by fewest-times-sent (infection-style broadcast). An update is evicted from the send
buffer after `piggybackRetransmits` (default 8) transmissions. No separate gossip
message type.

### 4.5 Refutation

When X learns it is suspected, X increments its own incarnation and gossips
`X alive, incarnation+1`. False positives visibly recover under high failure rates.

**Recipient-state echo:** whenever a node drafts any message (reply or outgoing
probe) to a peer it currently marks suspect or dead, it prepends its entry about
that peer to the message's piggyback (as memberlist does). Applied at draft time,
this covers both directions: replies to a suspect sender, and pings to a suspect
target (suspects stay in the probe rotation, §4.2). It guarantees a wrongly-declared
node hears about its own suspicion/death as soon as any communication with it
happens — even after the buffered update has exhausted its `piggybackRetransmits` —
making refutation, and recovery from isolation, deterministic rather than dependent
on gossip-buffer timing.

### 4.6 Membership lifecycle

- **Join:** new node is seeded with `seedCount` (default 3) random existing peers;
  learns the rest via piggyback. View converges to full cluster.
- **Unknown-sender learning:** any received message proves its sender exists; an
  unknown sender is added as `alive, incarnation 0` (memberlist-style). The merge
  rule keeps suspect/dead entries intact, so contact alone never resurrects a peer —
  refutation via incarnation is still required. Prevents gossip die-out from leaving
  a peer permanently unknown once its alive update exhausts retransmits.
- **Manual rejoin:** operator action (`rejoinNode` / inspector "Rejoin" button) for a
  node orphaned by a long isolation — mutual dead + prune empties its table and every
  peer's entry about it, leaving no gossip path back. Rejoin hands the node a fresh
  random seed list and re-announces its aliveness at its current incarnation; existing
  table entries are never overridden. Recovery is deliberately not automatic: the
  visualizer shows the permanent-split failure mode honestly until the operator heals it.
- **Graceful leave:** node broadcasts `leave`; gossiped as dead-with-consent, skipping
  the suspect phase.
- **Kill (non-graceful):** node silently stops processing; detection pipeline handles
  it.
- **Dead entry GC:** dead entries pruned from membership tables after `deadPruneTicks`
  (default 50).

## 5. Failure injection

- Global failure rate `g ∈ [0,1]`; per-node incoming rate `in_i` and outgoing rate
  `out_i ∈ [0,1]`.
- A message from A to B is dropped with `p = 1 − (1−g)·(1−out_A)·(1−in_B)`.
- The drop decision is made at send time from the seeded PRNG and revealed at delivery
  (`dropped` flag), so the packet still animates and fizzles mid-arc.
- Per-node rates at 1.0 simulate full isolation.

## 6. Engine

### 6.1 Message (in flight)

```ts
{ id, type, from, to, relay?, piggyback: MembershipUpdate[],
  sentTick, deliverTick,   // deliverTick = sentTick + 1
  dropped: boolean }
```

### 6.2 tick() order (deterministic)

1. `tickCount++`
2. **Deliver:** messages with `deliverTick === tickCount`; if `dropped` discard, else
   target (unless killed) merges piggyback, runs its probe state machine, queues
   replies for the next tick.
3. **Node phase step** (in node-id order): start probe if the node's phase says a new
   protocol period begins; escalate missed acks to ping-req or suspicion; expire
   suspect timers to dead.
4. Snapshot stats.
5. Return `TickReport`.

### 6.3 TickReport (immutable, consumed by viz)

```ts
{ tick,
  events: [
    { kind: 'sent' | 'delivered' | 'dropped', msg },
    { kind: 'state-change', nodeId, subject, from, to },
    { kind: 'joined' | 'left' | 'killed', nodeId } ],
  packets: [ { msgId, from, to, type, willDrop } ],   // for animation
  snapshot: GlobalSnapshot }
```

### 6.4 Determinism

Single mulberry32 stream owned by the Simulator. All randomness (peer selection, phase
offsets, drop decisions, relay selection) drawn in fixed order. Same seed + same
sequence of user actions (with their tick indices) → identical run.

### 6.5 Public API

```ts
new Simulator(config)   // { seed, nodeCount, swimParams, failureDefaults }
sim.tick(): TickReport
sim.addNode(): NodeId
sim.removeNode(id)      // graceful leave
sim.killNode(id)        // crash
sim.setGlobalFailureRate(p)
sim.setNodeFailureRate(id, { in, out })
sim.updateSwimParams(partial)   // applies from next tick
sim.getNodeDetail(id): NodeDetail
```

## 7. Visualization

### 7.1 Ring

SVG viewBox; node i at angle `2π·i/N`, ordered by id, so positions are stable and nodes
glide (CSS transition) to reslotted angles when the cluster grows or shrinks.

### 7.2 Node visual state

Rendered from the cluster-majority view (self-view lives in the inspector):

- alive — filled green
- suspect — amber, pulsing
- dead — gray, hollow
- killed but not yet detected — skull badge over a still-green node
- per-node failure rate > 0 — dashed ring, opacity proportional to rate

### 7.3 Packets

One SVG group (dot + short trail) per `TickReport.packets` entry. Trajectory is a
quadratic Bézier: control point = chord midpoint pushed perpendicular, curvature scaled
to chord length, biased to the right of travel direction so A→B and B→A occupy
separate lanes. Animated with SMIL `<animateMotion>` (path = the Bézier, dur = tick
duration) — native SVG, no CSS motion-path compatibility concerns; packets are replaced
when the next TickReport arrives. Pause uses `svg.pauseAnimations()`; step temporarily
unpauses for one tick duration so the stepped packets animate.

- Color by type: ping blue, ack green, ping-req violet, relay legs dashed variants,
  leave gray.
- `willDrop` packets fizzle at ~60% of the arc (fade + small ✕).
- Dot radius scales with piggyback payload size.

### 7.4 NodeInspector (click a node)

- Own state, incarnation, phase offset; editable failure rates (in/out sliders +
  isolate button).
- Membership table as this node sees it (peer / state / incarnation / staleness),
  with rows disagreeing with ground truth highlighted (false positives in red).
- Probe state: current target, awaiting ack, pending ping-reqs.
- Counters: sent/recv/dropped per message type, false suspicions issued, refutations.

### 7.5 GlobalStats (top bar)

- Tick counter; alive/suspect/dead counts (cluster-majority view, as on the ring —
  ground truth has no notion of "suspect").
- **Convergence %** — fraction of (node, peer) view entries matching ground truth;
  headline metric.
- Detection latency: ticks from last kill to all-alive-nodes-know.
- Messages this tick / total; drop count.
- Convergence sparkline over the last 100 ticks (inline SVG).

### 7.6 Controls (bottom bar)

Play/pause/step; tick-ms slider (200–5000, default 2000); seed input + restart; add
node; global failure slider; SWIM params drawer (period, k, suspectTimeout,
maxPiggyback, seedCount). Remove/kill available from the node inspector and a
right-click menu.

## 8. Edge cases

- **N=1 / last node:** probe phase no-ops; no crash.
- **Joiner whose seeds are all dead:** join proceeds; its probes fail; it holds a stale
  view until another node probes it (faithful SWIM behavior).
- **Relay killed mid ping-req:** relay legs die silently → origin gets no indirect ack
  → suspicion. Works by construction.
- **Kill/remove with in-flight messages:** messages already on the wire still travel;
  delivery to a killed node no-ops.
- **Param changes mid-run:** apply from the next tick; already-armed timers keep their
  old deadlines.
- **removeNode on a suspect/dead node:** allowed; amounts to pruning ground truth plus
  eventual gossip cleanup.
- **Pause + add node:** allowed; join traffic animates on resume/step.

## 9. Testing

### 9.1 Sim layer (vitest, headless — primary value)

- **Determinism:** same seed → deep-equal TickReport streams over 500 ticks.
- **Convergence:** N=20, zero failures → 100% convergence within a bounded tick count.
- **Detection:** kill a node → every alive node marks it dead within
  `P + suspectTimeout + slack`; zero false positives at zero failure rate.
- **Refutation:** targeted drop rates force a false suspicion → suspected node bumps
  incarnation → cluster returns it to alive.
- **Isolation:** in=out=1.0 → cluster marks the node dead; healing the rates →
  refutation revives it.
- **Piggyback:** fewest-times-sent prioritization holds.
- **Merge rules:** table-driven tests over incarnation/state precedence.

### 9.2 Viz layer

Thin React Testing Library smoke tests: renders N nodes, clicking opens the inspector,
controls dispatch to the simulator. Animation correctness verified by eye via step mode.

## 10. Defaults summary

| Parameter | Default |
|---|---|
| tick length (viz) | 2000 ms |
| protocol period P | 4 ticks |
| indirect probe count k | 3 |
| suspectTimeout | 12 ticks |
| maxPiggyback | 6 updates |
| piggybackRetransmits | 8 sends |
| seedCount (join) | 3 peers |
| deadPruneTicks | 50 ticks |
| initial cluster size | 12 nodes |
| global/per-node failure rates | 0 |

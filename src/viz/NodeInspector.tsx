import type { GlobalSnapshot, MembershipEntry, NodeDetail, NodeId } from '../sim/types';

interface Props {
  detail: NodeDetail;
  snapshot: GlobalSnapshot;
  onClose: () => void;
  onSetFailureRate: (id: NodeId, rates: { in: number; out: number }) => void;
  onKill: (id: NodeId) => void;
  onRemove: (id: NodeId) => void;
  onRejoin: (id: NodeId) => void;
}

function isMismatch(entry: MembershipEntry, snapshot: GlobalSnapshot): boolean {
  const gt = snapshot.groundTruth[entry.id]; // undefined => departed
  if (gt === 'running') return entry.state !== 'alive';
  return entry.state !== 'dead';
}

export function NodeInspector({ detail, snapshot, onClose, onSetFailureRate, onKill, onRemove, onRejoin }: Props) {
  const d = detail;
  return (
    <aside className="inspector">
      <header>
        <h2>Node {d.id} <span className={d.running ? 'badge running' : 'badge killed'}>{d.running ? 'running' : 'killed'}</span></h2>
        <button aria-label="close" onClick={onClose}>×</button>
      </header>

      <dl className="facts">
        <dt>incarnation</dt><dd>{d.incarnation}</dd>
        <dt>local health (LHM)</dt><dd>{d.lhm}</dd>
        <dt>phase offset</dt><dd>{d.phaseOffset}</dd>
      </dl>

      <section>
        <h3>Failure rates</h3>
        <div className="row">
          <label>in {d.failureIn.toFixed(2)}
            <input type="range" min="0" max="1" step="0.05" value={d.failureIn}
              onChange={(e) => onSetFailureRate(d.id, { in: Number(e.target.value), out: d.failureOut })} />
          </label>
          <label>out {d.failureOut.toFixed(2)}
            <input type="range" min="0" max="1" step="0.05" value={d.failureOut}
              onChange={(e) => onSetFailureRate(d.id, { in: d.failureIn, out: Number(e.target.value) })} />
          </label>
        </div>
      </section>

      <section className="row">
        <button onClick={() => onSetFailureRate(d.id, { in: 1, out: 1 })}>Isolate</button>
        <button onClick={() => onSetFailureRate(d.id, { in: 0, out: 0 })}>Heal</button>
        <button className="danger" onClick={() => onKill(d.id)} disabled={!d.running}>Kill</button>
        <button onClick={() => onRemove(d.id)}>Leave (graceful)</button>
        <button onClick={() => onRejoin(d.id)} disabled={!d.running}
          title="Re-introduce this node via a fresh seed list (recovers an orphaned node after a long isolation)">
          Rejoin
        </button>
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
        <h3>Doubted by</h3>
        {(snapshot.dissent[d.id] ?? []).length === 0 ? <p className="dim">none</p> : (
          <table>
            <thead><tr><th>node</th><th>sees this node as</th></tr></thead>
            <tbody>
              {(snapshot.dissent[d.id] ?? []).map((x) => (
                <tr key={x.viewer} data-testid="dissent-row" className={`dissent-${x.state}`}>
                  <td>{x.viewer}</td><td>{x.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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

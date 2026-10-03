import type { GlobalSnapshot, NodeId, Opinion } from '../sim/types';
import { nodePositions, nodeRadius, VIEW } from './layout';

interface RingProps {
  snapshot: GlobalSnapshot;
  selected: NodeId | null;
  onSelect: (id: NodeId | null) => void;
  children?: React.ReactNode;
}

type OpinionState = keyof Opinion;

/** Turn opinion fractions into cumulative donut segments; each renders as a circle
 *  stroke where dasharray sets arc length and dashoffset its start angle. */
function opinionSegments(
  opinion: Opinion | undefined,
): { state: OpinionState; frac: number; offset: number }[] {
  const order: OpinionState[] = ['alive', 'suspect', 'dead', 'unknown'];
  const segments: { state: OpinionState; frac: number; offset: number }[] = [];
  let offset = 0;
  for (const state of order) {
    const frac = opinion?.[state] ?? 0;
    if (frac > 0) {
      segments.push({ state, frac, offset });
      offset += frac;
    }
  }
  return segments;
}

export function Ring({ snapshot, selected, onSelect, children }: RingProps) {
  const ids = Object.keys(snapshot.groundTruth).map(Number);
  const positions = nodePositions(ids);
  const bodyR = nodeRadius(ids.length);
  const donutR = bodyR + 5;
  const C = 2 * Math.PI * donutR;

  return (
    <g>
      <circle className="ring-guide" cx={VIEW.cx} cy={VIEW.cy} r={VIEW.r} />
      {ids.map((id) => {
        const p = positions.get(id)!;
        const perceived = snapshot.perceived[id];
        const groundTruth = snapshot.groundTruth[id];
        // killed but not yet believed dead by the majority: the interesting window
        // where the failure detector is still working — marked with a skull
        const undetectedKill = groundTruth === 'killed' && perceived !== 'dead';
        const f = snapshot.failureRates[id];
        const failureOpacity = f ? Math.max(f.in, f.out) : 0;
        const segments = opinionSegments(snapshot.opinions[id]);
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
            style={{ transform: `translate(${p.x}px, ${p.y}px)`, cursor: 'pointer' }}
            onClick={() => onSelect(selected === id ? null : id)}
          >
            {failureOpacity > 0 && (
              <circle className="failure-ring" r={bodyR + 10} style={{ opacity: failureOpacity }} />
            )}
            <g className="opinion" transform="rotate(-90)">
              {segments.map((s) => (
                <circle
                  key={s.state}
                  data-testid="opinion-seg"
                  className={`opinion-seg ${s.state}`}
                  r={donutR}
                  strokeDasharray={`${s.frac * C} ${C}`}
                  strokeDashoffset={-s.offset * C}
                />
              ))}
            </g>
            <circle className="node-body" r={bodyR} />
            <text className="node-label" dy="4">{id}</text>
            {undetectedKill && <text className="skull" y={-20}>&#9760;</text>}
          </g>
        );
      })}
      {children}
    </g>
  );
}

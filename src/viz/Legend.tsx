import type { MessageType } from '../sim/types';
import { GLYPHS } from './glyphs';

const NODE_STATES: { state: string; label: string }[] = [
  { state: 'alive', label: 'alive' },
  { state: 'suspect', label: 'suspect' },
  { state: 'dead', label: 'dead' },
  { state: 'unknown', label: 'unknown' },
];

const PACKETS: { type: MessageType; label: string }[] = [
  { type: 'ping', label: 'ping' },
  { type: 'ack', label: 'ack' },
  { type: 'ping-req', label: 'ping-req' },
  { type: 'ping-req-ping', label: 'indirect ping / ack' },
  { type: 'leave', label: 'leave' },
];

/** Tiny SVG swatch; reuses the ring/packet CSS classes so colors never drift. */
function Swatch({ children, extent = 12 }: { children: React.ReactNode; extent?: number }) {
  return (
    <svg className="legend-swatch" viewBox={`${-extent} ${-extent} ${2 * extent} ${2 * extent}`} width="20" height="20" aria-hidden="true">
      {children}
    </svg>
  );
}

export function Legend() {
  return (
    <details className="legend" open>
      <summary>Legend</summary>
      <h4>Node fill — majority view</h4>
      <ul>
        {NODE_STATES.map(({ state, label }) => (
          <li key={state}>
            <Swatch>
              <g className={`node ${state}`}><circle className="node-body" r={7} /></g>
            </Swatch>
            {label}
          </li>
        ))}
      </ul>
      <h4>Node markers</h4>
      <ul>
        <li>
          <Swatch>
            <circle className="opinion-seg alive" r={8} strokeDasharray="25 100" transform="rotate(-90)" />
            <circle className="opinion-seg suspect" r={8} strokeDasharray="15 100" strokeDashoffset={-25} transform="rotate(-90)" />
            <circle className="opinion-seg dead" r={8} strokeDasharray="10.3 100" strokeDashoffset={-40} transform="rotate(-90)" />
          </Swatch>
          outer ring: peers' opinions split
        </li>
        <li>
          <Swatch><circle className="failure-ring" r={9} /></Swatch>
          dashed red: packet failure rate
        </li>
        <li>
          <Swatch><text className="skull" dy="5">&#9760;</text></Swatch>
          killed, not yet detected
        </li>
        <li>
          <Swatch><g className="node alive selected"><circle className="node-body" r={7} /></g></Swatch>
          selected
        </li>
      </ul>
      <h4>Packets</h4>
      <ul>
        {PACKETS.map(({ type, label }) => (
          <li key={type}>
            <Swatch extent={7}>
              <g className={`packet ${type}`}>
                <circle r={6} />
                <text className="packet-glyph" dy="2.5">{GLYPHS[type]}</text>
              </g>
            </Swatch>
            {label}
          </li>
        ))}
      </ul>
      <p className="dim">Bigger packet = more piggybacked updates. Fading mid-flight = dropped.</p>
    </details>
  );
}

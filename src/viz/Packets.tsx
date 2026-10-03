import { useLayoutEffect, useRef } from 'react';
import type { NodeId, PacketInfo } from '../sim/types';
import { arcPath, nodePositions } from './layout';
import { GLYPHS } from './glyphs';

interface PacketsProps {
  packets: PacketInfo[];
  ids: NodeId[];
  tick: number;
  tickMs: number;
}

interface PacketProps {
  p: PacketInfo;
  d: string;
  tickMs: number;
}

function Packet({ p, d, tickMs }: PacketProps) {
  const motionRef = useRef<SVGElement>(null);
  const fadeRef = useRef<SVGElement>(null);
  const dur = `${tickMs}ms`;

  // SMIL animations use begin="indefinite" and are kicked off manually on mount:
  // a declarative begin="0s" would be relative to document load, not element
  // insertion, so re-mounted packets (keyed by tick) would never replay.
  // Layout effect: begin before first paint, or the dot flashes at the SVG origin.
  useLayoutEffect(() => {
    type Beginable = { beginElement?: () => void };
    (motionRef.current as Beginable | null)?.beginElement?.();
    (fadeRef.current as Beginable | null)?.beginElement?.();
  }, []);

  return (
    <g data-testid="packet" className={`packet ${p.type}`}>
      <circle r={5 + p.piggybackCount * 0.5} />
      <text className="packet-glyph" dy="2.5">{GLYPHS[p.type]}</text>
      {/* dropped packets travel 60% of the arc and fade out; delivered ones go the distance */}
      {p.willDrop ? (
        <>
          <animateMotion ref={motionRef} begin="indefinite" dur={dur} path={d} keyPoints="0;0.6" keyTimes="0;1" calcMode="linear" fill="freeze" />
          <animate ref={fadeRef} begin="indefinite" attributeName="opacity" values="1;1;0" keyTimes="0;0.8;1" dur={dur} fill="freeze" />
        </>
      ) : (
        <animateMotion ref={motionRef} begin="indefinite" dur={dur} path={d} fill="freeze" />
      )}
    </g>
  );
}

export function Packets({ packets, ids, tick, tickMs }: PacketsProps) {
  // same slots as the Ring; packets to/from a node no longer on it (e.g. a departed
  // node's leave broadcast) are skipped rather than reslotting every other arc
  const positions = nodePositions(ids);

  return (
    <g>
      {packets.map((p) => {
        const from = positions.get(p.from);
        const to = positions.get(p.to);
        if (!from || !to) return null;
        const d = arcPath(from, to);
        return (
          <g key={`${tick}-${p.msgId}`}>
            <Packet p={p} d={d} tickMs={tickMs} />
          </g>
        );
      })}
    </g>
  );
}

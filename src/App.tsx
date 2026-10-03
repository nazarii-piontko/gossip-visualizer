import { useEffect, useRef, useState } from 'react';
import { SimController, useSimulation } from './viz/useSimulation';
import { Ring } from './viz/Ring';
import { Packets } from './viz/Packets';
import { NodeInspector } from './viz/NodeInspector';
import { GlobalStats } from './viz/GlobalStats';
import { Controls } from './viz/Controls';
import { Legend } from './viz/Legend';
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
    if (state.running) svg.unpauseAnimations?.();
    else {
      svg.unpauseAnimations?.(); // let the freshly stepped tick animate...
      const t = setTimeout(() => svg.pauseAnimations?.(), state.tickMs);
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
        <Legend />
      </main>
      {detail && (
        <NodeInspector
          detail={detail}
          snapshot={state.report.snapshot}
          onClose={() => setSelected(null)}
          onSetFailureRate={(id, r) => controller.setNodeFailureRate(id, r)}
          onKill={(id) => { controller.killNode(id); }}
          onRemove={(id) => { controller.removeNode(id); setSelected(null); }}
          onRejoin={(id) => controller.rejoinNode(id)}
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

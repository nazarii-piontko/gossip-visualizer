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

/** Editable params with their minimum; 0 is meaningful only where it disables a feature. */
const PARAM_MIN: Partial<Record<keyof SwimParams, number>> = {
  protocolPeriod: 1, indirectProbes: 0, suspicionMult: 1, maxPiggyback: 1, seedCount: 1, lhmMax: 0,
};
const PARAM_KEYS = Object.keys(PARAM_MIN) as (keyof SwimParams)[];

interface NumberFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onCommit: (v: number) => void;
}

/** Integer input that commits on blur or Enter (Escape reverts), never per keystroke:
 *  typing "10" must not briefly apply 1. Values are rounded and clamped to [min, max];
 *  an empty or non-numeric entry reverts to the current value. */
function NumberField({ label, value, min = -Infinity, max = Infinity, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n)) return;
    const v = Math.min(max, Math.max(min, Math.round(n)));
    if (v !== value) onCommit(v);
  };
  return (
    <label>{label}
      <input type="number" step="1" min={Number.isFinite(min) ? min : undefined} max={Number.isFinite(max) ? max : undefined}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') setDraft(null);
        }} />
    </label>
  );
}

export function Controls({ state, onPlay, onPause, onStep, onTickMs, onRestart, onAddNode, onGlobalFailureRate, onParams }: Props) {
  const [seed, setSeed] = useState(state.seed);
  const [nodeCount, setNodeCount] = useState(state.nodeCount);

  return (
    <div className="controls">
      <button onClick={state.running ? onPause : onPlay}>{state.running ? 'Pause' : 'Play'}</button>
      <button onClick={onStep} disabled={state.running}>Step</button>
      <label>
        <span>tick <span className="readout">{state.tickMs}</span>ms</span>
        <input type="range" min="200" max="5000" step="100" value={state.tickMs}
          onChange={(e) => onTickMs(Number(e.target.value))} />
      </label>
      <NumberField label="seed" value={seed} onCommit={setSeed} />
      <NumberField label="nodes" value={nodeCount} min={1} max={50} onCommit={setNodeCount} />
      <button onClick={() => onRestart(seed, nodeCount)}>Restart</button>
      <button onClick={onAddNode}>Add node</button>
      <label>
        <span>global fail <span className="readout">{state.globalFailureRate.toFixed(2)}</span></span>
        <input type="range" min="0" max="1" step="0.05" value={state.globalFailureRate}
          onChange={(e) => onGlobalFailureRate(Number(e.target.value))} />
      </label>
      <details>
        <summary>SWIM params</summary>
        <div>
          {PARAM_KEYS.map((k) => (
            <NumberField key={k} label={k} value={state.params[k]} min={PARAM_MIN[k]}
              onCommit={(v) => onParams({ [k]: v })} />
          ))}
        </div>
      </details>
    </div>
  );
}

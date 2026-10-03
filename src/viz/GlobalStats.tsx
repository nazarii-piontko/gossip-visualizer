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
      <Stat label="tick" value={s.tick} testId="tick" />
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

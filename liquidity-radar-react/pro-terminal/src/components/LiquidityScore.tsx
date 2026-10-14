import { useMemo } from 'react';
import { useMarket } from '@/store/useMarket';
import { bookMetrics, liquidityScore } from '@/core/scores/liquidityScore';
import { Panel } from './Panel'; import { Badge } from './Badge';
export function LiquidityScorePanel() {
  const book = useMarket(s => s.book), t = useMarket(s => s.ticker);
  const score = useMemo(() => (book && t ? liquidityScore(bookMetrics(book.data), t.data.quoteVolume24h) : undefined), [book, t]);
  return (
    <Panel title="Liquidity score" right={<Badge env={book} />} foot={`Version ${score?.version ?? 'liq-v1'}: weighted average of the components shown. Weights are fixed and visible; no hidden factors.`}>
      {!score ? <div className="empty">Needs order book and 24h ticker.</div> :
        <div className="score">
          <div className="dial" style={{ ['--v' as any]: score.value }}><span>{score.value}</span></div>
          <div>{score.components.map(c => <div key={c.key} className="comp"><span>{c.label} <span className="muted">×{c.weight}</span></span><div className="bar"><i style={{ width: `${c.score}%` }} /></div><span style={{ textAlign: 'right' }}>{Math.round(c.score)}</span><small>{c.reason}</small></div>)}</div>
        </div>}
    </Panel>
  );
}

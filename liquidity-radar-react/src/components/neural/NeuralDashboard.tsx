// The Neural Net tab: the self-learning engine's live dashboard, laid out
// after the owner's reference design. Lazy-loaded with its tab.
import { Guard } from '../ErrorBoundary'
import { NeuralChartCard } from './NeuralChart'
import { OrderFlow } from '../analysis/AnalysisViews'
import {
  AiInsights,
  AiSentiment,
  BrainCard,
  Journal,
  LearningLog,
  MiniHeatmap,
  NextGoals,
  NnFooter,
  NnHeader,
  NnMultiTf,
  NnVolumeProfile,
  PredictionCard,
  RecentTrades,
  TopMovers,
} from './NeuralViews'

export function NeuralDashboard() {
  return (
    <div className="nn-page">
      <Guard name="Neural header"><NnHeader /></Guard>
      <div className="nn-row nn-row-a">
        <Guard name="Neural chart"><NeuralChartCard /></Guard>
        <Guard name="AI prediction"><PredictionCard /></Guard>
        <Guard name="AI sentiment"><AiSentiment /></Guard>
        <Guard name="AI insights"><AiInsights /></Guard>
        <Guard name="Top movers"><TopMovers /></Guard>
      </div>
      <div className="nn-row nn-row-b">
        <Guard name="Mini heatmap"><MiniHeatmap /></Guard>
        <Guard name="Volume profile"><NnVolumeProfile /></Guard>
        <Guard name="Order flow"><OrderFlow tab="neuralnet" id="nnFlow" /></Guard>
        <Guard name="Multi-timeframe"><NnMultiTf /></Guard>
        <Guard name="Recent trades"><RecentTrades /></Guard>
      </div>
      <div className="nn-row nn-row-c">
        <Guard name="Learning log"><LearningLog /></Guard>
        <Guard name="Journal"><Journal /></Guard>
        <Guard name="Next goals"><NextGoals /></Guard>
        <Guard name="Brain"><BrainCard /></Guard>
      </div>
      <NnFooter />
    </div>
  )
}

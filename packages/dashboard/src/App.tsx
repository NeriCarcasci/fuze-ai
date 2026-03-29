import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout.js'
import { LiveRuns } from './views/LiveRuns.js'
import { TraceReplay } from './views/TraceReplay.js'
import { BudgetDashboard } from './views/BudgetDashboard.js'
import { AgentHealth } from './views/AgentHealth.js'
import { CompliancePanel } from './views/CompliancePanel.js'
import './styles/global.css'

export function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<LiveRuns />} />
          <Route path="/trace" element={<TraceReplay />} />
          <Route path="/trace/:runId" element={<TraceReplay />} />
          <Route path="/budget" element={<BudgetDashboard />} />
          <Route path="/health" element={<AgentHealth />} />
          <Route path="/compliance" element={<CompliancePanel />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

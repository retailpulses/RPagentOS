import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ListingAudit from './pages/ListingAudit'
import '@retailpulses/tickets/styles/tickets.css'

const Today = lazy(() => import('./pages/Today'))
const TicketWorkspace = lazy(() => import("@retailpulses/tickets").then(m => ({ default: m.TicketWorkspace })))
const TicketReportViewer = lazy(() => import("@retailpulses/tickets").then(m => ({ default: m.TicketReportViewer })))
const TicketPromptManager = lazy(() => import("@retailpulses/tickets").then(m => ({ default: m.TicketPromptManager })))
const Board = lazy(() => import('./pages/Board'))
const CreateTask = lazy(() => import('./pages/CreateTask'))
const TaskDetail = lazy(() => import('./pages/TaskDetail'))

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<p className="text-muted">Loading...</p>}>
        <Routes>
          <Route path="/" element={<Navigate to="/listing" replace />} />
          <Route path="/task" element={<Today />} />
          <Route path="/today" element={<Today />} />
          <Route path="/board" element={<Board />} />
          <Route path="/task/board" element={<Board />} />
          <Route path="/listing" element={<ListingAudit />} />
          <Route path="/tickets" element={<TicketWorkspace />} />
          <Route path="/tickets/reports" element={<TicketReportViewer />} />
          <Route path="/tickets/prompts" element={<TicketPromptManager />} />
          <Route path="/listing-audit" element={<Navigate to="/listing" replace />} />
          <Route path="/task/new" element={<CreateTask />} />
          <Route path="/tasks/new" element={<CreateTask />} />
          <Route path="/task/:id" element={<TaskDetail />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}

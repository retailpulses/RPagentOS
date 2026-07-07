import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ListingAudit from './pages/ListingAudit'

const Today = lazy(() => import('./pages/Today'))
const Board = lazy(() => import('./pages/Board'))
const CreateTask = lazy(() => import('./pages/CreateTask'))
const TaskDetail = lazy(() => import('./pages/TaskDetail'))
const ProjectList = lazy(() => import('./pages/ProjectList'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const CreateProject = lazy(() => import('./pages/CreateProject'))

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
          <Route path="/listing-audit" element={<Navigate to="/listing" replace />} />
          <Route path="/task/new" element={<CreateTask />} />
          <Route path="/tasks/new" element={<CreateTask />} />
          <Route path="/task/:id" element={<TaskDetail />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />
          <Route path="/projects" element={<ProjectList />} />
          <Route path="/projects/new" element={<CreateProject />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}

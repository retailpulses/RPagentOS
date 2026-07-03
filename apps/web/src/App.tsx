import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Today from './pages/Today'
import Board from './pages/Board'
import CreateTask from './pages/CreateTask'
import TaskDetail from './pages/TaskDetail'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<Today />} />
        <Route path="/board" element={<Board />} />
        <Route path="/tasks/new" element={<CreateTask />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
      </Routes>
    </Layout>
  )
}

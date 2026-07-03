import { type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>RPagentOS</h1>
        <nav>
          <NavLink to="/today" className={({ isActive }) => isActive ? 'active' : ''}>
            Today
          </NavLink>
          <NavLink to="/board" className={({ isActive }) => isActive ? 'active' : ''}>
            Board
          </NavLink>
          <NavLink to="/tasks/new" className={({ isActive }) => isActive ? 'active' : ''}>
            + New Task
          </NavLink>
        </nav>
      </aside>
      <main className="main-content">
        {children}
      </main>
    </div>
  )
}

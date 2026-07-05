import { type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>RPagentOS</h1>
        <nav>
          <NavLink to="/task" className={({ isActive }) => isActive ? 'active' : ''}>
            Today
          </NavLink>
          <NavLink to="/task/board" className={({ isActive }) => isActive ? 'active' : ''}>
            Board
          </NavLink>
          <NavLink to="/listing" className={({ isActive }) => isActive ? 'active' : ''}>
            Listing Audit
          </NavLink>
          <NavLink to="/task/new" className={({ isActive }) => isActive ? 'active' : ''}>
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

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

if (window.location.hostname === 'task.homesbliss.net') {
  const target = new URL('https://agent.homesbliss.net/task')
  target.search = window.location.search
  target.hash = window.location.hash
  window.location.replace(target)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)

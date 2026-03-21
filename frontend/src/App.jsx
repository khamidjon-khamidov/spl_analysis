import { Routes, Route, NavLink } from 'react-router-dom'
import DevicesPage from './pages/DevicesPage'
import './App.css'

function App() {
  return (
    <div className="app">
      <nav className="navbar">
        <span className="brand">SPL</span>
        <NavLink to="/devices" className={({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'}>
          Devices
        </NavLink>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="*" element={<div className="placeholder">Select a page from the menu.</div>} />
        </Routes>
      </main>
    </div>
  )
}

export default App

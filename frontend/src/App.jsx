import { Routes, Route, NavLink } from 'react-router-dom'
import DevicesPage from './pages/DevicesPage'
import SPLStaticPage from './pages/SPLStaticPage'
import SPLDailyPage from './pages/SPLDailyPage'
import SPLChartPage from './pages/SPLChartPage'
import './App.css'

const navClass = ({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'

function App() {
  return (
    <div className="app">
      <nav className="navbar">
        <span className="brand">SPL</span>
        <NavLink to="/devices" className={navClass}>Devices</NavLink>
        <NavLink to="/spl-static" className={navClass}>SPL Static</NavLink>
        <NavLink to="/spl-daily" className={navClass}>SPL Daily Analysis</NavLink>
        <NavLink to="/spl-chart" className={navClass}>SPL Chart</NavLink>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/spl-static" element={<SPLStaticPage />} />
          <Route path="/spl-daily" element={<SPLDailyPage />} />
          <Route path="/spl-chart" element={<SPLChartPage />} />
          <Route path="*" element={<div className="placeholder">Select a page from the menu.</div>} />
        </Routes>
      </main>
    </div>
  )
}

export default App

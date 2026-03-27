import { Routes, Route, NavLink } from 'react-router-dom'
import { DataSourceProvider, useDataSource } from './DataSourceContext'
import DevicesPage from './pages/DevicesPage'
import SPLStaticPage from './pages/SPLStaticPage'
import SPLDailyPage from './pages/SPLDailyPage'
import SPLChartPage from './pages/SPLChartPage'
import EvaluationPage from './pages/EvaluationPage'
import './App.css'

const navClass = ({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'

const SOURCE_OPTIONS = [
  { value: 'original',   label: 'Original' },
  { value: 'historical', label: 'Historical Median' },
  { value: 'knn',        label: 'KNN' },
  { value: 'combined',   label: 'Historical + KNN' },
  { value: 'timesfm',   label: 'TimesFM' },
]

function SourceDropdown() {
  const { source, setSource } = useDataSource()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
      <span style={{ color: '#888', fontSize: 12 }}>Imputation Method</span>
      <select
        value={source}
        onChange={e => setSource(e.target.value)}
        style={{
          background: '#2a2a3a', color: '#fff',
          border: '1px solid #444', borderRadius: 6,
          padding: '4px 10px', fontSize: 13, cursor: 'pointer',
        }}
      >
        {SOURCE_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function App() {
  return (
    <DataSourceProvider>
      <div className="app">
        <nav className="navbar">
          <span className="brand">SPL</span>
          <NavLink to="/devices"    className={navClass}>Devices</NavLink>
          <NavLink to="/spl-static" className={navClass}>SPL Static</NavLink>
          <NavLink to="/spl-daily"  className={navClass}>SPL Daily Analysis</NavLink>
          <NavLink to="/spl-chart"  className={navClass}>SPL Chart</NavLink>
          <NavLink to="/compare"    className={navClass}>Compare</NavLink>
          <SourceDropdown />
        </nav>
        <main className="content">
          <Routes>
            <Route path="/devices"    element={<DevicesPage />} />
            <Route path="/spl-static" element={<SPLStaticPage />} />
            <Route path="/spl-daily"  element={<SPLDailyPage />} />
            <Route path="/spl-chart"  element={<SPLChartPage />} />
            <Route path="/compare"    element={<EvaluationPage />} />
            <Route path="*" element={<div className="placeholder">Select a page from the menu.</div>} />
          </Routes>
        </main>
      </div>
    </DataSourceProvider>
  )
}

export default App

import { useState, useEffect, useRef } from 'react'
import { useDataSource } from '../DataSourceContext'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Brush, ResponsiveContainer,
} from 'recharts'
import Map, { Marker } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const HEALTH_LEVELS = [
  { max: 45,       color: '#22c55e', label: 'Safe (< 45 dB)'              },
  { max: 55,       color: '#a3e635', label: 'Acceptable (45–55 dB)'       },
  { max: 65,       color: '#facc15', label: 'Moderate concern (55–65 dB)' },
  { max: 75,       color: '#f97316', label: 'High concern (65–75 dB)'     },
  { max: Infinity, color: '#ef4444', label: 'Dangerous (≥ 75 dB)'         },
]

function splColor(v) { return HEALTH_LEVELS.find(l => v < l.max).color }

function missingColor(device) {
  if (!device.total_hours) return '#6b7280'
  const pct = device.missing_hours / device.total_hours
  if (pct >= 0.5) return '#ef4444'
  if (pct >= 0.2) return '#f59e0b'
  return '#22c55e'
}

function fmtTick(ts) {
  if (!ts) return ''
  const [datePart, hourPart] = ts.split(' ')
  const [d, m, y] = datePart.split('-')
  const month = new Date(`${y}-${m}-${d}`).toLocaleString('en', { month: 'short' })
  return `${d} ${month} ${hourPart}`
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { timestamp, value } = payload[0].payload
  const level = HEALTH_LEVELS.find(l => value < l.max)
  return (
    <div style={{
      background: '#1e1e2e', border: '1px solid #333', borderRadius: 6,
      padding: '8px 12px', fontSize: 12, color: '#fff',
    }}>
      <div style={{ color: '#aaa', marginBottom: 4 }}>{fmtTick(timestamp)}</div>
      <div>
        <span style={{ color: level.color, fontWeight: 700 }}>{value} dB</span>
        <span style={{ color: '#888', marginLeft: 8 }}>— {level.label.split('(')[0].trim()}</span>
      </div>
    </div>
  )
}

function DotWithColor({ cx, cy, payload }) {
  if (cx == null || cy == null) return null
  return <circle cx={cx} cy={cy} r={2} fill={splColor(payload.value)} stroke="none" />
}

export default function SPLChartPage() {
  const { source } = useDataSource()
  const [devices, setDevices]   = useState([])
  const [deviceId, setDeviceId] = useState('')
  const [data, setData]         = useState([])
  const [loading, setLoading]   = useState(false)

  useEffect(() => {
    fetch('http://localhost:8000/devices/all')
      .then(r => r.json())
      .then(d => setDevices([...d].sort((a, b) => a.name.localeCompare(b.name))))
  }, [])

  useEffect(() => {
    if (!deviceId) return
    setLoading(true)
    fetch(`http://localhost:8000/spl/device/${deviceId}?source=${source}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
  }, [deviceId, source])

  const selectedDevice = devices.find(d => d.id === Number(deviceId))
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target))
        setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div style={{
      width: '100%', height: '100%', background: '#0f0f17',
      display: 'flex', flexDirection: 'column', padding: '24px', gap: 16,
      boxSizing: 'border-box', overflowY: 'auto',
    }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ color: '#aaa', fontSize: 14 }}>Device</span>

        {/* Custom dropdown */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <div
            onClick={() => setDropdownOpen(o => !o)}
            style={{
              background: '#2a2a3a', border: '1px solid #444', borderRadius: 6,
              padding: '6px 12px', fontSize: 14, cursor: 'pointer', minWidth: 220,
              display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none',
              color: selectedDevice ? '#fff' : '#888',
            }}
          >
            {selectedDevice && (
              <span style={{
                width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                background: missingColor(selectedDevice), display: 'inline-block',
              }} />
            )}
            <span style={{ flex: 1 }}>{selectedDevice ? selectedDevice.name : '— select a device —'}</span>
            <span style={{ color: '#555', fontSize: 10 }}>{dropdownOpen ? '▲' : '▼'}</span>
          </div>

          {dropdownOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 100,
              background: '#1e1e2e', border: '1px solid #444', borderRadius: 6,
              marginTop: 4, maxHeight: 280, overflowY: 'auto', minWidth: 220,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}>
              {devices.map(d => (
                <div
                  key={d.id}
                  onClick={() => { setDeviceId(String(d.id)); setDropdownOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 12px', cursor: 'pointer', fontSize: 13,
                    color: '#fff',
                    background: d.id === Number(deviceId) ? '#2a2a3a' : 'transparent',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#2a2a3a'}
                  onMouseLeave={e => e.currentTarget.style.background = d.id === Number(deviceId) ? '#2a2a3a' : 'transparent'}
                >
                  <span style={{
                    width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                    background: missingColor(d),
                  }} />
                  <span style={{ flex: 1 }}>{d.name}</span>
                  <span style={{ color: '#555', fontSize: 11 }}>
                    {d.hours_with_data}/{d.total_hours}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedDevice && (
          <span style={{ color: '#666', fontSize: 13 }}>
            {data.length} hourly readings
            {selectedDevice.missing_hours != null && (
              <> · <span style={{ color: missingColor(selectedDevice), fontWeight: 600 }}>
                {selectedDevice.missing_hours} missing hrs ({(selectedDevice.missing_hours / selectedDevice.total_hours * 100).toFixed(1)}%)
              </span></>
            )}
          </span>
        )}
        {loading && <span style={{ color: '#aaa', fontSize: 13 }}>Loading…</span>}
      </div>

      {selectedDevice && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ color: '#555', fontSize: 12 }}>
            {selectedDevice.data_start} → {selectedDevice.data_end}
          </span>
        </div>
      )}

      {/* Chart */}
      <div style={{ height: 360, flexShrink: 0 }}>
        {data.length > 0 && !loading ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 40, bottom: 60, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={fmtTick}
                tick={{ fill: '#888', fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={80}
                stroke="#333"
              />
              <YAxis
                domain={[30, 90]}
                tick={{ fill: '#888', fontSize: 11 }}
                stroke="#333"
                label={{ value: 'dB', angle: -90, position: 'insideLeft', fill: '#666', fontSize: 12 }}
              />
              <Tooltip content={<CustomTooltip />} />
              {[45, 55, 65, 75].map(t => (
                <ReferenceLine
                  key={t} y={t}
                  stroke={HEALTH_LEVELS.find(l => t <= l.max).color}
                  strokeDasharray="4 4" strokeOpacity={0.5}
                  label={{ value: `${t} dB`, position: 'right', fill: '#555', fontSize: 10 }}
                />
              ))}
              <Line
                type="monotone" dataKey="value"
                dot={<DotWithColor />}
                activeDot={{ r: 4, fill: '#fff' }}
                stroke="#4f46e5" strokeWidth={1.5}
                isAnimationActive={false}
              />
              <Brush
                dataKey="timestamp" tickFormatter={fmtTick}
                height={28} stroke="#333" fill="#1a1a2a"
                travellerWidth={6} tick={{ fill: '#666', fontSize: 10 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#444', fontSize: 15,
          }}>
            {deviceId && loading ? 'Loading chart…' : 'Select a device to view its SPL chart'}
          </div>
        )}
      </div>

      {/* Health level legend */}
      {data.length > 0 && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', flexShrink: 0 }}>
          {HEALTH_LEVELS.map(l => (
            <span key={l.label} style={{ fontSize: 11, color: '#888' }}>
              <span style={{ color: l.color }}>—</span> {l.label}
            </span>
          ))}
        </div>
      )}

      {/* Device location map */}
      {selectedDevice && (
        <div style={{ flexShrink: 0 }}>
          <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
            Device location · {selectedDevice.lat.toFixed(6)}, {selectedDevice.long.toFixed(6)}
          </div>
          <div style={{ height: 260, borderRadius: 10, overflow: 'hidden', border: '1px solid #2a2a3a' }}>
            <Map
              key={selectedDevice.id}
              initialViewState={{ longitude: selectedDevice.long, latitude: selectedDevice.lat, zoom: 14 }}
              style={{ width: '100%', height: '100%' }}
              mapStyle={MAP_STYLE}
            >
              <Marker longitude={selectedDevice.long} latitude={selectedDevice.lat} anchor="bottom">
                <div style={{
                  background: missingColor(selectedDevice),
                  color: '#111', fontSize: 11, fontWeight: 700,
                  padding: '3px 8px', borderRadius: 4,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                }}>
                  {selectedDevice.name}
                </div>
              </Marker>
            </Map>
          </div>
        </div>
      )}
    </div>
  )
}

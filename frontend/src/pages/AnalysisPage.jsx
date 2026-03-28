import { useEffect, useState, useMemo, useRef } from 'react'
import { useDataSource } from '../DataSourceContext'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts'
import Map, { Marker, Popup } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const WHO_TIERS = [
  { key: 'safe',       color: '#22c55e', label: 'Safe < 45 dB'        },
  { key: 'acceptable', color: '#a3e635', label: 'Acceptable 45–55 dB' },
  { key: 'moderate',   color: '#facc15', label: 'Moderate 55–65 dB'   },
  { key: 'high',       color: '#f97316', label: 'High 65–75 dB'       },
  { key: 'dangerous',  color: '#ef4444', label: 'Dangerous ≥ 75 dB'   },
]

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const API = 'http://localhost:8000'

const tooltipStyle  = { background: '#1e1e2e', border: '1px solid #3a3a5a', borderRadius: 6, fontSize: 12 }
const itemStyle     = { color: '#e2e8f0' }
const labelStyle    = { color: '#94a3b8', marginBottom: 4 }

function card(children, style = {}) {
  return (
    <div style={{
      background: '#1a1a2e', border: '1px solid #2a2a4a',
      borderRadius: 10, padding: '20px 24px', ...style,
    }}>
      {children}
    </div>
  )
}

function Title({ children }) {
  return (
    <div style={{
      color: '#94a3b8', fontSize: 11, fontWeight: 700,
      letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14,
    }}>
      {children}
    </div>
  )
}

function splColor(v) {
  if (v < 45) return '#22c55e'
  if (v < 55) return '#a3e635'
  if (v < 65) return '#facc15'
  if (v < 75) return '#f97316'
  return '#ef4444'
}

// ── Sub-charts ────────────────────────────────────────────────────────────────

function ByHourChart({ data }) {
  return card(
    <>
      <Title>Average SPL by hour of day — weekday vs weekend</Title>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
          <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={h => `${String(h).padStart(2, '0')}:00`} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit=" dB" domain={['auto', 'auto']} />
          <Tooltip contentStyle={tooltipStyle} itemStyle={itemStyle} labelStyle={labelStyle}
            labelFormatter={h => `${String(h).padStart(2, '0')}:00`}
            formatter={v => [`${v?.toFixed(1)} dB`]} />
          <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
          <ReferenceLine y={45} stroke="#22c55e" strokeDasharray="4 3" strokeOpacity={0.5} />
          <ReferenceLine y={55} stroke="#a3e635" strokeDasharray="4 3" strokeOpacity={0.5} />
          <ReferenceLine y={65} stroke="#facc15" strokeDasharray="4 3" strokeOpacity={0.5} />
          <ReferenceLine y={75} stroke="#f97316" strokeDasharray="4 3" strokeOpacity={0.5} />
          <Line type="monotone" dataKey="weekday" name="Weekday"
            stroke="#3b82f6" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="weekend" name="Weekend"
            stroke="#f59e0b" strokeWidth={2.5} dot={false} strokeDasharray="6 3" />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>
        Dashed reference lines show WHO tier boundaries (45 / 55 / 65 / 75 dB).
      </div>
    </>
  )
}

function DowHourHeatmap({ data }) {
  // Build 7×24 lookup: dow → hour → avg_spl
  const grid = useMemo(() => {
    const map = {}
    for (const r of data) {
      if (!map[r.dow]) map[r.dow] = {}
      map[r.dow][r.hour] = r.avg_spl
    }
    return map
  }, [data])

  const allValues = data.map(r => r.avg_spl)
  const minV = Math.min(...allValues)
  const maxV = Math.max(...allValues)

  return card(
    <>
      <Title>Hour × Day-of-week heatmap — average SPL</Title>
      <div style={{ overflowX: 'auto' }}>
        {/* Hour labels */}
        <div style={{ display: 'flex', marginLeft: 36, marginBottom: 2 }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} style={{
              flex: 1, textAlign: 'center', fontSize: 9,
              color: '#475569', minWidth: 20,
            }}>
              {h % 3 === 0 ? `${h}h` : ''}
            </div>
          ))}
        </div>
        {/* Grid rows */}
        {DOW_LABELS.map((day, dow) => (
          <div key={dow} style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
            <div style={{ width: 32, fontSize: 11, color: '#64748b', flexShrink: 0 }}>{day}</div>
            {Array.from({ length: 24 }, (_, h) => {
              const val = grid[dow]?.[h]
              const bg  = val != null ? splColor(val) : '#1e1e2e'
              const opacity = val != null
                ? 0.4 + 0.6 * ((val - minV) / (maxV - minV || 1))
                : 0.1
              return (
                <div
                  key={h}
                  title={val != null ? `${day} ${h}:00 → ${val.toFixed(1)} dB` : 'No data'}
                  style={{
                    flex: 1, height: 26, background: bg, opacity,
                    borderRadius: 3, margin: '0 1px', cursor: 'default',
                    minWidth: 20,
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>
      {/* Colour scale */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <span style={{ fontSize: 11, color: '#475569' }}>Quiet</span>
        <div style={{
          flex: 1, height: 8, borderRadius: 4, maxWidth: 200,
          background: 'linear-gradient(to right, #22c55e, #a3e635, #facc15, #f97316, #ef4444)',
        }} />
        <span style={{ fontSize: 11, color: '#475569' }}>Loud</span>
        <span style={{ fontSize: 11, color: '#475569', marginLeft: 16 }}>
          Opacity encodes relative intensity within the range shown.
        </span>
      </div>
    </>
  )
}

function DistributionChart({ data }) {
  return card(
    <>
      <Title>SPL value distribution — readings per 2 dB bucket</Title>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barCategoryGap="5%">
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
          <XAxis dataKey="bucket" tick={{ fill: '#94a3b8', fontSize: 10 }}
            tickFormatter={v => `${v}`} unit=" dB" />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
          <Tooltip contentStyle={tooltipStyle} itemStyle={itemStyle} labelStyle={labelStyle}
            labelFormatter={v => `${v}–${v + 2} dB`}
            formatter={v => [v.toLocaleString(), 'readings']} />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {data.map(d => (
              <Cell key={d.bucket} fill={splColor(d.bucket + 1)} />
            ))}
          </Bar>
          {[45, 55, 65, 75].map(v => (
            <ReferenceLine key={v} x={v} stroke="#fff" strokeOpacity={0.2} strokeDasharray="4 3" />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>
        Vertical lines at WHO tier boundaries. Colours match health tiers.
      </div>
    </>
  )
}

function TierOverTimeChart({ data }) {
  // Convert counts to percentages
  const pctData = data.map(d => {
    const total = d.total || 1
    return {
      date: d.date_display,
      safe:       +((d.safe       / total) * 100).toFixed(1),
      acceptable: +((d.acceptable / total) * 100).toFixed(1),
      moderate:   +((d.moderate   / total) * 100).toFixed(1),
      high:       +((d.high       / total) * 100).toFixed(1),
      dangerous:  +((d.dangerous  / total) * 100).toFixed(1),
    }
  })

  // Show every ~10th date label to avoid crowding
  const step = Math.max(1, Math.floor(data.length / 10))

  return card(
    <>
      <Title>WHO tier breakdown over time — % of active sensors per day</Title>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={pctData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }}
            interval={step - 1} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="%" domain={[0, 100]} />
          <Tooltip contentStyle={tooltipStyle} itemStyle={itemStyle} labelStyle={labelStyle}
            formatter={v => [`${v}%`]} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
          {WHO_TIERS.map(t => (
            <Area key={t.key} type="monotone" dataKey={t.key} name={t.label}
              stackId="1" stroke={t.color} fill={t.color} fillOpacity={0.85} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>
        Stacked to 100%. Each band shows the fraction of all active sensor-hours in that WHO tier each day.
      </div>
    </>
  )
}

function DailyTrendChart({ data }) {
  const step = Math.max(1, Math.floor(data.length / 10))
  return card(
    <>
      <Title>Daily average SPL across all sensors</Title>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
          <XAxis dataKey="date_display" tick={{ fill: '#94a3b8', fontSize: 10 }} interval={step - 1} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit=" dB" domain={['auto', 'auto']} />
          <Tooltip contentStyle={tooltipStyle} itemStyle={itemStyle} labelStyle={labelStyle}
            formatter={v => [`${v?.toFixed(1)} dB`, 'Avg SPL']} />
          {[45, 55, 65, 75].map(v => (
            <ReferenceLine key={v} y={v} stroke="#fff" strokeOpacity={0.15} strokeDasharray="4 3" />
          ))}
          <Line type="monotone" dataKey="avg_spl" name="Daily avg SPL"
            stroke="#3b82f6" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </>
  )
}

function DeviceRankingChart({ data }) {
  const [popup, setPopup] = useState(null)
  if (!data) return null
  const { loudest, quietest } = data

  const allMarkers = [
    ...loudest.map(d => ({ ...d, group: 'loudest' })),
    ...quietest.map(d => ({ ...d, group: 'quietest' })),
  ]

  return card(
    <>
      <Title>Device ranking — top 15 loudest and quietest sensors by average SPL</Title>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

        {/* Loudest */}
        <div>
          <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, marginBottom: 8 }}>
            Loudest sensors
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={loudest} layout="vertical" barCategoryGap="15%">
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} unit=" dB"
                domain={[40, 'auto']} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }}
                width={72} />
              <Tooltip contentStyle={tooltipStyle} itemStyle={itemStyle} labelStyle={labelStyle}
                formatter={v => [`${v?.toFixed(1)} dB`, 'Avg SPL']} />
              <Bar dataKey="avg_spl" radius={[0, 3, 3, 0]}>
                {loudest.map(d => (
                  <Cell key={d.id} fill={splColor(d.avg_spl)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Quietest */}
        <div>
          <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 600, marginBottom: 8 }}>
            Quietest sensors
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={quietest} layout="vertical" barCategoryGap="15%">
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} unit=" dB"
                domain={[40, 'auto']} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }}
                width={72} />
              <Tooltip contentStyle={tooltipStyle} itemStyle={itemStyle} labelStyle={labelStyle}
                formatter={v => [`${v?.toFixed(1)} dB`, 'Avg SPL']} />
              <Bar dataKey="avg_spl" radius={[0, 3, 3, 0]}>
                {quietest.map(d => (
                  <Cell key={d.id} fill={splColor(d.avg_spl)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Map */}
      <div style={{ marginTop: 20, height: 380, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
        <div style={{ display: 'flex', gap: 16, position: 'absolute', top: 10, left: 10, zIndex: 10 }}>
          {[
            { color: '#ef4444', label: 'Loudest 15' },
            { color: '#22c55e', label: 'Quietest 15' },
          ].map(l => (
            <div key={l.label} style={{
              background: 'rgba(15,15,25,0.85)', backdropFilter: 'blur(4px)',
              borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#e2e8f0',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: l.color, display: 'inline-block',
              }} />
              {l.label}
            </div>
          ))}
        </div>
        <Map
          initialViewState={{ longitude: 24.75, latitude: 59.42, zoom: 11 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={MAP_STYLE}
        >
          {allMarkers.map(d => (
            <Marker
              key={`${d.group}-${d.id}`}
              longitude={d.long}
              latitude={d.lat}
              anchor="center"
              onClick={e => { e.originalEvent.stopPropagation(); setPopup(d) }}
            >
              <div style={{
                width: 14, height: 14, borderRadius: '50%', cursor: 'pointer',
                background: d.group === 'loudest' ? '#ef4444' : '#22c55e',
                border: '2px solid rgba(255,255,255,0.7)',
                boxShadow: '0 0 6px rgba(0,0,0,0.5)',
              }} />
            </Marker>
          ))}
          {popup && (
            <Popup
              longitude={popup.long}
              latitude={popup.lat}
              anchor="bottom"
              onClose={() => setPopup(null)}
              closeButton={true}
            >
              <div style={{ fontSize: 13, color: '#111', lineHeight: 1.6 }}>
                <strong>{popup.name}</strong><br />
                Avg SPL: <strong>{popup.avg_spl} dB</strong><br />
                <span style={{ color: '#555', fontSize: 11 }}>{popup.n.toLocaleString()} readings</span>
              </div>
            </Popup>
          )}
        </Map>
      </div>
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnalysisPage() {
  const { source } = useDataSource()
  const [byHour,    setByHour]    = useState([])
  const [heatmap,   setHeatmap]   = useState([])
  const [dist,      setDist]      = useState([])
  const [trend,     setTrend]     = useState([])
  const [tiers,     setTiers]     = useState([])
  const [ranking,   setRanking]   = useState(null)
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    setLoading(true)
    const q = `source=${source}`
    Promise.all([
      fetch(`${API}/analysis/by-hour?${q}`).then(r => r.json()),
      fetch(`${API}/analysis/dow-hour-heatmap?${q}`).then(r => r.json()),
      fetch(`${API}/analysis/distribution?${q}`).then(r => r.json()),
      fetch(`${API}/analysis/daily-trend?${q}`).then(r => r.json()),
      fetch(`${API}/analysis/tier-over-time?${q}`).then(r => r.json()),
      fetch(`${API}/analysis/device-ranking?${q}`).then(r => r.json()),
    ]).then(([h, hm, d, tr, ti, rk]) => {
      setByHour(h)
      setHeatmap(hm)
      setDist(d)
      setTrend(tr)
      setTiers(ti)
      setRanking(rk)
      setLoading(false)
    })
  }, [source])

  if (loading) return (
    <div style={{ color: '#aaa', padding: 40, textAlign: 'center' }}>Loading analysis…</div>
  )

  return (
    <div style={{ padding: '24px 28px', overflowY: 'auto', height: '100%', boxSizing: 'border-box', color: '#e2e8f0' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>SPL Data Analysis</h2>
          <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: 13 }}>
            Tallinn IoT acoustic sensor network · Sep–Dec 2021 · imputation source: <strong style={{ color: '#e2e8f0' }}>{source}</strong>
          </p>
        </div>

        <ByHourChart    data={byHour} />
        <DowHourHeatmap data={heatmap} />
        <TierOverTimeChart data={tiers} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <DistributionChart data={dist} />
          <DailyTrendChart   data={trend} />
        </div>
        <DeviceRankingChart data={ranking} />

      </div>
    </div>
  )
}

import { useState, useEffect, useRef, useCallback } from 'react'
import { useDataSource } from '../DataSourceContext'
import { useDateRange } from '../useDateRange'
import Map, { Source, Layer } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const SPEEDS = [
  { label: '1x',  ms: 1000 },
  { label: '2x',  ms: 700  },
  { label: '3x',  ms: 500  },
  { label: '5x',  ms: 300  },
  { label: '10x', ms: 100  },
]

const SPL_MIN = 30
const SPL_MAX = 90

function toApiDate(s) { const [y, m, d] = s.split('-'); return `${d}-${m}-${y}` }

function formatTimestamp(ts) {
  if (!ts) return ''
  const [datePart, hourPart] = ts.split(' ')
  const [d, m, y] = datePart.split('-')
  const month = new Date(`${y}-${m}-${d}`).toLocaleString('en', { month: 'short' })
  return `${d} ${month} ${y} · ${hourPart}`
}

function readingsToGeojson(readings) {
  return {
    type: 'FeatureCollection',
    features: readings.map(r => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.long, r.lat] },
      properties: {
        value:  r.value,
        weight: Math.max(0, Math.min(1, (r.value - SPL_MIN) / (SPL_MAX - SPL_MIN))),
      },
    })),
  }
}

const heatmapLayer = {
  id:   'spl-heatmap',
  type: 'heatmap',
  paint: {
    'heatmap-weight': ['get', 'weight'],
    'heatmap-radius': [
      'interpolate', ['linear'], ['zoom'],
      9,  25,
      11, 40,
      13, 60,
    ],
    'heatmap-intensity': [
      'interpolate', ['linear'], ['zoom'],
      9,  0.6,
      13, 1.2,
    ],
    'heatmap-color': [
      'interpolate', ['linear'], ['heatmap-density'],
      0,    'rgba(0,0,0,0)',
      0.15, '#22c55e',
      0.35, '#a3e635',
      0.55, '#facc15',
      0.75, '#f97316',
      1.0,  '#ef4444',
    ],
    'heatmap-opacity': 0.82,
  },
}

export default function SPLHeatmapPage() {
  const { minDate, maxDate } = useDateRange()
  const { source } = useDataSource()
  const [startDate, setStartDate] = useState(null)
  const [endDate,   setEndDate]   = useState(null)
  const [slots,     setSlots]     = useState([])
  const [slotIdx,   setSlotIdx]   = useState(0)
  const [playing,   setPlaying]   = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [speedIdx,  setSpeedIdx]  = useState(0)
  const intervalRef = useRef(null)

  useEffect(() => {
    if (minDate && !startDate) {
      setStartDate(minDate)
      const end = new Date(minDate)
      end.setDate(end.getDate() + 2)
      setEndDate(end.toISOString().slice(0, 10))
    }
  }, [minDate])

  useEffect(() => {
    if (!startDate || !endDate || endDate < startDate) return
    setPlaying(false)
    setSlotIdx(0)
    setLoading(true)
    fetch(`http://localhost:8000/spl/range?start=${toApiDate(startDate)}&end=${toApiDate(endDate)}&source=${source}`)
      .then(r => r.json())
      .then(data => { setSlots(data); setLoading(false) })
  }, [startDate, endDate, source])

  const tick = useCallback(() => {
    setSlotIdx(prev => {
      if (prev >= slots.length - 1) { setPlaying(false); return prev }
      return prev + 1
    })
  }, [slots.length])

  useEffect(() => {
    if (playing) intervalRef.current = setInterval(tick, SPEEDS[speedIdx].ms)
    else         clearInterval(intervalRef.current)
    return () => clearInterval(intervalRef.current)
  }, [playing, tick, speedIdx])

  function togglePlay() {
    if (slots.length === 0) return
    if (slotIdx >= slots.length - 1) setSlotIdx(0)
    setPlaying(p => !p)
  }

  function handleSlider(e) {
    setPlaying(false)
    setSlotIdx(Number(e.target.value))
  }

  const current  = slots[slotIdx]
  const geojson  = readingsToGeojson(current?.readings ?? [])
  const count    = current?.readings?.length ?? 0

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>

      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        background: 'rgba(15,15,25,0.88)', color: '#fff',
        borderRadius: 8, padding: '8px 14px', fontSize: 15, fontWeight: 700,
        backdropFilter: 'blur(4px)', minWidth: 220,
      }}>
        {current ? formatTimestamp(current.timestamp) : 'Select a date range and load'}
      </div>

      <div style={{
        position: 'absolute', top: 12, right: 12, zIndex: 10,
        background: 'rgba(15,15,25,0.88)', color: '#fff',
        borderRadius: 8, padding: '10px 14px', fontSize: 12,
        backdropFilter: 'blur(4px)', lineHeight: '22px',
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>WHO noise standard</div>
        {[
          { color: '#22c55e', label: '< 45 dB',  desc: 'Safe'             },
          { color: '#a3e635', label: '45–55 dB', desc: 'Acceptable'       },
          { color: '#facc15', label: '55–65 dB', desc: 'Moderate concern' },
          { color: '#f97316', label: '65–75 dB', desc: 'High concern'     },
          { color: '#ef4444', label: '≥ 75 dB',  desc: 'Dangerous'        },
        ].map(l => (
          <div key={l.label}><span style={{ color: l.color }}>●</span> {l.label} — {l.desc}</div>
        ))}
        <div style={{ marginTop: 8, borderTop: '1px solid #333', paddingTop: 8 }}>
          <div style={{
            height: 10, borderRadius: 5, marginBottom: 4,
            background: 'linear-gradient(to right, #22c55e, #a3e635, #facc15, #f97316, #ef4444)',
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#aaa', fontSize: 10 }}>
            <span>Quiet</span><span>Loud</span>
          </div>
        </div>
      </div>

      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
        background: 'rgba(15,15,25,0.92)', backdropFilter: 'blur(6px)',
        padding: '12px 20px', borderTop: '1px solid #333',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ color: '#aaa', fontSize: 12 }}>From</label>
          <input type="date" value={startDate ?? ''} min={minDate ?? ''} max={maxDate ?? ''}
            onChange={e => setStartDate(e.target.value)} style={inputStyle} />
          <label style={{ color: '#aaa', fontSize: 12 }}>To</label>
          <input type="date" value={endDate ?? ''} min={minDate ?? ''} max={maxDate ?? ''}
            onChange={e => setEndDate(e.target.value)} style={inputStyle} />
          {loading && <span style={{ color: '#aaa', fontSize: 12 }}>Loading…</span>}
          {slots.length > 0 && !loading && (
            <span style={{ color: '#666', fontSize: 12 }}>{slots.length} hours total</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={togglePlay} disabled={loading || slots.length === 0} style={playBtnStyle}>
            {playing ? '⏸' : '▶'}
          </button>
          {SPEEDS.map((s, i) => (
            <button key={s.label} onClick={() => setSpeedIdx(i)} style={{
              background: speedIdx === i ? '#4f46e5' : '#2a2a3a',
              color: speedIdx === i ? '#fff' : '#888',
              border: '1px solid #444', borderRadius: 5,
              padding: '3px 8px', fontSize: 12, cursor: 'pointer', fontWeight: 600,
            }}>
              {s.label}
            </button>
          ))}
          <input type="range" min={0} max={Math.max(slots.length - 1, 0)} value={slotIdx}
            onChange={handleSlider} disabled={slots.length === 0}
            style={{ flex: 1, accentColor: '#4f46e5', cursor: slots.length ? 'pointer' : 'default' }} />
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, minWidth: 160 }}>
            {current ? formatTimestamp(current.timestamp) : '--'}
          </span>
          <span style={{ color: '#666', fontSize: 12, minWidth: 80 }}>
            {slots.length > 0 ? `${count} sensors` : ''}
          </span>
        </div>
      </div>

      <Map
        initialViewState={{ longitude: 24.75, latitude: 59.42, zoom: 11 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
      >
        <Source id="spl-source" type="geojson" data={geojson}>
          <Layer {...heatmapLayer} />
        </Source>
      </Map>
    </div>
  )
}

const inputStyle = {
  background: '#2a2a3a', color: '#fff',
  border: '1px solid #444', borderRadius: 6,
  padding: '5px 8px', fontSize: 13, cursor: 'pointer',
}

const playBtnStyle = {
  background: '#22c55e', color: '#111', border: 'none',
  borderRadius: 6, width: 36, height: 36, fontSize: 16,
  cursor: 'pointer', flexShrink: 0,
}

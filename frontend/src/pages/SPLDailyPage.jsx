import { useState, useEffect, useRef, useCallback } from 'react'
import Map, { Marker, Popup } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

const MAP_STYLE  = 'https://tiles.openfreemap.org/styles/liberty'
const MS_PER_SLOT = 300  // 300ms per hour

const HEALTH_LEVELS = [
  { max: 45,       color: '#22c55e', label: '< 45 dB',  desc: 'Safe'             },
  { max: 55,       color: '#a3e635', label: '45–55 dB', desc: 'Acceptable'       },
  { max: 65,       color: '#facc15', label: '55–65 dB', desc: 'Moderate concern' },
  { max: 75,       color: '#f97316', label: '65–75 dB', desc: 'High concern'     },
  { max: Infinity, color: '#ef4444', label: '≥ 75 dB',  desc: 'Dangerous'        },
]

function splColor(v) { return HEALTH_LEVELS.find(l => v < l.max).color }

function toApiDate(s) { const [y, m, d] = s.split('-'); return `${d}-${m}-${y}` }

export default function SPLDailyPage() {
  const [startDate, setStartDate] = useState('2023-05-01')
  const [endDate, setEndDate]     = useState('2023-05-03')
  const [allDevices, setAllDevices] = useState([])
  const [slots, setSlots]         = useState([])   // [{timestamp, readings}]
  const [slotIdx, setSlotIdx]     = useState(0)
  const [playing, setPlaying]     = useState(false)
  const [loading, setLoading]     = useState(false)
  const [selected, setSelected]   = useState(null)
  const intervalRef = useRef(null)

  useEffect(() => {
    fetch('http://localhost:8000/devices/all')
      .then(r => r.json())
      .then(setAllDevices)
  }, [])

  useEffect(() => {
    if (!startDate || !endDate || endDate < startDate) return
    setPlaying(false)
    setSlotIdx(0)
    setSelected(null)
    setLoading(true)
    const s = toApiDate(startDate)
    const e = toApiDate(endDate)
    fetch(`http://localhost:8000/spl/range?start=${s}&end=${e}`)
      .then(r => r.json())
      .then(data => { setSlots(data); setLoading(false) })
  }, [startDate, endDate])

  const tick = useCallback(() => {
    setSlotIdx(prev => {
      if (prev >= slots.length - 1) { setPlaying(false); return prev }
      return prev + 1
    })
  }, [slots.length])

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(tick, MS_PER_SLOT)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [playing, tick])

  function togglePlay() {
    if (slots.length === 0) return
    if (slotIdx >= slots.length - 1) setSlotIdx(0)
    setPlaying(p => !p)
  }

  function handleSlider(e) {
    setPlaying(false)
    setSlotIdx(Number(e.target.value))
    setSelected(null)
  }

  const current      = slots[slotIdx]
  const currentReadings = current?.readings ?? []
  const readingById  = Object.fromEntries(currentReadings.map(r => [r.id, r]))
  const center       = { lat: 59.42, lon: 24.75 }

  // Format "dd-mm-yyyy hh:00" -> "01 May 2023 · 14:00"
  function formatTimestamp(ts) {
    if (!ts) return ''
    const [datePart, hourPart] = ts.split(' ')
    const [d, m, y] = datePart.split('-')
    const month = new Date(`${y}-${m}-${d}`).toLocaleString('en', { month: 'short' })
    return `${d} ${month} ${y} · ${hourPart}`
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>

      {/* Current timestamp heading */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        background: 'rgba(15,15,25,0.88)', color: '#fff',
        borderRadius: 8, padding: '8px 14px', fontSize: 15, fontWeight: 700,
        backdropFilter: 'blur(4px)', minWidth: 220,
      }}>
        {current ? formatTimestamp(current.timestamp) : 'Select a date range and load'}
      </div>

      {/* Legend */}
      <div style={{
        position: 'absolute', top: 12, right: 12, zIndex: 10,
        background: 'rgba(15,15,25,0.88)', color: '#fff',
        borderRadius: 8, padding: '10px 14px', fontSize: 12,
        backdropFilter: 'blur(4px)', lineHeight: '22px'
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>WHO noise standard</div>
        {HEALTH_LEVELS.map(l => (
          <div key={l.label}><span style={{ color: l.color }}>●</span> {l.label} — {l.desc}</div>
        ))}
        <div style={{ marginTop: 4, borderTop: '1px solid #333', paddingTop: 4 }}>
          <span style={{ color: '#6b7280' }}>●</span> No data
        </div>
      </div>

      {/* Bottom controls */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
        background: 'rgba(15,15,25,0.92)', backdropFilter: 'blur(6px)',
        padding: '12px 20px', borderTop: '1px solid #333',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {/* Date range row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ color: '#aaa', fontSize: 12 }}>From</label>
          <input
            type="date" value={startDate} min="2023-05-01" max="2023-08-31"
            onChange={e => setStartDate(e.target.value)}
            style={inputStyle}
          />
          <label style={{ color: '#aaa', fontSize: 12 }}>To</label>
          <input
            type="date" value={endDate} min="2023-05-01" max="2023-08-31"
            onChange={e => setEndDate(e.target.value)}
            style={inputStyle}
          />
          {loading && <span style={{ color: '#aaa', fontSize: 12 }}>Loading…</span>}
          {slots.length > 0 && !loading && (
            <span style={{ color: '#666', fontSize: 12 }}>
              {slots.length} hours total
            </span>
          )}
        </div>

        {/* Playback row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={togglePlay} disabled={loading || slots.length === 0} style={playBtnStyle}>
            {playing ? '⏸' : '▶'}
          </button>
          <input
            type="range" min={0} max={Math.max(slots.length - 1, 0)} value={slotIdx}
            onChange={handleSlider}
            disabled={slots.length === 0}
            style={{ flex: 1, accentColor: '#4f46e5', cursor: slots.length ? 'pointer' : 'default' }}
          />
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 600, minWidth: 160 }}>
            {current ? formatTimestamp(current.timestamp) : '--'}
          </span>
          <span style={{ color: '#666', fontSize: 12, minWidth: 100 }}>
            {slots.length > 0 ? `${currentReadings.length} / ${allDevices.length} devices` : ''}
          </span>
        </div>
      </div>

      <Map
        initialViewState={{ longitude: center.lon, latitude: center.lat, zoom: 11 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
      >
        {allDevices.map(device => {
          const reading = readingById[device.id]
          const hasData = !!reading
          return (
            <Marker
              key={device.id}
              longitude={device.long}
              latitude={device.lat}
              anchor="bottom"
              onClick={e => {
                e.originalEvent.stopPropagation()
                setSelected(hasData ? reading : { ...device, value: null })
              }}
            >
              <div style={{
                background: hasData ? splColor(reading.value) : '#6b7280',
                color: hasData ? '#111' : '#ddd',
                fontSize: 10, fontWeight: 600,
                width: 44, textAlign: 'center',
                padding: '2px 0', borderRadius: 4,
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                opacity: hasData ? 1 : 0.45,
                transition: 'background-color 0.25s ease, color 0.25s ease, opacity 0.25s ease',
              }}>
                {hasData ? `${reading.value} dB` : '— dB'}
              </div>
            </Marker>
          )
        })}

        {selected && (
          <Popup
            longitude={selected.long} latitude={selected.lat}
            anchor="top" onClose={() => setSelected(null)} maxWidth="200px"
          >
            <div style={{ fontSize: 13, lineHeight: '20px', color: '#111' }}>
              <strong>{selected.name}</strong>
              {selected.value != null ? (
                <>
                  <div style={{ marginTop: 4 }}>
                    <span style={{ color: '#444' }}>Value: </span>
                    <span style={{ color: splColor(selected.value), fontWeight: 700 }}>
                      {selected.value} dB
                    </span>
                  </div>
                  <div style={{ color: '#444', fontSize: 11, marginTop: 2 }}>
                    {HEALTH_LEVELS.find(l => selected.value < l.max).desc}
                  </div>
                  <div style={{ color: '#444', fontSize: 11 }}>
                    {current && formatTimestamp(current.timestamp)}
                  </div>
                </>
              ) : (
                <div style={{ color: '#888', fontSize: 11, marginTop: 4 }}>
                  No data for this hour
                </div>
              )}
            </div>
          </Popup>
        )}
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

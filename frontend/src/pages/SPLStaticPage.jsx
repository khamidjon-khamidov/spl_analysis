import { useState, useEffect } from 'react'
import { useDataSource } from '../DataSourceContext'
import { useDateRange } from '../useDateRange'
import Map, { Marker, Popup } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const HEALTH_LEVELS = [
  { max: 45, color: '#22c55e', label: '< 45 dB',   desc: 'Safe'            },
  { max: 55, color: '#a3e635', label: '45–55 dB',  desc: 'Acceptable'      },
  { max: 65, color: '#facc15', label: '55–65 dB',  desc: 'Moderate concern' },
  { max: 75, color: '#f97316', label: '65–75 dB',  desc: 'High concern'    },
  { max: Infinity, color: '#ef4444', label: '≥ 75 dB', desc: 'Dangerous'   },
]

function splColor(value) {
  return HEALTH_LEVELS.find(l => value < l.max).color
}

// Build today's date string in yyyy-mm-dd for the date input default
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

// Format date input (yyyy-mm-dd) + hour -> "dd-mm-yyyy hh:00"
function toTimestamp(dateStr, hour) {
  const [y, m, d] = dateStr.split('-')
  return `${d}-${m}-${y} ${String(hour).padStart(2, '0')}:00`
}

export default function SPLStaticPage() {
  const { source } = useDataSource()
  const { minDate, maxDate } = useDateRange()
  const [date, setDate] = useState(null)
  const [hour, setHour] = useState(12)
  const [allDevices, setAllDevices] = useState([])
  const [readings, setReadings] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)
  const [queried, setQueried] = useState(null)

  useEffect(() => { if (minDate && !date) setDate(minDate) }, [minDate])

  useEffect(() => {
    fetch('http://localhost:8000/devices/all')
      .then(r => r.json())
      .then(setAllDevices)
  }, [])

  useEffect(() => {
    if (!date) return
    const ts = toTimestamp(date, hour)
    setLoading(true)
    setSelected(null)
    fetch(`http://localhost:8000/spl/static?timestamp=${encodeURIComponent(ts)}&source=${source}`)
      .then(r => r.json())
      .then(data => {
        setReadings(data)
        setQueried(ts)
        setLoading(false)
      })
  }, [date, hour, source])

  // Build a lookup of device_id -> reading for quick access
  const readingById = Object.fromEntries(readings.map(r => [r.id, r]))

  const center = { lat: 59.42, lon: 24.75 }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>

      {/* Controls */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        background: 'rgba(20,20,30,0.88)', color: '#fff',
        borderRadius: 8, padding: '12px 16px',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'
      }}>
        <input
          type="date"
          value={date}
          min={minDate ?? ''}
          max={maxDate ?? ''}
          onChange={e => setDate(e.target.value)}
          style={inputStyle}
        />
        <select
          value={hour}
          onChange={e => setHour(Number(e.target.value))}
          style={inputStyle}
        >
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
          ))}
        </select>
        {loading
          ? <span style={{ fontSize: 12, color: '#aaa' }}>Loading…</span>
          : queried && <span style={{ fontSize: 12, color: '#aaa' }}>{readings.length} devices · {queried}</span>
        }
      </div>

      {/* Legend */}
      <div style={{
        position: 'absolute', top: 12, right: 12, zIndex: 10,
        background: 'rgba(20,20,30,0.88)', color: '#fff',
        borderRadius: 8, padding: '10px 14px', fontSize: 12,
        backdropFilter: 'blur(4px)', lineHeight: '22px'
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>WHO noise standard</div>
        {HEALTH_LEVELS.map(l => (
          <div key={l.label}>
            <span style={{ color: l.color }}>●</span> {l.label} — {l.desc}
          </div>
        ))}
        <div style={{ marginTop: 4, borderTop: '1px solid #444', paddingTop: 4 }}>
          <span style={{ color: '#6b7280' }}>●</span> No data
        </div>
        <div style={{ marginTop: 6, borderTop: '1px solid #444', paddingTop: 6 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Value source</div>
          <div><span style={{ display:'inline-block', width:8, height:8, borderRadius:1, background:'#9ca3af', marginRight:5 }}/>Original</div>
          <div><span style={{ display:'inline-block', width:8, height:8, borderRadius:1, background:'#f472b6', marginRight:5 }}/>Imputed</div>
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
                padding: '2px 6px 2px 12px', borderRadius: 4,
                whiteSpace: 'nowrap', cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                opacity: hasData ? 1 : 0.5,
                position: 'relative', overflow: 'hidden',
              }}>
                <span style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: 6,
                  background: hasData && reading.imputed ? '#f472b6' : '#9ca3af',
                }} />
                {hasData ? `${reading.value} dB` : device.name}
              </div>
            </Marker>
          )
        })}

        {selected && (
          <Popup
            longitude={selected.long}
            latitude={selected.lat}
            anchor="top"
            onClose={() => setSelected(null)}
            maxWidth="200px"
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
                  <div style={{ color: '#444', fontSize: 11 }}>{queried}</div>
                </>
              ) : (
                <div style={{ color: '#888', fontSize: 11, marginTop: 4 }}>
                  No data for {queried ?? 'this hour'}
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
  background: '#2a2a3a',
  color: '#fff',
  border: '1px solid #444',
  borderRadius: 6,
  padding: '5px 8px',
  fontSize: 13,
  cursor: 'pointer',
}


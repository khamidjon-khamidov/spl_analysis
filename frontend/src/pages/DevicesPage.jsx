import { useEffect, useState } from 'react'
import Map, { Marker, Popup } from 'react-map-gl/maplibre'
import { useDataSource } from '../DataSourceContext'
import 'maplibre-gl/dist/maplibre-gl.css'

const API_URL = 'http://localhost:8000/devices/all'
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const FILLED_COL = {
  original:   null,
  historical: 'hist_hours_filled',
  knn:        'knn_hours_filled',
  combined:   'combined_hours_filled',
}

function missingPct(device, source) {
  if (!device.total_hours) return 0
  const col = FILLED_COL[source]
  if (!col) return (device.missing_hours / device.total_hours) * 100
  return ((device.total_hours - device[col]) / device.total_hours) * 100
}

// green -> yellow -> red based on missing %
function markerColor(pct) {
  if (pct >= 50) return '#ef4444'  // red
  if (pct >= 20) return '#f59e0b'  // amber
  return '#22c55e'                  // green
}

export default function DevicesPage() {
  const { source } = useDataSource()
  const [devices, setDevices] = useState([])
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    fetch(API_URL)
      .then(r => r.json())
      .then(setDevices)
  }, [])

  const center = devices.length
    ? { lat: devices[0].lat, lon: devices[0].long }
    : { lat: 59.4, lon: 24.7 }

  const pct = selected ? missingPct(selected, source) : 0

  const overview = devices.reduce((acc, d) => {
    const p = missingPct(d, source)
    if (p < 20)       acc.green++
    else if (p <= 50) acc.amber++
    else              acc.red++
    return acc
  }, { green: 0, amber: 0, red: 0 })

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Legend */}
      <div style={{
        position: 'absolute', top: 12, right: 12, zIndex: 10,
        background: 'rgba(20,20,30,0.85)', color: '#fff',
        borderRadius: 8, padding: '10px 14px', fontSize: 12,
        backdropFilter: 'blur(4px)', lineHeight: '22px'
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Missing data</div>
        <div><span style={{ color: '#22c55e' }}>●</span> &lt; 20%</div>
        <div><span style={{ color: '#f59e0b' }}>●</span> 20 – 50%</div>
        <div><span style={{ color: '#ef4444' }}>●</span> &gt; 50%</div>
      </div>

      <Map
        initialViewState={{ longitude: center.lon, latitude: center.lat, zoom: 11 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
      >
        {devices.map(device => {
          const color = markerColor(missingPct(device, source))
          return (
            <Marker
              key={device.id}
              longitude={device.long}
              latitude={device.lat}
              anchor="bottom"
              onClick={e => { e.originalEvent.stopPropagation(); setSelected(device) }}
            >
              <div style={{
                background: color,
                color: '#fff',
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 4,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.4)'
              }}>
                {device.name}
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
            maxWidth="240px"
          >
            <div style={{ fontSize: 13, lineHeight: '20px', color: '#111' }}>
              <strong>{selected.name}</strong>
              <div style={{ color: '#111', marginBottom: 6 }}>ID: {selected.id}</div>

              <div style={{ borderTop: '1px solid #eee', paddingTop: 6 }}>
                <Row label="Start" value={selected.data_start ?? '—'} />
                <Row label="End"   value={selected.data_end   ?? '—'} />
                <Row label="Total hours" value={selected.total_hours ?? '—'} />
                <Row
                  label="Missing hours"
                  value={selected.missing_hours != null
                    ? `${selected.missing_hours} (${pct.toFixed(1)}%)`
                    : '—'}
                  color={markerColor(pct)}
                />
              </div>
              <div style={{ borderTop: '1px solid #eee', paddingTop: 6, marginTop: 2 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 11, color: '#555' }}>After imputation</div>
                {[
                  { label: 'Historical', filled: selected.hist_hours_filled },
                  { label: 'KNN',        filled: selected.knn_hours_filled },
                  { label: 'Combined',   filled: selected.combined_hours_filled },
                ].map(({ label, filled }) => {
                  const missing = selected.total_hours - filled
                  const pctFilled = selected.total_hours ? (filled / selected.total_hours * 100) : 0
                  return (
                    <Row
                      key={label}
                      label={label}
                      value={filled != null ? `${filled} / ${selected.total_hours} (${pctFilled.toFixed(1)}%)` : '—'}
                      color={missing === 0 ? '#16a34a' : missing < 10 ? '#ca8a04' : '#dc2626'}
                    />
                  )
                })}
              </div>
            </div>
          </Popup>
        )}
      </Map>

      {/* Bottom overview bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
        background: 'rgba(15,15,25,0.92)', backdropFilter: 'blur(6px)',
        borderTop: '1px solid #333',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32,
        padding: '10px 20px',
      }}>
        {[
          { color: '#22c55e', label: '< 20% missing',    count: overview.green },
          { color: '#f59e0b', label: '20 – 50% missing', count: overview.amber },
          { color: '#ef4444', label: '> 50% missing',    count: overview.red   },
        ].map(({ color, label, count }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color, fontSize: 22, fontWeight: 700 }}>{count}</span>
            <span style={{ color: '#aaa', fontSize: 12 }}>{label}</span>
          </div>
        ))}
        <span style={{ color: '#555', fontSize: 12, marginLeft: 16 }}>
          {devices.length} total devices
        </span>
      </div>
    </div>
  )
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: '#444' }}>{label}</span>
      <span style={{ color: color ?? '#111', fontWeight: color ? 600 : 400 }}>{value}</span>
    </div>
  )
}

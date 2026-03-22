import { useEffect, useState } from 'react'
import Map, { Marker, Popup } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

const API_URL = 'http://localhost:8000/devices/all'
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

function missingPct(device) {
  if (!device.total_hours) return 0
  return (device.missing_hours / device.total_hours) * 100
}

// green -> yellow -> red based on missing %
function markerColor(pct) {
  if (pct >= 50) return '#ef4444'  // red
  if (pct >= 20) return '#f59e0b'  // amber
  return '#22c55e'                  // green
}

export default function DevicesPage() {
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

  const pct = selected ? missingPct(selected) : 0

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
          const color = markerColor(missingPct(device))
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
                <Row label="Total hours"    value={selected.total_hours     ?? '—'} />
                <Row label="Hours with data" value={selected.hours_with_data ?? '—'} />
                <Row
                  label="Missing hours"
                  value={selected.missing_hours != null
                    ? `${selected.missing_hours} (${pct.toFixed(1)}%)`
                    : '—'}
                  color={markerColor(pct)}
                />
              </div>
            </div>
          </Popup>
        )}
      </Map>
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

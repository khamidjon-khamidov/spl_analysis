import { useEffect, useState, useRef } from 'react'
import Map, { Marker, Popup } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

const API_URL = 'http://localhost:8000/devices/all'
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

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

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Map
        initialViewState={{ longitude: center.lon, latitude: center.lat, zoom: 11 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
      >
        {devices.map(device => (
          <Marker
            key={device.id}
            longitude={device.long}
            latitude={device.lat}
            anchor="bottom"
            onClick={e => { e.originalEvent.stopPropagation(); setSelected(device) }}
          >
            <div style={{
              background: '#4f46e5',
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
        ))}

        {selected && (
          <Popup
            longitude={selected.long}
            latitude={selected.lat}
            anchor="top"
            onClose={() => setSelected(null)}
          >
            <div style={{ fontSize: 13 }}>
              <strong>{selected.name}</strong><br />
              <span style={{ color: '#888' }}>ID: {selected.id}</span><br />
              <span style={{ color: '#888' }}>{selected.lat.toFixed(6)}, {selected.long.toFixed(6)}</span>
            </div>
          </Popup>
        )}
      </Map>
    </div>
  )
}

import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Cell,
} from 'recharts'

const METHOD_COLORS = {
  historical: '#f59e0b',
  knn:        '#3b82f6',
  combined:   '#a855f7',
  timesfm:    '#22c55e',
}

const METHOD_LABELS = {
  historical: 'Historical',
  knn:        'KNN',
  combined:   'Combined',
  timesfm:    'TimesFM',
}

const METHODS = ['historical', 'knn', 'combined', 'timesfm']

const GROUP_LABELS = {
  'ALL':            'Overall',
  'A-Connected':    'A — Well-connected',
  'B-Isolated':     'B — Spatially isolated',
  'C-ShortHistory': 'C — Short history',
}

const SCOPES = ['ALL', 'A-Connected', 'B-Isolated', 'C-ShortHistory']

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

function SectionTitle({ children }) {
  return (
    <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14 }}>
      {children}
    </div>
  )
}

// Build chart data: one entry per scope, mae/rmse for each method
function buildScopeChart(summary, metric) {
  return SCOPES.map(scope => {
    const entry = { scope: GROUP_LABELS[scope] ?? scope }
    METHODS.forEach(m => {
      const row = summary.find(r => r.scope === scope && r.method === m)
      entry[m] = row?.[metric] ?? null
    })
    return entry
  })
}

// Build chart data: one entry per method with mae + rmse for overall
function buildMethodChart(summary) {
  return METHODS.map(m => {
    const row = summary.find(r => r.scope === 'ALL' && r.method === m)
    return {
      method: METHOD_LABELS[m],
      MAE:    row?.mae  ?? null,
      RMSE:   row?.rmse ?? null,
      color:  METHOD_COLORS[m],
    }
  })
}

const tooltipStyle = {
  background: '#1e1e2e', border: '1px solid #3a3a5a',
  borderRadius: 6, color: '#e2e8f0', fontSize: 12,
}
const tooltipItemStyle = { color: '#e2e8f0' }
const tooltipLabelStyle = { color: '#94a3b8', marginBottom: 4 }

export default function EvaluationPage() {
  const [summary, setSummary]       = useState([])
  const [perDevice, setPerDevice]   = useState([])
  const [metric, setMetric]         = useState('mae')
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('http://localhost:8000/evaluation/summary').then(r => r.json()),
      fetch('http://localhost:8000/evaluation/per-device').then(r => r.json()),
    ]).then(([s, d]) => {
      setSummary(s)
      setPerDevice(d)
      setLoading(false)
    })
  }, [])

  if (loading) return (
    <div style={{ color: '#aaa', padding: 40, textAlign: 'center' }}>Loading evaluation data…</div>
  )

  const methodChart = buildMethodChart(summary)
  const scopeChart  = buildScopeChart(summary, metric)
  const allRow      = m => summary.find(r => r.scope === 'ALL' && r.method === m)

  return (
    <div style={{ padding: '24px 28px', overflowY: 'auto', height: '100%', boxSizing: 'border-box', color: '#e2e8f0' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Imputation Method Comparison</h2>
          <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: 13 }}>
            Held-out evaluation on 35 test devices · 17,317 masked slots · 20% of each device's original readings
          </p>
        </div>

        {/* Metric toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {['mae', 'rmse'].map(m => (
            <button key={m} onClick={() => setMetric(m)} style={{
              background: metric === m ? '#3b82f6' : '#2a2a3a',
              color: '#fff', border: 'none', borderRadius: 6,
              padding: '6px 18px', fontSize: 13, cursor: 'pointer', fontWeight: metric === m ? 700 : 400,
            }}>
              {m.toUpperCase()}
            </button>
          ))}
          <span style={{ color: '#64748b', fontSize: 12, alignSelf: 'center', marginLeft: 8 }}>
            {metric === 'mae'
              ? 'Mean Absolute Error — average dB deviation from true value'
              : 'Root Mean Square Error — penalises large errors more heavily'}
          </span>
        </div>

        {/* Top row: scorecard + overall bar chart */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 16, marginBottom: 16 }}>

          {/* Scorecard */}
          {card(
            <>
              <SectionTitle>Overall scores</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {METHODS.map(m => {
                  const row = allRow(m)
                  const best = Math.min(...METHODS.map(x => allRow(x)?.[metric] ?? Infinity))
                  const isBest = row?.[metric] === best
                  return (
                    <div key={m} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: isBest ? 'rgba(34,197,94,0.08)' : 'transparent',
                      borderRadius: 6, padding: '6px 10px',
                      border: isBest ? '1px solid rgba(34,197,94,0.25)' : '1px solid transparent',
                    }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: 2,
                        background: METHOD_COLORS[m], flexShrink: 0,
                      }} />
                      <span style={{ flex: 1, fontSize: 13 }}>{METHOD_LABELS[m]}</span>
                      <span style={{ fontWeight: 700, fontSize: 15, color: METHOD_COLORS[m] }}>
                        {row?.[metric]?.toFixed(2) ?? '—'} dB
                      </span>
                      {isBest && <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 700 }}>BEST</span>}
                    </div>
                  )
                })}
              </div>
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #2a2a4a', fontSize: 11, color: '#64748b' }}>
                TimesFM is <strong style={{ color: '#22c55e' }}>
                  {(allRow('combined')?.[metric] / allRow('timesfm')?.[metric]).toFixed(1)}×
                </strong> more accurate than the best statistical method (Combined)
              </div>
            </>
          )}

          {/* MAE/RMSE bar chart per method */}
          {card(
            <>
              <SectionTitle>MAE vs RMSE by method (overall)</SectionTitle>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={methodChart} barCategoryGap="30%" barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
                  <XAxis dataKey="method" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit=" dB" />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} formatter={v => `${v.toFixed(3)} dB`} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                  <Bar dataKey="MAE" radius={[3, 3, 0, 0]}>
                    {methodChart.map(entry => <Cell key={entry.method} fill={entry.color} />)}
                  </Bar>
                  <Bar dataKey="RMSE" radius={[3, 3, 0, 0]} fill="transparent"
                    stroke="#64748b" strokeWidth={1}
                  >
                    {methodChart.map(entry => (
                      <Cell key={entry.method} fill={entry.color} fillOpacity={0.3} stroke={entry.color} strokeWidth={1} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </div>

        {/* By-group grouped bar chart */}
        {card(
          <>
            <SectionTitle>{metric.toUpperCase()} by method and device group</SectionTitle>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={scopeChart} barCategoryGap="25%" barGap={3}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
                <XAxis dataKey="scope" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit=" dB" domain={[0, 'auto']} />
                <Tooltip contentStyle={tooltipStyle} formatter={v => `${v?.toFixed(3)} dB`} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                {METHODS.map(m => (
                  <Bar key={m} dataKey={m} name={METHOD_LABELS[m]}
                    fill={METHOD_COLORS[m]} radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 24, marginTop: 14, fontSize: 11, color: '#64748b' }}>
              <span><strong style={{ color: '#e2e8f0' }}>A — Well-connected:</strong> long history, dense neighbours — KNN noisiest here</span>
              <span><strong style={{ color: '#e2e8f0' }}>B — Isolated:</strong> few neighbours — KNN beats Historical</span>
              <span><strong style={{ color: '#e2e8f0' }}>C — Short history:</strong> new sensors — cold-start hurts Historical</span>
            </div>
          </>,
          { marginBottom: 16 }
        )}

        {/* Summary table */}
        {card(
          <>
            <SectionTitle>Full summary table</SectionTitle>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a4a' }}>
                    <th style={th}>Scope</th>
                    {METHODS.map(m => (
                      <th key={m} colSpan={2} style={{ ...th, color: METHOD_COLORS[m] }}>
                        {METHOD_LABELS[m]}
                      </th>
                    ))}
                  </tr>
                  <tr style={{ borderBottom: '1px solid #2a2a4a', color: '#64748b' }}>
                    <th style={th} />
                    {METHODS.map(m => (
                      <>
                        <th key={m + 'mae'} style={th}>MAE</th>
                        <th key={m + 'rmse'} style={th}>RMSE</th>
                      </>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SCOPES.map(scope => (
                    <tr key={scope} style={{ borderBottom: '1px solid #1e1e3a' }}>
                      <td style={{ ...td, fontWeight: 600, color: '#cbd5e1' }}>
                        {GROUP_LABELS[scope] ?? scope}
                      </td>
                      {METHODS.map(m => {
                        const row = summary.find(r => r.scope === scope && r.method === m)
                        const bestMae  = Math.min(...METHODS.map(x => summary.find(r => r.scope === scope && r.method === x)?.mae  ?? Infinity))
                        const bestRmse = Math.min(...METHODS.map(x => summary.find(r => r.scope === scope && r.method === x)?.rmse ?? Infinity))
                        return (
                          <>
                            <td key={m + 'mae'} style={{
                              ...td,
                              color: row?.mae === bestMae ? '#22c55e' : '#e2e8f0',
                              fontWeight: row?.mae === bestMae ? 700 : 400,
                            }}>
                              {row?.mae?.toFixed(3) ?? '—'}
                            </td>
                            <td key={m + 'rmse'} style={{
                              ...td,
                              color: row?.rmse === bestRmse ? '#22c55e' : '#94a3b8',
                              fontWeight: row?.rmse === bestRmse ? 700 : 400,
                            }}>
                              {row?.rmse?.toFixed(3) ?? '—'}
                            </td>
                          </>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: '#475569' }}>
              Best value per row highlighted in green. Units: dB.
            </div>
          </>,
          { marginBottom: 16 }
        )}

        {/* Per-device table */}
        {card(
          <>
            <SectionTitle>Per-device MAE — test devices ({perDevice.length})</SectionTitle>
            <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#1a1a2e' }}>
                  <tr style={{ borderBottom: '1px solid #2a2a4a', color: '#64748b' }}>
                    <th style={th}>Device</th>
                    <th style={th}>Group</th>
                    {METHODS.map(m => (
                      <th key={m} style={{ ...th, color: METHOD_COLORS[m] }}>{METHOD_LABELS[m]}</th>
                    ))}
                    <th style={th}>Best method</th>
                  </tr>
                </thead>
                <tbody>
                  {perDevice.map(d => {
                    const maes   = METHODS.map(m => d[`${m}_mae`])
                    const minMae = Math.min(...maes.filter(v => v != null))
                    const bestM  = METHODS[maes.indexOf(minMae)]
                    return (
                      <tr key={d.device_id} style={{ borderBottom: '1px solid #1a1a2e' }}>
                        <td style={{ ...td, fontWeight: 600 }}>{d.name}</td>
                        <td style={{ ...td, color: '#64748b', fontSize: 11 }}>
                          {d.group.replace('A-Connected', 'A').replace('B-Isolated', 'B').replace('C-ShortHistory', 'C')}
                        </td>
                        {METHODS.map(m => (
                          <td key={m} style={{
                            ...td,
                            color: m === bestM ? '#22c55e' : '#94a3b8',
                            fontWeight: m === bestM ? 700 : 400,
                          }}>
                            {d[`${m}_mae`]?.toFixed(2) ?? '—'}
                          </td>
                        ))}
                        <td style={{ ...td, color: METHOD_COLORS[bestM], fontWeight: 700, fontSize: 11 }}>
                          {METHOD_LABELS[bestM]}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

      </div>
    </div>
  )
}

const th = {
  textAlign: 'left', padding: '8px 12px',
  color: '#94a3b8', fontWeight: 600, fontSize: 12,
}
const td = {
  padding: '7px 12px', color: '#e2e8f0',
}

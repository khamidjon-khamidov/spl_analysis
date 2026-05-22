import { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_URL

export function useDateRange() {
  const [minDate, setMinDate] = useState(null)
  const [maxDate, setMaxDate] = useState(null)

  useEffect(() => {
    fetch(`${API}/spl/date-range`)
      .then(r => r.json())
      .then(data => {
        setMinDate(data.min_date)
        setMaxDate(data.max_date)
      })
  }, [])

  return { minDate, maxDate }
}

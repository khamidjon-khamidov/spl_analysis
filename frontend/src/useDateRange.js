import { useState, useEffect } from 'react'

export function useDateRange() {
  const [minDate, setMinDate] = useState(null)
  const [maxDate, setMaxDate] = useState(null)

  useEffect(() => {
    fetch('http://localhost:8000/spl/date-range')
      .then(r => r.json())
      .then(data => {
        setMinDate(data.min_date)
        setMaxDate(data.max_date)
      })
  }, [])

  return { minDate, maxDate }
}

import { createContext, useContext, useState } from 'react'

const DataSourceContext = createContext()

export function DataSourceProvider({ children }) {
  const [source, setSource] = useState('original')
  return (
    <DataSourceContext.Provider value={{ source, setSource }}>
      {children}
    </DataSourceContext.Provider>
  )
}

export function useDataSource() {
  return useContext(DataSourceContext)
}

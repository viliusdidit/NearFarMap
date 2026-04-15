import { useEffect } from 'react'
import { useDataStore } from '../stores/useDataStore'
import type { City } from '../types/city'

export function useLoadData() {
  const setCities = useDataStore((s) => s.setCities)
  const setLoading = useDataStore((s) => s.setLoading)
  const setError = useDataStore((s) => s.setError)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/data/cities.json')
        if (!res.ok) throw new Error('Failed to load cities.json')
        const cities: City[] = await res.json()
        setCities(cities)
        setLoading(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error')
        setLoading(false)
      }
    }

    load()
  }, [setCities, setLoading, setError])
}

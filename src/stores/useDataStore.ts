import { create } from 'zustand'
import type { City } from '../types/city'

interface DataState {
  cities: City[]
  displacementLayers: Record<string, Float32Array>
  loading: boolean
  error: string | null
  setCities: (cities: City[]) => void
  setDisplacementLayer: (metricId: string, data: Float32Array) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useDataStore = create<DataState>((set) => ({
  cities: [],
  displacementLayers: {},
  loading: true,
  error: null,
  setCities: (cities) => set({ cities }),
  setDisplacementLayer: (metricId, data) =>
    set((state) => ({
      displacementLayers: { ...state.displacementLayers, [metricId]: data },
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}))

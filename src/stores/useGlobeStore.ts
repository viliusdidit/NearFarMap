import { create } from 'zustand'
import { DEFAULT_METRICS, type Metric } from '../types/metric'
import type { City } from '../types/city'

interface GlobeState {
  metrics: Metric[]
  selectedCity: City | null
  hoveredCity: City | null
  displacementScale: number
  setMetricWeight: (id: string, weight: number) => void
  setSelectedCity: (city: City | null) => void
  setHoveredCity: (city: City | null) => void
  setDisplacementScale: (scale: number) => void
}

export const useGlobeStore = create<GlobeState>((set) => ({
  metrics: DEFAULT_METRICS,
  selectedCity: null,
  hoveredCity: null,
  displacementScale: 0.3,
  setMetricWeight: (id, weight) =>
    set((state) => ({
      metrics: state.metrics.map((m) =>
        m.id === id ? { ...m, weight } : m
      ),
    })),
  setSelectedCity: (city) => set({ selectedCity: city }),
  setHoveredCity: (city) => set({ hoveredCity: city }),
  setDisplacementScale: (scale) => set({ displacementScale: scale }),
}))

export interface Metric {
  id: string
  name: string
  weight: number // 0-1 slider value
  color: string
}

export const DEFAULT_METRICS: Metric[] = [
  { id: 'geodesic', name: 'Geodesic Distance', weight: 0.0, color: '#4fc3f7' },
  { id: 'flight', name: 'Flight Time', weight: 1.0, color: '#ab47bc' },
  { id: 'driving', name: 'Driving Time', weight: 1.0, color: '#66bb6a' },
  { id: 'shipping', name: 'Shipping Cost', weight: 1.0, color: '#ffa726' },
  { id: 'latency', name: 'Internet Latency', weight: 0.0, color: '#ef5350' },
]

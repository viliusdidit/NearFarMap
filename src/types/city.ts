export interface City {
  id: string
  name: string
  country: string
  lat: number
  lng: number
  population: number
  scores: Record<string, number> // metric name → 0-1 normalized score
}

// Web worker: computes per-vertex IDW displacement scores from city data

interface City {
  lat: number
  lng: number
  scores: Record<string, number>
}

interface WorkerInput {
  positions: Float32Array // original vertex positions (x,y,z interleaved)
  cities: City[]
}

interface WorkerOutput {
  scores: Record<string, Float32Array>
}

const DEG_TO_RAD = Math.PI / 180
const K_NEAREST = 12
const IDW_POWER = 2.0

function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371
  const dLat = (lat2 - lat1) * DEG_TO_RAD
  const dLng = (lng2 - lng1) * DEG_TO_RAD
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function vector3ToLatLng(x: number, y: number, z: number) {
  const radius = Math.sqrt(x * x + y * y + z * z)
  const lat = 90 - Math.acos(y / radius) / DEG_TO_RAD
  let lng = Math.atan2(z, -x) / DEG_TO_RAD - 180
  if (lng < -180) lng += 360
  return { lat, lng }
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { positions, cities } = e.data
  const vertexCount = positions.length / 3

  const metricIds = Object.keys(cities[0]?.scores || {})
  const scores: Record<string, Float32Array> = {}
  for (const mid of metricIds) {
    scores[mid] = new Float32Array(vertexCount)
  }

  const cityCoords = cities.map((c) => ({ lat: c.lat, lng: c.lng }))

  for (let i = 0; i < vertexCount; i++) {
    const { lat: vLat, lng: vLng } = vector3ToLatLng(
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
    )

    // Distances to all cities
    const dists: { idx: number; dist: number }[] = []
    for (let j = 0; j < cities.length; j++) {
      dists.push({
        idx: j,
        dist: haversineDistance(vLat, vLng, cityCoords[j].lat, cityCoords[j].lng),
      })
    }

    dists.sort((a, b) => a.dist - b.dist)
    const nearest = dists.slice(0, K_NEAREST)

    const epsilon = 0.1
    let weightSum = 0
    const weighted: Record<string, number> = {}
    for (const mid of metricIds) weighted[mid] = 0

    for (const n of nearest) {
      const w = 1.0 / Math.pow(n.dist + epsilon, IDW_POWER)
      weightSum += w
      for (const mid of metricIds) {
        weighted[mid] += (cities[n.idx].scores[mid] ?? 0) * w
      }
    }

    for (const mid of metricIds) {
      scores[mid][i] = weighted[mid] / weightSum
    }

    // Progress every 1000 vertices
    if (i % 1000 === 0) {
      self.postMessage({ type: 'progress', value: i / vertexCount })
    }
  }

  self.postMessage({ type: 'done', scores } as { type: string } & WorkerOutput)
}

// Web worker: computes per-vertex IDW displacement scores from city data

interface City {
  lat: number
  lng: number
  scores: Record<string, number>
}

interface WorkerInput {
  positions: Float32Array
  cities: City[]
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
        dist: haversineDistance(vLat, vLng, cities[j].lat, cities[j].lng),
      })
    }

    dists.sort((a, b) => a.dist - b.dist)
    const nearest = dists.slice(0, K_NEAREST)

    // IDW weights
    let weightSum = 0
    const weights: number[] = []
    for (const n of nearest) {
      const w = 1.0 / Math.pow(n.dist + 0.1, IDW_POWER)
      weights.push(w)
      weightSum += w
    }

    // Distance-based isolation: far from any city → push toward 1.0
    const nearestDist = nearest[0].dist
    const isolation = Math.min(1.0, nearestDist / 2000)

    // Interpolate each metric
    for (const mid of metricIds) {
      let vSum = 0
      for (let k = 0; k < nearest.length; k++) {
        vSum += (cities[nearest[k].idx].scores[mid] ?? 0) * weights[k]
      }
      const idwScore = vSum / weightSum
      scores[mid][i] = idwScore + (1.0 - idwScore) * isolation
    }

    // Progress every 500 vertices
    if (i % 500 === 0) {
      self.postMessage({ type: 'progress', value: i / vertexCount })
    }
  }

  self.postMessage({ type: 'done', scores })
}

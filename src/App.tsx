import { useRef, useEffect, useState } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useLoadData } from './hooks/useLoadData'
import { useDataStore } from './stores/useDataStore'
import { useGlobeStore } from './stores/useGlobeStore'
import { WeightSliders } from './components/UI/WeightSliders'
import { Legend } from './components/UI/Legend'
import type { City } from './types/city'

const DEG_TO_RAD = Math.PI / 180
const K_NEAREST = 8
const IDW_POWER = 2.0
const POINT_SIZE = 0.015
const BATCH_SIZE = 200

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = (lat2 - lat1) * DEG_TO_RAD
  const dLng = (lng2 - lng1) * DEG_TO_RAD
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) *
    Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function latLngToXYZ(lat: number, lng: number, radius: number): [number, number, number] {
  const phi = (90 - lat) * DEG_TO_RAD
  const theta = (lng + 180) * DEG_TO_RAD
  return [
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ]
}

const dummy = new THREE.Object3D()
const colorObj = new THREE.Color()

// Per-metric IDW scores for each vertex
interface VertexScores {
  [metricId: string]: Float32Array
}

function Scene({ onCityClick }: { onCityClick: (city: City | null) => void }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  const pointsRef = useRef<THREE.InstancedMesh>(null)
  const cities = useDataStore((s) => s.cities)
  const metrics = useGlobeStore((s) => s.metrics)
  const displacementScale = useGlobeStore((s) => s.displacementScale)
  const selectedCity = useGlobeStore((s) => s.selectedCity)
  const prevWeightsRef = useRef('')
  const prevScaleRef = useRef<number | null>(null)
  const origRef = useRef<Float32Array | null>(null)
  const vertexScoresRef = useRef<VertexScores | null>(null)
  const idwProgressRef = useRef(0)
  const idwStartedRef = useRef(false)
  const metricIdsRef = useRef<string[]>([])

  useEffect(() => {
    new THREE.TextureLoader().load('/textures/earth-1k.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      if (matRef.current) {
        matRef.current.map = tex
        matRef.current.color.set('#ffffff')
        matRef.current.needsUpdate = true
      }
    })
  }, [])

  useFrame((_, delta) => {
    if (pointsRef.current && meshRef.current) {
      pointsRef.current.rotation.copy(meshRef.current.rotation)
    }

    if (cities.length === 0 || !meshRef.current) return

    const geo = meshRef.current.geometry
    const positions = geo.attributes.position.array as Float32Array
    const vertexCount = positions.length / 3

    if (!origRef.current) {
      origRef.current = new Float32Array(positions.length)
      origRef.current.set(positions)
    }

    // Initialize IDW computation
    if (!idwStartedRef.current) {
      idwStartedRef.current = true
      // Discover available metrics from city data
      const metricIds = Object.keys(cities[0]?.scores || {})
      metricIdsRef.current = metricIds
      const scores: VertexScores = {}
      for (const mid of metricIds) {
        scores[mid] = new Float32Array(vertexCount)
      }
      vertexScoresRef.current = scores
    }

    // Compute IDW in batches
    if (idwProgressRef.current < vertexCount) {
      const orig = origRef.current
      const scores = vertexScoresRef.current!
      const mids = metricIdsRef.current
      const end = Math.min(idwProgressRef.current + BATCH_SIZE, vertexCount)

      for (let i = idwProgressRef.current; i < end; i++) {
        const x = orig[i * 3], y = orig[i * 3 + 1], z = orig[i * 3 + 2]
        const r = Math.sqrt(x * x + y * y + z * z)
        const lat = 90 - Math.acos(y / r) / DEG_TO_RAD
        let lng = Math.atan2(z, -x) / DEG_TO_RAD - 180
        if (lng < -180) lng += 360

        // Compute distances to all cities (once per vertex, shared across metrics)
        const cityDists: { idx: number; dist: number }[] = []
        for (let j = 0; j < cities.length; j++) {
          cityDists.push({ idx: j, dist: haversine(lat, lng, cities[j].lat, cities[j].lng) })
        }
        cityDists.sort((a, b) => a.dist - b.dist)
        const nearest = cityDists.slice(0, K_NEAREST)

        // IDW weights (shared across metrics)
        let wSum = 0
        const weights: number[] = []
        for (const n of nearest) {
          const w = 1 / (n.dist + 0.1) ** IDW_POWER
          weights.push(w)
          wSum += w
        }

        // Interpolate each metric
        for (const mid of mids) {
          let vSum = 0
          for (let k = 0; k < nearest.length; k++) {
            vSum += (cities[nearest[k].idx].scores[mid] ?? 0) * weights[k]
          }
          scores[mid][i] = vSum / wSum
        }
      }

      idwProgressRef.current = end

      // Apply displacement for computed vertices so far
      applyDisplacement(positions, origRef.current, vertexScoresRef.current!, metrics, displacementScale, end)
      geo.attributes.position.needsUpdate = true
      if (end === vertexCount) {
        geo.computeVertexNormals()
        prevScaleRef.current = displacementScale
        prevWeightsRef.current = metrics.map(m => m.weight).join(',')
        placeCityPoints()
      }
      return
    }

    // After IDW done: handle weight/scale changes
    const weightsKey = metrics.map(m => m.weight).join(',')
    if (prevScaleRef.current !== displacementScale || prevWeightsRef.current !== weightsKey) {
      prevScaleRef.current = displacementScale
      prevWeightsRef.current = weightsKey
      applyDisplacement(positions, origRef.current, vertexScoresRef.current!, metrics, displacementScale, vertexCount)
      geo.attributes.position.needsUpdate = true
      geo.computeVertexNormals()
      placeCityPoints()
    }
  })

  function applyDisplacement(
    positions: Float32Array, orig: Float32Array,
    scores: VertexScores, metrics: typeof useGlobeStore.getState extends () => infer S ? S['metrics'] : never,
    scale: number, count: number
  ) {
    let totalWeight = 0
    for (const m of metrics) totalWeight += m.weight
    if (totalWeight === 0) totalWeight = 1

    for (let i = 0; i < count; i++) {
      const x = orig[i * 3], y = orig[i * 3 + 1], z = orig[i * 3 + 2]
      const r = Math.sqrt(x * x + y * y + z * z)

      let blended = 0
      for (const m of metrics) {
        if (m.weight > 0 && scores[m.id]) {
          blended += scores[m.id][i] * m.weight
        }
      }
      blended /= totalWeight

      const s = 1.0 + blended * scale
      positions[i * 3] = (x / r) * s
      positions[i * 3 + 1] = (y / r) * s
      positions[i * 3 + 2] = (z / r) * s
    }
  }

  function placeCityPoints() {
    if (!pointsRef.current) return
    const cities_ = useDataStore.getState().cities
    const metrics_ = useGlobeStore.getState().metrics
    const scale = useGlobeStore.getState().displacementScale
    const selected = useGlobeStore.getState().selectedCity

    let totalWeight = 0
    for (const m of metrics_) totalWeight += m.weight
    if (totalWeight === 0) totalWeight = 1

    for (let i = 0; i < cities_.length; i++) {
      const city = cities_[i]
      let blended = 0
      for (const m of metrics_) {
        if (m.weight > 0) blended += (city.scores[m.id] ?? 0) * m.weight
      }
      blended /= totalWeight

      const radius = 1.0 + blended * scale + 0.02
      const [cx, cy, cz] = latLngToXYZ(city.lat, city.lng, radius)
      dummy.position.set(cx, cy, cz)
      dummy.updateMatrix()
      pointsRef.current!.setMatrixAt(i, dummy.matrix)

      colorObj.set(selected?.id === city.id ? '#ffd700' : '#ffffff')
      pointsRef.current!.setColorAt(i, colorObj)
    }
    pointsRef.current!.instanceMatrix.needsUpdate = true
    if (pointsRef.current!.instanceColor) pointsRef.current!.instanceColor.needsUpdate = true
  }

  const handleGlobeClick = (e: ThreeEvent<MouseEvent>) => {
    // Find nearest city to click point
    const point = e.point
    let nearest: City | null = null
    let nearestDist = Infinity

    for (const city of cities) {
      const score = blendCityScore(city)
      const radius = 1.0 + score * useGlobeStore.getState().displacementScale + 0.02
      const [cx, cy, cz] = latLngToXYZ(city.lat, city.lng, radius)

      // Account for globe rotation
      const rotY = meshRef.current?.rotation.y ?? 0
      const cosR = Math.cos(rotY), sinR = Math.sin(rotY)
      const rx = cx * cosR + cz * sinR
      const rz = -cx * sinR + cz * cosR

      const dx = point.x - rx
      const dy = point.y - cy
      const dz = point.z - rz
      const dist = dx * dx + dy * dy + dz * dz

      if (dist < nearestDist) {
        nearestDist = dist
        nearest = city
      }
    }

    // Only select if close enough (screen-space ~30px)
    if (nearest && nearestDist < 0.01) {
      const current = useGlobeStore.getState().selectedCity
      const next = current?.id === nearest.id ? null : nearest
      useGlobeStore.getState().setSelectedCity(next)
      onCityClick(next)
      updatePointColors(next)
    } else {
      useGlobeStore.getState().setSelectedCity(null)
      onCityClick(null)
      updatePointColors(null)
    }
  }

  function blendCityScore(city: City): number {
    const metrics_ = useGlobeStore.getState().metrics
    let totalWeight = 0, blended = 0
    for (const m of metrics_) {
      if (m.weight > 0) {
        blended += (city.scores[m.id] ?? 0) * m.weight
        totalWeight += m.weight
      }
    }
    return totalWeight > 0 ? blended / totalWeight : 0
  }

  function updatePointColors(selected: City | null) {
    if (!pointsRef.current) return
    for (let i = 0; i < cities.length; i++) {
      colorObj.set(selected?.id === cities[i].id ? '#ffd700' : '#ffffff')
      pointsRef.current.setColorAt(i, colorObj)
    }
    if (pointsRef.current.instanceColor) pointsRef.current.instanceColor.needsUpdate = true
  }

  return (
    <>
      <mesh ref={meshRef} onClick={handleGlobeClick}>
        <sphereGeometry args={[1, 128, 64]} />
        <meshBasicMaterial ref={matRef} color="#2244aa" />
      </mesh>
      <instancedMesh
        ref={pointsRef}
        args={[undefined, undefined, 500]}
        raycast={() => {}}
      >
        <sphereGeometry args={[POINT_SIZE, 4, 4]} />
        <meshBasicMaterial />
      </instancedMesh>
    </>
  )
}

function CityTooltip({ city }: { city: City }) {
  const metrics = useGlobeStore((s) => s.metrics)
  return (
    <div className="absolute top-4 right-4 bg-black/80 text-white px-4 py-3 rounded-lg border border-white/20 min-w-48">
      <div className="font-bold text-base">{city.name}</div>
      <div className="text-xs text-gray-400">{city.country}</div>
      <div className="text-sm mt-2">
        Pop: {(city.population / 1_000_000).toFixed(1)}M
      </div>
      {metrics.map(m => {
        const score = city.scores[m.id]
        if (score === undefined) return null
        const label = score < 0.3 ? 'well connected' : score > 0.7 ? 'isolated' : 'moderate'
        return (
          <div key={m.id} className="text-xs text-gray-300 mt-1">
            {m.name}: {(score * 100).toFixed(0)}%
            <span className="text-gray-500 ml-1">({label})</span>
          </div>
        )
      })}
    </div>
  )
}

function App() {
  useLoadData()
  const [selectedCity, setSelectedCity] = useState<City | null>(null)

  return (
    <div className="w-full h-full relative">
      <Canvas
        camera={{ position: [0, 0, 3] }}
        onPointerMissed={() => {
          useGlobeStore.getState().setSelectedCity(null)
          setSelectedCity(null)
        }}
      >
        <Scene onCityClick={setSelectedCity} />
        <OrbitControls />
      </Canvas>
      <WeightSliders />
      <Legend />
      {selectedCity && <CityTooltip city={selectedCity} />}
    </div>
  )
}

export default App

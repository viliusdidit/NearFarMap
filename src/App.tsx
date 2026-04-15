import { useRef, useEffect, useState } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Text, Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { useLoadData } from './hooks/useLoadData'
import { useDataStore } from './stores/useDataStore'
import { useGlobeStore } from './stores/useGlobeStore'
import { WeightSliders } from './components/UI/WeightSliders'
import { Legend } from './components/UI/Legend'
import type { City } from './types/city'
import DisplacementWorker from './workers/displacement.worker?worker'

const DEG_TO_RAD = Math.PI / 180
const POINT_SIZE = 0.006
const TOP_LABEL_COUNT = 100

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

interface VertexScores {
  [metricId: string]: Float32Array
}

function FlyControls({ onZoom }: { onZoom: (dist: number) => void }) {
  const keys = useRef(new Set<string>())
  const speed = 0.008

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      keys.current.add(e.code)
    }
    const onUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  useFrame(({ camera }) => {
    onZoom(camera.position.length())

    const k = keys.current
    if (k.size === 0) return

    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize()
    const up = camera.up.clone()

    const move = new THREE.Vector3()
    if (k.has('KeyQ')) move.add(forward)
    if (k.has('KeyE')) move.sub(forward)
    if (k.has('Equal') || k.has('NumpadAdd')) {
      const s = useGlobeStore.getState()
      s.setDisplacementScale(Math.min(2.0, s.displacementScale + 0.005))
    }
    if (k.has('Minus') || k.has('NumpadSubtract')) {
      const s = useGlobeStore.getState()
      s.setDisplacementScale(Math.max(0.05, s.displacementScale - 0.005))
    }
    if (k.has('KeyD')) move.sub(right)
    if (k.has('KeyA')) move.add(right)
    if (k.has('KeyS')) move.add(up)
    if (k.has('KeyW')) move.sub(up)

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed)
      camera.position.add(move)
    }
  })

  return null
}

function Scene({ onCityClick, onZoom, onProgress }: { onCityClick: (city: City | null) => void; onZoom: (dist: number) => void; onProgress: (p: number) => void }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  const pointsRef = useRef<THREE.InstancedMesh>(null)
  const cities = useDataStore((s) => s.cities)
  const metrics = useGlobeStore((s) => s.metrics)
  const displacementScale = useGlobeStore((s) => s.displacementScale)
  const selectedCity = useGlobeStore((s) => s.selectedCity)
  const labelOpacity = useGlobeStore((s) => s.labelOpacity)
  const globeOpacity = useGlobeStore((s) => s.globeOpacity)
  const invertDepth = useGlobeStore((s) => s.invertDepth)
  const prevKeyRef = useRef('')
  const origRef = useRef<Float32Array | null>(null)
  const vertexScoresRef = useRef<VertexScores | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const [labelData, setLabelData] = useState<{ name: string; pos: [number, number, number]; underground: boolean; rank: number }[]>([])

  // Load texture
  useEffect(() => {
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/earth-diffuse.jpg`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      if (matRef.current) {
        matRef.current.map = tex
        matRef.current.color.set('#ffffff')
        matRef.current.needsUpdate = true
      }
    })
  }, [])

  // Launch worker when cities load
  useEffect(() => {
    if (cities.length === 0 || !meshRef.current) return

    const geo = meshRef.current.geometry
    const positions = geo.attributes.position.array as Float32Array

    // Store originals
    if (!origRef.current) {
      origRef.current = new Float32Array(positions.length)
      origRef.current.set(positions)
      const vertexCount = positions.length / 3
      const initColors = new Float32Array(vertexCount * 3).fill(1.0)
      geo.setAttribute('color', new THREE.BufferAttribute(initColors, 3))
    }

    // Kill previous worker
    if (workerRef.current) workerRef.current.terminate()

    const worker = new DisplacementWorker()
    workerRef.current = worker
    onProgress(0)

    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        onProgress(e.data.value)
      } else if (e.data.type === 'done') {
        const scores: VertexScores = {}
        for (const [key, val] of Object.entries(e.data.scores)) {
          scores[key] = new Float32Array(val as ArrayLike<number>)
        }
        vertexScoresRef.current = scores
        onProgress(1)
        prevKeyRef.current = '' // force displacement apply
        worker.terminate()
        workerRef.current = null
      }
    }

    worker.postMessage({
      positions: origRef.current,
      cities: cities.map((c) => ({ lat: c.lat, lng: c.lng, scores: c.scores })),
    })

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [cities])

  // Apply displacement + update points when scores/weights/scale change
  useFrame(() => {
    if (!meshRef.current || !vertexScoresRef.current || !origRef.current) return
    if (pointsRef.current) pointsRef.current.rotation.copy(meshRef.current.rotation)

    const key = metrics.map(m => m.weight).join(',') + '|' + displacementScale + '|' + invertDepth
    if (prevKeyRef.current === key) return
    prevKeyRef.current = key

    const geo = meshRef.current.geometry
    const positions = geo.attributes.position.array as Float32Array
    const orig = origRef.current
    const scores = vertexScoresRef.current
    const vertexCount = positions.length / 3

    let totalWeight = 0
    for (const m of metrics) totalWeight += m.weight
    if (totalWeight === 0) totalWeight = 1

    // Get/create color attribute
    let colorAttr = geo.getAttribute('color') as THREE.BufferAttribute
    const colors = colorAttr.array as Float32Array

    for (let i = 0; i < vertexCount; i++) {
      const x = orig[i * 3], y = orig[i * 3 + 1], z = orig[i * 3 + 2]
      const r = Math.sqrt(x * x + y * y + z * z)

      let blended = 0
      for (const m of metrics) {
        if (m.weight > 0 && scores[m.id]) {
          blended += scores[m.id][i] * m.weight
        }
      }
      blended /= totalWeight
      if (invertDepth) blended = 1.0 - blended

      // Map 0→-1, 0.5→0, 1→+1 then scale
      // Valleys (low scores) sink below surface, peaks rise above
      const centered = blended * 2.0 - 1.0 // -1 to +1
      // Asymmetric: valleys go deeper than peaks go high
      const shaped = centered >= 0
        ? centered * centered          // peaks: gentle
        : -(centered * centered)        // valleys: deep
      const s = 1.0 + shaped * displacementScale
      positions[i * 3] = (x / r) * s
      positions[i * 3 + 1] = (y / r) * s
      positions[i * 3 + 2] = (z / r) * s

      colors[i * 3] = 2.5
      colors[i * 3 + 1] = 2.5
      colors[i * 3 + 2] = 3.0
    }

    geo.attributes.position.needsUpdate = true
    colorAttr.needsUpdate = true
    geo.computeVertexNormals()
    placeCityPoints()
  })

  function placeCityPoints() {
    if (!pointsRef.current) return
    const cities_ = useDataStore.getState().cities
    const metrics_ = useGlobeStore.getState().metrics
    const scale = useGlobeStore.getState().displacementScale
    const selected = useGlobeStore.getState().selectedCity
    const inv = useGlobeStore.getState().invertDepth

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
      if (inv) blended = 1.0 - blended

      const centered = blended * 2.0 - 1.0
      const shaped = centered >= 0 ? centered * centered : -(centered * centered)
      const beaconHeight = 0.02 + Math.abs(shaped) * scale * 0.3
      const baseRadius = 1.0 + shaped * scale + 0.001
      const midRadius = baseRadius + beaconHeight / 2
      const [cx, cy, cz] = latLngToXYZ(city.lat, city.lng, midRadius)

      dummy.position.set(cx, cy, cz)
      dummy.lookAt(0, 0, 0)
      dummy.rotateX(Math.PI / 2)
      dummy.scale.set(1, beaconHeight, 1)
      dummy.updateMatrix()
      pointsRef.current!.setMatrixAt(i, dummy.matrix)

      if (selected?.id === city.id) {
        colorObj.set('#ffd700')
      } else {
        // Cities with airports (flight score < 1.0) get cyan, others white
        const hasAirport = (city.scores.flight ?? 1.0) < 0.95
        colorObj.set(hasAirport ? '#00ccff' : '#ffffff')
      }
      pointsRef.current!.setColorAt(i, colorObj)
    }
    pointsRef.current!.instanceMatrix.needsUpdate = true
    if (pointsRef.current!.instanceColor) pointsRef.current!.instanceColor.needsUpdate = true

    // Labels: biggest cities by population, spaced apart
    const scored = cities_.map(city => {
      let b = 0
      for (const m of metrics_) {
        if (m.weight > 0) b += (city.scores[m.id] ?? 0) * m.weight
      }
      b /= totalWeight
      if (inv) b = 1.0 - b
      return { city, blended: b }
    })

    // Sort by population, pick biggest with spacing
    const byPop = [...scored].sort((a, b) => b.city.population - a.city.population)
    const MIN_ANGLE_DEG = 8
    const minAngleRad = MIN_ANGLE_DEG * Math.PI / 180
    const topCities: { city: City; blended: number }[] = []
    const pickedCoords: { lat: number; lng: number }[] = []

    for (const s of byPop) {
      if (topCities.length >= TOP_LABEL_COUNT) break
      const lat1 = s.city.lat * Math.PI / 180
      const lng1 = s.city.lng * Math.PI / 180
      let tooClose = false
      for (const p of pickedCoords) {
        const dlat = lat1 - p.lat
        const dlng = lng1 - p.lng
        const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(p.lat) * Math.sin(dlng / 2) ** 2
        const angle = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        if (angle < minAngleRad) { tooClose = true; break }
      }
      if (!tooClose) {
        topCities.push(s)
        pickedCoords.push({ lat: lat1, lng: lng1 })
      }
    }
    const labels = topCities.map(({ city, blended }, idx) => {
      const centered = blended * 2.0 - 1.0
      const shaped = centered >= 0 ? centered * centered : -(centered * centered)
      const beaconHeight = 0.02 + Math.abs(shaped) * scale * 0.3
      const baseRadius = 1.0 + shaped * scale
      const underground = baseRadius < 1.0
      // Underground labels: at high displacement, put label at the deep end (near center)
      // At low displacement, keep near surface
      let labelRadius: number
      if (underground) {
        if (scale > 0.4) {
          // Label at the deepest point — near beacon base (closest to center)
          labelRadius = Math.max(0.02, baseRadius - 0.02)
        } else {
          labelRadius = Math.min(0.95, baseRadius + beaconHeight + 0.02)
        }
      } else {
        labelRadius = baseRadius + beaconHeight + 0.02
      }
      const pos = latLngToXYZ(city.lat, city.lng, labelRadius)
      return { name: city.name, pos, underground, rank: idx }
    })
    setLabelData(labels)
  }

  const handleGlobeClick = (e: ThreeEvent<MouseEvent>) => {
    const point = e.point
    let nearest: City | null = null
    let nearestDist = Infinity

    for (const city of cities) {
      const score = blendCityScore(city)
      const centered = score * 2.0 - 1.0
      const shaped = centered >= 0 ? centered * centered : -(centered * centered)
      const radius = 1.0 + shaped * useGlobeStore.getState().displacementScale + 0.02
      const [cx, cy, cz] = latLngToXYZ(city.lat, city.lng, radius)

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

    if (nearest && nearestDist < 0.015) {
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
    let result = totalWeight > 0 ? blended / totalWeight : 0
    if (useGlobeStore.getState().invertDepth) result = 1.0 - result
    return result
  }

  function updatePointColors(selected: City | null) {
    if (!pointsRef.current) return
    for (let i = 0; i < cities.length; i++) {
      if (selected?.id === cities[i].id) {
        colorObj.set('#ffd700')
      } else {
        const hasAirport = (cities[i].scores.flight ?? 1.0) < 0.95
        colorObj.set(hasAirport ? '#00ccff' : '#ffffff')
      }
      pointsRef.current.setColorAt(i, colorObj)
    }
    if (pointsRef.current.instanceColor) pointsRef.current.instanceColor.needsUpdate = true
  }

  return (
    <>
      <mesh ref={meshRef} onClick={handleGlobeClick}>
        <sphereGeometry args={[1, 128, 64]} />
        <meshBasicMaterial ref={matRef} color="#2244aa" vertexColors side={THREE.DoubleSide} transparent opacity={globeOpacity} />
      </mesh>
      <instancedMesh
        ref={pointsRef}
        args={[undefined, undefined, 3000]}
        raycast={() => {}}
      >
        <cylinderGeometry args={[0.001, 0.001, 1, 4]} />
        <meshBasicMaterial transparent opacity={0.6} />
      </instancedMesh>
      {labelData.map(({ name, pos, underground, rank }) => (
        <group key={name}>
          {rank < 10 && (
            <mesh position={pos}>
              <sphereGeometry args={[0.012 - rank * 0.001, 8, 8]} />
              <meshBasicMaterial
                color={underground ? '#00ffaa' : '#ffaa00'}
                transparent
                opacity={0.7}
              />
            </mesh>
          )}
          <Billboard position={pos}>
            <Text
              fontSize={rank < 10 ? 0.025 : underground ? 0.018 : 0.02}
              color={underground ? '#00ffaa' : '#ffffff'}
              anchorX="left"
              anchorY="middle"
              outlineWidth={0.002}
              outlineColor={underground ? '#003322' : '#000000'}
              fillOpacity={labelOpacity}
              outlineOpacity={labelOpacity * 0.5}
            >
              {underground ? `▼ ${name}` : name}
            </Text>
          </Billboard>
        </group>
      ))}
      <mesh>
        <sphereGeometry args={[0.03, 16, 16]} />
        <meshBasicMaterial color="#ff2200" />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshBasicMaterial color="#ff4400" transparent opacity={0.3} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color="#ff6600" transparent opacity={0.1} />
      </mesh>
      <pointLight position={[0, 0, 0]} color="#ff4400" intensity={0.5} distance={2} />
      <FlyControls onZoom={onZoom} />
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
  const [zoom, setZoom] = useState(0.45)
  const [progress, setProgress] = useState(0)
  const [showUI, setShowUI] = useState(true)

  return (
    <div className="w-full h-full relative">
      <Canvas
        camera={{ position: [0, 0, 0.45] }}
        onPointerMissed={() => {
          useGlobeStore.getState().setSelectedCity(null)
          setSelectedCity(null)
        }}
      >
        <Scene onCityClick={setSelectedCity} onZoom={setZoom} onProgress={setProgress} />
        <OrbitControls zoomSpeed={0.3} maxDistance={6} />
      </Canvas>
      <div className="absolute top-4 left-4 flex flex-col gap-2">
        <div className="bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/10 flex items-center gap-2">
          <h1 className="text-sm font-bold text-white/90">NearFar Map</h1>
          {progress > 0 && progress < 1 && <span className="text-xs text-white/40 font-mono">computing... {(progress * 100).toFixed(0)}%</span>}
          <button
            onClick={() => setShowUI(v => !v)}
            className="ml-auto text-white/50 hover:text-white/90 text-xs cursor-pointer"
          >
            {showUI ? '[ hide ]' : '[ show ]'}
          </button>
        </div>
        {showUI && (
          <>
            <p className="text-xs text-white/40 bg-black/50 rounded-lg px-4 py-1 border border-white/10">A 3D globe where elevation shows how connected or isolated each place is — by flight, road, shipping, and internet.</p>
            <WeightSliders />
          </>
        )}
      </div>
      {showUI && <Legend />}
      {selectedCity && <CityTooltip city={selectedCity} />}
      <div className="absolute bottom-4 right-4 text-white/40 text-xs font-mono">
        zoom: {zoom.toFixed(2)}
      </div>
    </div>
  )
}

export default App

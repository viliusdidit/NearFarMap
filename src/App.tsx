import { useRef, useEffect, useCallback } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
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
const POINT_SIZE = 0.008

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

function Scene() {
  const meshRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  const pointsRef = useRef<THREE.InstancedMesh>(null)
  const cities = useDataStore((s) => s.cities)
  const displacementScale = useGlobeStore((s) => s.displacementScale)
  const displacedRef = useRef(false)
  const pointsPlacedRef = useRef(false)
  const lastScaleRef = useRef(displacementScale)
  const origRef = useRef<Float32Array | null>(null)

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
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.05
    if (pointsRef.current) pointsRef.current.rotation.y = meshRef.current?.rotation.y ?? 0

    if (cities.length === 0 || !meshRef.current) return

    const geo = meshRef.current.geometry
    const positions = geo.attributes.position.array as Float32Array

    // Store originals on first run
    if (!origRef.current) {
      origRef.current = new Float32Array(positions.length)
      origRef.current.set(positions)
    }

    // Recompute displacement when scale changes or first run
    if (!displacedRef.current || lastScaleRef.current !== displacementScale) {
      displacedRef.current = true
      lastScaleRef.current = displacementScale
      const orig = origRef.current
      const vertexCount = positions.length / 3

      for (let i = 0; i < vertexCount; i++) {
        const x = orig[i * 3]
        const y = orig[i * 3 + 1]
        const z = orig[i * 3 + 2]
        const r = Math.sqrt(x * x + y * y + z * z)
        const lat = 90 - Math.acos(y / r) / DEG_TO_RAD
        let lng = Math.atan2(z, -x) / DEG_TO_RAD - 180
        if (lng < -180) lng += 360

        const dists: { dist: number; score: number }[] = []
        for (const city of cities) {
          dists.push({ dist: haversine(lat, lng, city.lat, city.lng), score: city.scores.geodesic ?? 0 })
        }
        dists.sort((a, b) => a.dist - b.dist)

        let wSum = 0, vSum = 0
        for (let k = 0; k < Math.min(K_NEAREST, dists.length); k++) {
          const w = 1 / (dists[k].dist + 0.1) ** IDW_POWER
          wSum += w
          vSum += dists[k].score * w
        }

        const scale = 1.0 + (vSum / wSum) * displacementScale
        positions[i * 3] = (x / r) * scale
        positions[i * 3 + 1] = (y / r) * scale
        positions[i * 3 + 2] = (z / r) * scale
      }

      geo.attributes.position.needsUpdate = true
      geo.computeVertexNormals()

      // Update city point positions too
      if (pointsRef.current) {
        for (let i = 0; i < cities.length; i++) {
          const city = cities[i]
          const score = city.scores.geodesic ?? 0
          const radius = 1.0 + score * displacementScale + 0.005
          const [x, y, z] = latLngToXYZ(city.lat, city.lng, radius)
          dummy.position.set(x, y, z)
          dummy.updateMatrix()
          pointsRef.current.setMatrixAt(i, dummy.matrix)
        }
        pointsRef.current.instanceMatrix.needsUpdate = true
      }
    }
  })

  return (
    <>
      <mesh ref={meshRef}>
        <sphereGeometry args={[1, 32, 16]} />
        <meshBasicMaterial ref={matRef} color="#2244aa" />
      </mesh>
      <instancedMesh ref={pointsRef} args={[undefined, undefined, 500]}>
        <sphereGeometry args={[POINT_SIZE, 4, 4]} />
        <meshBasicMaterial color="#ffffff" />
      </instancedMesh>
    </>
  )
}

function App() {
  useLoadData()

  return (
    <div className="w-full h-full relative">
      <Canvas camera={{ position: [0, 0, 3] }}>
        <Scene />
        <OrbitControls />
      </Canvas>
      <WeightSliders />
      <Legend />
    </div>
  )
}

export default App

import { useRef, useMemo, useCallback, useEffect } from 'react'
import * as THREE from 'three'
import { useDataStore } from '../../stores/useDataStore'
import { useGlobeStore } from '../../stores/useGlobeStore'
import { latLngToVector3 } from '../../lib/geodesic'
import type { ThreeEvent } from '@react-three/fiber'

const POINT_SIZE = 0.008
const dummy = new THREE.Object3D()
const colorObj = new THREE.Color()

export function CityPoints() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const cities = useDataStore((s) => s.cities)
  const metrics = useGlobeStore((s) => s.metrics)
  const displacementScale = useGlobeStore((s) => s.displacementScale)
  const selectedCity = useGlobeStore((s) => s.selectedCity)
  const setSelectedCity = useGlobeStore((s) => s.setSelectedCity)

  const cityPositions = useMemo(() => {
    return cities.map((city) => {
      const [x, y, z] = latLngToVector3(city.lat, city.lng)

      let totalDisp = 0
      let totalWeight = 0
      for (const metric of metrics) {
        if (metric.weight > 0 && city.scores[metric.id] !== undefined) {
          totalDisp += city.scores[metric.id] * metric.weight
          totalWeight += metric.weight
        }
      }
      const displacement = totalWeight > 0
        ? (totalDisp / totalWeight) * displacementScale
        : 0

      const radius = 1.0 + displacement + 0.005
      return new THREE.Vector3(x * radius, y * radius, z * radius)
    })
  }, [cities, metrics, displacementScale])

  // Update instanced mesh positions
  useEffect(() => {
    if (!meshRef.current || cities.length === 0) return

    cities.forEach((city, i) => {
      dummy.position.copy(cityPositions[i])
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      meshRef.current!.setMatrixAt(i, dummy.matrix)

      const isSelected = selectedCity?.id === city.id
      colorObj.set(isSelected ? '#ffd700' : '#ffffff')
      meshRef.current!.setColorAt(i, colorObj)
    })

    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true
    }
  }, [cities, cityPositions, selectedCity])

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const idx = e.instanceId
    if (idx !== undefined && idx < cities.length) {
      const city = cities[idx]
      setSelectedCity(selectedCity?.id === city.id ? null : city)
    }
  }, [cities, selectedCity, setSelectedCity])

  if (cities.length === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, cities.length]}
      onClick={handleClick}
    >
      <sphereGeometry args={[POINT_SIZE, 4, 4]} />
      <meshBasicMaterial />
    </instancedMesh>
  )
}

import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { DeformedSphere } from './DeformedSphere'
import { CityPoints } from './CityPoints'

function RotatingGroup() {
  const groupRef = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.03
    }
  })

  return (
    <group ref={groupRef}>
      <DeformedSphere />
    </group>
  )
}

export function Globe() {
  return (
    <Canvas
      camera={{ position: [0, 0, 3], fov: 45 }}
      style={{ background: '#000' }}
      gl={{
        powerPreference: 'default',
        antialias: false,
        stencil: false,
        depth: true,
      }}
    >
      <ambientLight intensity={1.5} />
      <directionalLight position={[5, 3, 5]} intensity={2.0} />
      <directionalLight position={[-3, -1, -3]} intensity={0.5} />
      <RotatingGroup />
      <OrbitControls enablePan={false} />
    </Canvas>
  )
}


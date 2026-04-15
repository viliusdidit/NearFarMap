import { useState, useEffect } from 'react'
import * as THREE from 'three'

export function DeformedSphere() {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    const loader = new THREE.TextureLoader()
    loader.load('/textures/earth-1k.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      setTexture(tex)
    })
  }, [])

  return (
    <mesh>
      <sphereGeometry args={[1, 48, 24]} />
      {texture ? (
        <meshBasicMaterial map={texture} />
      ) : (
        <meshBasicMaterial color="#2244aa" />
      )}
    </mesh>
  )
}

const DEG_TO_RAD = Math.PI / 180

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371 // Earth radius km
  const dLat = (lat2 - lat1) * DEG_TO_RAD
  const dLng = (lng2 - lng1) * DEG_TO_RAD
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function latLngToVector3(
  lat: number, lng: number, radius: number = 1,
): [number, number, number] {
  const phi = (90 - lat) * DEG_TO_RAD
  const theta = (lng + 180) * DEG_TO_RAD
  return [
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ]
}

export function vector3ToLatLng(
  x: number, y: number, z: number,
): { lat: number; lng: number } {
  const radius = Math.sqrt(x * x + y * y + z * z)
  const lat = 90 - Math.acos(y / radius) / DEG_TO_RAD
  const lng = Math.atan2(z, -x) / DEG_TO_RAD - 180
  return {
    lat,
    lng: lng < -180 ? lng + 360 : lng,
  }
}

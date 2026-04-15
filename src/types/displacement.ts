export interface DisplacementLayer {
  metricId: string
  data: Float32Array // one value per vertex
}

export interface DisplacementData {
  layers: Record<string, Float32Array>
  vertexCount: number
}

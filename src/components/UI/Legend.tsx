import { scoreToColor } from '../../lib/colorRamp'

export function Legend() {
  const stops = 20
  const gradient = Array.from({ length: stops }, (_, i) => {
    const t = i / (stops - 1)
    const [r, g, b] = scoreToColor(t)
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
  })

  return (
    <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-sm rounded-lg p-3 border border-white/10">
      <div className="text-xs text-white/70 mb-2">Connectivity</div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/50">Hub</span>
        <div
          className="w-32 h-3 rounded"
          style={{
            background: `linear-gradient(to right, ${gradient.join(', ')})`,
          }}
        />
        <span className="text-xs text-white/50">Isolated</span>
      </div>
    </div>
  )
}

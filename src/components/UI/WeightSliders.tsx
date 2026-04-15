import { useGlobeStore } from '../../stores/useGlobeStore'

export function WeightSliders() {
  const metrics = useGlobeStore((s) => s.metrics)
  const setMetricWeight = useGlobeStore((s) => s.setMetricWeight)
  const displacementScale = useGlobeStore((s) => s.displacementScale)
  const setDisplacementScale = useGlobeStore((s) => s.setDisplacementScale)

  return (
    <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm rounded-lg p-4 w-64 border border-white/10">
      <h3 className="text-sm font-bold mb-3 text-white/90">Distance Metrics</h3>

      {metrics.map((metric) => (
        <div key={metric.id} className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-white/70">{metric.name}</span>
            <span className="text-white/50">{(metric.weight * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={metric.weight}
            onChange={(e) => setMetricWeight(metric.id, parseFloat(e.target.value))}
            className="w-full h-1 rounded-lg appearance-none cursor-pointer"
            style={{
              accentColor: metric.color,
              background: `linear-gradient(to right, ${metric.color} ${metric.weight * 100}%, #333 ${metric.weight * 100}%)`,
            }}
          />
        </div>
      ))}

      <div className="mt-4 pt-3 border-t border-white/10">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-white/70">Displacement Scale</span>
          <span className="text-white/50">{displacementScale.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="0.05"
          max="1.0"
          step="0.01"
          value={displacementScale}
          onChange={(e) => setDisplacementScale(parseFloat(e.target.value))}
          className="w-full h-1 rounded-lg appearance-none cursor-pointer"
          style={{
            accentColor: '#888',
            background: `linear-gradient(to right, #888 ${(displacementScale / 1.0) * 100}%, #333 ${(displacementScale / 1.0) * 100}%)`,
          }}
        />
      </div>
    </div>
  )
}

// src/presentation/components/gaze/GazeDebugPanel.tsx

import { useShallow } from 'zustand/shallow'
import { useGazeStore } from '@/presentation/state/gazeStore'

export const GazeDebugPanel = () => {
  const {
    fps,
    confidence,
  } = useGazeStore(
    useShallow((state) => ({
      fps: state.stats.fps,

      confidence:
        state.confidence,
    }))
  )

  return (
    <div>
      <div>
        FPS:
        {fps}
      </div>

      <div>
        Confidence:
        {confidence.toFixed(2)}
      </div>
    </div>
  )
}

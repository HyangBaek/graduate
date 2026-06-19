// src/presentation/components/gaze/GazeOverlay.tsx

import { useShallow } from 'zustand/shallow'
import { useCalibrationStore }
from '@/presentation/store/calibrationStore'

export const GazeOverlay = () => {
  const {
    isCalibrated,
    currentPointIndex,
    totalPoints,
  } = useCalibrationStore(
    useShallow((state) => ({
      isCalibrated:
        state.isCalibrated,

      currentPointIndex:
        state.currentPointIndex,

      totalPoints:
        state.totalPoints,
    }))
  )

  return (
    <div>
      <div>
        calibrated:
        {String(isCalibrated)}
      </div>

      <div>
        point:
        {currentPointIndex + 1}
        /
        {totalPoints}
      </div>
    </div>
  )
}

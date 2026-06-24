// src/presentation/components/gaze/TrackingStatus.tsx

import { useShallow } from 'zustand/shallow'
import { useGazeStore } from '@/presentation/state/gazeStore'

export const TrackingStatus = () => {
  const {
    isTracking,
  } = useGazeStore(
    useShallow((state) => ({
      isTracking:
        state.isTracking,
    }))
  )

  return (
    <div>
      {isTracking
        ? 'Tracking'
        : 'Stopped'}
    </div>
  )
}

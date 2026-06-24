// src/presentation/components/performance/PerformanceCountdownOverlay.tsx
// PDF 뷰어 진입 시(isCountdownPending=true) 화면 전체에 표시되는 시작 딜레이
// 카운트다운. 화면을 터치하면 즉시 카운트다운을 끝내고 연주를 시작한다.

import { useEffect, useState } from 'react'
import { usePerformanceStore } from '@/presentation/store/performanceStore'
import '@/presentation/styles/components/PerformanceCountdownOverlay.css'

/**
 * PDF 뷰어 진입 시 표시되는 연주 시작 카운트다운 오버레이.
 * 설정된 delaySeconds부터 1초씩 감소하며, 화면을 터치하거나 카운트가
 * 0에 도달하면 카운트다운을 종료하고 연주를 시작한다.
 *
 * @returns isCountdownPending이 false면 null, 그렇지 않으면 남은 시간을
 *          보여주는 전체화면 오버레이
 */
export function PerformanceCountdownOverlay() {
  const isCountdownPending = usePerformanceStore((s) => s.isCountdownPending)
  const delaySeconds = usePerformanceStore((s) => s.delaySeconds)
  const skipOrFinishCountdown = usePerformanceStore((s) => s.skipOrFinishCountdown)

  const [remaining, setRemaining] = useState(delaySeconds)

  // 카운트다운이 새로 시작될 때마다(isCountdownPending: false→true) 표시값을
  // 현재 설정된 딜레이로 리셋.
  useEffect(() => {
    if (isCountdownPending) setRemaining(delaySeconds)
  }, [isCountdownPending, delaySeconds])

  useEffect(() => {
    if (!isCountdownPending) return

    // 딜레이가 0초로 설정된 경우 즉시 연주 시작
    if (delaySeconds <= 0) {
      skipOrFinishCountdown()
      return
    }

    const intervalId = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(intervalId)
          skipOrFinishCountdown()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCountdownPending, delaySeconds])

  if (!isCountdownPending) return null

  return (
    <div
      className="perf-countdown-overlay"
      onClick={skipOrFinishCountdown}
      role="button"
      aria-label="터치하여 바로 시작"
    >
      <span className="perf-countdown-number">{remaining}</span>
      <span className="perf-countdown-hint">화면을 터치하면 바로 시작합니다</span>
    </div>
  )
}

export default PerformanceCountdownOverlay

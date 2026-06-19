// src/presentation/components/gaze/NavigationROIHint.tsx
//
// 페이지 이동 직후 사용자의 시선을 콘텐츠 상단으로 유도하는 시각적 힌트.
// navigationPauseUntil이 설정되면 표시되고, ~2초 후 자동으로 사라집니다.

import { useEffect, useRef, useState } from 'react'
import { useGazeStore } from '@/presentation/state/gazeStore'
import '@/presentation/styles/components/NavigationROIHint.css'

const HINT_DURATION_MS = 1800

/**
 * 페이지 이동 직후 navigationPauseUntil이 설정되면 화면에 잠시 나타나
 * 사용자의 시선을 콘텐츠 상단(새 페이지 읽기 시작 지점)으로 유도하는
 * 시각적 힌트. 표시 후 HINT_DURATION_MS 동안 유지되다 fade-out 되며 사라진다.
 *
 * @returns 힌트가 보이지 않을 때는 null, 보일 때는 맥동 링/라벨/화살표로
 *          구성된 힌트 div
 */
export function NavigationROIHint() {
  const [visible, setVisible] = useState(false)
  const [fading, setFading]   = useState(false)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeRef    = useRef<ReturnType<typeof setTimeout> | null>(null)

  // navigationPauseUntil이 새로 설정될 때마다 힌트 표시
  useEffect(() => {
    const unsub = useGazeStore.subscribe(
      (s) => s.navigationPauseUntil,
      (pauseUntil) => {
        if (pauseUntil == null) return

        // 기존 타이머 초기화
        if (timerRef.current) clearTimeout(timerRef.current)
        if (fadeRef.current)  clearTimeout(fadeRef.current)

        setFading(false)
        setVisible(true)

        // fade-out 시작 (HINT_DURATION_MS - 400ms)
        fadeRef.current = setTimeout(() => {
          setFading(true)
        }, HINT_DURATION_MS - 400)

        // 완전히 숨김
        timerRef.current = setTimeout(() => {
          setVisible(false)
          setFading(false)
        }, HINT_DURATION_MS)
      }
    )

    return () => {
      unsub()
      if (timerRef.current) clearTimeout(timerRef.current)
      if (fadeRef.current)  clearTimeout(fadeRef.current)
    }
  }, [])

  if (!visible) return null

  return (
    <div className={`roi-hint${fading ? ' roi-hint--fading' : ''}`}>
      {/* 외부 맥동 링 */}
      <div className="roi-hint__ring-wrap">
        <div className="roi-hint__ring-outer" />
        <div className="roi-hint__ring-inner" />
        {/* 중앙 점 */}
        <div className="roi-hint__dot" />
      </div>

      {/* 라벨 */}
      <div className="roi-hint__label">새 페이지 시작</div>

      {/* 아래 방향 화살표 */}
      <div className="roi-hint__arrow" />
    </div>
  )
}

// src/presentation/components/performance/PerformanceGridOverlay.tsx
// 연주 시작(isPerformanceActive=true) 후 PDF 위에 6행x4열 그리드를 겹쳐 그리고,
// 설정된 메트로놈 BPM 박자에 맞춰 칸을 순서대로(행 우선, 왼→오른쪽, 위→아래) 강조한다.
// 우상단 정지 버튼으로 언제든 연주를 중단할 수 있다.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePerformanceStore, GRID_ROWS, GRID_COLS } from '@/presentation/store/performanceStore'
import '@/presentation/styles/components/PerformanceGridOverlay.css'

const TOTAL_CELLS = GRID_ROWS * GRID_COLS

/**
 * 연주 모드 진행 중 PDF 위에 표시되는 BPM 동기화 그리드 오버레이.
 * GRID_ROWS x GRID_COLS 크기의 격자를 만들고, 설정된 BPM에서 계산한
 * 간격(intervalMs)마다 활성 칸을 행 우선(왼→오른쪽, 위→아래) 순서로
 * 한 칸씩 진행시킨다.
 *
 * @returns isPerformanceActive가 false면 null, 그렇지 않으면 정지 버튼과
 *          그리드를 포함한 오버레이
 */
export function PerformanceGridOverlay() {
  const isPerformanceActive = usePerformanceStore((s) => s.isPerformanceActive)
  const bpm = usePerformanceStore((s) => s.bpm)
  const stopPerformance = usePerformanceStore((s) => s.stopPerformance)

  const [activeIndex, setActiveIndex] = useState(0)
  const indexRef = useRef(0)

  // 연주가 새로 시작될 때 0번 칸부터 다시 시작
  useEffect(() => {
    if (isPerformanceActive) {
      indexRef.current = 0
      setActiveIndex(0)
    }
  }, [isPerformanceActive])

  useEffect(() => {
    if (!isPerformanceActive) return

    const intervalMs = Math.max(1, (60 / bpm) * 1000)
    const intervalId = setInterval(() => {
      indexRef.current = (indexRef.current + 1) % TOTAL_CELLS
      setActiveIndex(indexRef.current)
    }, intervalMs)

    return () => clearInterval(intervalId)
  }, [isPerformanceActive, bpm])

  if (!isPerformanceActive) return null

  return (
    <div className="perf-grid-overlay">
      <button
        className="perf-grid-stop-btn"
        onClick={stopPerformance}
        aria-label="연주 중단"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        연주 중단
      </button>

      <div
        className="perf-grid"
        style={{
          '--perf-grid-rows': `repeat(${GRID_ROWS}, 1fr)`,
          '--perf-grid-cols': `repeat(${GRID_COLS}, 1fr)`,
        } as CSSProperties}
      >
        {Array.from({ length: TOTAL_CELLS }).map((_, i) => (
          <div
            key={i}
            className={`perf-grid-cell ${i === activeIndex ? 'active' : ''}`}
          />
        ))}
      </div>
    </div>
  )
}

export default PerformanceGridOverlay

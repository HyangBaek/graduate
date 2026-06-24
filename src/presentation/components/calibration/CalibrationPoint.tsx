// src/presentation/components/calibration/CalibrationPoint.tsx
//
// ── 최적화 ──────────────────────────────────────────────────────────────────
//  React.memo: 부모(CalibrationOverlay) 리렌더 시 props 변화 없는 포인트 재렌더 차단
//              13개 포인트 중 활성 포인트 1개만 progress prop이 변하므로
//              나머지 12개는 완전히 재렌더 생략됨
//  CIRCUMFERENCE: 매 렌더 2*PI*16 계산 → 모듈 상수로 추출

import { memo, type CSSProperties } from 'react'
import '@/presentation/styles/components/CalibrationPoint.css'

const RADIUS = 16
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * CalibrationPoint 컴포넌트의 props.
 * @property x 화면 가로 비율(0~1) 기준 점 위치
 * @property y 화면 세로 비율(0~1) 기준 점 위치
 * @property active 현재 활성(응시 대상) 점인지 여부
 * @property completed 이미 캡처가 끝난 점인지 여부 (완료 스타일 표시용)
 * @property progress 활성 점의 dwell 진행률(0~100)
 * @property index 전체 포인트 배열에서의 인덱스(0-base)
 * @property total 전체 캘리브레이션 포인트 개수
 */
interface Props {
  x: number
  y: number
  active: boolean
  completed?: boolean
  progress?: number
  index: number
  total: number
}

/**
 * 캘리브레이션 점 하나를 렌더링하는 컴포넌트.
 * 활성 상태일 때만 progress ring(SVG)과 순번을 표시하며, React.memo로
 * 활성 포인트 외 나머지 포인트들의 불필요한 리렌더를 차단한다.
 *
 * @param props CalibrationPoint props (위 Props 인터페이스 참고)
 * @returns 점 위치에 배치되는 div(활성 시 progress ring 포함)
 */
export const CalibrationPoint = memo(function CalibrationPoint({
  x,
  y,
  active,
  completed,
  progress = 0,
  index,
  total,
}: Props) {
  const strokeDashoffset = CIRCUMFERENCE - (progress / 100) * CIRCUMFERENCE

  return (
    <div
      className={`cal-point ${active ? 'cal-point--active' : ''} ${completed ? 'cal-point--done' : ''}`}
      style={{ '--cal-point-x': `${x * 100}%`, '--cal-point-y': `${y * 100}%` } as CSSProperties}
    >
      {/* 활성 점 — 외부 링 */}
      {active && (
        <>
          {/* 외부 progress ring */}
          <svg
            className="cal-point__ring"
            width="44"
            height="44"
            viewBox="0 0 44 44"
          >
            {/* track */}
            <circle
              cx="22"
              cy="22"
              r={RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="2"
            />
            {/* fill */}
            <circle
              cx="22"
              cy="22"
              r={RADIUS}
              fill="none"
              stroke="#ff3366"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={strokeDashoffset}
              className="cal-point__ring-fill"
            />
          </svg>

          {/* 숫자 표시 */}
          <span className="cal-point__num">{index + 1}/{total}</span>
        </>
      )}

      {/* 중앙 코어 (항상 표시하되, 완료되면 CSS에서 초록색 처리) */}
      <div className="cal-point__core" />
    </div>
  )
})

// src/presentation/components/performance/PerformanceSetupOverlay.tsx
// "연주 시작" 버튼 클릭 시 뜨는 설정 레이어.
// - 메트로놈 BPM: 프리셋 버튼 + 슬라이더 + 직접 입력
// - 시작 딜레이: 프리셋 버튼(3/5/10초)
// 확정 시 onConfirm() 호출 — 실제 파일 열기/navigate는 호출부(HomeLayout)가 담당.

import { useState } from 'react'
import {
  usePerformanceStore,
  BPM_PRESETS,
  DELAY_PRESETS,
  MIN_BPM,
  MAX_BPM,
} from '@/presentation/store/performanceStore'
import '@/presentation/styles/components/PerformanceSetupOverlay.css'

/**
 * PerformanceSetupOverlay 컴포넌트의 props.
 * @property onConfirm 설정 확정("연주 시작") 시 호출되는 콜백.
 *                      실제 파일 열기/페이지 이동은 호출부(HomeLayout)가 담당한다.
 */
interface PerformanceSetupOverlayProps {
  onConfirm: () => void
}

/**
 * "연주 시작" 버튼 클릭 시 표시되는 연주 설정 바텀시트.
 * 메트로놈 BPM(프리셋/슬라이더/직접 입력)과 시작 딜레이(프리셋)를
 * 설정할 수 있으며, 확정 시 스토어에 설정을 반영하고 onConfirm을 호출한다.
 *
 * @param onConfirm 설정 확정 시 호출되는 콜백
 * @returns isSetupOpen이 false면 null, 그렇지 않으면 설정 바텀시트 JSX
 */
export function PerformanceSetupOverlay({ onConfirm }: PerformanceSetupOverlayProps) {
  const isSetupOpen = usePerformanceStore((s) => s.isSetupOpen)
  const bpm = usePerformanceStore((s) => s.bpm)
  const delaySeconds = usePerformanceStore((s) => s.delaySeconds)
  const setBpm = usePerformanceStore((s) => s.setBpm)
  const setDelaySeconds = usePerformanceStore((s) => s.setDelaySeconds)
  const closeSetup = usePerformanceStore((s) => s.closeSetup)
  const confirmSetupAndStart = usePerformanceStore((s) => s.confirmSetupAndStart)

  // 직접 입력 칸은 빈 문자열/중간 입력 상태를 허용하기 위해 별도 로컬 상태로 관리
  const [bpmInput, setBpmInput] = useState(String(bpm))

  if (!isSetupOpen) return null

  const handleBpmInputChange = (value: string) => {
    setBpmInput(value)
    const parsed = Number(value)
    if (value.trim() !== '' && Number.isFinite(parsed)) {
      setBpm(parsed)
    }
  }

  const handleBpmInputBlur = () => {
    // 빈 값이나 범위 밖 입력 후 포커스를 잃으면 현재 적용된 bpm으로 표시 동기화
    setBpmInput(String(bpm))
  }

  const handlePresetBpm = (preset: number) => {
    setBpm(preset)
    setBpmInput(String(preset))
  }

  const handleConfirm = () => {
    confirmSetupAndStart()
    onConfirm()
  }

  return (
    <div className="perf-setup-overlay">
      <div className="perf-setup-backdrop" onClick={closeSetup} />

      <div className="perf-setup-sheet" role="dialog" aria-label="연주 설정">
        <div className="perf-setup-header">
          <h3>연주 설정</h3>
          <button
            className="perf-setup-close-btn"
            onClick={closeSetup}
            aria-label="닫기"
          >
            <svg
              width="18"
              height="18"
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
          </button>
        </div>

        {/* ── 메트로놈 BPM ── */}
        <section className="perf-setup-section">
          <p className="perf-setup-label">메트로놈 속도 (BPM)</p>

          <div className="perf-preset-row">
            {BPM_PRESETS.map((preset) => (
              <button
                key={preset}
                className={`perf-preset-btn ${bpm === preset ? 'active' : ''}`}
                onClick={() => handlePresetBpm(preset)}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="perf-slider-row">
            <input
              type="range"
              min={MIN_BPM}
              max={MAX_BPM}
              step={1}
              value={bpm}
              onChange={(e) => {
                const v = Number(e.target.value)
                setBpm(v)
                setBpmInput(String(v))
              }}
              className="perf-bpm-slider"
              aria-label="BPM 슬라이더"
            />
            <input
              type="number"
              min={MIN_BPM}
              max={MAX_BPM}
              value={bpmInput}
              onChange={(e) => handleBpmInputChange(e.target.value)}
              onBlur={handleBpmInputBlur}
              className="perf-bpm-input"
              aria-label="BPM 직접 입력"
            />
          </div>
        </section>

        {/* ── 시작 딜레이 ── */}
        <section className="perf-setup-section">
          <p className="perf-setup-label">시작 딜레이</p>
          <div className="perf-preset-row">
            {DELAY_PRESETS.map((preset) => (
              <button
                key={preset}
                className={`perf-preset-btn ${delaySeconds === preset ? 'active' : ''}`}
                onClick={() => setDelaySeconds(preset)}
              >
                {preset}초
              </button>
            ))}
          </div>
        </section>

        <button className="perf-setup-start-btn" onClick={handleConfirm}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="perf-setup-start-icon"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          연주 시작
        </button>
      </div>
    </div>
  )
}

export default PerformanceSetupOverlay

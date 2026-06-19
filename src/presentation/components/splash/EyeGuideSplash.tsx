// src/presentation/components/splash/EyeGuideSplash.tsx
// 앱 진입 시 소문자 e를 역방향으로 그리면서 시선을 유도하는 스플래시 스크린.
//
// ── 최적화 (이전 → 현재) ───────────────────────────────────────────────────────
//  JS rAF 루프 (매 프레임 getPointAtLength + strokeDashoffset 갱신)
//    → 제거
//  SVG <feGaussianBlur> 필터 (매 프레임 CPU 래스터화)
//    → CSS drop-shadow() (GPU 컴포지터)
//  dot/ring 경로 이동: getPointAtLength (DOM layout query × 60fps)
//    → <animateMotion>+<mpath> (SVG 엔진에 위임, 컴포지터 스레드)
//  stroke-dashoffset: JS rAF 갱신
//    → CSS transition (컴포지터 스레드)
//  getTotalLength(): 매 프레임 → 초기화 시 단 1회
//
//  결과: 스플래시 중 메인 스레드 해방 → MediaPipe/Worker 초기화 경쟁 없음

import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react'
import { useGazeStore } from '@/presentation/state/gazeStore'
import '@/presentation/styles/EyeGuideSplash.css'

/**
 * EyeGuideSplash 컴포넌트의 props.
 * @property onComplete 스플래시 시퀀스(드로잉→로고 표시→페이드아웃)가
 *                       모두 끝났을 때 호출되는 콜백
 */
interface EyeGuideSplashProps {
  onComplete: () => void
}

// ── SVG viewBox: 0 0 360 680 ─────────────────────────────────────────────────
// 소문자 e — 역방향 (꼬리→크로스바 중앙)
const E_PATH =
  'M 307 561 ' +
  'C 254 574 159 572 116 537 ' +
  'C 89 515 49 466 44 413 ' +
  'C 37 341 54 286 82 244 ' +
  'C 99 220 149 187 198 184 ' +
  'C 259 182 295 196 311 224 ' +
  'C 323 246 331 311 253 332 ' +
  'L 185 342';

const STROKE_COLOR = 'rgba(89, 241, 255, 0.5)'
const STROKE_GUIDE = 'rgba(62, 184, 255, 0.1)'

const DRAW_MS = 1100
const HOLD_MS = 800
const FADE_MS = 400

// ease-in-out cubic-bezier: CSS "0.45 0 0.55 1" == JS easeInOut(t)
const EASE_SPLINE = '0.45 0 0.55 1'

/**
 * 앱 진입 시 소문자 e를 역방향으로 그려 사용자의 시선을 유도하는
 * 스플래시 스크린. CSS transition과 SVG <animateMotion>으로 애니메이션을
 * 컴포지터 스레드에 위임해(파일 상단 최적화 내역 참고) 메인 스레드를
 * MediaPipe/Worker 초기화에 양보한다. 드로잉(DRAW_MS) → 로고 표시 및
 * 시선 베이스라인 리셋 → 대기(HOLD_MS) → 페이드아웃(FADE_MS) 순으로
 * 진행되며 종료 시 onComplete를 호출한다.
 *
 * @param onComplete 스플래시 시퀀스 종료 시 호출되는 콜백
 * @returns e 드로잉 애니메이션과 EyeScore 로고를 표시하는 전체화면 div
 */
export function EyeGuideSplash({ onComplete }: EyeGuideSplashProps) {
  const pathRef = useRef<SVGPathElement | null>(null)
  const [showLogo, setShowLogo] = useState(false)
  const [fadingOut, setFadingOut] = useState(false)

  const handleComplete = useCallback(() => onComplete(), [onComplete])

  useEffect(() => {
    const path = pathRef.current
    if (!path) return

    // ── stroke 애니메이션 준비 (getTotalLength 단 1회) ─────────────────────
    // CSS transition이 처리하므로 rAF 루프 불필요
    const len = path.getTotalLength()
    path.style.strokeDasharray = `${len}`
    path.style.strokeDashoffset = `${len}`

    // 더블 rAF: 초기 오프셋이 렌더에 반영된 후 transition 시작
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        path.style.transition =
          `stroke-dashoffset ${DRAW_MS}ms cubic-bezier(${EASE_SPLINE})`
        path.style.strokeDashoffset = '0'
      })
    })

    // ── 타이머: 로고 표시 + 베이스라인 리셋 + 완료 ────────────────────────
    const t1 = setTimeout(() => {
      setShowLogo(true)
      // 정중앙을 바라보는 동안 아이리스 베이스라인 리셋 → 캘리브레이션 중심 기준점
      useGazeStore.getState().triggerBaselineReset()
    }, DRAW_MS + 80)

    const t2 = setTimeout(() => setFadingOut(true), DRAW_MS + HOLD_MS)
    const t3 = setTimeout(handleComplete, DRAW_MS + HOLD_MS + FADE_MS + 100)

    return () => {
      cancelAnimationFrame(rafId)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [handleComplete])

  return (
    <div className={`eye-guide-splash${fadingOut ? ' eye-guide-splash--out' : ''}`}>

      <svg
        className="eye-guide-splash__svg"
        viewBox="0 0 360 680"
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* 가이드선 (배경, 정적) */}
        <path
          d={E_PATH}
          fill="none"
          stroke={STROKE_GUIDE}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* 드로잉 경로 (CSS transition으로 stroke-dashoffset 애니메이션)
            SVG feGaussianBlur 제거 → CSS drop-shadow (GPU 가속) */}
        <path
          ref={pathRef}
          d={E_PATH}
          fill="none"
          stroke={STROKE_COLOR}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="eye-guide-splash__draw-path"
        />

        {/* 링 — animateMotion path 속성으로 직접 경로 지정 (mpath ID 참조 제거)
            mpath href="#..." 는 React에서 attribute 전달이 불안정 → path 직접 사용 */}
        <circle r="20" fill="rgba(0,200,220,0.15)">
          <animateMotion
            dur={`${DRAW_MS / 1000}s`}
            path={E_PATH}
            keyTimes="0;1"
            keySplines={EASE_SPLINE}
            calcMode="spline"
            fill="freeze"
          />
        </circle>

        {/* 코어 점 — SVG feGaussianBlur 제거 → CSS drop-shadow (GPU 가속) */}
        <circle
          r="11"
          fill={STROKE_COLOR}
          className="eye-guide-splash__core-dot"
        >
          <animateMotion
            dur={`${DRAW_MS / 1000}s`}
            path={E_PATH}
            keyTimes="0;1"
            keySplines={EASE_SPLINE}
            calcMode="spline"
            fill="freeze"
          />
        </circle>
      </svg>

      {/* 정중앙 EyeScore 로고 — e 완료 후 글자별 순차 등장 */}
      {showLogo && (
        <div className="eye-guide-splash__logo">
          {['E', 'y', 'e'].map((ch, i) => (
            <span
              key={i}
              className="eye-guide-splash__logo-char"
              style={{ '--logo-char-delay': `${i * 45}ms` } as CSSProperties}
            >
              {ch}
            </span>
          ))}
          {['S', 'c', 'o', 'r', 'e'].map((ch, i) => (
            <span
              key={i + 3}
              className="eye-guide-splash__logo-char eye-guide-splash__logo-char--accent"
              style={{ '--logo-char-delay': `${(i + 3) * 60}ms` } as CSSProperties}
            >
              {ch}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

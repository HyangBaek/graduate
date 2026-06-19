// src/presentation/components/debug/PipelineOverlay.tsx

import React, { useEffect, useRef, useState } from 'react'
import { useDebugStore } from '../../store/useDebugStore'
import { useGazeStore } from '../../state/gazeStore'
import '@/presentation/styles/components/PipelineOverlay.css'

// ── Head Pose ↔ Gaze 상관관계 진단 ──────────────────────────────────────
// 순수 표시용 분석 패널. gazeStore를 "쓰지" 않고 rAF로 "읽기만" 하므로
// GazeCursor/실제 시선 파이프라인 동작에는 전혀 영향을 주지 않는다.
// (예전에 HeadPoseCompensationService로 실제 보정을 시도했을 때, 보정값을
//  CoordinateTransformService의 GAIN(50x) 적용 *이전* 좌표 공간에 더해서
//  강도를 낮춰도 GAIN에 의해 그대로 증폭되어 이동량이 폭발했던 문제가 있었음.
//  그 보정 로직(HeadPoseCompensationService)은 현재도 미연결 상태이며, 이
//  패널은 그것과 무관하게 "머리 움직임이 시선에 얼마나 새는지"만 측정한다.)
const CORR_WINDOW = 90 // ~1.5s @60fps
const VECTOR_WINDOW = 10 // 최근 10프레임으로 순간 이동 벡터(위상차) 계산

/**
 * Head Pose ↔ Gaze 상관관계 진단을 위해 한 프레임에서 수집하는 샘플.
 * @property yaw 헤드 포즈의 yaw 각도(도)
 * @property pitch 헤드 포즈의 pitch 각도(도)
 * @property gx 해당 시점의 raw 시선 x 좌표
 * @property gy 해당 시점의 raw 시선 y 좌표
 */
interface CorrSample {
  yaw: number
  pitch: number
  gx: number
  gy: number
}

/**
 * 두 수열 간의 피어슨 상관계수(Pearson correlation coefficient)를 계산한다.
 * Head Pose(yaw/pitch)와 Gaze(x/y) 사이에 값이 얼마나 함께 변하는지를
 * 진단 목적으로 측정하기 위해 사용한다.
 * @param xs 첫 번째 수열
 * @param ys 두 번째 수열 (xs와 같은 길이)
 * @returns -1~1 범위의 상관계수. 샘플이 2개 미만이거나 분산이 0이면 0
 */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  let sx = 0, sy = 0
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i] }
  const mx = sx / n, my = sy / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  return denom === 0 ? 0 : num / denom
}

/**
 * 시선 추적 10단계 파이프라인(수집→추론→후처리→출력) 각각의 상태를
 * OK/FAIL로 표시하는 진단 패널. gazeStore를 읽기만 하며 실제 보정에는
 * 관여하지 않는다. Head Pose ↔ Gaze 상관계수와 위상차 벡터를 부가적으로
 * 시각화해 머리 움직임이 시선 추정에 얼마나 새어 들어오는지 보여준다.
 *
 * @returns 4개 그룹(수집/추론/후처리/출력)의 단계별 상태를 보여주는 패널
 */
export const PipelineOverlay: React.FC = () => {
  const isVisible = useDebugStore((state) => state.isVisible)
  const cursorVisible = useDebugStore((state) => state.cursorVisible)

  // Real-time tracking data from global store
  const isFaceDetected = useGazeStore((state) => state.isFaceDetected)
  const stability = useGazeStore((state) => state.stats.stabilityScore)
  const rawGaze = useGazeStore((state) => state.rawGaze)
  const filteredGaze = useGazeStore((state) => state.filteredGaze)
  const rawConfidence = useGazeStore((state) => state.confidence)

  // New real-time metrics
  const cameraReady = useGazeStore((state) => state.cameraReady)
  const cameraResolution = useGazeStore((state) => state.cameraResolution)
  const landmarkCount = useGazeStore((state) => state.landmarkCount)
  const headPose = useGazeStore((state) => state.headPose)

  // ── Head Pose ↔ Gaze 상관계수 / 위상차 벡터 (읽기 전용 진단) ──────────
  const corrBufRef = useRef<CorrSample[]>([])
  const [corrYaw, setCorrYaw] = useState(0)
  const [corrPitch, setCorrPitch] = useState(0)
  const [headAngleDeg, setHeadAngleDeg] = useState<number | null>(null)
  const [gazeAngleDeg, setGazeAngleDeg] = useState<number | null>(null)
  const [phaseDiffDeg, setPhaseDiffDeg] = useState<number | null>(null)

  useEffect(() => {
    let rafId: number
    let frame = 0

    const tick = () => {
      const s = useGazeStore.getState()
      if (s.headPose && s.rawGaze) {
        const buf = corrBufRef.current
        buf.push({ yaw: s.headPose.yaw, pitch: s.headPose.pitch, gx: s.rawGaze.x, gy: s.rawGaze.y })
        if (buf.length > CORR_WINDOW) buf.shift()

        // 10프레임마다만 재계산 — 매 프레임 계산할 필요 없는 가벼운 통계라 비용은
        // 미미하지만, 패널 리렌더 빈도를 줄여 다른 디버그 표시와 간섭을 줄인다.
        if (frame % 10 === 0 && buf.length >= 10) {
          setCorrYaw(pearson(buf.map((b) => b.yaw), buf.map((b) => b.gx)))
          setCorrPitch(pearson(buf.map((b) => b.pitch), buf.map((b) => b.gy)))

          const recent = buf.slice(-VECTOR_WINDOW)
          const head0 = recent[0]
          const headN = recent[recent.length - 1]
          const dYaw = headN.yaw - head0.yaw
          const dPitch = headN.pitch - head0.pitch
          const dGx = headN.gx - head0.gx
          const dGy = headN.gy - head0.gy

          const headMag = Math.hypot(dYaw, dPitch)
          const gazeMag = Math.hypot(dGx, dGy)

          if (headMag > 0.3 && gazeMag > 3) {
            const hAngle = Math.atan2(dPitch, dYaw) * (180 / Math.PI)
            const gAngle = Math.atan2(dGy, dGx) * (180 / Math.PI)
            let diff = gAngle - hAngle
            while (diff > 180) diff -= 360
            while (diff < -180) diff += 360
            setHeadAngleDeg(hAngle)
            setGazeAngleDeg(gAngle)
            setPhaseDiffDeg(diff)
          } else {
            setHeadAngleDeg(null)
            setGazeAngleDeg(null)
            setPhaseDiffDeg(null)
          }
        }
      }
      frame++
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  // 단계별 OK/FAIL 판정 — 데이터 흐름 순서(수집 → 추론 → 후처리 → 출력)와 동일하게 평가한다.
  // headPose는 표시용일 뿐 실제 좌표 보정에 쓰이지 않으므로(HeadPoseCompensationService 미연결)
  // 그룹 실패 판정에서 제외하고 "참고용"으로만 표시한다.
  const cameraOk = cameraReady
  const faceMeshOk = isFaceDetected
  const landmarkOk = landmarkCount > 0
  const confidenceOk = rawConfidence > 0.35
  const transformOk = !!rawGaze
  const filterOk = !!filteredGaze
  const stabilityOk = stability >= 35
  const syncOk = !!filteredGaze
  const cursorOk = cursorVisible

  const groups = [
    { key: 'acquisition', label: '수집 (Acquisition)', ok: cameraOk && faceMeshOk && landmarkOk },
    { key: 'inference', label: '추론 (Inference)', ok: confidenceOk },
    { key: 'postprocessing', label: '후처리 (Postprocessing)', ok: transformOk && filterOk && stabilityOk },
    { key: 'output', label: '출력 (Output)', ok: syncOk && cursorOk },
  ]
  // 가장 상류(앞쪽)에서 처음 실패한 그룹이 보통의 root cause — 그 그룹에만 원인 배지를 단다.
  const firstFailedIndex = groups.findIndex((g) => !g.ok)

  return (
    <div
      className={`debug-overlay-panel ${isVisible ? 'panel-visible' : 'panel-hidden'}`}
    >
      <h3>10-STEP PIPELINE STATUS</h3>
      <hr />

      {/* ── 그룹 1: 수집 (Acquisition) ──────────────────────────────── */}
      <div className={`pipeline-group ${groups[0].ok ? 'group-ok' : 'group-fail'}`}>
        <h4>
          {groups[0].label}
          {firstFailedIndex === 0 && <span className="group-root-cause">원인</span>}
        </h4>

        <div className="debug-section">
          <div>
            <p>1. Camera</p>
            <div className="pipeline-sub-section">
              <p>
                Status
                <span className={cameraOk ? 'status-ok' : 'status-error'}>
                  {cameraOk ? 'READY' : 'OFFLINE'}
                </span>
              </p>
              {cameraOk && (
                <p>
                  Resolution
                  <span className="status-ok">{cameraResolution || '?'}</span>
                </p>
              )}
            </div>
          </div>

          <p>
            2. FaceMeshAdapter
            <span className={faceMeshOk ? 'status-ok' : 'status-error'}>
              {faceMeshOk ? 'DETECTED' : 'NOT FOUND'}
            </span>
          </p>

          <p>
            3. FaceLandmark Quality
            <span className={landmarkOk ? 'status-ok' : 'status-error'}>
              {landmarkOk ? `${landmarkCount} pts` : 'FAIL'}
            </span>
          </p>
        </div>
      </div>

      {/* ── 그룹 2: 추론 (Inference) ─────────────────────────────────── */}
      <div className={`pipeline-group ${groups[1].ok ? 'group-ok' : 'group-fail'}`}>
        <h4>
          {groups[1].label}
          {firstFailedIndex === 1 && <span className="group-root-cause">원인</span>}
        </h4>

        <div className="debug-section">
          <div>
            <p>4. GazeEstimatorAdapter</p>
            <div className="pipeline-sub-section">
              <p>
                Confidence
                <span className={confidenceOk ? 'status-ok' : 'status-error'}>
                  {rawConfidence > 0
                    ? `${Math.round(rawConfidence * 100)}%`
                    : 'null'}
                </span>
              </p>
            </div>
          </div>

          <div>
            <p>
              5. Head Pose <span className="highlight">(참고용·미사용)</span>
            </p>
            <div className="pipeline-sub-section">
              <p>
                Yaw
                <span className="highlight">{headPose ? `${headPose.yaw}°` : 'N/A'}</span>
              </p>
              <p>
                Pitch
                <span className="highlight">{headPose ? `${headPose.pitch}°` : 'N/A'}</span>
              </p>
              <p>
                Roll
                <span className="highlight">{headPose ? `${headPose.roll}°` : 'N/A'}</span>
              </p>
            </div>
          </div>

          {/* Head Pose ↔ Gaze 상관관계 진단 (읽기 전용, 보정 미적용) */}
          <div>
            <p>
              Head↔Gaze 상관계수 <span className="highlight">(진단용)</span>
            </p>
            <div className="pipeline-sub-section">
              <p>
                corr(yaw, x)
                <span className={Math.abs(corrYaw) > 0.5 ? 'status-warn' : 'highlight'}>
                  {corrYaw.toFixed(2)}
                </span>
              </p>
              <p>
                corr(pitch, y)
                <span className={Math.abs(corrPitch) > 0.5 ? 'status-warn' : 'highlight'}>
                  {corrPitch.toFixed(2)}
                </span>
              </p>
              <p>
                위상차
                <span className="highlight">
                  {phaseDiffDeg !== null ? `${phaseDiffDeg.toFixed(0)}°` : '-'}
                </span>
              </p>
              <svg className="pipeline-vector-svg" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="48" className="pipeline-vector-ring" />
                <line x1="2" y1="50" x2="98" y2="50" className="pipeline-vector-axis" />
                <line x1="50" y1="2" x2="50" y2="98" className="pipeline-vector-axis" />
                {headAngleDeg !== null && (
                  <line
                    x1="50" y1="50"
                    x2={50 + 40 * Math.cos((headAngleDeg * Math.PI) / 180)}
                    y2={50 + 40 * Math.sin((headAngleDeg * Math.PI) / 180)}
                    className="pipeline-vector-arrow-head"
                  />
                )}
                {gazeAngleDeg !== null && (
                  <line
                    x1="50" y1="50"
                    x2={50 + 40 * Math.cos((gazeAngleDeg * Math.PI) / 180)}
                    y2={50 + 40 * Math.sin((gazeAngleDeg * Math.PI) / 180)}
                    className="pipeline-vector-arrow-gaze"
                  />
                )}
              </svg>
              <p className="pipeline-vector-legend">
                <span className="pipeline-vector-legend-head">● Head</span>
                <span className="pipeline-vector-legend-gaze">● Gaze</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 그룹 3: 후처리 (Postprocessing) ──────────────────────────── */}
      <div className={`pipeline-group ${groups[2].ok ? 'group-ok' : 'group-fail'}`}>
        <h4>
          {groups[2].label}
          {firstFailedIndex === 2 && <span className="group-root-cause">원인</span>}
        </h4>

        <div className="debug-section">
          <p>
            6. CoordinateTransform
            <span className={transformOk ? 'status-ok' : 'status-error'}>
              {rawGaze
                ? `x:${Math.round(rawGaze.x)}, y:${Math.round(rawGaze.y)}`
                : 'FAIL'}
            </span>
          </p>

          <p>
            7. GazeFilterService
            <span className={filterOk ? 'status-ok' : 'status-error'}>
              {filteredGaze
                ? `x:${Math.round(filteredGaze.x)}, y:${Math.round(filteredGaze.y)}`
                : 'FAIL'}
            </span>
          </p>

          <p>
            8. StabilityService
            <span className={stabilityOk ? 'status-ok' : 'status-error'}>
              {stability.toFixed(0)}% (Stable: {stabilityOk ? 'Y' : 'N'})
            </span>
          </p>
        </div>
      </div>

      {/* ── 그룹 4: 출력 (Output) ───────────────────────────────────── */}
      <div className={`pipeline-group ${groups[3].ok ? 'group-ok' : 'group-fail'}`}>
        <h4>
          {groups[3].label}
          {firstFailedIndex === 3 && <span className="group-root-cause">원인</span>}
        </h4>

        <div className="debug-section">
          <p>
            9. gazeStore Sync
            <span className={syncOk ? 'status-ok' : 'status-error'}>
              {syncOk ? 'SYNCED' : 'FAIL'}
            </span>
          </p>

          <p>
            10. GazeCursor CSS
            <span className={cursorOk ? 'status-ok' : 'status-error'}>
              {cursorOk ? 'SHOWN' : 'HIDDEN'}
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}

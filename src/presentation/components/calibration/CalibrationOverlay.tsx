// src/presentation/components/calibration/CalibrationOverlay.tsx

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { CalibrationPoint } from '@/presentation/components/calibration/CalibrationPoint'
import { CALIBRATION_POINTS } from '@/presentation/constants/calibrationPoints'
import { useCalibration } from '@/presentation/hooks/useCalibration'
import { useGazeStore } from '@/presentation/state/gazeStore'
import { calibrationLogger } from '@/infrastructure/storage/CalibrationLoggerImpl'
import '@/presentation/styles/components/CalibrationOverlay.css'

const DWELL_TIME_MS = 1200
const STABILITY_THRESHOLD = 0.35

/**
 * 시선 캘리브레이션 진행 화면 오버레이.
 * CALIBRATION_POINTS를 순서대로 보여주고, 각 점에서 사용자의 시선이 일정 시간
 * (DWELL_TIME_MS) 안정적으로 머무르면 샘플을 캡처해 다음 점으로 넘어간다.
 * 게이트(거리/안정성/신뢰도/가장자리)와 시간 기반 완화·강제진행 로직으로
 * 특정 점에서 캘리브레이션이 영구히 멈추지 않도록 보장한다.
 *
 * @returns isCalibrating이 false면 null, 그렇지 않으면 안내 배너와
 *          CalibrationPoint 목록을 렌더링하는 오버레이 div.
 */
export const CalibrationOverlay = () => {
  const {
    isCalibrating,
    currentPointIndex,
    captureSample,
    moveNextPoint,
    completeCalibration,
    cancelCalibration,
  } = useCalibration()

  const [dwellProgress, setDwellProgress] = useState(0)
  const [guideMessage, setGuideMessage] = useState('화면의 점을 바라봐 주세요.')
  
  const elapsedTimeRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)
  // 특정 점(특히 화면 가장자리 극단점)에서 게이지가 일정 비율(예: 1/8)에서
  // 더 이상 차지 않고 영구히 멈추는 증상의 원인: 그 사용자의 실제 눈동자 가동
  // 범위가 GAIN/거리 게이트가 가정하는 평균치보다 좁으면, 시선이 그 점에
  // 도달할 수 있는 한계까지 가더라도 distance/stability 게이트를 영원히
  // 통과 못 함 — dwell이 시작도 못 하고 0%/일부 값에서 무한 대기.
  // → 이 점에서 보낸 "총 체류 시간"(pointElapsedRealTime)을 누적해, 일정
  //   시간 이상 끌면 거리 허용치와 안정성 기준을 점진적으로 완화해
  //   결국엔 진행되도록 한다.
  //
  // 7번 점(우측 중앙) 재현 사례에서 드러난 추가 버그: 처음엔 이 누적값을
  // "게이트가 연속으로 실패하는 시간"으로만 쌌었는데, 바깥을 봤다가 다시
  // 보는 동작 한 번마다 아주 잠깐(노이즈로) 게이트가 우연히 true가 되는
  // 순간이 끼면 그 즉시 0으로 리셋되어 버렸음. 그 결과 "바깥을 보고 다시
  // 보면 1/8씩 차는데 완화는 전혀 발동하지 않는" 패턴이 반복되다가, 결국
  // 그 우연한 true 순간조차 없으면 완전히 멈춰버림.
  // → 게이트 성공/실패와 무관하게 "이 점에 머문 실제 시간"을 매 프레임
  //   그냥 누적한다(점이 바뀌거나 캡처가 끝날 때만 리셋). 완화 여부는
  //   이 값에만 의존하므로 간헐적인 순간 성공에 영향받지 않는다.
  const stuckTimeRef = useRef<number>(0)
  // forceProgress(9초 안전장치) 발동을 콘솔에 점당 1회만 남기기 위한 플래그.
  const forceProgressLoggedRef = useRef<boolean>(false)
  // edge 게이트 디바운스용 — 시선이 가장자리 판정 영역에 "연속으로" 머문 시간.
  // 8·9·10·11번 점에서 게이지가 깜빡이는 것처럼 보인 원인: 단 한 프레임이라도
  // 노이즈로 가장자리 영역에 잠깐 찍히면 즉시 isAtEdge=true가 되어 게이지 누적이
  // 멈췄다가, 다음 프레임에 다시 false가 되면 바로 재개되는 게 매 프레임 반복되어
  // 깜빡임처럼 보였음. 실제로 화면 밖을 보는 게 아니라 추적 노이즈인 경우가 많으므로,
  // 일정 시간(EDGE_CONFIRM_MS) 연속으로 가장자리에 머물러야 진짜 edge로 판정한다.
  const edgeStreakRef = useRef<number>(0)

  // ` Key (Backquote) cancels calibration
  useEffect(() => {
    if (!isCalibrating) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' || e.code === 'Backquote' || e.key === '₩') {
        cancelCalibration()
      }
    }
    // Listen in capture phase (true) so that focused child elements cannot block it with stopPropagation()
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isCalibrating, cancelCalibration])

  const currentPoint = useMemo(() => CALIBRATION_POINTS[currentPointIndex], [currentPointIndex])

  // 포인트 변경 시 dwell 리셋
  //
  // 버그: 의존성 배열이 [currentPointIndex]만 있던 이전 버전에서는, 재캘리브레이션
  // 시작 시 store가 currentPointIndex를 0으로 "리셋"해도 이미 직전 값이 0이었던
  // 경우(가장 흔한 케이스 — 항상 0번 점부터 시작하므로) React가 값이 안 바뀐 걸로
  // 보고 effect를 재실행하지 않았음. 그 결과 0번 점에서는 stuckTimeRef/
  // forceProgressLoggedRef가 리셋되지 않고 calibrationLogger.startPoint()도
  // 호출되지 않아, 로그에 0번 점 데이터가 통째로 빠지는 문제가 있었음.
  // → isCalibrating을 의존성에 추가해 "캘리브레이션이 새로 시작되는 시점" 자체를
  //   감지하게 한다 (false→true 전환 시 currentPointIndex 값과 무관하게 재실행).
  useEffect(() => {
    if (!isCalibrating) return

    setDwellProgress(0)
    elapsedTimeRef.current = 0
    lastTimeRef.current = Date.now()
    stuckTimeRef.current = 0
    forceProgressLoggedRef.current = false
    edgeStreakRef.current = 0
    setGuideMessage('화면의 점을 바라봐 주세요.')

    const point = CALIBRATION_POINTS[currentPointIndex]
    if (point) {
      // 이전 캘리브레이션 문제 분석용 — 이 점에서 일어나는 일을 점 단위로 기록 시작.
      calibrationLogger.startPoint({
        point_index: currentPointIndex,
        target_x: point.x,
        target_y: point.y,
        difficulty: point.difficulty,
      })
    }
  }, [currentPointIndex, isCalibrating])

  // ── rAF dwell 루프 ────────────────────────────────────────────────────────
  // gazeStore를 구독하지 않고 getState()로 직접 읽어 리렌더 없음.
  // setDwellProgress는 실제 progress 값이 바뀔 때만 호출.
  useEffect(() => {
    if (!isCalibrating || !currentPoint) {
      setDwellProgress(0)
      return
    }

    let rafId: number
    let lastProgress = -1
    lastTimeRef.current = Date.now()

    const loop = () => {
      const now = Date.now()
      const dt = now - lastTimeRef.current
      lastTimeRef.current = now

      // 게이트 성공 여부와 무관하게 이 점에 머문 실제 시간을 누적 (위 stuckTimeRef
      // 선언부 주석 참고) — 간헐적인 순간 성공으로 리셋되지 않게 하기 위함.
      stuckTimeRef.current += dt

      const { filteredGaze, uncalibratedGaze, stats, confidence, isBaselineLocked } =
        useGazeStore.getState()

      if (!filteredGaze) {
        setGuideMessage('얼굴을 카메라 정면에 위치시켜 주세요.')
        rafId = requestAnimationFrame(loop)
        return
      }

      // 캡처와 타겟 매칭을 진행할 시선 데이터 선택
      // 캘리브레이션 중에는 아직 가중치 학습이 불완전하므로, 왜곡되지 않은 원본 시선(uncalibratedGaze)을 기준으로 판정합니다.
      const gazeToCheck = uncalibratedGaze || filteredGaze

      // 점별 난이도(calibrationPoints.ts의 difficulty)에서 게이트 시작 기준을
      // 계산한다. 기존엔 "몇 번째 점인가"(currentPointIndex)로만 거리 허용치를
      // 넓혔는데, 실제로 게이트를 어렵게 만드는 건 순서가 아니라 화면 중심에서
      // 얼마나 먼 위치인가다 — 그래서 4·5·7번 점이 각각 distance/confidence
      // 게이트에 따로 걸려 매번 patch가 필요했다. 난이도가 높을수록 처음부터
      // 더 낮은 기준에서 출발하고, 그 위에 기존 stuckTime 완화(시간이 지날수록
      // 추가로 더 낮추는 것)가 그대로 더해진다.
      const difficulty = currentPoint.difficulty ?? 0
      const baseMaxDistance = window.innerWidth * (0.38 + difficulty * 0.15)
      const baseStabilityThreshold = STABILITY_THRESHOLD - difficulty * 0.10
      const baseConfidenceThreshold = 0.4 - difficulty * 0.10

      // stuckTime이 누적될수록(이 점에서 게이트가 계속 실패할수록) 위 기본
      // 기준들을 추가로 더 완화한다 — 2초부터 서서히 시작해 6초 시점엔
      // distance는 +50%p, stability/confidence는 -0.20까지.
      const stuckRelaxFactor = Math.max(0, Math.min((stuckTimeRef.current - 2000) / 4000, 1)) * 0.5
      const stuckRelaxAmount = Math.min(stuckTimeRef.current / 6000, 1) * 0.20

      // 1. 화면 가장자리(테두리)에 시선이 달라붙었는지 검사 (화면 바깥 응시 차단)
      // 단, 목표 보정 점 자체가 해당 가장자리에 위치하는 경우(x <= 0.1, y <= 0.1 등)에는 테두리 감지를 제외합니다.
      //
      // 버그: 마진이 8px 고정값이라 distance/stability/confidence 게이트는 난이도와
      // stuckTime에 따라 점점 완화되는데 edge 게이트만 완화가 전혀 없었음. 실측
      // 로그(8번 점 등)에서 10초 내내 거의 매 프레임 edge 게이트에만 막혀
      // forceProgress(9초 안전장치)로만 넘어가는 패턴이 반복됐음 — 다른 게이트보다
      // edge가 사실상 진행을 막는 진짜 원인이었던 것. 다른 게이트와 동일한 원칙으로
      // 난이도가 높을수록, stuckTime이 쌓일수록 마진을 넓혀 완화한다.
      const baseEdgeMargin = 8 + difficulty * 12 // 최대 8+12=20px
      const edgeMargin = baseEdgeMargin * (1 + stuckRelaxFactor)
      const isAtLeftEdge = gazeToCheck.x <= edgeMargin && currentPoint.x > 0.1
      const isAtRightEdge = gazeToCheck.x >= window.innerWidth - edgeMargin && currentPoint.x < 0.9
      const isAtTopEdge = gazeToCheck.y <= edgeMargin && currentPoint.y > 0.1
      const isAtBottomEdge = gazeToCheck.y >= window.innerHeight - edgeMargin && currentPoint.y < 0.9

      const isAtEdgeRaw = isAtLeftEdge || isAtRightEdge || isAtTopEdge || isAtBottomEdge

      // 디바운스: 연속으로 EDGE_CONFIRM_MS 이상 가장자리 판정이 유지될 때만 진짜
      // edge로 취급한다. 단일 프레임 노이즈는 무시 — 게이지 깜빡임 방지.
      const EDGE_CONFIRM_MS = 200
      if (isAtEdgeRaw) {
        edgeStreakRef.current += dt
      } else {
        edgeStreakRef.current = 0
      }
      const isAtEdge = edgeStreakRef.current >= EDGE_CONFIRM_MS

      // 2. 활성 포인트와의 대략적인 응시 거리 검사 (느슨한 반경 제한으로 정합성 확보)
      const targetPxX = currentPoint.x * window.innerWidth
      const targetPxY = currentPoint.y * window.innerHeight
      const dx = gazeToCheck.x - targetPxX
      const dy = gazeToCheck.y - targetPxY
      const distance = Math.sqrt(dx * dx + dy * dy)

      const maxAllowedDistance = baseMaxDistance * (1 + stuckRelaxFactor)
      const effectiveStabilityThreshold = Math.max(0.05, baseStabilityThreshold - stuckRelaxAmount)
      const effectiveConfidenceThreshold = Math.max(0.15, baseConfidenceThreshold - stuckRelaxAmount)

      // 최종 안전장치: 위 게이트들을 아무리 점별로 정교화해도, 예상 못 한 다른
      // 원인(새 게이트, 특정 사용자의 예외적 상황 등)으로 또 영구히 막힐 가능성은
      // 항상 남는다. 한 점에 9초 이상 머물렀다면 어떤 게이트가 막고 있든 무조건
      // 진행시켜, 캘리브레이션 자체가 영구히 멈추는 일은 구조적으로 불가능하게 한다.
      const FORCE_PROGRESS_AFTER_MS = 9000
      const forceProgress = stuckTimeRef.current >= FORCE_PROGRESS_AFTER_MS

      // forceProgress가 실제로 발동하는 순간을 콘솔에 남긴다. 이게 한 번이라도
      // 찍히면 "특정 점이 정상 게이트로는 못 뚫린다"는 뜻이므로, 나중에 어떤
      // 게이트(confidence/distance/stability)가 막고 있었는지, 그 점의 위치·
      // 난이도와 함께 바로 알 수 있게 한다. 한 점당 최초 1회만 찍어 콘솔 도배 방지.
      if (forceProgress && !forceProgressLoggedRef.current) {
        forceProgressLoggedRef.current = true
        console.warn('[CalibrationOverlay] forceProgress 발동 — 정상 게이트 통과 실패, 강제 진행', {
          pointIndex: currentPointIndex,
          pointPos: { x: currentPoint.x, y: currentPoint.y },
          difficulty,
          stuckTimeMs: Math.round(stuckTimeRef.current),
          confidence,
          effectiveConfidenceThreshold,
          stabilityScore: stats.stabilityScore,
          effectiveStabilityThreshold,
          distance,
          maxAllowedDistance,
          isAtEdge,
        })
        // 이 점이 정상 게이트로는 끝내 통과하지 못했다는 사실을 구조화된 로그(점별 분석용)에도
        // 남긴다. localStorage 영속화는 calibrationLogger 쪽에서 점 완료 시 한 번에 처리.
        calibrationLogger.recordForceProgress()
      }

      // 0번(중앙) 점은 irisBaseline이 잠기기 전(~1초, LOCK_AFTER_FRAMES)에는 baseline이
      // 매 프레임 갱신 중이라 centered 좌표(=raw-baseline) 자체가 아직 수렴하지 않은 상태.
      // 이 상태에서 distance/stability를 정상 게이트로 검사하면, 학습 초반 잠깐의 흔들림이나
      // 약간의 baseline 편향만으로도 게이트가 깨지고, 게이지가 멈춘 뒤 회복되지 않는 문제가
      // 있었음(목표가 "중앙 응시 = baseline 그 자체"라 거리 판정이 순환 종속적임).
      // → 0번 점이면서 baseline이 아직 잠기지 않은 동안은 거리/안정성 게이트를 면제하고
      //   confidence/가장자리만 확인해 시간 기반으로 진행시킨다. 잠긴 이후에는 정상 게이트로 복귀.
      const isCenterPointStillLearning = currentPointIndex === 0 && !isBaselineLocked

      // stability gating: 안정성, 신뢰도, 경계선 처박힘, 활성 포인트와의 거리 검사
      // forceProgress(9초 이상 정체)면 어떤 게이트든 무시하고 통과시킨다 — 안전장치.
      const isStableGaze =
        forceProgress ||
        (confidence >= effectiveConfidenceThreshold &&
          !isAtEdge &&
          (isCenterPointStillLearning ||
            (stats.stabilityScore >= effectiveStabilityThreshold && distance <= maxAllowedDistance)))

      if (!isStableGaze) {
        // 불안정할 경우 게이지 누적을 멈추고(Pause), 적절한 안내 메시지 표시.
        // 어떤 게이트가 막았는지 점별 로그에도 집계 — 나중에 "이 점은 항상
        // confidence가 막는다" 같은 패턴을 분석하는 데 사용.
        if (isAtEdge) {
          setGuideMessage('화면 안쪽의 점을 응시해 주세요.')
          calibrationLogger.recordGateFailure('edge')
        } else if (confidence < effectiveConfidenceThreshold) {
          setGuideMessage('얼굴/시선 인식이 약합니다. 카메라를 정면으로 봐주세요.')
          calibrationLogger.recordGateFailure('confidence')
        } else if (!isCenterPointStillLearning && distance > maxAllowedDistance) {
          setGuideMessage('점을 더 정확히 바라봐 주세요.')
          calibrationLogger.recordGateFailure('distance')
        } else {
          setGuideMessage('정면을 응시하세요 (움직임 감지)')
          calibrationLogger.recordGateFailure('stability')
        }

        rafId = requestAnimationFrame(loop)
        return
      }

      // 안정적일 경우 게이지 증가 및 기본 가이드 표시
      setGuideMessage('시선을 유지해 주세요.')
      elapsedTimeRef.current += dt
      
      const newProgress = Math.min(100, Math.floor((elapsedTimeRef.current / DWELL_TIME_MS) * 100))

      if (newProgress !== lastProgress) {
        lastProgress = newProgress
        setDwellProgress(newProgress)
      }

      if (elapsedTimeRef.current >= DWELL_TIME_MS) {
        // 게이지가 100% 차고도 다음 점으로 넘어가지 않고 멈추는 증상(점3 등 임의 지점에서
        // 보고됨)의 가능한 원인: captureSample/moveNextPoint 처리 중 예기치 못한 예외가
        // 발생하면 이 rAF 콜백이 중간에 throw되어 다음 requestAnimationFrame이 전혀
        // 예약되지 못하고 루프 자체가 영구 정지함 — 게이지는 마지막 값(100%)에 그대로
        // 멈춰 보이고 currentPointIndex도 바뀌지 않아 진행이 끊긴 것처럼 보임.
        // → 캡처~다음 점 전환 구간을 try/catch로 감싸 예외가 나도 진행 상태를 보존하고
        //   루프를 계속 살려서(다음 프레임에서 동일 시점 재시도) 영구 정지를 방지한다.
        try {
          // 캡처 시 보정 전 원본 좌표(uncalibratedGaze) 우선 — 피드백 루프 차단
          const gazeToCapture = uncalibratedGaze || filteredGaze
          // forceProgress로 강제 진행된 점은 정상 게이트(거리/안정성/신뢰도)를 통과하지
          // 못한 채 캡처된 샘플이라 오차가 크다 — 회귀 가중치를 낮춰 polynomial fit이
          // 이런 저품질 샘플에 휘둘리지 않게 한다 (전체 가중치 0이 아닌 0.15로,
          // 위치 정보를 완전히 버리진 않음).
          captureSample(
            currentPoint.x * window.innerWidth,
            currentPoint.y * window.innerHeight,
            gazeToCapture,
            forceProgress ? 0.15 : 1,
          )
          elapsedTimeRef.current = 0
          lastProgress = 0
          setDwellProgress(0)

          // 이 점이 어떻게 끝났는지(최종 confidence/stability/distance) 점별 로그에 확정.
          calibrationLogger.completePoint({
            confidence,
            stabilityScore: stats.stabilityScore,
            distance,
          })

          if (currentPointIndex >= CALIBRATION_POINTS.length - 1) {
            completeCalibration()
            return // 루프 종료, 컴포넌트 언마운트됨
          }
          moveNextPoint()
          return // 루프 종료, currentPointIndex 변경 → Effect 재실행
        } catch (err) {
          console.error('[CalibrationOverlay] 점 캡처/전환 중 예외 발생, 루프 유지하며 재시도:', err)
          calibrationLogger.recordCaptureRetry()
          elapsedTimeRef.current = 0
          lastProgress = 0
          setDwellProgress(0)
          // 루프를 죽이지 않고 다음 프레임에서 동일 점을 다시 시도하도록 계속 진행
        }
      }

      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [isCalibrating, currentPoint, currentPointIndex, captureSample, moveNextPoint, completeCalibration])

  if (!isCalibrating) return null

  return (
    <div className="calibration-overlay">
      <div className="calibration-instruction-banner">
        <h3>시선 보정 ({currentPointIndex + 1} / {CALIBRATION_POINTS.length})</h3>
        <p className="calibration-guide-message">{guideMessage}</p>
      </div>
      {CALIBRATION_POINTS.map((point, index) => (
        <CalibrationPoint
          key={index}
          x={point.x}
          y={point.y}
          active={index === currentPointIndex}
          completed={index < currentPointIndex}
          progress={index === currentPointIndex ? dwellProgress : 0}
          index={index}
          total={CALIBRATION_POINTS.length}
        />
      ))}
    </div>
  )
}

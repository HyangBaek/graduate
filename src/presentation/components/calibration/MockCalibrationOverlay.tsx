// // src/presentation/components/calibration/MockCalibrationOverlay.tsx

// import { useEffect, useMemo, useRef, useState } from 'react'

// import { CalibrationPoint } from '@/presentation/components/calibration/CalibrationPoint'
// import { CALIBRATION_POINTS } from '@/presentation/constants/calibrationPoints'
// import { useCalibration } from '@/presentation/hooks/useCalibration'

// const DWELL_TIME_MS = 2500 // 한 점당 걸리는 시간 (2.5초)

// export const MockCalibrationOverlay = () => {
//   const {
//     isCalibrating,
//     currentPointIndex,
//     captureSample,
//     moveNextPoint,
//     completeCalibration,
//   } = useCalibration()

//   const [dwellProgress, setDwellProgress] = useState(0)
//   const [guideMessage, setGuideMessage] = useState('화면의 점을 바라봐 주세요.')
  
//   const startTimeRef = useRef<number>(Date.now())

//   const currentPoint = useMemo(() => CALIBRATION_POINTS[currentPointIndex], [currentPointIndex])

//   // 포인트 변경 시 초기화
//   useEffect(() => {
//     setDwellProgress(0)
//     startTimeRef.current = Date.now()
//     setGuideMessage('화면의 점을 바라봐 주세요.')
//   }, [currentPointIndex])

//   // ── 자동 진행 rAF 애니메이션 루프 ──────────────────────────────────────────
//   useEffect(() => {
//     if (!isCalibrating || !currentPoint) return

//     let rafId: number
//     let isTransitioning = false

//     const loop = () => {
//       // 이미 100%를 찍고 다음 점으로 넘어가는 대기 상태면 루프 일시 정지
//       if (isTransitioning) return

//       const now = Date.now()
//       const elapsed = now - startTimeRef.current
      
//       // 진행도 계산 (0 ~ 100)
//       const newProgress = Math.min(100, Math.floor((elapsed / DWELL_TIME_MS) * 100))
      
//       setDwellProgress(newProgress)

//       // 진행도에 따른 가이드 메시지 변경 애니메이션 느낌 추가
//       if (newProgress > 30) {
//         setGuideMessage('시선을 유지해 주세요.')
//       }

//       // 게이지가 100% 다 찼을 때
//       if (newProgress >= 100) {
//         isTransitioning = true // 중복 실행 방지
        
//         // 100% 도달 시 해당 타겟 좌표를 기반으로 가상 시선 데이터를 생성합니다.
//         const targetX = currentPoint.x * window.innerWidth
//         const targetY = currentPoint.y * window.innerHeight
//         const dummyGaze = { x: targetX, y: targetY }
        
//         // 훅 내부 상태가 정상 업데이트되도록 가상 캡처를 먼저 수행합니다.
//         if (captureSample) {
//           captureSample(targetX, targetY, dummyGaze)
//         }
        
//         // 데이터가 갱신될 시간을 벌어준 뒤 다음 상태로 전환합니다.
//         setTimeout(() => {
//           if (currentPointIndex >= CALIBRATION_POINTS.length - 1) {
//             // 마지막 점 보정이 끝나면 실제 보정 완료 로직을 호출하여 메인 화면으로 이동시킵니다.
//             completeCalibration()
//           } else {
//             moveNextPoint()
//           }
//         }, 300)
        
//         return
//       }

//       rafId = requestAnimationFrame(loop)
//     }

//     rafId = requestAnimationFrame(loop)
//     return () => cancelAnimationFrame(rafId)
//   }, [isCalibrating, currentPointIndex, currentPoint, captureSample, moveNextPoint, completeCalibration])

//   if (!isCalibrating) return null

//   return (
//     <div className="calibration-overlay">
//       <div className="calibration-instruction-banner">
//         <h3>시선 보정 ({currentPointIndex + 1} / {CALIBRATION_POINTS.length})</h3>
//         <p className="calibration-guide-message">{guideMessage}</p>
//       </div>
//       {CALIBRATION_POINTS.map((point, index) => (
//         <CalibrationPoint
//           key={index}
//           x={point.x}
//           y={point.y}
//           active={index === currentPointIndex}
//           completed={index < currentPointIndex}
//           progress={index === currentPointIndex ? dwellProgress : 0}
//           index={index}
//           total={CALIBRATION_POINTS.length}
//         />
//       ))}
//     </div>
//   )
// }
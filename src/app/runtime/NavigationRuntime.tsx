// src/app/runtime/NavigationRuntime.tsx

import { useEffect, useRef } from 'react'
import { useGazeStore } from '@/presentation/state/gazeStore'
import { useViewerStore } from '@/presentation/store/viewerStore'
import { useCalibrationStore } from '@/presentation/store/calibrationStore'
import { useDebugStore } from '@/presentation/store/useDebugStore'
import { NavigatePageUseCase } from '@/domain/usecases/NavigatePageUseCase'

// cooldownMs: RESET_BASELINE 후 dwell이 처음부터 다시 쌓여야 하므로(800ms~1200ms)
// 중복 트리거 방지용 짧은 안전장치만 필요. 2000ms는 과도하게 길어 "완료 표시(녹색) 후
// 한참 멈춰있다가 넘어가는" 느린 체감의 원인이었음 → navigationPause(500ms)보다
// 살짝 긴 값으로 축소.
const navigateUseCase = new NavigatePageUseCase({ cooldownMs: 600 })

/**
 * 시선(dwell) 기반 자동 페이지 이동을 처리하는 렌더 없는 런타임 컴포넌트.
 * gazeStore의 shouldNavigateNext/Prev 트리거를 구독하여 NavigatePageUseCase로
 * 이동 가능 여부를 판정하고, 허용되면 실제 페이지 전환과 베이스라인 리셋을 수행한다.
 * @returns null (UI를 렌더링하지 않음)
 */
export function NavigationRuntime() {
  const nextPage = useViewerStore((state) => state.nextPage)
  const prevPage = useViewerStore((state) => state.prevPage)

  const stabilityScore = useGazeStore((state) => state.stats.stabilityScore)
  const isStable = stabilityScore > 0.35

  // ref로 최신값 유지 → 구독 콜백이 stale closure로 이전값을 참조하는 문제 해결
  const isStableRef = useRef(isStable)
  useEffect(() => {
    isStableRef.current = isStable
  }, [isStable])

  const nextPageRef = useRef(nextPage)
  useEffect(() => { nextPageRef.current = nextPage }, [nextPage])

  const prevPageRef = useRef(prevPage)
  useEffect(() => { prevPageRef.current = prevPage }, [prevPage])

  useEffect(() => {
    const unsubNext = useGazeStore.subscribe(
      (state) => state.shouldNavigateNext,
      (shouldNavigate) => {
        // '수동' 모드에서는 시선 기반 자동 넘김을 사용하지 않음
        if (useGazeStore.getState().turnMode === 'manual') return
        if (shouldNavigate && !useCalibrationStore.getState().isCalibrating) {
          const { currentPage, totalPages } = useViewerStore.getState()
          const result = navigateUseCase.navigateNext(
            currentPage,
            totalPages,
            {
              completed: true,
              isDwelling: true,
              dwellTime: 1200,
              progress: 1.0,
            },
            isStableRef.current, // ← 항상 최신 isStable 참조
            Date.now(),
          )
          if (result.triggered) {
            console.log('[NavigationRuntime] ▶ Next page:', result.targetPage)
            nextPageRef.current()
            useGazeStore.getState().setNavigationPause(500)
            useGazeStore.getState().triggerBaselineReset()
          } else {
            console.log('[NavigationRuntime] Next blocked:', result.reason)
          }
        }
      },
    )

    const unsubPrev = useGazeStore.subscribe(
      (state) => state.shouldNavigatePrev,
      (shouldNavigate) => {
        // '수동' 모드에서는 시선 기반 자동 넘김을 사용하지 않음
        if (useGazeStore.getState().turnMode === 'manual') return
        // 이전 페이지 존이 비활성화된 경우 동작 안 함 (사용자 모드 기본값)
        if (!useDebugStore.getState().prevPageZoneEnabled) return
        if (shouldNavigate && !useCalibrationStore.getState().isCalibrating) {
          const { currentPage } = useViewerStore.getState()
          const result = navigateUseCase.navigatePrevious(
            currentPage,
            {
              completed: true,
              isDwelling: true,
              dwellTime: 1200,
              progress: 1.0,
            },
            isStableRef.current, // ← 항상 최신 isStable 참조
            Date.now(),
          )
          if (result.triggered) {
            console.log('[NavigationRuntime] ◀ Prev page:', result.targetPage)
            prevPageRef.current()
            useGazeStore.getState().setNavigationPause(500)
            useGazeStore.getState().triggerBaselineReset()
          } else {
            console.log('[NavigationRuntime] Prev blocked:', result.reason)
          }
        }
      },
    )

    return () => {
      unsubNext()
      unsubPrev()
      navigateUseCase.reset()
    }
  // 구독은 마운트 시 1회만 등록 - ref를 사용하므로 재등록 불필요
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
export default NavigationRuntime

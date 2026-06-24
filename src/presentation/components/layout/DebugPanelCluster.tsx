// src/presentation/components/layout/DebugPanelCluster.tsx
// 화면 우측에 고정되는 디버그 패널 묶음 (드로어 개폐에 따라 슬라이드)

import { DebugOverlay } from '@/presentation/components/debug/DebugOverlay'
import { DebugSandbox } from '@/presentation/components/debug/DebugSandbox'
import { PipelineOverlay } from '@/presentation/components/debug/PipelineOverlay'
import '@/presentation/styles/components/DebugPanelCluster.css'

interface DebugPanelClusterProps {
  /** 드로어가 열려 있을 때 true → 클러스터가 왼쪽으로 슬라이드 */
  drawerOpen: boolean
}

/**
 * 디버그 모드에서 화면 우측에 고정 배치되는 디버그 패널들의 묶음.
 * 좌측 컬럼에는 파이프라인 단계별 상태(PipelineOverlay), 우측 컬럼에는
 * 실시간 통계(DebugOverlay)와 마우스 시뮬레이션 패널(DebugSandbox)을 배치한다.
 *
 * @param drawerOpen 드로어 열림 여부 — true면 클러스터를 왼쪽으로 슬라이드시켜 겹침을 방지
 * @returns 좌/우 두 컬럼으로 구성된 디버그 패널 클러스터 div
 */
export function DebugPanelCluster({ drawerOpen }: DebugPanelClusterProps) {
  return (
    <div className={`debug-panel-cluster ${drawerOpen ? 'drawer-open' : ''}`}>
      {/* Left Column: 10-Step Pipeline Status */}
      <div className="debug-panel-col left-col">
        <PipelineOverlay />
      </div>

      {/* Right Column: Gaze Monitor & Gaze Sandbox */}
      <div className="debug-panel-col right-col">
        <DebugOverlay />
        <DebugSandbox />
      </div>
    </div>
  )
}

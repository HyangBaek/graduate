// src/presentation/components/layout/PageHotzones.tsx
// 시선 기반 페이지 전환 핫존 영역 (다음/이전 페이지 트리거)

import { useMemo, type CSSProperties } from 'react'
import { useGazeStore } from '@/presentation/state/gazeStore'
import { useDebugStore } from '@/presentation/store/useDebugStore'
import { useViewerStore } from '@/presentation/store/viewerStore'
import '@/presentation/styles/components/PageHotzones.css'

/**
 * PageHotzones 컴포넌트의 props.
 */
interface PageHotzonesProps {
  /** false 이면 핫존을 렌더링하지 않고 숨김 */
  visible: boolean
}

/**
 * 시선 기반 페이지 전환을 트리거하는 다음/이전 페이지 핫존 영역을 렌더링한다.
 * pdfBounds(렌더링된 PDF 영역)를 기준으로 다음 페이지 핫존(하단 1/6)과
 * 이전 페이지 핫존(상단 15%)의 위치/크기를 계산하고, 시선 dwell 진행률에
 * 따라 진행 바와 배경 그라디언트를 표시한다.
 *
 * @param visible 핫존을 항상 표시할지 여부 (false여도 dwell 진행 중이면 표시됨)
 * @returns 다음/이전 페이지 핫존 div 요소들
 */
export function PageHotzones({ visible }: PageHotzonesProps) {
  const nextProgress = useGazeStore((s) => s.nextProgress)
  const prevProgress = useGazeStore((s) => s.prevProgress)
  const pdfBounds = useGazeStore((s) => s.pdfBounds)
  const prevPageZoneEnabled = useDebugStore((s) => s.prevPageZoneEnabled)
  const currentPage = useViewerStore((s) => s.currentPage)
  const totalPages = useViewerStore((s) => s.totalPages)
  const isLastPage = totalPages > 0 && currentPage >= totalPages
  const isFirstPage = currentPage <= 1

  // 다음 페이지 핫존: PDF 영역의 우측 25%, 하단 1/6 영역으로 좌표를 계산한다.
  const nextGeometry = useMemo(() => {
    if (pdfBounds) {
      return {
        left:   `${pdfBounds.x + pdfBounds.width * 0.75}px`,
        top:    `${pdfBounds.y + pdfBounds.height * (5 / 6)}px`,  // 악보 마지막 1/6 시작점
        width:  `${pdfBounds.width * 0.25}px`,
        height: `${pdfBounds.height * (1 / 6)}px`,                // 정확히 1/6 높이
      }
    }
    return { left: 'auto', top: 'auto', width: '25vw', height: '16.67vh' }
  }, [pdfBounds])

  // 이전 페이지 핫존: PDF 영역 전체 너비, 상단 15% 높이로 계산한다.
  const prevGeometry = useMemo(() => {
    if (pdfBounds) {
      return {
        left:   `${pdfBounds.x}px`,
        top:    `${pdfBounds.y}px`,
        width:  `${pdfBounds.width}px`,
        height: `${pdfBounds.height * 0.15}px`,
      }
    }
    return { left: '0', top: '0', width: '100vw', height: '15vh' }
  }, [pdfBounds])

  const nextBg = isLastPage
    ? 'rgba(120,120,130,0.10)'
    : nextProgress > 0
      ? `linear-gradient(to top, rgba(255,0,127,${nextProgress * 0.15}), transparent)`
      : 'rgba(255,255,255,0.005)'

  const prevBg = isFirstPage
    ? 'rgba(120,120,130,0.10)'
    : prevProgress > 0
      ? `linear-gradient(to bottom, rgba(0,240,255,${prevProgress * 0.1}), transparent)`
      : 'transparent'

  const nextZoneStyle: CSSProperties = {
    '--hz-left': nextGeometry.left,
    '--hz-top': nextGeometry.top,
    '--hz-width': nextGeometry.width,
    '--hz-height': nextGeometry.height,
    '--hz-bg': nextBg,
  } as CSSProperties

  const prevZoneStyle: CSSProperties = {
    '--hz-left': prevGeometry.left,
    '--hz-top': prevGeometry.top,
    '--hz-width': prevGeometry.width,
    '--hz-height': prevGeometry.height,
    '--hz-bg': prevBg,
  } as CSSProperties

  return (
    <>
      {/* Next Page Zone (bottom area) */}
      <div
        className={`hotzone hotzone-next${!pdfBounds ? ' no-bounds' : ''}${isLastPage ? ' hotzone-end' : ''}${!(visible || nextProgress > 0) ? ' hidden' : ''}`}
        style={nextZoneStyle}
      >
        {!isLastPage && nextProgress > 0 && (
          <div
            className="hotzone-progress-bar next-bar"
            style={{ '--hz-progress': `${nextProgress * 100}%` } as CSSProperties}
          />
        )}
        <span className="hotzone-label next-label">
          {isLastPage
            ? '마지막 페이지'
            : `NEXT PAGE ZONE${nextProgress > 0 ? ` (${(nextProgress * 100).toFixed(0)}%)` : ''}`}
        </span>
      </div>

      {/* Prev Page Zone (top area) */}
      {prevPageZoneEnabled && (
        <div
          className={`hotzone hotzone-prev${!pdfBounds ? ' no-bounds' : ''}${isFirstPage ? ' hotzone-end' : ''}${!(visible || prevProgress > 0) ? ' hidden' : ''}`}
          style={prevZoneStyle}
        >
          {!isFirstPage && prevProgress > 0 && (
            <div
              className="hotzone-progress-bar prev-bar"
              style={{ '--hz-progress': `${prevProgress * 100}%` } as CSSProperties}
            />
          )}
          <span className="hotzone-label prev-label">
            {isFirstPage
              ? '첫 페이지'
              : `PREV PAGE ZONE${prevProgress > 0 ? ` (${(prevProgress * 100).toFixed(0)}%)` : ''}`}
          </span>
        </div>
      )}
    </>
  )
}

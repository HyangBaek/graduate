// src/presentation/components/layout/FloatingHeader.tsx
// 뷰어 상단 플로팅 헤더 (로고, 문서명, 페이지/줌 컨트롤, 드로어 토글)

import { useViewerStore } from '@/presentation/store/viewerStore'
import '@/presentation/styles/components/FloatingHeader.css'

/**
 * FloatingHeader 컴포넌트의 props.
 * @property drawerOpen 디버그 드로어가 열려 있는지 여부 (토글 버튼 활성 표시에 사용)
 * @property onDrawerToggle 드로어 열기/닫기 토글 버튼 클릭 시 호출되는 콜백
 */
interface FloatingHeaderProps {
  drawerOpen: boolean
  onDrawerToggle: () => void
}

/**
 * 뷰어 화면 상단에 떠 있는 플로팅 헤더.
 * 로고/문서명, 페이지 이동 및 줌 컨트롤, 디버그 드로어 토글 버튼을 표시한다.
 *
 * @param drawerOpen 디버그 드로어 열림 여부
 * @param onDrawerToggle 드로어 토글 버튼 클릭 콜백
 * @returns 좌(로고/문서명)·중앙(페이지 컨트롤)·우(줌/드로어 토글)로 구성된 header
 */
export function FloatingHeader({
  drawerOpen,
  onDrawerToggle,
}: FloatingHeaderProps) {
  const currentPage = useViewerStore((s) => s.currentPage)
  const totalPages = useViewerStore((s) => s.totalPages)
  const zoomLevel = useViewerStore((s) => s.zoomLevel)
  const prevPage = useViewerStore((s) => s.prevPage)
  const nextPage = useViewerStore((s) => s.nextPage)
  const zoomIn = useViewerStore((s) => s.zoomIn)
  const zoomOut = useViewerStore((s) => s.zoomOut)
  const setZoom = useViewerStore((s) => s.setZoom)
  const isLoading = useViewerStore((s) => s.isLoading)
  const documentName = useViewerStore((s) => s.documentName)

  return (
    <header className="dashboard-header">
      {/* Left: Logo & Document Title */}
      <div className="header-left-side">
        <span className="header-logo-text">
          EyeScore <span className="header-logo-badge">v1.0</span>
        </span>
        <div className="header-divider" />
        <span className="header-doc-title">
          {isLoading ? 'Loading Score...' : documentName || 'No Document'}
        </span>
      </div>

      {/* Center: Page Controls */}
      <div className="header-center-side">
        <div className="control-group">
          <button
            onClick={prevPage}
            disabled={currentPage <= 1}
            className="control-nav-btn"
            aria-label="Previous page"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="icon-svg-centered"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="header-page-text">
            Page {currentPage} / {totalPages || '?'}
          </span>
          <button
            onClick={nextPage}
            disabled={currentPage >= totalPages}
            className="control-nav-btn"
            aria-label="Next page"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="icon-svg-centered"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Right: Zoom Controls & Hamburger Button */}
      <div className="header-right-side">
        <div className="control-group">
          <button
            onClick={zoomOut}
            className="control-nav-btn"
            aria-label="Zoom out"
          >
            -
          </button>
          <span
            onClick={() => setZoom(1.0)}
            className="header-zoom-text"
            title="Click to reset zoom"
            role="button"
            tabIndex={0}
          >
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            onClick={zoomIn}
            className="control-nav-btn"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>

        <button
          onClick={onDrawerToggle}
          className={`drawer-toggle-btn ${drawerOpen ? 'active' : ''}`}
          title="Debug & Calibration Menu"
          aria-label="Toggle debug drawer"
          aria-expanded={drawerOpen}
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
            className="icon-svg-centered"
          >
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>
    </header>
  )
}

// src/presentation/state/selectors/viewerSelectors.ts

import { useViewerStore } from '@/presentation/store/viewerStore'

/**
 * 현재 페이지 번호를 반환하는 selector.
 * @returns currentPage 값
 */
export const useCurrentPage = () =>
  useViewerStore(
    state => state.currentPage
  )

/**
 * 전체 페이지 수를 반환하는 selector.
 * @returns totalPages 값
 */
export const useTotalPages = () =>
  useViewerStore(
    state => state.totalPages
  )

/**
 * 현재 줌 레벨을 반환하는 selector.
 * @returns zoomLevel 값
 */
export const useZoomLevel = () =>
  useViewerStore(
    state => state.zoomLevel
  )
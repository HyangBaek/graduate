// src/presentation/state/viewerStore.ts

import { create } from 'zustand'

/**
 * PDF 뷰어의 현재 문서, 페이지, 줌/회전, 로딩 상태를 관리하는 상태 인터페이스.
 */
export interface ViewerState {
  /** 현재 표시 중인 페이지 번호 (1-based) */
  currentPage: number
  /** 문서의 전체 페이지 수 */
  totalPages: number

  /** 현재 줌 레벨 */
  zoomLevel: number
  /** 현재 회전 각도(도 단위) */
  rotation: number

  /** 문서 로딩 중 여부 */
  isLoading: boolean
  /** 페이지 렌더링 중 여부 */
  isRendering: boolean

  /** 현재 열려 있는 문서의 이름 */
  documentName: string | null
  /** 현재 열려 있는 문서의 URL */
  documentUrl: string | null

  /** PdfRuntime에게 로드할 파일 이름을 전달하는 채널. null이면 대기 중. */
  pendingFileName: string | null

  /** 마지막으로 실제 렌더링이 완료된 페이지 번호 */
  lastRenderedPage: number | null

  /** 현재 페이지를 설정한다. 1~totalPages 범위로 clamp된다. */
  setPage: (page: number) => void

  /** 다음 페이지로 이동한다. 마지막 페이지면 동작하지 않는다. */
  nextPage: () => void
  /** 이전 페이지로 이동한다. 첫 페이지면 동작하지 않는다. */
  prevPage: () => void

  /** 전체 페이지 수를 설정한다. */
  setTotalPages: (pages: number) => void

  /** 줌 레벨을 설정한다. MIN_ZOOM~MAX_ZOOM 범위로 clamp된다. */
  setZoom: (zoom: number) => void
  /** 줌 레벨을 ZOOM_STEP만큼 확대한다(최대 MAX_ZOOM). */
  zoomIn: () => void
  /** 줌 레벨을 ZOOM_STEP만큼 축소한다(최소 MIN_ZOOM). */
  zoomOut: () => void

  /** 회전 각도를 설정한다. */
  setRotation: (rotation: number) => void

  /** 문서 로딩 상태를 설정한다. */
  setLoading: (loading: boolean) => void
  /** 페이지 렌더링 상태를 설정한다. */
  setRendering: (rendering: boolean) => void

  /**
   * 현재 문서의 이름과 URL을 설정한다.
   * @param name 문서 이름
   * @param url 문서 URL
   */
  setDocument: (
    name: string,
    url: string
  ) => void

  /**
   * PdfRuntime에 전달할 대기 파일명을 설정한다.
   * name이 있으면 documentUrl/documentName을 초기화해 이전 cycle의 stale URL 사용을 방지한다.
   */
  setPendingFile: (name: string | null) => void

  /** 마지막으로 렌더링 완료된 페이지 번호를 설정한다. */
  setLastRenderedPage: (
    page: number
  ) => void

  /** 뷰어 상태를 초기값으로 되돌린다. */
  resetViewer: () => void
}

const INITIAL_ZOOM = 1
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 0.1

/**
 * PDF 뷰어의 페이지/줌/회전/로딩 상태를 관리하는 Zustand 스토어.
 */
export const useViewerStore =
  create<ViewerState>((set, get) => ({
    currentPage: 1,
    totalPages: 0,

    zoomLevel: INITIAL_ZOOM,
    rotation: 0,

    isLoading: false,
    isRendering: false,

    documentName: null,
    documentUrl: null,

    pendingFileName: null,

    lastRenderedPage: null,

    setPage: (page) => {
      const totalPages = get().totalPages

      const safePage = Math.min(
        Math.max(page, 1),
        totalPages || 1
      )

      set({
        currentPage: safePage,
      })
    },

    nextPage: () => {
      const {
        currentPage,
        totalPages,
      } = get()

      if (currentPage >= totalPages)
        return

      set({
        currentPage: currentPage + 1,
      })
    },

    prevPage: () => {
      const { currentPage } = get()

      if (currentPage <= 1) return

      set({
        currentPage: currentPage - 1,
      })
    },

    setTotalPages: (pages) => {
      set({
        totalPages: pages,
      })
    },

    setZoom: (zoom) => {
      const safeZoom = Math.min(
        Math.max(zoom, MIN_ZOOM),
        MAX_ZOOM
      )

      set({
        zoomLevel: safeZoom,
      })
    },

    zoomIn: () => {
      const { zoomLevel } = get()

      const nextZoom =
        zoomLevel + ZOOM_STEP

      set({
        zoomLevel: Math.min(
          nextZoom,
          MAX_ZOOM
        ),
      })
    },

    zoomOut: () => {
      const { zoomLevel } = get()

      const nextZoom =
        zoomLevel - ZOOM_STEP

      set({
        zoomLevel: Math.max(
          nextZoom,
          MIN_ZOOM
        ),
      })
    },

    setRotation: (rotation) => {
      set({
        rotation,
      })
    },

    setLoading: (loading) => {
      set({
        isLoading: loading,
      })
    },

    setRendering: (rendering) => {
      set({
        isRendering: rendering,
      })
    },

    setDocument: (name, url) => {
      set({
        documentName: name,
        documentUrl: url,
      })
    },

    setPendingFile: (name) => {
      // name이 있으면 documentUrl/Name도 초기화.
      // → PdfViewerPage가 이전 cycle의 stale URL로 로딩 시작하는 것을 방지.
      if (name != null) {
        set({ pendingFileName: name, documentUrl: null, documentName: null })
      } else {
        set({ pendingFileName: null })
      }
    },

    setLastRenderedPage: (page) => {
      set({
        lastRenderedPage: page,
      })
    },

    resetViewer: () => {
      set({
        currentPage: 1,
        totalPages: 0,

        zoomLevel: INITIAL_ZOOM,
        rotation: 0,

        isLoading: false,
        isRendering: false,

        documentName: null,
        documentUrl: null,

        pendingFileName: null,

        lastRenderedPage: null,
      })
    },
  }))
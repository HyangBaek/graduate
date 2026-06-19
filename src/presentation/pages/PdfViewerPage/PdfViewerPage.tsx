// src/presentation/pages/PdfViewerPage/PdfViewerPage.tsx
//
// PDF 페이지 렌더러 + 프리페치 캐시
//
// 동작 원리:
//   현재 페이지(N) 렌더 완료 → 백그라운드에서 N+1, N-1을 offscreen 캔버스에 미리 렌더링
//   페이지 이동 시:
//     캐시 히트  → visible 캔버스에 즉시 blit (사실상 0ms)
//     캐시 미스  → 기존 방식으로 렌더 (최초 1회만 느림)
//
// 로드 우선순위:
//   1. pdfPreloadManager  — HomeLayout이 미리 로드+렌더한 doc+bitmap (즉시)
//   2. pdfDocSessionCache — 이전 방문에서 파싱된 doc (bitmap만 재렌더, 빠름)
//   3. pdfFileStore       — IndexedDB/세션캐시에서 ArrayBuffer → getDocument (느림)
//   4. URL fallback       — 같은 세션의 blob URL (실패 시 홈으로 복귀)
//
// StrictMode 대응:
//   loadingUrlRef를 cleanup에서 null로 초기화하지 않는다.
//   → 같은 URL에 대한 두 번째 loadPdf 호출이 guard에 걸려 즉시 반환된다.
//   clearCache effect도 실제 값 변경 시에만 실행 (첫 마운트/StrictMode 재실행 스킵).

// ── 최적화 ────────────────────────────────────────────────────────────────────
//  이전: 9개 Zustand 구독
//    navigate(1) + documentUrl/currentPage/zoomLevel/rotation(4) + 4 actions(4)
//  현재: 1개 구독
//    useShallow → { documentUrl, currentPage, zoomLevel, rotation } 단일 구독
//    actions(setTotalPages/setLoading/setRendering/setLastRenderedPage) → getState()
//    navigate → useAppRouter.getState().navigate

import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker?url'
import { useViewerStore } from '@/presentation/store/viewerStore'
import { useGazeStore } from '@/presentation/state/gazeStore'
import { useAppRouter } from '@/app/router/useAppRouter'
import { pdfPreloadManager, preloadFromBuffer } from '@/shared/utils/pdfPreloadManager'
import { loadFile } from '@/shared/utils/pdfFileStore'
import { getDocCache, setDocCache } from '@/shared/utils/pdfDocSessionCache'
import { CMAP_URL } from '@/shared/utils/pdfConstants'
import { useRecentFilesStore } from '@/presentation/store/recentFilesStore'
import '@/presentation/styles/PdfViewerPage.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

// ── 캐시 키 ──────────────────────────────────────────────────────────────────
// containerHeight는 10px 단위로 반올림 (resize 민감도 낮춤)
/**
 * 페이지/줌/회전/컨테이너 높이 조합으로 프리페치 캐시의 키를 생성.
 *
 * @param page 페이지 번호
 * @param zoom 줌 레벨
 * @param rot 회전 각도
 * @param containerHeight 뷰어 컨테이너 높이(px)
 * @returns 캐시 조회/저장에 사용할 문자열 키
 */
function cacheKey(page: number, zoom: number, rot: number, containerHeight: number): string {
  return `${page}_${zoom.toFixed(2)}_${rot}_${Math.round(containerHeight / 10) * 10}`
}

// ── offscreen 캔버스에 페이지 렌더 후 ImageBitmap 반환 ─────────────────────
/**
 * 지정한 페이지를 OffscreenCanvas에 렌더링하고 ImageBitmap으로 반환한다.
 * 메인 스레드의 화면 표시 캔버스와 별개로 백그라운드 프리페치용 렌더에 사용된다.
 *
 * @param pdf 로드된 PDF 문서 프록시
 * @param pageNum 렌더링할 페이지 번호
 * @param zoomLevel 줌 레벨
 * @param rotation 회전 각도
 * @param containerHeight 뷰어 컨테이너 높이(px), 스케일 계산에 사용
 * @returns 렌더링된 페이지의 ImageBitmap
 */
async function renderPageToOffscreen(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  zoomLevel: number,
  rotation: number,
  containerHeight: number,
): Promise<ImageBitmap> {
  const page = await pdf.getPage(pageNum)
  const viewport = page.getViewport({ scale: zoomLevel, rotation })
  const scale = containerHeight / viewport.height
  const scaledViewport = page.getViewport({ scale: zoomLevel * scale, rotation })
  const dpr = window.devicePixelRatio || 1

  // OffscreenCanvas: 메인 스레드 블로킹 없이 GPU 가속 렌더 가능
  const offscreen = new OffscreenCanvas(
    Math.round(scaledViewport.width * dpr),
    Math.round(scaledViewport.height * dpr),
  )
  const ctx = offscreen.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: scaledViewport }).promise

  // ImageBitmap: GPU 텍스처로 올라가 있어 drawImage가 즉시 완료
  return createImageBitmap(offscreen)
}

/**
 * PdfViewerPage 컴포넌트의 props.
 */
interface PdfViewerPageProps {
  /** Phase 1 렌더 완료(가시 페이지 갱신) 시마다 호출되는 콜백 */
  onPageChange?: (page: number) => void;
}

/**
 * 시선/일반 입력 기반 PDF 뷰어의 핵심 렌더링 컴포넌트.
 * 현재 페이지를 canvas에 렌더링하고, 인접 페이지를 백그라운드에서 프리페치하여
 * 페이지 이동 시 캐시 히트로 즉시 전환되도록 한다.
 *
 * @param props onPageChange 콜백을 포함한 컴포넌트 props
 * @returns PDF 페이지 canvas 및 로딩 썸네일을 포함한 JSX
 */
export default function PdfViewerPage({ onPageChange }: PdfViewerPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // 실제 컨테이너 높이를 반환. debug 모드에서는 floating header가 공간을 차지하므로
  // window.innerHeight 대신 실제 div의 clientHeight를 사용해야 올바른 비율로 렌더된다.
  const getContainerHeight = () => containerRef.current?.clientHeight ?? window.innerHeight

  // ── 구독: state 5개를 useShallow 단일 구독으로 합산 ─────────────────────────
  // actions는 getState()로 직접 접근 (stable ref, 구독·재렌더 불필요)
  const { documentUrl, currentPage, zoomLevel, rotation, documentName } = useViewerStore(
    useShallow((s) => ({
      documentUrl: s.documentUrl,
      currentPage: s.currentPage,
      zoomLevel: s.zoomLevel,
      rotation: s.rotation,
      documentName: s.documentName,
    }))
  )

  // ── LCP 썸네일 ────────────────────────────────────────────────────────────
  // 파일 이름으로 recentFilesStore에서 썸네일 조회 (구독 없이 단순 읽기)
  const thumbnail = useMemo(() => {
    if (!documentName) return null
    return useRecentFilesStore.getState().files.find((f) => f.name === documentName)?.thumbnail ?? null
  }, [documentName])

  // Phase 1 렌더 완료 전까지 썸네일 표시
  const [showThumbnail, setShowThumbnail] = useState(true)

  // 새 파일로 전환 시 썸네일 재표시
  useEffect(() => {
    setShowThumbnail(true)
  }, [documentUrl])

  // Local state to force re-render on resize
  const [resizeTrigger, setResizeTrigger] = useState(0)

  // Refs for tracking pdfjs objects and render states
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const activePdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)

  // StrictMode 중복 로드 방지:
  // cleanup에서 null로 초기화하지 않아 같은 URL의 두 번째 호출이 early-return됨.
  const loadingUrlRef = useRef<string | null>(null)

  // Effect to load document
  // 프리페치 캐시: cacheKey → ImageBitmap
  const prefetchCache = useRef<Map<string, ImageBitmap>>(new Map())
  // 현재 백그라운드 프리페치 중인 페이지 집합 (중복 방지)
  const prefetchingRef = useRef<Set<string>>(new Set())

  // clearCache guard: 실제 값 변경 시에만 실행하기 위한 이전 값 추적
  const prevClearDepsRef = useRef({ zoom: zoomLevel, rotation, resizeTrigger })

  // 첫 렌더 여부 추적: pdfDoc이 새로 설정된 직후에는 debounce 없이 즉시 렌더
  const isFirstRenderRef = useRef(false)

  // ── 캐시 무효화 ──────────────────────────────────────────────────────────────
  /**
   * 프리페치 캐시에 저장된 모든 ImageBitmap을 해제하고 캐시/진행 중 집합을 초기화한다.
   * 줌/회전/리사이즈 등으로 기존 캐시가 더 이상 유효하지 않을 때 호출된다.
   */
  function clearCache() {
    for (const bm of prefetchCache.current.values()) bm.close()
    prefetchCache.current.clear()
    prefetchingRef.current.clear()
  }

  // ── PDF 문서 로드 ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!documentUrl) return

    // StrictMode 중복 로드 방지: 같은 URL은 한 번만 로드
    if (loadingUrlRef.current === documentUrl) return
    loadingUrlRef.current = documentUrl

    const loadPdf = async () => {
      useViewerStore.getState().setLoading(true)
      clearCache()
      try {
        const docName = useViewerStore.getState().documentName

        // 기존 doc 정리 (다른 파일로 전환 시)
        // ※ docSessionCache에 있는 doc은 destroy하지 않는다.
        //   캐시된 doc을 destroy하면 이후 getPage() 호출에서
        //   "Cannot read properties of null (reading 'sendWithPromise')" 발생.
        if (activePdfDocRef.current) {
          const cachedDoc = docName ? getDocCache(docName) : null
          if (activePdfDocRef.current !== cachedDoc) {
            try { await activePdfDocRef.current.destroy() } catch { /* ignore */ }
          }
          activePdfDocRef.current = null
        }
        const preloaded = pdfPreloadManager.consume(documentUrl, docName ?? undefined)
        let pdf: pdfjsLib.PDFDocumentProxy | null = null

        // ── 우선순위 1: pdfPreloadManager (HomeLayout 프리로드 / PdfRuntime) ──
        // bitmap을 await하지 않고 즉시 setPdfDoc → 렌더 effect 즉시 trigger.
        // bitmap은 백그라운드에서 완성되면 prefetchCache에 fire-and-forget 주입.
        // → 첫 페이지는 캐시 미스로 직접 렌더 (정상 경로).
        // → 이후 같은 페이지 재방문 시 캐시 히트로 즉시 blit.
        //
        // 이전: await preloaded.bitmapPromise → bitmap 완성까지 setPdfDoc 대기
        //   (0.5-1s 지연, 또한 cacheKey 불일치 시 bitmap이 있어도 캐시 미스)
        if (preloaded) {
          console.log('[PdfViewerPage] 프리로드 doc 재사용 — getDocument() 스킵')
          pdf = preloaded.doc
          // bitmapPromise 제거됨 (Task #54): pdfPreloadManager는 doc만 저장.
          // PdfViewerPage가 직접 progressive DPR 렌더 담당 (Task #55).
        }

        // ── 우선순위 2: pdfDocSessionCache (이전 방문에서 파싱된 doc) ────────
        if (!pdf && docName) {
          const cachedDoc = getDocCache(docName)
          if (cachedDoc) {
            console.log('[PdfViewerPage] doc 세션 캐시 재사용:', docName)
            pdf = cachedDoc
          }
        }

        // ── 우선순위 3: pdfFileStore + preloadFromBuffer Promise 공유 ──────
        // 직접 getDocument() 대신 preloadFromBuffer를 통해
        // PdfRuntime의 fire-and-forget preload와 동일 Promise를 공유(dedup).
        // → getDocument()가 이미 진행 중이면 해당 Promise에 합류 (중복 파싱 없음).
        // → 완료됐으면 docCache 히트로 즉시 반환.
        if (!pdf && docName) {
          let fileBuffer: ArrayBuffer | null = null
          try { fileBuffer = await loadFile(docName) } catch { /* ignore */ }
          if (fileBuffer) {
            try {
              await preloadFromBuffer(docName, fileBuffer, currentPage)
              // preloadFromBuffer 완료 → store() 호출됨 → consume() 가능
              const preloadEntry = pdfPreloadManager.consume(documentUrl, docName)
              if (preloadEntry) {
                pdf = preloadEntry.doc
              }
            } catch { /* ignore */ }

            // consume() 미스 폴백: docCache 재확인 후 직접 파싱
            if (!pdf) {
              const cached2 = docName ? getDocCache(docName) : null
              if (cached2) {
                pdf = cached2
              } else if (fileBuffer) {
                try {
                  pdf = await pdfjsLib.getDocument({
                    data: fileBuffer.slice(0),
                    cMapUrl: CMAP_URL,
                    cMapPacked: true,
                  }).promise
                } catch { /* ignore */ }
              }
            }
          }
        }

        // ── 우선순위 4: URL fallback ──────────────────────────────────────────
        if (!pdf) {
          console.log('[PdfViewerPage] URL에서 로드:', documentUrl)
          try {
            pdf = await pdfjsLib.getDocument({
              url: documentUrl,
              cMapUrl: CMAP_URL,
              cMapPacked: true,
            }).promise
          } catch (urlErr) {
            console.warn('[PdfViewerPage] URL 로드 실패 → 홈으로 복귀:', urlErr)
            useAppRouter.getState().navigate('home')
            return
          }
        }

        activePdfDocRef.current = pdf
        isFirstRenderRef.current = true   // 다음 렌더 effect에서 delay=0으로 처리
        setPdfDoc(pdf)
        useViewerStore.getState().setTotalPages(pdf.numPages)

        // 성공 시 doc을 세션 캐시에 저장 → 다음 방문에서 재파싱 없이 재사용
        if (docName) setDocCache(docName, pdf)

      } catch (err) {
        console.error('[PdfViewerPage] 문서 로드 실패:', err)
        // 에러 시에만 여기서 setLoading(false) — 성공 경로는 Phase 1 완료 후 renderPage가 처리
        useViewerStore.getState().setLoading(false)
      }
    }

    loadPdf()

    // ※ cleanup에서 loadingUrlRef를 null로 초기화하지 않는다.
    //   → StrictMode 두 번째 호출이 guard에 걸려 안전하게 스킵됨.
  }, [documentUrl])

  // ── zoom / rotation / resize → 캐시 무효화 ───────────────────────────────
  // 실제 값 변경 시에만 실행 (StrictMode 초기 이중 실행에서 bitmap 소멸 방지)
  useEffect(() => {
    const prev = prevClearDepsRef.current
    if (
      prev.zoom === zoomLevel &&
      prev.rotation === rotation &&
      prev.resizeTrigger === resizeTrigger
    ) return   // 초기 마운트 / StrictMode 재실행 → 값 변화 없음 → 스킵

    prevClearDepsRef.current = { zoom: zoomLevel, rotation, resizeTrigger }
    clearCache()
  }, [zoomLevel, rotation, resizeTrigger])

  // ── 페이지 렌더 (캐시 활용 + progressive DPR) ────────────────────────────
  //
  // 캐시 미스 시 2단계 렌더:
  //   Phase 1: DPR=1 로 직접 canvas에 렌더 → 즉시 표시 (~4× 빠름)
  //   Phase 2: OffscreenCanvas에 실제 DPR 렌더 → 완료 후 swap → prefetchCache 저장
  //
  // 효과:
  //   DPR=2 기기에서 첫 가시 시간이 ~4× 단축됨.
  //   Phase 2는 백그라운드에서 진행되므로 UI를 블로킹하지 않음.
  //   페이지 전환/언마운트 시 cancelled 플래그로 Phase 2를 안전하게 중단.
  useEffect(() => {
    if (!pdfDoc) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 진행 중인 렌더 취소
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel() } catch { /* ignore */ }
      renderTaskRef.current = null
    }

    useViewerStore.getState().setRendering(true)

    // cleanup에서 true로 설정 → renderPage 내 각 await 직후 확인해 조기 종료
    let cancelled = false

    const renderPage = async () => {
      try {
        const containerHeight = getContainerHeight()
        const key = cacheKey(currentPage, zoomLevel, rotation, containerHeight)
        const cached = prefetchCache.current.get(key)

        if (cached) {
          // ── 캐시 히트: 즉시 blit ──────────────────────────────────────────
          console.log(`[PdfCache] 캐시 히트 page=${currentPage}`)
          const dpr = window.devicePixelRatio || 1
          canvas.width = cached.width
          canvas.height = cached.height
          canvas.style.width = `${cached.width / dpr}px`
          canvas.style.height = `${cached.height / dpr}px`
          ctx.drawImage(cached, 0, 0)
          useViewerStore.getState().setLastRenderedPage(currentPage)
          // 캐시 히트여도 다음 페이지 프리페치 시작
          schedulePrefetch(pdfDoc, currentPage, zoomLevel, rotation, containerHeight)
        } else {
          // ── 캐시 미스: progressive DPR 렌더 ─────────────────────────────
          console.log(`[PdfCache] 캐시 미스 page=${currentPage} — 직접 렌더`)
          const page = await pdfDoc.getPage(currentPage)
          if (cancelled) return

          const viewport = page.getViewport({ scale: zoomLevel, rotation })

          // Fit page height to container height (vertical fit)
          const scale = containerHeight / viewport.height
          const scaledViewport = page.getViewport({
            scale: zoomLevel * scale,
            rotation,
          })

          const dpr = window.devicePixelRatio || 1

          // ── Phase 1: DPR=1 (빠른 선표시) ──────────────────────────────────
          // canvas 크기를 CSS 픽셀과 1:1로 설정 → 렌더 픽셀 수 = 1/dpr²
          canvas.width = Math.round(scaledViewport.width)
          canvas.height = Math.round(scaledViewport.height)
          canvas.style.width = `${scaledViewport.width}px`
          canvas.style.height = `${scaledViewport.height}px`
          ctx.resetTransform()

          const rt1 = page.render({ canvasContext: ctx, viewport: scaledViewport })
          renderTaskRef.current = rt1
          await rt1.promise
          renderTaskRef.current = null
          if (cancelled) return

          // Phase 1 완료 → 스피너 해제 + LCP 썸네일 숨김 (동시에 처리해 빈 프레임 없음)
          useViewerStore.getState().setLoading(false)
          useViewerStore.getState().setLastRenderedPage(currentPage)
          setShowThumbnail(false)
          onPageChange?.(currentPage)

          // Update PDF bounds in gazeStore
          const rect = canvas.getBoundingClientRect()
          useGazeStore.getState().setPdfBounds({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          })

          // ── Phase 2: 실제 DPR (백그라운드 업그레이드) ─────────────────────
          // DPR=1 기기는 이미 최고 품질이므로 스킵
          if (dpr > 1) {
            const offscreen = new OffscreenCanvas(
              Math.round(scaledViewport.width * dpr),
              Math.round(scaledViewport.height * dpr),
            )
            const offCtx = offscreen.getContext('2d')!
            offCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

            const rt2 = page.render({
              canvasContext: offCtx as unknown as CanvasRenderingContext2D,
              viewport: scaledViewport,
            })
            renderTaskRef.current = rt2
            await rt2.promise
            renderTaskRef.current = null
            if (cancelled) return

            const bitmap = await createImageBitmap(offscreen)
            if (cancelled) { bitmap.close(); return }

            // Phase 2 완료 → 고해상도로 교체
            canvas.width = bitmap.width
            canvas.height = bitmap.height
            canvas.style.width = `${scaledViewport.width}px`
            canvas.style.height = `${scaledViewport.height}px`
            ctx.resetTransform()
            ctx.drawImage(bitmap, 0, 0)

            // prefetchCache에 저장 → 같은 페이지 재방문 시 즉시 blit
            prefetchCache.current.set(key, bitmap)
          }

          schedulePrefetch(pdfDoc, currentPage, zoomLevel, rotation, containerHeight)
        }
      } catch (err: unknown) {
        if (
          err &&
          typeof err === 'object' &&
          'name' in err &&
          (err.name === 'HeadingCancelledException' ||
            err.name === 'RenderingCancelledException')
        ) {
          // 정상 취소 — 로그 불필요
        } else {
          console.error('[PdfViewerPage] 렌더 실패:', err)
        }
      } finally {
        useViewerStore.getState().setRendering(false)
        renderTaskRef.current = null
      }
    }

    // 첫 로드(pdfDoc 새로 설정 직후)는 즉시 렌더, 이후 zoom/rotation/resize는 50ms debounce
    const delay = isFirstRenderRef.current ? 0 : 50
    isFirstRenderRef.current = false
    const timer = setTimeout(() => {
      renderPage()
    }, delay)

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel() } catch { /* ignore */ }
      }
    }
  }, [pdfDoc, currentPage, zoomLevel, rotation, resizeTrigger])

  // ── 프리페치 스케줄러 ─────────────────────────────────────────────────────
  /**
   * 현재 페이지 주변(다음, 다음+1, 이전) 페이지를 백그라운드에서 순차적으로 프리페치한다.
   * 이미 캐시되었거나 진행 중인 페이지는 건너뛰며, 메인 렌더를 방해하지 않도록
   * 페이지마다 지연 시간을 두고 setTimeout으로 실행한다.
   *
   * @param pdf 로드된 PDF 문서 프록시
   * @param page 기준이 되는 현재 페이지 번호
   * @param zoom 줌 레벨
   * @param rot 회전 각도
   * @param containerH 뷰어 컨테이너 높이(px)
   */
  function schedulePrefetch(
    pdf: pdfjsLib.PDFDocumentProxy,
    page: number,
    zoom: number,
    rot: number,
    containerH: number,
  ) {
    const total = useViewerStore.getState().totalPages
    // 다음 페이지, 그 다음 페이지, 이전 페이지 순으로 프리페치
    const candidates = [page + 1, page + 2, page - 1].filter((p) => p >= 1 && p <= total)

    for (const p of candidates) {
      const key = cacheKey(p, zoom, rot, containerH)
      if (prefetchCache.current.has(key)) continue
      if (prefetchingRef.current.has(key)) continue

      prefetchingRef.current.add(key)

      // 메인 렌더를 방해하지 않도록 requestIdleCallback / setTimeout으로 지연
      const delay = candidates.indexOf(p) * 200  // 0ms, 200ms, 400ms 순차 실행

      setTimeout(async () => {
        if (!prefetchCache.current || prefetchCache.current.has(key)) return
        try {
          console.log(`[PdfCache] 🔄 프리페치 시작 page=${p}`)
          const bitmap = await renderPageToOffscreen(pdf, p, zoom, rot, containerH)
          // 렌더 중 캐시가 무효화됐으면 버림
          if (prefetchingRef.current.has(key)) {
            prefetchCache.current.set(key, bitmap)
            console.log(`[PdfCache] 💾 프리페치 완료 page=${p}`)
          } else {
            bitmap.close()
          }
        } catch (err) {
          console.warn(`[PdfCache] 프리페치 실패 page=${p}:`, err)
        } finally {
          prefetchingRef.current.delete(key)
        }
      }, delay)
    }
  }

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      setResizeTrigger((prev) => prev + 1)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  // Cleanup PDF bounds on unmount
  // unmount 정리: doc을 세션 캐시에 보존하고 bitmap 해제
  useEffect(() => {
    return () => {
      const docName = useViewerStore.getState().documentName
      if (activePdfDocRef.current && docName) {
        // doc을 캐시에 저장 → 다음 방문 시 preloadFromBuffer가 재파싱 없이 사용
        setDocCache(docName, activePdfDocRef.current)
      }
      useGazeStore.getState().setPdfBounds(null)
      clearCache()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="pdf-viewer-page-container"
    >
      {/* 로딩/렌더 중 오버레이 — Phase 1 완료까지 canvas(기본 300×150)가 노출되지 않도록 차단.
          thumbnail 있으면 미리보기 이미지, 없으면 배경색만 표시 (둘 다 z-index:1로 canvas 위). */}
      {showThumbnail && (
        <div className="pdf-lcp-thumbnail">
          {thumbnail && <img src={thumbnail} alt="" aria-hidden="true" fetchPriority="high" />}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="pdf-viewer-page-canvas"
      />
    </div>
  )
}

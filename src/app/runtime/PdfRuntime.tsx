// src/app/runtime/PdfRuntime.tsx
//
// PDF 로딩 런타임 — HomeLayout에서 분리된 모든 PDF 로드 로직 담당
//
// 역할:
//   HomeLayout: setPendingFile(name) → documentUrl도 null로 초기화 → navigate('viewer')
//   PdfRuntime: pendingFileName 감지 → doc 파싱 → pdfPreloadManager.store (bitmap 백그라운드)
//              → setDocument(name, freshUrl) → PdfViewerPage가 bitmapPromise await
//
// 로딩 오버레이 흐름:
//   PdfRuntime: setLoading(true) → doc 파싱 (blocking) → setDocument
//   PdfViewerPage: setLoading(true) 유지 → bitmap await → 렌더 → setLoading(false)
//   ※ 성공 시 PdfRuntime은 setLoading(false)를 호출하지 않는다.
//     오버레이가 PdfViewerPage 렌더 완료까지 끊김 없이 유지됨.
//
// StrictMode 대응:
//   loadingNameRef — 같은 이름의 두 번째 effect 호출을 차단.
//   cleanup에서 null로 초기화하지 않으므로 StrictMode 재실행이 no-op이 된다.
//
// cycle 간 stale URL 문제 방지:
//   setPendingFile이 documentUrl을 null로 초기화하므로
//   PdfViewerPage는 이전 cycle의 URL로 로딩 시작하지 않음.

import { useEffect, useRef } from 'react'
import { useViewerStore } from '@/presentation/store/viewerStore'
import { useAppRouter } from '@/app/router/useAppRouter'
import { loadFile, storeFile } from '@/shared/utils/pdfFileStore'
import { preloadFromBuffer } from '@/shared/utils/pdfPreloadManager'

// ── 최적화 ────────────────────────────────────────────────────────────────────
// 이전: 6개 구독 (pendingFileName, currentPage, setDocument, setPendingFile, setLoading, navigate)
// 현재: pendingFileName 1개 구독만 유지.
//   currentPage / actions → effect 내부에서 getState() 직접 읽기.

/**
 * 대기 중인 PDF 파일명(pendingFileName)을 감지해 실제 문서 로딩을 수행하는
 * 렌더 없는 런타임 컴포넌트. 캐시/IndexedDB에서 파일을 읽어 blob URL을 생성하고,
 * 백그라운드 비트맵 프리로드를 시작한 뒤 documentUrl을 스토어에 반영한다.
 * @returns null (UI를 렌더링하지 않음)
 */
export function PdfRuntime() {
  // pendingFileName만 구독 — 이 값이 변할 때만 effect 재실행 필요
  const pendingFileName = useViewerStore((s) => s.pendingFileName)

  // StrictMode 이중 실행 방지: cleanup에서 초기화하지 않음
  const loadingNameRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pendingFileName) return
    if (loadingNameRef.current === pendingFileName) return  // StrictMode guard
    loadingNameRef.current = pendingFileName

    const name = pendingFileName
    // currentPage는 effect 실행 시점의 스냅샷 — getState()로 읽어 구독 불필요
    const page = useViewerStore.getState().currentPage

    const load = async () => {
      useViewerStore.getState().setLoading(true)
      try {
        // 1. 세션 캐시 또는 IndexedDB에서 파일 읽기
        const buffer = await loadFile(name)
        if (!buffer) {
          console.warn('[PdfRuntime] 파일을 찾을 수 없음, 홈으로:', name)
          useViewerStore.getState().setPendingFile(null)
          useViewerStore.getState().setLoading(false)
          useAppRouter.getState().navigate('home')
          return
        }

        // 2. 세션 캐시 갱신 (IndexedDB에서 읽어온 경우)
        storeFile(name, buffer)

        // 3. 신선한 blob URL 생성
        const freshUrl = URL.createObjectURL(
          new Blob([buffer], { type: 'application/pdf' }),
        )

        // 4. doc 파싱 선점 시작 (fire-and-forget)
        //    await 제거: getDocument()(1~3s)를 기다리지 않고 즉시 setDocument 진행.
        //    PdfViewerPage는 consume() → preloadFromBuffer(Promise dedup)로 동일 Promise 공유.
        //    → getDocument()는 1회만 실행, 중복 파싱 없음.
        preloadFromBuffer(name, buffer, page).catch(() => {})

        // 5. documentUrl 설정 → PdfViewerPage 즉시 시작 (preload 완료 전에 시작 가능)
        //    ※ setLoading(false) 호출 안 함 — PdfViewerPage의 finally가 처리
        useViewerStore.getState().setDocument(name, freshUrl)
        useViewerStore.getState().setPendingFile(null)

      } catch (err) {
        console.error('[PdfRuntime] 로드 실패:', err)
        useViewerStore.getState().setPendingFile(null)
        useViewerStore.getState().setLoading(false)   // 에러 시에만 여기서 해제
        useAppRouter.getState().navigate('home')
      }
      // ※ finally { setLoading(false) } 없음 — 성공 경로는 PdfViewerPage가 처리
    }

    load()
    // ※ cleanup에서 loadingNameRef를 null로 초기화하지 않는다.
  }, [pendingFileName])

  return null
}

export default PdfRuntime

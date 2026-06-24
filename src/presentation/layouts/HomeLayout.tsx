// src/presentation/layouts/HomeLayout.tsx
// 메인 홈 화면 — 최근 악보 목록, 불러오기, 연주 시작
//
// PDF 로딩 로직은 PdfRuntime이 담당.
// HomeLayout 역할:
//   - 파일 선택 UI
//   - 신규 파일 → buffer 저장 + setPendingFile → 즉시 navigate
//              → 썸네일/doc 캐시는 백그라운드에서 fire-and-forget
//   - 최근 파일 탭 → setPendingFile → navigate
//   - mount 시 IndexedDB에서 복원 불가한 stale 항목 제거
//
// ── 최적화 ──────────────────────────────────────────────────────────────────
//  handleFileChange: await generatePdfThumbnailWithDoc 대기 → navigate 블로킹
//    → 썸네일/doc 캐시를 fire-and-forget으로 전환, 즉시 navigate
//  action 구독 6개 (navigate/onSettingsClick/addFile/removeFile/setPage/setPendingFile)
//    → 모두 getState() 직접 접근으로 대체 (stable ref, 구독 불필요)
//    → files 단일 구독만 유지
//
// Worker 분석:
//   generatePdfThumbnailWithDoc: PDF.js는 이미 worker 사용.
//   Canvas 렌더는 OffscreenCanvas Worker 가능하나 navigate 분리로 블로킹 이미 해소.
//   Worker 이전 불필요.

import { useRef, useEffect, useCallback } from 'react'
import { useAppRouter } from '@/app/router/useAppRouter'
import { useRecentFilesStore } from '@/presentation/store/recentFilesStore'
import { useViewerStore } from '@/presentation/store/viewerStore'
import { usePerformanceStore } from '@/presentation/store/performanceStore'
import { PerformanceSetupOverlay } from '@/presentation/components/performance/PerformanceSetupOverlay'
import { AdBanner } from '@/presentation/components/ads/AdBanner'
import { storeFile, saveFilePersistent, fileExists, loadFile } from '@/shared/utils/pdfFileStore'
import { setDocCache } from '@/shared/utils/pdfDocSessionCache'
// pdfThumbnail은 handleFileChange 내부에서 동적 import:
//   - pdfThumbnail → pdfjs-dist(vendor-pdfjs, 수 MB)를 정적으로 import하면
//     HomeLayout 청크 로드 시 vendor-pdfjs도 함께 다운로드됨
//   - 동적 import로 전환 → 파일을 실제로 선택한 시점에만 다운로드

/**
 * ISO 날짜 문자열을 "오늘"/"어제"/"N일 전"/날짜 형태의 한국어 상대 표시 문자열로 변환한다.
 * @param iso ISO 8601 형식의 날짜 문자열
 * @returns 사람이 읽기 쉬운 한국어 상대 날짜 문자열
 */
function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return '오늘'
  if (days === 1) return '어제'
  if (days < 7) return `${days}일 전`
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

/**
 * 앱의 메인 홈 화면. 최근에 연 악보 목록을 표시하고, 새 파일 불러오기와
 * 연주 시작(설정 오버레이 경유)을 처리한다.
 * 실제 PDF 로딩/디코딩은 PdfRuntime이 담당하며, 이 컴포넌트는 파일 선택
 * UI 제공, 신규 파일을 IndexedDB에 저장 후 즉시 navigate(썸네일/문서
 * 캐시는 fire-and-forget으로 백그라운드 처리), 최근 파일 클릭 시 이어서
 * 열기, 마운트 시 복원 불가능한 stale 항목 정리를 수행한다.
 *
 * @returns 최근 파일 목록, 파일 불러오기 버튼, 연주 설정 오버레이를 포함한 레이아웃
 */
export function HomeLayout() {
  // ── state 구독 (files만) ────────────────────────────────────────────────────
  const files = useRecentFilesStore((s) => s.files)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── mount 시 복원 불가 항목 제거 ────────────────────────────────────────────
  // IndexedDB에 데이터가 없는 파일은 목록에서 제거.
  // 첫 페인트 이후로 지연(500ms)해 LCP에 영향을 주지 않도록 함.
  useEffect(() => {
    if (files.length === 0) return
    let cancelled = false

    const timer = setTimeout(async () => {
      for (const file of [...files]) {
        if (cancelled) return
        const exists = await fileExists(file.name).catch(() => false)
        if (!exists) {
          console.warn('[HomeLayout] 복원 불가 파일 제거:', file.name)
          useRecentFilesStore.getState().removeFile(file.name)
        }
      }
    }, 500)

    return () => { clearTimeout(timer); cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 최근 파일 백그라운드 프리로드 ──────────────────────────────────────────
  // 홈 화면에서 대기하는 동안 최근 파일[0]의 PDF doc을 선점 파싱.
  // 사용자가 "열기" 클릭 시 PdfRuntime이 getDocCache 히트 → getDocument() 스킵 → 즉시 렌더.
  //
  // pdfPreloadManager은 pdfjs-dist를 포함하므로 동적 import:
  //   → HomeLayout 청크 로드 시 pdfjs 다운로드 방지
  //   → 프리로드 시작 시점에 pdfjs 다운로드 (_preloadViewer와 병렬 실행)
  useEffect(() => {
    const mostRecent = useRecentFilesStore.getState().files[0]
    if (!mostRecent) return

    let cancelled = false
    let idleHandle: ReturnType<typeof requestIdleCallback> | undefined

    const run = async () => {
      if (cancelled) return
      try {
        const buf = await loadFile(mostRecent.name)
        if (!buf || cancelled) return
        const { preloadFromBuffer } = await import('@/shared/utils/pdfPreloadManager')
        if (cancelled) return
        await preloadFromBuffer(mostRecent.name, buf, mostRecent.lastPage || 1)
        console.log('[HomeLayout] 프리로드 완료:', mostRecent.name)
      } catch {
        // 실패 무시 — PdfRuntime이 폴백 처리
      }
    }

    // requestIdleCallback으로 지연 — LCP paint와 GazeRuntime WASM init 이후 idle time에 실행
    // timeout: 5000ms fallback (idle callback이 너무 늦어지지 않도록)
    if (typeof requestIdleCallback !== 'undefined') {
      idleHandle = requestIdleCallback(() => { void run() }, { timeout: 5000 })
    } else {
      const t = setTimeout(() => { void run() }, 2000)
      return () => { cancelled = true; clearTimeout(t) }
    }

    return () => {
      cancelled = true
      if (idleHandle != null) cancelIdleCallback(idleHandle)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 신규 파일 선택 ──────────────────────────────────────────────────────────
  // buffer 저장 후 즉시 navigate — 썸네일/doc 캐시는 백그라운드 fire-and-forget.
  // 기존: await generatePdfThumbnailWithDoc → navigate (1~2초 블로킹)
  // 현재: navigate 즉시 → 썸네일은 뷰어 뒤에서 생성
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // buffer 읽기 (메모리 파일 → 빠름)
    const buf = await file.arrayBuffer()

    // 세션 캐시 즉시 저장 (PdfRuntime이 이 경로로 읽음)
    storeFile(file.name, buf)

    // IndexedDB 저장 — fire & forget
    saveFilePersistent(file.name, buf)
      .catch((err) => console.warn('[HomeLayout] 파일 영구 저장 실패:', err))

    // getDocument() 선점 시작 — navigate보다 먼저 doc 파싱 킥오프
    // PdfRuntime이 pendingFileName을 처리할 때 getDocCache 히트 → getDocument() 스킵
    import('@/shared/utils/pdfPreloadManager')
      .then(({ preloadFromBuffer }) => preloadFromBuffer(file.name, buf, 1))
      .catch(() => {})

    // 썸네일 + doc 캐시 — fire & forget (navigate 블로킹 제거)
    // pdfThumbnail은 여기서 동적 import:
    //   정적 import → HomeLayout 청크 로드 시 vendor-pdfjs(수 MB)도 함께 다운로드
    //   동적 import → 파일을 실제로 선택한 시점에만 vendor-pdfjs 다운로드
    const tempUrl = URL.createObjectURL(file)
    import('@/shared/utils/pdfThumbnail')
      .then(({ generatePdfThumbnailWithDoc }) => generatePdfThumbnailWithDoc(tempUrl))
      .then(({ thumbnail: thumb, doc }) => {
        URL.revokeObjectURL(tempUrl)
        setDocCache(file.name, doc)
        useRecentFilesStore.getState().updateFileThumbnail(file.name, thumb)
      })
      .catch((err) => {
        URL.revokeObjectURL(tempUrl)
        console.error('[HomeLayout] 썸네일 생성 실패:', err)
      })

    // setLoading(true) 먼저: GazeRuntime 즉시 정지 → CPU 확보
    useViewerStore.getState().setLoading(true)

    // 즉시 네비게이션 — actions는 getState()로 직접 접근
    useRecentFilesStore.getState().addFile({
      name: file.name,
      url: '',
      totalPages: 0,
      lastPage: 1,
    })
    useViewerStore.getState().setPage(1)
    useViewerStore.getState().setPendingFile(file.name)
    useAppRouter.getState().navigate('viewer')

    e.target.value = ''
  }, [])

  // ── 최근 파일 열기 ──────────────────────────────────────────────────────────
  // URL 복원/blob 생성은 PdfRuntime이 담당 → 여기서는 파일명만 전달
  const openRecentFile = useCallback((name: string, lastPage: number) => {
    // setLoading(true) 먼저: GazeRuntime 구독이 즉시 발동 → face tracking 정지
    // → UserViewerLayout 청크 다운로드 + PDF 파싱 동안 CPU 독점 보장
    useViewerStore.getState().setLoading(true)

    // preload 선점: navigate보다 먼저 getDocument() 킥오프
    // (Promise dedup으로 PdfRuntime이 동일 Promise 재사용)
    import('@/shared/utils/pdfFileStore')
      .then(({ loadFile }) => loadFile(name))
      .then((buf) => {
        if (!buf) return
        return import('@/shared/utils/pdfPreloadManager')
          .then(({ preloadFromBuffer }) => preloadFromBuffer(name, buf, lastPage || 1))
      })
      .catch(() => {})

    useViewerStore.getState().setPage(lastPage || 1)
    useViewerStore.getState().setPendingFile(name)
    useAppRouter.getState().navigate('viewer')
  }, [])

  const handleDeleteFile = useCallback((name: string) => {
    useRecentFilesStore.getState().removeFile(name)
  }, [])

  const handleSettingsClick = useCallback(() => {
    useAppRouter.getState().onSettingsClick()
  }, [])

  // ── 연주 시작 ────────────────────────────────────────────────────────────
  // 기존: 버튼 클릭 즉시 파일을 열고 뷰어로 navigate.
  // 현재: 먼저 메트로놈/딜레이 설정 오버레이를 띄우고, 설정 확정 시에만
  //       기존 파일 열기 로직(openRecentFile/파일 선택)을 실행한다.
  const handlePlayScoreClick = useCallback(() => {
    usePerformanceStore.getState().openSetup()
  }, [])

  const handlePerformanceSetupConfirmed = useCallback(() => {
    if (files.length > 0) {
      openRecentFile(files[0].name, files[0].lastPage)
    } else {
      fileInputRef.current?.click()
    }
  }, [files, openRecentFile])

  const hasFiles = files.length > 0

  return (
    <div className="mobile-shell">
      {/* ── 상단 바 ── */}
      <header className="mobile-topbar">
        <div className="mobile-topbar__logo">EyeScore</div>
        <button
          id="home-settings-btn"
          className="mobile-topbar__icon-btn"
          onClick={handleSettingsClick}
          aria-label="설정 (3번 클릭 시 디버그 모드)"
          title="설정"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      {/* ── 스크롤 영역 ── */}
      <main className="mobile-scroll-area">
        <p className="mobile-section-title">최근 악보</p>

        {hasFiles ? (
          files.map((file) => (
            <div key={file.name} className="recent-card">
              {/* 클릭 영역 — 삭제 버튼과 분리 */}
              <div
                className="recent-card__clickable"
                onClick={() => openRecentFile(file.name, file.lastPage)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openRecentFile(file.name, file.lastPage)
                }}
              >
                {/* 썸네일 */}
                <div className="recent-card__thumb">
                  {file.thumbnail ? (
                    <img
                      src={file.thumbnail}
                      alt=""
                      className="recent-card__thumb-img"
                    />
                  ) : (
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  )}
                </div>

                {/* 정보 */}
                <div className="recent-card__info">
                  <span className="recent-card__name">{file.name}</span>
                  <span className="recent-card__meta">
                    {formatDate(file.openedAt)}
                  </span>
                  {file.lastPage > 1 && (
                    <span className="recent-card__page-badge">
                      p.{file.lastPage} 이어보기
                    </span>
                  )}
                </div>
              </div>

              {/* 삭제 버튼 — 클릭 영역 바깥, 이벤트 버블링 없음 */}
              <button
                className="recent-card__delete-btn"
                onClick={() => handleDeleteFile(file.name)}
                aria-label={`${file.name} 삭제`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))
        ) : (
          <div className="recent-empty">
            <span className="recent-empty__icon">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <p className="recent-empty__text">
              아직 열람한 악보가 없습니다.
              <br />
              아래 버튼으로 악보를 불러오세요.
            </p>
          </div>
        )}
      </main>

      {/* ── 하단 버튼 ── */}
      <footer className="home-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
          id="pdf-file-input"
        />

        <button
          id="load-score-btn"
          className="btn-secondary"
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="home-icon-load"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          악보 불러오기
        </button>

        <button
          id="play-score-btn"
          className="btn-primary"
          onClick={handlePlayScoreClick}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="home-icon-play"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          연주 시작
        </button>

        {/* 연주 시작 버튼 아래 광고 배너 */}
        <AdBanner />
      </footer>

      <PerformanceSetupOverlay onConfirm={handlePerformanceSetupConfirmed} />
    </div>
  )
}

// src/shared/utils/pdfPreloadManager.ts
//
// PDF 첫 페이지 프리로드 싱글톤
//
// 사용 흐름 A — 신규 업로드:
//   HomeLayout.handleFileChange:
//     preloadFromBuffer(name, buf, page) — fire-and-forget → doc 파싱만 진행
//     navigate('viewer') 즉시
//   PdfRuntime: pendingFileName 감지 → preloadFromBuffer → setDocument
//   PdfViewerPage.loadPdf:
//     consume(documentUrl, docName) → doc 재사용 → 즉시 렌더 시작
//
// 사용 흐름 B — 최근 파일 열기 (HomeLayout mount 프리로드):
//   HomeLayout useEffect (mount):
//     preloadFromBuffer(files[0].name, buf, lastPage) — fire-and-forget
//     → doc 파싱을 홈 화면 대기 중에 선점
//   openRecentFile → navigate('viewer')
//   PdfRuntime: preloadFromBuffer → getDocCache 히트 → 즉시 완료
//   PdfViewerPage: consume() → doc 즉시 → 첫 렌더 시작
//
// ── bitmap 렌더 제거 (Task #54) ───────────────────────────────────────────────
//  이전: pdfPreloadManager.store()에서 window.innerHeight 기준 bitmap을 미리 렌더
//         → PdfViewerPage는 containerRef.clientHeight 기준 cacheKey를 사용해
//            항상 캐시 미스 → bitmap이 CPU를 소모하고 결과는 버려짐
//  현재: store()는 doc만 저장. bitmap 렌더는 PdfViewerPage가 직접 담당.
//         PdfViewerPage는 DPR=1 빠른 선렌더 후 DPR 풀 업그레이드 (Task #55).

import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker?url'
import { getDocCache, setDocCache } from './pdfDocSessionCache'
import { CMAP_URL } from './pdfConstants'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

// ── 엔트리 타입 ───────────────────────────────────────────────────────────────
/**
 * pdfPreloadManager 싱글톤이 보관하는 프리로드 항목.
 * name 또는 url 중 하나라도 일치하면 consume()에서 재사용된다.
 */
export interface PdfPreloadEntry {
  /** 파일 이름 (name 기반 매칭 키) */
  name: string
  /** blob URL (url 기반 매칭 키, 빈 문자열이면 name 매칭만 사용) */
  url: string
  startPage: number
  doc: pdfjsLib.PDFDocumentProxy
}

// ── 싱글톤 ──────────────────────────────────────────────────────────────────
let _entry: PdfPreloadEntry | null = null

/**
 * 단일 PDF 프리로드 엔트리를 보관하는 모듈 싱글톤.
 * HomeLayout 등에서 미리 파싱해둔 PDFDocumentProxy를 PdfViewerPage가
 * 즉시 재사용할 수 있도록 store()/consume() 형태로 1회성 전달한다.
 */
export const pdfPreloadManager = {
  /**
   * 이미 로드된 PDFDocumentProxy를 저장한다.
   * bitmap 렌더는 하지 않는다 — PdfViewerPage가 자체 렌더 파이프라인으로 직접 담당.
   *
   * @param name  파일 이름 (recentFilesStore의 name, consume 매칭 키)
   * @param url   blob URL (없으면 '', consume에서 name으로만 매칭)
   * @param page  뷰어 진입 시 보여줄 페이지
   * @param doc   이미 로드된 PDFDocumentProxy
   * @returns 없음
   */
  store(name: string, url: string, page: number, doc: pdfjsLib.PDFDocumentProxy): void {
    _entry = { name, url, startPage: page, doc }
  },

  /**
   * URL 또는 파일명이 일치하는 엔트리를 꺼낸다.
   * 일치하지 않으면 null → PdfViewerPage는 loadFile() 폴백 사용.
   *
   * @param url   현재 documentUrl
   * @param name  viewerStore의 documentName (없으면 undefined)
   * @returns 일치하는 엔트리 또는 null
   */
  consume(url: string, name?: string): PdfPreloadEntry | null {
    if (!_entry) return null
    const urlMatch = _entry.url !== '' && _entry.url === url
    const nameMatch = name != null && _entry.name === name
    if (!urlMatch && !nameMatch) return null
    const consumed = _entry
    _entry = null
    return consumed
  },

  /** 현재 보관 중인 엔트리의 파일 이름 (없으면 null). */
  get currentName(): string | null {
    return _entry?.name ?? null
  },
}

// ── getDocument Promise deduplication ────────────────────────────────────────
// 같은 파일에 대해 동시에 여러 곳(HomeLayout mount preload, handleFileChange 선점,
// PdfRuntime)에서 preloadFromBuffer를 호출할 때 getDocument()가 중복 실행되는
// 경쟁 조건 방지. 진행 중인 Promise를 캐싱해 동일 파일은 1회만 파싱.
const _loadingDocs = new Map<string, Promise<pdfjsLib.PDFDocumentProxy>>()

/**
 * ArrayBuffer에서 PDF doc을 로드해 pdfPreloadManager에 저장.
 * bitmap 렌더 없이 getDocument() 완료 즉시 반환.
 *
 * await하면: getDocument() 완료 시점에 반환.
 * → PdfRuntime이 doc 준비 즉시 setDocument 호출 가능.
 * → 동시에 여러 곳에서 호출해도 getDocument()는 1회만 실행 (Promise dedup).
 *
 * @param name PDF 파일 이름 (캐시/매칭 키)
 * @param buffer PDF 파일의 ArrayBuffer
 * @param page 뷰어 진입 시 보여줄 페이지 번호
 * @returns 없음 (완료 시 pdfPreloadManager에 저장됨)
 */
export async function preloadFromBuffer(
  name: string,
  buffer: ArrayBuffer,
  page: number,
): Promise<void> {
  // 1. doc 캐시 히트 → 즉시 재사용
  let doc = getDocCache(name)
  if (!doc) {
    // 2. 이미 파싱 진행 중 → 동일 Promise 재사용 (dedup)
    if (!_loadingDocs.has(name)) {
      const p = pdfjsLib.getDocument({
        data: buffer.slice(0),
        cMapUrl: CMAP_URL,
        cMapPacked: true,
      }).promise.then((d) => {
        setDocCache(name, d)
        _loadingDocs.delete(name)
        return d
      }).catch((err) => {
        _loadingDocs.delete(name)
        throw err
      })
      _loadingDocs.set(name, p)
    }
    doc = await _loadingDocs.get(name)!
  }
  pdfPreloadManager.store(name, '', page, doc)
}

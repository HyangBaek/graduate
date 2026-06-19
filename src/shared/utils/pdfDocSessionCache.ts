// src/shared/utils/pdfDocSessionCache.ts
//
// PDFDocumentProxy 세션 캐시
//
// 목적:
//   PdfViewerPage가 unmount될 때 파싱 완료된 PDFDocumentProxy를 보존한다.
//   다음 방문 시 getDocument() 재파싱(1~2초) 없이 즉시 doc을 재사용한다.
//
// 사용 흐름:
//   PdfViewerPage unmount:
//     setDocCache(documentName, activePdfDocRef.current)
//
//   PdfViewerPage loadPdf (폴백 경로):
//     const doc = getDocCache(name)
//     if (doc) pdf = doc            // 즉시
//     else pdf = await getDocument(...)  // 첫 방문만 느림
//
//   pdfPreloadManager.preloadFromBuffer:
//     const doc = getDocCache(name) ?? await getDocument(...)
//     pdfPreloadManager.store(name, '', page, doc)

// 타입만 사용 — 런타임 번들에서 pdfjs-dist 제외 (import type)
import type * as pdfjsLib from 'pdfjs-dist'

const _cache = new Map<string, pdfjsLib.PDFDocumentProxy>()

/**
 * PDFDocumentProxy를 이름 기준으로 저장한다.
 * 이미 저장된 항목이 있으면 덮어쓴다.
 *
 * @param name 캐시 키로 사용할 문서 이름
 * @param doc 저장할 PDFDocumentProxy 인스턴스
 */
export function setDocCache(name: string, doc: pdfjsLib.PDFDocumentProxy): void {
  _cache.set(name, doc)
}

/**
 * 이름에 대응하는 PDFDocumentProxy를 반환한다.
 * 없으면 null.
 *
 * @param name 조회할 문서 이름
 * @returns 캐시된 PDFDocumentProxy 또는 null
 */
export function getDocCache(name: string): pdfjsLib.PDFDocumentProxy | null {
  return _cache.get(name) ?? null
}

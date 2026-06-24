// src/shared/utils/pdfThumbnail.ts
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker?url'
import { CMAP_URL } from './pdfConstants'

// Ensure worker is configured
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
}

/**
 * 이미 로드된 PDFDocumentProxy에서 썸네일을 생성한다.
 * doc은 destroy()하지 않으므로 caller가 재사용할 수 있다.
 *
 * @param doc 썸네일을 생성할 PDFDocumentProxy
 * @param targetWidth 썸네일 목표 너비(px), 기본 120
 * @returns base64 JPEG data URL
 * @throws Canvas 2D context를 얻지 못하면 에러
 */
async function generateThumbnailFromDoc(
  doc: pdfjsLib.PDFDocumentProxy,
  targetWidth = 120,
): Promise<string> {
  const page = await doc.getPage(1)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context not available')

  const unscaledViewport = page.getViewport({ scale: 1.0 })
  const scale = targetWidth / unscaledViewport.width
  const viewport = page.getViewport({ scale })

  canvas.width = viewport.width
  canvas.height = viewport.height

  await page.render({ canvasContext: ctx, viewport }).promise

  // 용량 최소화: JPEG 0.6
  return canvas.toDataURL('image/jpeg', 0.6)
}

/**
 * PDF를 로드하고 첫 페이지 썸네일(base64 JPEG)과
 * PDFDocumentProxy를 함께 반환한다.
 *
 * doc을 반환하므로 caller(HomeLayout)는 이를 pdfPreloadManager.store()에
 * 전달해 PdfViewerPage가 재사용하도록 한다.
 * getDocument()는 이 함수 내에서 1회만 호출된다.
 *
 * @param url PDF 파일의 URL (blob URL 등)
 * @returns 썸네일 data URL과 로드된 PDFDocumentProxy
 */
export async function generatePdfThumbnailWithDoc(url: string): Promise<{
  thumbnail: string
  doc: pdfjsLib.PDFDocumentProxy
}> {
  const doc = await pdfjsLib.getDocument({
    url,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
  }).promise

  const thumbnail = await generateThumbnailFromDoc(doc)
  return { thumbnail, doc }
}

/**
 * 기존 API (하위 호환) — thumbnail만 필요한 경우.
 * 내부적으로 generatePdfThumbnailWithDoc을 호출하고
 * doc을 버린다(GC에 맡김).
 *
 * @param url PDF 파일의 URL
 * @returns 썸네일 data URL
 */
export async function generatePdfThumbnail(url: string): Promise<string> {
  const { thumbnail } = await generatePdfThumbnailWithDoc(url)
  return thumbnail
}

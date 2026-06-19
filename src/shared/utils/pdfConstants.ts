// src/shared/utils/pdfConstants.ts
// PDF.js 공통 상수

/**
 * CMap 리소스 URL — 한중일 폰트 지원에 필요.
 * public/cmaps/ 로컬 서빙 (빌드 시 node_modules/pdfjs-dist/cmaps/*.bcmap 복사됨).
 * CDN 대신 로컬 경로 사용 → 네트워크 왕복 제거.
 */
export const CMAP_URL = '/cmaps/'

// src/app/config/debugFlag.ts
// 디버그 모드(설정 3연속 클릭, /debug 계열 경로, 캘리브레이션/커서 분석 화면)는
// 일반 사용자 배포판(GitHub Pages)에는 포함하지 않는다.
//
// import.meta.env.DEV는 Vite가 빌드 시점에 정적으로 치환하는 값이므로
// production 빌드에서는 이 분기가 항상 false로 굳어 데드코드 제거(tree-shaking)
// 대상이 된다. 로컬 `npm run dev`에서는 그대로 true.
import type { AppPage } from '@app/router/useAppRouter'

export const DEBUG_ENABLED = import.meta.env.DEV

export const DEBUG_PAGES: readonly AppPage[] = ['debug', 'calibration-analysis', 'cursor-analysis']

export function isDebugPage(page: AppPage): boolean {
  return DEBUG_PAGES.includes(page)
}

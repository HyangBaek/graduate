// src/app/routes/AppRoutes.tsx
// 애플리케이션 라우팅 테이블.
// 상태 기반 라우터를 사용하여 홈/뷰어/설정/디버그 페이지를 전환합니다.

import { AppRouter } from '@/app/router/AppRouter'

/**
 * 애플리케이션의 라우팅 진입점 컴포넌트.
 * 실제 라우팅 로직은 AppRouter에 위임하고, 이 컴포넌트는 라우팅 테이블 역할만 한다.
 * @returns AppRouter 렌더 결과
 */
export function AppRoutes() {
  return <AppRouter />
}

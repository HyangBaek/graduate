// src/app/AppShell.tsx

import { AppRoutes } from '@/app/routes/AppRoutes'

/**
 * 애플리케이션 라우팅 영역을 감싸는 최상위 쉘 컴포넌트.
 * 현재는 AppRoutes를 그대로 렌더링하는 래퍼 역할을 한다.
 * @returns AppRoutes 렌더 결과
 */
export default function AppShell() {
  return <AppRoutes />
}

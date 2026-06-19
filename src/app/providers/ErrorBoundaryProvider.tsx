// src/app/providers/ErrorBoundaryProvider.tsx

import type { PropsWithChildren } from 'react'

/**
 * 에러 바운더리 적용 지점을 위한 Provider 컴포넌트.
 * 현재는 별도 처리 없이 children을 그대로 통과시키는 자리표시자(placeholder)이다.
 * @param props.children 렌더링할 하위 트리
 * @returns children을 감싼 Fragment
 */
function ErrorBoundaryProvider({ children }: PropsWithChildren) {
  return <>{children}</>
}

export default ErrorBoundaryProvider

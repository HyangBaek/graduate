// src/app/providers/ThemeProvider.tsx

import type { PropsWithChildren } from 'react'

/**
 * 테마(다크/라이트 등) 적용 지점을 위한 Provider 컴포넌트.
 * 현재는 별도 처리 없이 children을 그대로 통과시키는 자리표시자(placeholder)이다.
 * @param props.children 렌더링할 하위 트리
 * @returns children을 감싼 Fragment
 */
function ThemeProvider({ children }: PropsWithChildren) {
  return <>{children}</>
}

export default ThemeProvider

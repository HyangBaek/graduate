// src/app/providers/AppProviders.tsx

import type { PropsWithChildren } from 'react'

import StoreProvider from './StoreProvider'
import ThemeProvider from './ThemeProvider'
import ErrorBoundaryProvider from './ErrorBoundaryProvider'

/**
 * 앱 전역 Provider들을 합성하여 한 번에 적용하는 컴포넌트.
 * ErrorBoundaryProvider → ThemeProvider → StoreProvider 순으로 중첩 래핑한다.
 * @param props.children Provider들로 감쌀 하위 트리
 * @returns 중첩된 Provider 트리로 감싸진 children
 */
export default function AppProviders({ children }: PropsWithChildren) {
  return (
    <ErrorBoundaryProvider>
      <ThemeProvider>
        <StoreProvider>{children}</StoreProvider>
      </ThemeProvider>
    </ErrorBoundaryProvider>
  )
}

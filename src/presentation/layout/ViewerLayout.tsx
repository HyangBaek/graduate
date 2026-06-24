// src/presentation/layout/ViewerLayout.tsx

import type { ReactNode } from 'react';

export function ViewerLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        background: '#111',
      }}
    >
      {children}
    </div>
  )
}

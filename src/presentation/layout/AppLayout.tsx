// src/presentation/layout/AppLayout.tsx

import type { ReactNode } from 'react';

export function AppLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}

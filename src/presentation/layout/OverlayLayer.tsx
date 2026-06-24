// src/presentation/layout/OverlayLayer.tsx

import type { ReactNode } from 'react';

export function OverlayLayer({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {children}
    </div>
  )
}

//

import { useEffect, useRef } from 'react'
import { useGazeStore } from '@/presentation/state/gazeStore'

const DWELL_MS = 800

export const PdfGazeNavigationLayer = () => {
  const filteredGaze = useGazeStore((s) => s.filteredGaze)

  const dwellRef = useRef<number | null>(null)
  const lastTargetRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!filteredGaze) return

    const x = filteredGaze.x
    const y = filteredGaze.y

    const el = document.elementFromPoint(x, y)

    if (!el) {
      dwellRef.current = null
      lastTargetRef.current = null
      return
    }

    const isPdfClickable =
            el.closest('[data-pdf-page]') ||
            el.closest('a') ||
            el.closest('button')

    if (!isPdfClickable) {
      dwellRef.current = null
      lastTargetRef.current = null
      return
    }

    if (lastTargetRef.current !== el) {
      lastTargetRef.current = el
      dwellRef.current = performance.now()
      return
    }

    const now = performance.now()
    const elapsed = now - (dwellRef.current ?? now)

    if (elapsed > DWELL_MS) {
      ;(el as HTMLElement).click()

      dwellRef.current = null
      lastTargetRef.current = null
    }
  }, [filteredGaze])

  return null
}

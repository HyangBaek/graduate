// src/domain/types/NavigationResult.ts

import type { PageNavigationDirection } from '@domain/types/PageNavigationDirection'

/**
 * NavigatePageUseCase의 페이지 전환 시도 결과.
 */
export interface NavigationResult {
  triggered: boolean

  direction: PageNavigationDirection

  targetPage: number

  reason:
    | 'success'
    | 'cooldown'
    | 'invalid_page'
    | 'dwell_not_completed'
    | 'unstable'
}

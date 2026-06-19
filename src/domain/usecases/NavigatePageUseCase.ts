// src/domain/usecases/NavigatePageUseCase.ts

import type { DwellResult } from '@domain/types/DwellResult'
import type { NavigationResult } from '@domain/types/NavigationResult'

/*
 * navigation reason 타입은 반드시 union으로 고정
 */
/**
 * 페이지 전환 시도의 성공/실패 원인을 나타내는 타입.
 */
export type NavigationReason =
  | 'success'
  | 'cooldown'
  | 'invalid_page'
  | 'dwell_not_completed'
  | 'unstable'

/**
 * NavigatePageUseCase 동작을 제어하는 설정.
 */
export interface NavigatePageConfig {
  cooldownMs: number
}

const DEFAULT_CONFIG: NavigatePageConfig = {
  cooldownMs: 1500,
}

type Direction = 'next' | 'previous'

/**
 * dwell 완료, 안정성, 쿨다운 조건을 검사해 페이지 전환(다음/이전)을 실행하는 유스케이스.
 */
export class NavigatePageUseCase {
  private lastNavigationTime = 0
  // private lastDirection: Direction | null = null
  private readonly config: NavigatePageConfig

  constructor(
    config = DEFAULT_CONFIG,
  ) {
    this.config = config
  }

  /*
   * 공통 validation
   *
   * navigationLocked 제거: cooldown만으로 중복 전환 방지.
   * (이전: dwell이 항상 isDwelling=true로 전달되어 locked 해제 조건이
   *  충족되지 않아 첫 전환 후 영구 잠김되는 버그가 있었음 — 필드 자체를 제거)
   */
  /**
   * 페이지 전환 전 공통 검증을 수행한다 (안정성 → dwell 완료 → 쿨다운 순서로 검사).
   * @param dwell 현재 dwell 평가 결과
   * @param isStable 현재 시선 안정성 여부
   * @param timestamp 현재 타임스탬프 (ms)
   * @returns 검증 실패 원인, 모두 통과하면 null
   */
  private validateCommon(
    dwell: DwellResult,
    isStable: boolean,
    timestamp: number,
  ): NavigationReason | null {
    if (!isStable) return 'unstable'

    if (!dwell.completed) {
      return 'dwell_not_completed'
    }

    const elapsed = timestamp - this.lastNavigationTime

    if (elapsed < this.config.cooldownMs) {
      return 'cooldown'
    }

    return null
  }

  /*
   * 실제 navigation 실행
   */
  /**
   * 검증을 통과한 페이지 전환을 실제로 실행한다.
   * @param direction 전환 방향
   * @param currentPage 현재 페이지 번호
   * @param timestamp 전환 실행 시각 (쿨다운 기준 시각으로 기록됨)
   * @returns 전환 성공 결과
   */
  private executeNavigation(
    direction: Direction,
    currentPage: number,
    timestamp: number,
  ): NavigationResult {
    this.lastNavigationTime = timestamp
    // this.lastDirection = direction

    return {
      triggered: true,
      direction,
      targetPage:
        direction === 'next'
          ? currentPage + 1
          : currentPage - 1,
      reason: 'success',
    }
  }

  /*
   * next navigation
   */
  /**
   * 다음 페이지로 전환을 시도한다.
   * @param currentPage 현재 페이지 번호
   * @param totalPages 전체 페이지 수
   * @param dwell 현재 dwell 평가 결과
   * @param isStable 현재 시선 안정성 여부
   * @param timestamp 현재 타임스탬프 (ms)
   * @returns 전환 시도 결과
   */
  navigateNext(
    currentPage: number,
    totalPages: number,
    dwell: DwellResult,
    isStable: boolean,
    timestamp: number,
  ): NavigationResult {

    const reason = this.validateCommon(
      dwell,
      isStable,
      timestamp,
    )

    if (reason) {
      return this.fail(currentPage, reason)
    }

    if (currentPage >= totalPages) {
      return this.fail(currentPage, 'invalid_page')
    }

    return this.executeNavigation(
      'next',
      currentPage,
      timestamp,
    )
  }

  /*
   * previous navigation
   */
  /**
   * 이전 페이지로 전환을 시도한다.
   * @param currentPage 현재 페이지 번호
   * @param dwell 현재 dwell 평가 결과
   * @param isStable 현재 시선 안정성 여부
   * @param timestamp 현재 타임스탬프 (ms)
   * @returns 전환 시도 결과
   */
  navigatePrevious(
    currentPage: number,
    // totalPages: number,
    dwell: DwellResult,
    isStable: boolean,
    timestamp: number,
  ): NavigationResult {

    const reason = this.validateCommon(
      dwell,
      isStable,
      timestamp,
    )

    if (reason) {
      return this.fail(currentPage, reason)
    }

    if (currentPage <= 1) {
      return this.fail(currentPage, 'invalid_page')
    }

    return this.executeNavigation(
      'previous',
      currentPage,
      timestamp,
    )
  }

  /**
   * 전환 실패 결과 객체를 생성한다.
   * @param currentPage 현재 페이지 번호 (전환되지 않으므로 그대로 반환)
   * @param reason 실패 원인
   * @returns 전환 실패 결과
   */
  private fail(
    currentPage: number,
    reason: NavigationReason,
  ): NavigationResult {
    return {
      triggered: false,
      direction: 'none',
      targetPage: currentPage,
      reason,
    }
  }
  /*
   * 상태 초기화
   */
  /**
   * 쿨다운 등 내부 상태를 초기화한다.
   */
  reset(): void {
    this.lastNavigationTime = 0
    // this.lastDirection = null
  }
}

// src/domain/services/DwellDetectionService.ts

import type { GazePoint } from '@domain/models/GazePoint'
import type { DwellRegion } from '@domain/models/DwellRegion'
import type { DwellResult } from '@domain/types/DwellResult'

/**
 * dwell(시선 머묾) 판정 정책.
 */
export interface DwellPolicy {
  /*
   * dwell 완료 기준 시간(ms)
   */
  dwellThreshold: number
  /*
   * 영역 이탈 허용 시간(ms)
   */
  gracePeriod: number
}

/**
 * DwellDetectionService 생성 시 필요한 설정.
 */
export interface DwellDetectionConfig {
  defaultPolicy: DwellPolicy
}

/**
 * 특정 영역(region)에 대한 시선의 dwell(머묾) 상태를 평가하는 서비스.
 * 영역 이탈 시에도 일정 시간(grace period) 동안은 머묾 상태를 유지해
 * micro-saccade(미세한 시선 흔들림)로 인한 끊김을 방지한다.
 */
export class DwellDetectionService {
  /*
   * dwell 시작 시간
   */
  private dwellStartTime: number | null = null
  /*
   * 마지막으로 영역 안에 있었던 시간
   */
  private lastInsideTime: number | null = null

  /*
   * 현재 활성 region id (multi-region 안정화용)
   */
  // private activeRegionId: string | null = null
  private readonly config: DwellDetectionConfig
  constructor(config: DwellDetectionConfig) {
    this.config = config
  }

  /*
   * dwell 상태 평가
   */
  /**
   * 주어진 시선 좌표가 영역 내부에 있는지를 평가해 dwell 진행 상태를 반환한다.
   * @param point 현재 시선 좌표
   * @param region 평가 대상 dwell 영역
   * @param policy 적용할 정책 (부분 지정 시 기본 정책과 병합)
   * @returns dwell 진행 상태 (진행 여부, 경과 시간, 진행률, 완료 여부)
   */
  evaluate(
    point: GazePoint,
    region: DwellRegion,
    policy?: Partial<DwellPolicy>,
  ): DwellResult {
    const finalPolicy: DwellPolicy = {
      dwellThreshold:
        policy?.dwellThreshold ??
        this.config.defaultPolicy.dwellThreshold,

      gracePeriod:
        policy?.gracePeriod ??
        this.config.defaultPolicy.gracePeriod,
    }

    const isInside = this.isInside(point, region)

    /*
     * CASE 1: region 내부
     */
    if (isInside) {
      if (this.dwellStartTime === null) {
        this.dwellStartTime = point.timestamp
      }

      this.lastInsideTime = point.timestamp

      const dwellTime = point.timestamp - this.dwellStartTime

      return {
        isDwelling: true,
        dwellTime,
        progress: Math.min(
          1,
          dwellTime / finalPolicy.dwellThreshold,
        ),
        completed:
          dwellTime >= finalPolicy.dwellThreshold,
      }
    }

    /*
     * CASE 2: grace period (micro-saccade tolerance)
     */
    if (this.lastInsideTime !== null) {
      const elapsed =
        point.timestamp - this.lastInsideTime

      if (elapsed <= finalPolicy.gracePeriod) {
        const dwellTime =
          point.timestamp -
          (this.dwellStartTime ?? point.timestamp)

        return {
          isDwelling: true,
          dwellTime,
          progress: Math.min(
            1,
            dwellTime / finalPolicy.dwellThreshold,
          ),
          completed:
            dwellTime >= finalPolicy.dwellThreshold,
        }
      }
    }

    /*
     * CASE 3: reset
     */
    this.reset()

    return {
      isDwelling: false,
      dwellTime: 0,
      progress: 0,
      completed: false,
    }
  }

  /*
   * progress 정규화
   */
  // private normalize(value: number, threshold: number): number {
  //   return Math.min(1, value / threshold)
  // }
  /*
   * region 내부 판정 (rect + circle 지원)
   */
  /**
   * 시선 좌표가 주어진 영역(사각형 또는 원형) 내부에 있는지 판정한다.
   * @param point 판정할 시선 좌표
   * @param region 판정 대상 영역
   * @returns 영역 내부 여부
   */
  private isInside(
    point: GazePoint,
    region: DwellRegion,
  ): boolean {
    /*
    * RECT 기반 region (button/page/hotspot 계열)
    */
    if ('left' in region) {
      return (
        point.x >= region.left &&
        point.x <= region.right &&
        point.y >= region.top &&
        point.y <= region.bottom
      )
    }

    /*
    * CIRCLE 기반 region
    */
    if ('centerX' in region) {
      const dx = point.x - region.centerX
      const dy = point.y - region.centerY

      const radius = region.radius + (region.tolerance ?? 0)

      return dx * dx + dy * dy <= radius * radius
    }

    /*
    * fallback (custom region or unknown shape)
    */
    return false
  }
  
  /*
   * 상태 초기화
   */
  /**
   * dwell 추적 상태를 초기화한다.
   */
  reset(): void {
    this.dwellStartTime = null
    this.lastInsideTime = null
  }
}

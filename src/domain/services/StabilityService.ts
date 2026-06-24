// src/domain/services/StabilityService.ts

import type { GazePoint } from '@domain/models/GazePoint'
import type { StabilityResult } from '@domain/types/StabilityResult'

/**
 * StabilityService 동작을 제어하는 설정.
 */
export interface StabilityConfig {
  /*
   * 안정성 계산에 사용할 최대 프레임 수
   */
  maxSamples: number

  /*
   * stable 판단 이동량 threshold
   */
  movementThreshold: number

  /*
   * variance threshold
   */
  varianceThreshold: number
}

const DEFAULT_CONFIG: StabilityConfig = {
  maxSamples: 30,

  movementThreshold: 12,

  varianceThreshold: 80,
}

/**
 * 최근 시선 샘플들의 분산과 평균 이동량을 기반으로 시선의 안정성(고정 여부)을
 * 평가하는 서비스. 값이 낮을수록(분산/이동량이 적을수록) 안정적인 것으로 판단한다.
 */
export class StabilityService {
  private readonly samples: GazePoint[] = []

  private readonly config: StabilityConfig;
  constructor(
    config: StabilityConfig = DEFAULT_CONFIG,
  ) {
    this.config = config
  }

  /*
   * 새로운 gaze 샘플 추가
   */
  /**
   * 새로운 시선 샘플을 추가한다. maxSamples를 초과하면 가장 오래된 샘플을 제거한다.
   * @param point 추가할 시선 좌표
   */
  addSample(point: GazePoint): void {
    this.samples.push(point)

    if (this.samples.length > this.config.maxSamples) {
      this.samples.shift()
    }
  }

  /*
   * 샘플 초기화
   */
  /**
   * 저장된 모든 샘플을 초기화한다.
   */
  reset(): void {
    this.samples.length = 0
  }

  /*
   * 현재 샘플 반환
   */
  /**
   * 현재 저장된 샘플 목록을 반환한다.
   * @returns 읽기 전용 시선 샘플 배열
   */
  getSamples(): readonly GazePoint[] {
    return this.samples
  }

  /*
   * 안정성 계산
   */
  /**
   * 누적된 샘플들의 분산(varianceX/Y)과 평균 이동량을 계산해 안정성 점수와
   * 안정 여부를 평가한다. 샘플이 2개 미만이면 평가 불가로 처리한다.
   * @returns 안정성 평가 결과
   */
  evaluate(): StabilityResult {
    if (this.samples.length < 2) {
      return {
        isStable: false,

        stabilityScore: 0,

        varianceX: 0,
        varianceY: 0,

        averageMovement: 0,

        sampleCount: this.samples.length,
      }
    }

    const varianceX = this.calculateVariance(
      this.samples.map((p) => p.x),
    )

    const varianceY = this.calculateVariance(
      this.samples.map((p) => p.y),
    )

    const averageMovement = this.calculateAverageMovement()

    /*
     * variance 총합
     */
    const totalVariance = varianceX + varianceY

    /*
     * 안정성 점수 계산
     * 낮을수록 안정적
     */
    const rawScore =
      averageMovement + totalVariance * 0.1

    /*
     * 0 ~ 100 normalize
     */
    const stabilityScore = Math.max(
      0,
      Math.min(
        100,
        100 - rawScore,
      ),
    )

    const isStable =
      averageMovement <= this.config.movementThreshold &&
      totalVariance <= this.config.varianceThreshold

    return {
      isStable,

      stabilityScore,

      varianceX,
      varianceY,

      averageMovement,

      sampleCount: this.samples.length,
    }
  }

  /*
   * 평균 이동량 계산
   */
  /**
   * 연속된 샘플 간 유클리드 거리의 평균을 계산한다.
   * @returns 평균 이동 거리
   */
  private calculateAverageMovement(): number {
    if (this.samples.length < 2) {
      return 0
    }

    let totalDistance = 0

    for (let i = 1; i < this.samples.length; i++) {
      const prev = this.samples[i - 1]
      const current = this.samples[i]

      const dx = current.x - prev.x
      const dy = current.y - prev.y

      const distance = Math.sqrt(
        dx * dx + dy * dy,
      )

      totalDistance += distance
    }

    return totalDistance / (this.samples.length - 1)
  }

  /*
   * 분산 계산
   */
  /**
   * 주어진 값 배열의 분산을 계산한다.
   * @param values 분산을 계산할 값 배열
   * @returns 분산 값
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) {
      return 0
    }

    const mean =
      values.reduce(
        (sum, value) => sum + value,
        0,
      ) / values.length

    const squaredDiffs = values.map(
      (value) => {
        const diff = value - mean

        return diff * diff
      },
    )

    return (
      squaredDiffs.reduce(
        (sum, value) => sum + value,
        0,
      ) / values.length
    )
  }
}

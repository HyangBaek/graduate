// src/domain/services/GazeFilterService.ts

import type { GazePoint } from '@domain/models/GazePoint'

/**
 * GazeFilterService 동작을 제어하는 옵션.
 */
export interface FilterOptions {
  /*
   * EMA smoothing 강도
   *
   * 0 ~ 1
   *
   * 낮을수록 더 부드러움
   */
  smoothingFactor: number

  /*
   * moving average window
   */
  windowSize: number

  /*
   * 급격한 점프 허용 거리(px)
   */
  maxJumpDistance: number
}

const DEFAULT_OPTIONS: FilterOptions = {
  smoothingFactor: 0.35,

  windowSize: 5,

  maxJumpDistance: 180,
}

/**
 * 시선 좌표에 이상치 제거, 이동 평균, 속도 기반 지수 평활화(EMA)를 순차적으로 적용해
 * 노이즈를 줄이면서도 빠른 시선 이동에는 즉각 반응하도록 만드는 필터링 서비스.
 */
export class GazeFilterService {
  private readonly history: GazePoint[] = []

  private previousPoint: GazePoint | null = null

  private spikeCount = 0

  // alpha 산정에 쓰는 "속도" 추정값 자체를 평활화한 상태.
  // 매 프레임의 raw dist를 그대로 alpha 산정에 쓰면, 증폭된 sub-pixel 노이즈만으로도
  // dist가 프레임마다 들쑥날쑥해져 alpha(0.10~0.65)가 같이 출렁이고, 그 결과 커서가
  // 이동 중에 "물결치듯" 흔들리는 현상으로 나타남. dist 자체를 한 번 더 가볍게
  // 평활화해 alpha 변화를 매끄럽게 만든다.
  //
  // X/Y를 분리해서 평활화하는 이유: 기존에는 dx,dy를 합친 유클리드 거리 하나로
  // alpha를 정하고 그 alpha를 X/Y 양쪽에 동일하게 적용했다. 그 결과 "가로로 크게
  // 움직이는" 구간(=가로 saccade)에서는 X거리 때문에 alpha가 커지는데, 이 커진
  // alpha가 세로(Y) 쪽에도 그대로 적용돼 원래는 거의 무시됐을 Y축의 미세한 노이즈가
  // 그대로 통과해버린다 — 가로로 읽는 동안 세로로 같이 끌려 올라가거나(대각선 쏠림)
  // 단차처럼 튀는("계단") 현상의 핵심 원인. X/Y 각자의 거리로 각자의 alpha를 정하면
  // 가로 이동 중에는 X만 빠르게 반응하고 Y는 여전히 낮은 alpha로 평활되어 분리된다.
  private smoothedDistX = 0
  private smoothedDistY = 0

  private readonly options: FilterOptions

  constructor(
    options?: Partial<FilterOptions>,
  ) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    }
  }

  /*
   * 전체 filtering pipeline
   */
  /**
   * 새 시선 좌표에 전체 필터링 파이프라인(이상치 제거 → 이동 평균 → EMA)을 적용한다.
   * @param point 새로 들어온 원본 시선 좌표
   * @returns 필터링된 시선 좌표
   */
  filter(
    point: GazePoint,
  ): GazePoint {
    /*
     * 이상치 제거 (consecutive spike 허용 횟수 도입하여 고정 현상 방지)
     */
    if (
      this.isSpike(point)
      && this.previousPoint
    ) {
      this.spikeCount++
      if (this.spikeCount < 3) { // 3프레임(약 90ms) 연속 급격한 변화면 실제 움직임으로 취급
        return this.previousPoint
      }
    }

    this.spikeCount = 0

    /*
     * moving average
     */
    const averaged =
      this.applyMovingAverage(point)

    /*
     * EMA smoothing
     */
    const smoothed =
      this.applyExponentialSmoothing(
        averaged,
      )

    this.previousPoint = smoothed

    return smoothed
  }

  /*
   * moving average
   */
  /**
   * 최근 windowSize개의 좌표에 대한 단순 이동 평균을 계산한다.
   * @param point 새로 추가할 시선 좌표
   * @returns 이동 평균이 적용된 좌표
   */
  private applyMovingAverage(
    point: GazePoint,
  ): GazePoint {
    this.history.push(point)

    if (
      this.history.length
      > this.options.windowSize
    ) {
      this.history.shift()
    }

    const sumX = this.history.reduce(
      (sum, p) => sum + p.x,
      0,
    )

    const sumY = this.history.reduce(
      (sum, p) => sum + p.y,
      0,
    )

    return {
      x: sumX / this.history.length,

      y: sumY / this.history.length,

      timestamp: point.timestamp,
    }
  }

  /*
   * EMA smoothing
   */
  /**
   * 속도(이동 거리) 기반으로 alpha를 동적으로 조정하는 지수 평활화(EMA)를 적용한다.
   * X/Y 축을 독립적으로 평활화해 한쪽 축의 빠른 이동이 다른 축의 노이즈까지
   * 증폭시키는 현상을 방지한다.
   * @param point 이동 평균이 적용된 좌표
   * @returns EMA가 적용된 최종 좌표
   */
  private applyExponentialSmoothing(
    point: GazePoint,
  ): GazePoint {
    if (!this.previousPoint) {
      return point
    }

    // Velocity-based Weighting: 시선 속도(이동 거리)에 따라 평활화 가중치(alpha)를 동적으로 변경
    // - 정지/미세 응시 시: alpha가 낮아져(0.10) 떨림이 완벽히 억제되고 정밀도 상승
    // - 빠른 시선 전환(Saccade) 시: alpha가 증가(최대 0.65)하여 지연 없는 극도의 반응성 확보
    //
    // X/Y 각각의 거리로 각자의 alpha를 독립 계산한다(이전: 유클리드 합산 거리 하나로
    // 양쪽에 동일한 alpha를 적용 → 가로 saccade 중 Y축 노이즈까지 같이 증폭되어
    // 대각선으로 쓸리거나 계단처럼 튀는 현상의 원인이었음).
    const distX = Math.abs(point.x - this.previousPoint.x)
    const distY = Math.abs(point.y - this.previousPoint.y)

    // dist를 그대로 alpha 계산에 쓰지 않고, dist 자체를 가볍게 EMA로 한 번 더 죽인 값을
    // 사용한다 (alpha 0.4 = 약간의 지연만 추가, 응답성은 거의 그대로 유지하면서 프레임
    // 간 dist 변동을 매끄럽게 만들어 이동 중 "물결치는" alpha 진동을 없앤다).
    this.smoothedDistX += (distX - this.smoothedDistX) * 0.4
    this.smoothedDistY += (distY - this.smoothedDistY) * 0.4

    const minAlpha = 0.10
    const maxAlpha = 0.65
    const minDist = 10
    const maxDist = 180

    const alphaFor = (smoothedDist: number): number => {
      if (smoothedDist <= minDist) return minAlpha
      const t = Math.min((smoothedDist - minDist) / (maxDist - minDist), 1)
      return minAlpha + t * (maxAlpha - minAlpha)
    }

    const alphaX = alphaFor(this.smoothedDistX)
    const alphaY = alphaFor(this.smoothedDistY)

    return {
      x:
        this.previousPoint.x
        + (point.x - this.previousPoint.x)
          * alphaX,

      y:
        this.previousPoint.y
        + (point.y - this.previousPoint.y)
          * alphaY,

      timestamp: point.timestamp,
    }
  }

  /*
   * 급격한 좌표 점프 감지
   */
  /**
   * 이전 좌표와의 거리가 maxJumpDistance를 초과하는지로 이상치(spike)를 판정한다.
   * @param point 판정할 시선 좌표
   * @returns 이상치 여부
   */
  private isSpike(
    point: GazePoint,
  ): boolean {
    if (!this.previousPoint) {
      return false
    }

    const distance =
      this.calculateDistance(
        point,
        this.previousPoint,
      )

    return (
      distance
      > this.options.maxJumpDistance
    )
  }

  /*
   * 두 좌표 거리 계산
   */
  /**
   * 두 좌표 간 유클리드 거리를 계산한다.
   * @param a 좌표 A
   * @param b 좌표 B
   * @returns 두 좌표 사이의 거리
   */
  private calculateDistance(
    a: GazePoint,
    b: GazePoint,
  ): number {
    const dx = a.x - b.x
    const dy = a.y - b.y

    return Math.sqrt(dx * dx + dy * dy)
  }

  /*
   * 상태 초기화
   */
  /**
   * 필터 내부 상태(히스토리, 이전 좌표, 평활화 상태 등)를 초기화한다.
   */
  reset(): void {
    this.history.length = 0

    this.previousPoint = null
    this.spikeCount = 0
    this.smoothedDistX = 0
    this.smoothedDistY = 0
  }

  /*
   * 현재 history 반환
   */
  /**
   * 현재 이동 평균에 사용 중인 좌표 히스토리를 반환한다.
   * @returns 읽기 전용 좌표 히스토리 배열
   */
  getHistory(): readonly GazePoint[] {
    return this.history
  }
}

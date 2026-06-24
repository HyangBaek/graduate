// src/domain/usecases/ProcessGazeUseCase.ts

import type {
  FaceLandmark,
} from '@domain/models/FaceLandmark'

import type {
  CalibrationData,
} from '@domain/models/CalibrationData'

import type {
  GazeEstimator,
} from '@domain/interfaces/GazeEstimator'

import type {
  GazePoint,
} from '@domain/models/GazePoint'

import type {
  ProcessedGazeResult,
} from '@domain/types/ProcessedGazeResult'

import {
  GazeFilterService,
} from '@domain/services/GazeFilterService'



import {
  StabilityService,
} from '@domain/services/StabilityService'

/**
 * ProcessGazeUseCase 실행에 필요한 옵션.
 */
export interface ProcessGazeOptions {
  screenWidth: number
  screenHeight: number

  calibrationData?: CalibrationData | null
}

/**
 * 얼굴 랜드마크로부터 시선을 추정하고, 필터링과 안정성 평가까지 수행하는 유스케이스.
 * GazeEstimator -> GazeFilterService -> StabilityService 순으로 파이프라인을 구성한다.
 */
export class ProcessGazeUseCase {
    private readonly gazeEstimator: GazeEstimator
    private readonly gazeFilterService: GazeFilterService
    private readonly stabilityService: StabilityService
    constructor(
        gazeEstimator: GazeEstimator,
        gazeFilterService: GazeFilterService,
        stabilityService: StabilityService,
    ) {
        this.gazeEstimator = gazeEstimator
        this.gazeFilterService = gazeFilterService
        this.stabilityService = stabilityService
  }

  /**
   * 한 프레임의 얼굴 랜드마크를 입력받아 시선 추정 -> 필터링 -> 안정성 평가까지
   * 전체 파이프라인을 실행한다.
   * @param landmark 얼굴 랜드마크 정보
   * @param options 화면 크기 및 캘리브레이션 데이터 옵션
   * @returns 처리된 시선 결과, 추정 실패 시 null
   */
  execute(
    landmark: FaceLandmark,
    options: ProcessGazeOptions,
  ): ProcessedGazeResult | null {
    /*
     * gaze estimation
     */
    const estimated =
      this.gazeEstimator.estimate(
        landmark,
        null,
      )

    if (!estimated) {
      return null
    }

    const rawGaze: GazePoint = {
      x: Math.min(Math.max(estimated.x, 0), options.screenWidth),
      y: Math.min(Math.max(estimated.y, 0), options.screenHeight),
      timestamp: Date.now(),
    }

    /*
    * filtering
    */
    const filtered =
      this.gazeFilterService.filter(
        rawGaze,
      )

    /*
    * stability 계산
    */
    this.stabilityService.addSample(
      filtered,
    )

    const stability =
      this.stabilityService.evaluate()

    return {
      raw: rawGaze,

      filtered,

      confidence:
        estimated.confidence,

      isStable:
        stability.isStable,

      stabilityScore:
        stability.stabilityScore,

      timestamp: Date.now(),
    }
  }

  /**
   * 필터링 및 안정성 평가 상태를 초기화한다.
   */
  reset(): void {
    this.gazeFilterService.reset()
    this.stabilityService.reset()
  }
}

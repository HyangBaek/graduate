// src/domain/usecases/RunCalibrationUseCase.ts

import { CalibrationService } from '@domain/services/CalibrationService'
import type { CalibrationData } from '@domain/models/CalibrationData'
import type { CalibrationSample } from '@domain/models/CalibrationSample'

/**
 * 캘리브레이션 샘플 개수를 검증한 뒤 CalibrationService에 위임해 캘리브레이션을
 * 실행하는 유스케이스.
 */
export class RunCalibrationUseCase {
  private readonly calibrationService: CalibrationService

  constructor(calibrationService: CalibrationService) {
    this.calibrationService = calibrationService
  }

  /**
   * 캘리브레이션 샘플 유효성을 검증하고 CalibrationService로 계산을 위임한다.
   * @param samples 캘리브레이션 샘플 목록
   * @returns 계산된 캘리브레이션 데이터
   * @throws 샘플이 비어 있거나 3개 미만일 경우 Error
   */
  execute(samples: CalibrationSample[]): CalibrationData {
    if (!samples.length) {
      throw new Error('Calibration samples are empty')
    }

    if (samples.length < 3) {
      throw new Error(
        'At least 3 calibration samples are required'
      )
    }

    return this.calibrationService.calculate(samples)
  }
}

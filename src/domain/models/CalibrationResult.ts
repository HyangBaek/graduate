// domain/models/CalibrationResult.ts
import type { CalibrationData } from '@domain/models/CalibrationData'

/**
 * 캘리브레이션 실행 결과를 나타내는 모델.
 * 성공 시 CalibrationData를 포함하고, 실패 시 에러 메시지를 포함한다.
 */
export interface CalibrationResult {
  success: boolean
  data?: CalibrationData
  error?: string
}

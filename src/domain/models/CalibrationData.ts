// src/domain/models/CalibrationData.ts

/**
 * 캘리브레이션 계산 결과로 산출되는 데이터.
 * 선형 offset/scale, 2차 다항식 보정 계수, 3x3 그리드 보정값을 모두 포함하며,
 * 시선 좌표를 화면 좌표로 변환할 때 이 데이터를 적용해 정확도를 높인다.
 */
export interface CalibrationData {
  offsetX: number
  offsetY: number

  scaleX: number
  scaleY: number

  qualityScore: number

  screenWidth: number
  screenHeight: number

  calibratedAt: number

  devicePixelRatio: number

  baselineX?: number
  baselineY?: number

  // 2nd-order polynomial coefficients
  // polyCoeffsX: [a1, a2, a3, a4] for tx = a1*x^2 + a2*x + a3*y + a4
  // polyCoeffsY: [b1, b2, b3, b4] for ty = b1*y^2 + b2*y + b3*x + b4
  polyCoeffsX?: number[]
  polyCoeffsY?: number[]

  // 3x3 Grid of local offsets for bilinear interpolation
  gridOffsets?: { offsetX: number; offsetY: number }[][]
}

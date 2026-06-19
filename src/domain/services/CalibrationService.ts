// src/domain/services/CalibrationService.ts

import type { CalibrationData } from '@domain/models/CalibrationData'
import type { CalibrationSample } from '@domain/models/CalibrationSample'

/**
 * 캘리브레이션 샘플로부터 시선 보정 데이터를 계산하는 서비스.
 * 2차 다항식 회귀(ridge 정규화 포함)로 전역 보정 계수를 구하고, 잔차에 대해
 * Inverse Distance Weighting(IDW) 기반 3x3 로컬 보정 그리드를 추가로 산출해
 * 화면 전체에 걸친 비선형 시선 오차를 보정한다.
 */
export class CalibrationService {
  /**
   * 캘리브레이션 샘플들로부터 최종 CalibrationData를 계산한다.
   * @param samples 캘리브레이션 포인트별로 수집된 샘플 목록
   * @returns 계산된 캘리브레이션 데이터 (offset/scale, 다항식 계수, 그리드 보정값, 품질 점수 포함)
   * @throws 샘플이 비어 있을 경우 Error
   */
  calculate(samples: CalibrationSample[]): CalibrationData {
    if (samples.length === 0) {
      throw new Error('Calibration samples are empty')
    }

    let polyCoeffsX = [0, 1, 0, 0] // Default tx = x
    let polyCoeffsY = [0, 1, 0, 0] // Default ty = y

    // 2nd-order Polynomial Regression using Least Squares (requires at least 4 samples)
    if (samples.length >= 4) {
      try {
        polyCoeffsX = this.fitPolynomial(samples, false)
        polyCoeffsY = this.fitPolynomial(samples, true)
      } catch (e) {
        console.warn('[CalibrationService] Polynomial fit failed, backing up to linear scale', e)
        // Fallback coefficients will remain default [0, 1, 0, 0]
      }
    }

    // Generate 3x3 grid of local offsets using Inverse Distance Weighting (IDW)
    const gridOffsets = this.generateGridOffsets(samples, polyCoeffsX, polyCoeffsY)

    // Compute traditional linear parameters for backwards compatibility
    const scaleX = this.calculateScaleX(samples)
    const scaleY = this.calculateScaleY(samples)
    const offsetX = this.calculateOffsetX(samples, scaleX)
    const offsetY = this.calculateOffsetY(samples, scaleY)

    // Compute overall quality score based on remaining error after polynomial/grid correction
    const qualityScore = this.calculateQualityScore(
      samples,
      polyCoeffsX,
      polyCoeffsY,
      gridOffsets
    )

    return {
      offsetX,
      offsetY,
      scaleX,
      scaleY,
      polyCoeffsX,
      polyCoeffsY,
      gridOffsets,
      qualityScore,
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      calibratedAt: Date.now(),
      devicePixelRatio: window.devicePixelRatio,
    }
  }

  /**
   * Fit 2nd-order polynomial using Gaussian Elimination Least Squares
   * For X: tx = a1*x^2 + a2*x + a3*y + a4
   * For Y: ty = b1*y^2 + b2*y + b3*x + b4
   *
   * 가중 최소제곱(weighted least squares)으로 2차 다항식 계수를 추정하고,
   * 노이즈가 큰 소수의 샘플이 cross/이차 항을 과적합시키지 않도록 identity
   * prior([0,1,0,0]) 방향으로 살짝 당기는 ridge 정규화를 추가한다.
   * @param samples 캘리브레이션 샘플 목록
   * @param isYAxis true면 Y축 계수([y^2, y, x, 1] 기반), false면 X축 계수([x^2, x, y, 1] 기반)를 추정
   * @returns 추정된 4개 다항식 계수 [a1, a2, a3, a4]
   */
  private fitPolynomial(samples: CalibrationSample[], isYAxis: boolean): number[] {
    const n = samples.length
    const A = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    const B = [0, 0, 0, 0]

    const W = window.innerWidth
    const H = window.innerHeight

    for (let i = 0; i < n; i++) {
      const sample = samples[i]
      const gx = sample.gaze.x / W
      const gy = sample.gaze.y / H
      const target = isYAxis ? (sample.targetY / H) : (sample.targetX / W)
      // forceProgress로 강제 캡처된 저품질 샘플은 weight < 1로 회귀 영향력을 줄인다.
      const weight = sample.weight ?? 1

      // Input vector: X uses [gx^2, gx, gy, 1], Y uses [gy^2, gy, gx, 1]
      const u = isYAxis ? [gy * gy, gy, gx, 1] : [gx * gx, gx, gy, 1]

      // Accumulate weighted X^T * X into A
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
          A[j][k] += weight * u[j] * u[k]
        }
        // Accumulate weighted X^T * y into B
        B[j] += weight * u[j] * target
      }
    }

    // 캘리브레이션 표본은 13개뿐이고 일부 극단 점(4·7·9번 등)은 시선이 잘
    // 도달하지 못해 노이즈가 큼. 4개 파라미터를 제약 없이(OLS) 그대로 맞추면
    // 이 노이즈 몇 개만으로도 cross 항(특히 ty의 x 의존 계수, w[2])이 과도하게
    // 커질 수 있는데, 그 결과 "가로로 읽는 동안 세로로도 같이 움직이는" 대각선
    // 쓸림/과도한 상하 이동 현상이 나타남(가로 위치 변화가 그대로 세로 출력에
    // 섞여 들어감). 물리적으로 좋은 캘리브레이션일수록 이 cross 항은 0에
    // 가까워야 하므로, identity prior([0,1,0,0]) 쪽으로 살짝 당기는 ridge
    // 정규화를 추가해 소수의 노이즈 표본이 cross/이차 항을 과적합시키지
    // 못하게 한다. 일관되고 강한 실제 상관관계가 있으면 여전히 데이터가
    // 이를 충분히 압도해 정상적으로 반영된다.
    const priorW = [0, 1, 0, 0]
    const REG_LAMBDA = 2.0
    for (let j = 0; j < 4; j++) {
      A[j][j] += REG_LAMBDA
      B[j] += REG_LAMBDA * priorW[j]
    }

    // Solve A * w = B using Gaussian Elimination
    return this.solveLinearSystem(A, B)
  }

  /**
   * Gaussian Elimination with partial pivoting to solve 4x4 system
   *
   * 부분 피벗팅을 적용한 가우스 소거법으로 4x4 선형 연립방정식 A*w=b를 풀어 가중치 w를 구한다.
   * @param A 4x4 계수 행렬
   * @param b 4차원 우변 벡터
   * @returns 해 벡터 w (4개 원소)
   * @throws 행렬이 특이(singular)하거나 조건이 나쁠 경우 Error
   */
  private solveLinearSystem(A: number[][], b: number[]): number[] {
    const n = b.length
    // Create augmented matrix [A | b]
    const M = A.map((row, i) => [...row, b[i]])

    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxEl = Math.abs(M[i][i])
      let maxRow = i
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > maxEl) {
          maxEl = Math.abs(M[k][i])
          maxRow = k
        }
      }

      // Swap rows
      const temp = M[maxRow]
      M[maxRow] = M[i]
      M[i] = temp

      if (Math.abs(M[i][i]) < 1e-9) {
        throw new Error('Matrix is singular or ill-conditioned')
      }

      // Eliminate column below pivot
      for (let k = i + 1; k < n; k++) {
        const c = -M[k][i] / M[i][i]
        for (let j = i; j <= n; j++) {
          if (i === j) {
            M[k][j] = 0
          } else {
            M[k][j] += c * M[i][j]
          }
        }
      }
    }

    // Back substitution
    const x = new Array(n).fill(0)
    for (let i = n - 1; i >= 0; i--) {
      x[i] = M[i][n] / M[i][i]
      for (let k = i - 1; k >= 0; k--) {
        M[k][n] -= M[k][i] * x[i]
      }
    }
    return x
  }

  /**
   * Generates a 3x3 local offset grid using Inverse Distance Weighting
   *
   * 전역 다항식 보정 후 남은 잔차를 화면을 3x3으로 나눈 그리드 노드에 대해
   * 거리 기반 역거리 가중(IDW)으로 보간해, 전역 모델이 놓치는 지역적 편향을 추가 보정한다.
   * @param samples 캘리브레이션 샘플 목록
   * @param polyX 전역 X축 다항식 계수
   * @param polyY 전역 Y축 다항식 계수
   * @returns 3x3 그리드의 각 노드별 로컬 offset (offsetX, offsetY)
   */
  private generateGridOffsets(
    samples: CalibrationSample[],
    polyX: number[],
    polyY: number[]
  ): { offsetX: number; offsetY: number }[][] {
    const rows = 3
    const cols = 3
    const grid: { offsetX: number; offsetY: number }[][] = []

    const W = window.innerWidth
    const H = window.innerHeight

    // Compute residual errors for each sample after applying global polynomial fit
    const residuals = samples.map((sample) => {
      const gx = sample.gaze.x / W
      const gy = sample.gaze.y / H
      const predXNorm = polyX[0] * gx * gx + polyX[1] * gx + polyX[2] * gy + polyX[3]
      const predYNorm = polyY[0] * gy * gy + polyY[1] * gy + polyY[2] * gx + polyY[3]
      const predX = predXNorm * W
      const predY = predYNorm * H
      return {
        targetX: sample.targetX,
        targetY: sample.targetY,
        errX: sample.targetX - predX,
        errY: sample.targetY - predY,
        weight: sample.weight ?? 1,
      }
    })

    // Create 3x3 nodes spanning screen coords (e.g. 1/6th, 1/2th, 5/6th width/height)
    for (let r = 0; r < rows; r++) {
      const gridRow: { offsetX: number; offsetY: number }[] = []
      const gy = H * ((r + 0.5) / rows)

      for (let c = 0; c < cols; c++) {
        const gx = W * ((c + 0.5) / cols)

        // Interpolate local bias using Inverse Distance Weighting (IDW)
        let sumW = 0
        let sumErrX = 0
        let sumErrY = 0
        const epsilon = 50.0 // smoothing parameter to prevent divide-by-zero

        for (let i = 0; i < residuals.length; i++) {
          const res = residuals[i]
          const dx = gx - res.targetX
          const dy = gy - res.targetY
          const distSq = dx * dx + dy * dy
          // 거리 기반 IDW 가중치에 샘플 신뢰도 가중치를 추가로 곱해, forceProgress로
          // 캡처된 저품질 샘플이 로컬 보정값에 끼치는 영향도 줄인다.
          const w = (1.0 / (distSq + epsilon * epsilon)) * res.weight

          sumW += w
          sumErrX += w * res.errX
          sumErrY += w * res.errY
        }

        gridRow.push({
          offsetX: sumW > 0 ? sumErrX / sumW : 0,
          offsetY: sumW > 0 ? sumErrY / sumW : 0,
        })
      }
      grid.push(gridRow)
    }

    return grid
  }

  /**
   * 단순 선형 보정을 위한 X축 offset을 계산한다 (하위 호환용 보조 값).
   * @param samples 캘리브레이션 샘플 목록
   * @param scaleX X축 선형 스케일 값
   * @returns 평균 X offset
   */
  private calculateOffsetX(samples: CalibrationSample[], scaleX: number): number {
    const total = samples.reduce((sum, sample) => {
      return sum + (sample.targetX - sample.gaze.x * scaleX)
    }, 0)
    return total / samples.length
  }

  /**
   * 단순 선형 보정을 위한 Y축 offset을 계산한다 (하위 호환용 보조 값).
   * @param samples 캘리브레이션 샘플 목록
   * @param scaleY Y축 선형 스케일 값
   * @returns 평균 Y offset
   */
  private calculateOffsetY(samples: CalibrationSample[], scaleY: number): number {
    const total = samples.reduce((sum, sample) => {
      return sum + (sample.targetY - sample.gaze.y * scaleY)
    }, 0)
    return total / samples.length
  }

  /**
   * 목표 좌표 범위와 시선 좌표 범위의 비율로 X축 선형 스케일을 계산한다.
   * 샘플 부족, 범위가 너무 작거나 스케일이 비정상적인 경우 1.0(보정 없음)으로 fallback한다.
   * @param samples 캘리브레이션 샘플 목록
   * @returns X축 선형 스케일 값
   */
  private calculateScaleX(samples: CalibrationSample[]): number {
    if (samples.length < 4) return 1.0
    const targetRange = Math.max(...samples.map((s) => s.targetX)) - Math.min(...samples.map((s) => s.targetX))
    const gazeRange = Math.max(...samples.map((s) => s.gaze.x)) - Math.min(...samples.map((s) => s.gaze.x))
    if (gazeRange < 50) return 1.0
    const scale = targetRange / gazeRange
    return scale < 0.3 || scale > 2.0 ? 1.0 : scale
  }

  /**
   * 목표 좌표 범위와 시선 좌표 범위의 비율로 Y축 선형 스케일을 계산한다.
   * @param samples 캘리브레이션 샘플 목록
   * @returns Y축 선형 스케일 값
   */
  private calculateScaleY(samples: CalibrationSample[]): number {
    if (samples.length < 4) return 1.0
    const targetRange = Math.max(...samples.map((s) => s.targetY)) - Math.min(...samples.map((s) => s.targetY))
    const gazeRange = Math.max(...samples.map((s) => s.gaze.y)) - Math.min(...samples.map((s) => s.gaze.y))
    if (gazeRange < 50) return 1.0
    const scale = targetRange / gazeRange
    return scale < 0.3 || scale > 2.0 ? 1.0 : scale
  }

  /**
   * 다항식+그리드 보정을 모두 적용한 예측 좌표와 실제 목표 좌표 간 평균 오차를 기반으로
   * 캘리브레이션 품질 점수(0~100)를 계산한다. 오차가 클수록 점수가 낮아진다.
   * @param samples 캘리브레이션 샘플 목록
   * @param polyX 전역 X축 다항식 계수
   * @param polyY 전역 Y축 다항식 계수
   * @param gridOffsets 3x3 로컬 보정 그리드
   * @returns 0~100 범위의 품질 점수
   */
  private calculateQualityScore(
    samples: CalibrationSample[],
    polyX: number[],
    polyY: number[],
    gridOffsets: { offsetX: number; offsetY: number }[][]
  ): number {
    const W = window.innerWidth
    const H = window.innerHeight

    const totalError = samples.reduce((sum, sample) => {
      const gx = sample.gaze.x / W
      const gy = sample.gaze.y / H

      // Global polynomial prediction (normalized output)
      const predXNorm = polyX[0] * gx * gx + polyX[1] * gx + polyX[2] * gy + polyX[3]
      const predYNorm = polyY[0] * gy * gy + polyY[1] * gy + polyY[2] * gx + polyY[3]

      let predX = predXNorm * W
      let predY = predYNorm * H

      // Local grid offset bilinear interpolation
      const localOff = this.interpolateGridOffset(predX, predY, W, H, gridOffsets)
      predX += localOff.offsetX
      predY += localOff.offsetY

      const dx = sample.targetX - predX
      const dy = sample.targetY - predY

      return sum + Math.sqrt(dx * dx + dy * dy)
    }, 0)

    const averageError = totalError / samples.length
    const maxAcceptableError = 150
    const score = Math.max(0, 100 - (averageError / maxAcceptableError) * 100)
    return Number(score.toFixed(2))
  }

  /**
   * Helper to perform bilinear interpolation of grid offsets during quality score evaluation
   *
   * 주어진 좌표를 3x3 그리드 인덱스로 정규화한 뒤, 인접한 4개 그리드 노드의 보정값을
   * 양선형 보간(bilinear interpolation)하여 해당 좌표에서의 로컬 offset을 구한다.
   * @param x 보간할 X 좌표 (화면 픽셀)
   * @param y 보간할 Y 좌표 (화면 픽셀)
   * @param W 화면 너비
   * @param H 화면 높이
   * @param grid 3x3 로컬 보정 그리드
   * @returns 보간된 offsetX, offsetY
   */
  private interpolateGridOffset(
    x: number,
    y: number,
    W: number,
    H: number,
    grid: { offsetX: number; offsetY: number }[][]
  ): { offsetX: number; offsetY: number } {
    const rows = 3
    const cols = 3

    // Normalize target coordinates into grid index floats
    const cFloat = (x / W) * cols - 0.5
    const rFloat = (y / H) * rows - 0.5

    // Clamp coordinates within the bounds of the grid cells
    const c0 = Math.min(Math.max(Math.floor(cFloat), 0), cols - 1)
    const c1 = Math.min(Math.max(c0 + 1, 0), cols - 1)
    const r0 = Math.min(Math.max(Math.floor(rFloat), 0), rows - 1)
    const r1 = Math.min(Math.max(r0 + 1, 0), rows - 1)

    // Interpolation weights
    const tx = cFloat - Math.floor(cFloat)
    const ty = rFloat - Math.floor(rFloat)

    const w00 = (1 - tx) * (1 - ty)
    const w10 = tx * (1 - ty)
    const w01 = (1 - tx) * ty
    const w11 = tx * ty

    const off00 = grid[r0][c0]
    const off10 = grid[r0][c1]
    const off01 = grid[r1][c0]
    const off11 = grid[r1][c1]

    return {
      offsetX: off00.offsetX * w00 + off10.offsetX * w10 + off01.offsetX * w01 + off11.offsetX * w11,
      offsetY: off00.offsetY * w00 + off10.offsetY * w10 + off01.offsetY * w01 + off11.offsetY * w11,
    }
  }
}

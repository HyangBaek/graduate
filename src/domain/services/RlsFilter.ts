// src/domain/services/RlsFilter.ts
//
// Recursive Least Squares (RLS) filter for 4D parameter vectors.
// Used to incrementally fit polynomial coefficient weights (a1..a4 or b1..b4)
// as new calibration points are captured.

/**
 * 4차원 파라미터 벡터(2차 다항식 계수)를 위한 재귀적 최소제곱(RLS) 필터.
 * 캘리브레이션 점이 새로 캡처될 때마다 다항식 계수(a1..a4 또는 b1..b4)를
 * 전체 데이터를 다시 회귀하지 않고 점진적으로(incrementally) 갱신하는 데 사용한다.
 */
export class RlsFilter {
  // Parameter weights: [coeffs^2, coeff_linear, cross_coeff, bias]
  // Initialized to match identity mapping: tx = x, ty = y (i.e. [0, 1, 0, 0])
  private w: number[] = [0, 1, 0, 0]

  // Covariance matrix P (4x4)
  private P: number[][] = []

  // Forgetting factor (lambda) - 1.0 means infinite memory (standard LS)
  private readonly lambda: number = 1.0

  /**
   * @param initialDelta 초기 공분산 행렬 P의 스케일 (클수록 초기 불확실성이 커 학습이 빨라짐)
   */
  constructor(initialDelta = 1000.0) {
    this.reset(initialDelta)
  }

  /**
   * 필터 상태(가중치 w, 공분산 행렬 P)를 초기값으로 리셋한다.
   * @param delta 공분산 행렬 P를 초기화할 때 사용할 스케일 (delta * 단위행렬)
   */
  reset(delta = 1000.0) {
    this.w = [0, 1, 0, 0]
    // Initialize P as delta * Identity matrix
    this.P = [
      [delta, 0, 0, 0],
      [0, delta, 0, 0],
      [0, 0, delta, 0],
      [0, 0, 0, delta],
    ]
  }

  /**
   * 현재 추정된 가중치(다항식 계수)를 반환한다.
   * @returns 현재 가중치 벡터 [a1, a2, a3, a4]의 복사본
   */
  getWeights(): number[] {
    return [...this.w]
  }

  /**
   * 가중치를 외부에서 직접 설정한다 (예: CalibrationService의 OLS 결과로 초기화).
   * @param newWeights 설정할 4개 가중치 배열 (길이가 4가 아니면 무시됨)
   */
  setWeights(newWeights: number[]) {
    if (newWeights.length === 4) {
      this.w = [...newWeights]
    }
  }

  /**
   * Update RLS weights with a new sample
   * @param x Gaze X (normalized or screen coord)
   * @param y Gaze Y (normalized or screen coord)
   * @param target Target coordinate (true X or Y screen coord)
   * @param isYAxis Whether we are updating the Y-axis (which uses [y^2, y, x, 1] instead of [x^2, x, y, 1])
   */
  /**
   * RLS 알고리즘 핵심: 칼만 게인을 이용해 새 샘플 하나로 가중치와 공분산 행렬을 갱신한다.
   * 예측 오차(잔차)에 비례해 가중치를 조정하고, 공분산 행렬을 축소시켜 점진적으로
   * 추정의 확신도를 높여간다.
   * @param x Gaze X (normalized or screen coord)
   * @param y Gaze Y (normalized or screen coord)
   * @param target Target coordinate (true X or Y screen coord)
   * @param isYAxis Whether we are updating the Y-axis (which uses [y^2, y, x, 1] instead of [x^2, x, y, 1])
   */
  update(x: number, y: number, target: number, isYAxis: boolean) {
    // 1. Construct input vector u (4x1)
    // For X: [x^2, x, y, 1]
    // For Y: [y^2, y, x, 1]
    const u = isYAxis ? [y * y, y, x, 1] : [x * x, x, y, 1]

    // 2. Compute predicted value: d_hat = u^T * w
    let dHat = 0
    for (let i = 0; i < 4; i++) {
      dHat += u[i] * this.w[i]
    }

    // 3. Compute error (residual): e = target - d_hat
    const e = target - dHat

    // 4. Compute P * u (4x1 vector)
    const Pu = [0, 0, 0, 0]
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        Pu[i] += this.P[i][j] * u[j]
      }
    }

    // 5. Compute denominator: lambda + u^T * P * u
    let uPu = 0
    for (let i = 0; i < 4; i++) {
      uPu += u[i] * Pu[i]
    }
    const denom = this.lambda + uPu

    // 6. Compute Kalman gain vector: g = (P * u) / denom
    const g = Pu.map((val) => val / denom)

    // 7. Update weights: w = w + g * e
    for (let i = 0; i < 4; i++) {
      this.w[i] += g[i] * e
    }

    // 8. Update covariance matrix: P = (P - g * u^T * P) / lambda
    // Compute g * u^T (4x4 matrix)
    const gUt = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        gUt[i][j] = g[i] * u[j]
      }
    }

    // Compute g * u^T * P (4x4 matrix)
    const gUtP = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
          gUtP[i][j] += gUt[i][k] * this.P[k][j]
        }
      }
    }

    // Update P: P = (P - gUtP) / lambda
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        this.P[i][j] = (this.P[i][j] - gUtP[i][j]) / this.lambda
      }
    }
  }
}

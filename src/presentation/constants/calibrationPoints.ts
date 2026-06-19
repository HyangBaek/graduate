// src/presentation/constants/calibrationPoints.ts

/**
 * 캘리브레이션(시선 보정) 한 점의 좌표 및 난이도 정보.
 * x, y는 화면 비율(0~1) 기준 정규화 좌표.
 */
export interface CalibrationPointData {
  x: number
  y: number
  /**
   * 이 점의 confidence/stability/distance 게이트 시작 기준을 얼마나 낮춰서
   * 출발할지 결정하는 0~1 난이도 값.
   *
   * 기존에는 게이트 기준이 모든 점에서 동일했고, 점이 막혔을 때만 그 점에서
   * 보낸 시간(stuckTime)에 비례해 사후적으로 완화했음(4·5·7번 점에서 각각
   * distance/confidence 게이트가 따로 막혀 그때마다 patch가 필요했던 이유).
   * 화면 중심에서 멀수록, 특히 수직(y)축으로 멀수록(위/아래를 볼 때 눈꺼풀에
   * 가려지거나 GAIN_Y 특성상 흔들림이 커짐) confidence·stability가 구조적으로
   * 낮게 나오는 경향이 있어 "순서"가 아니라 점의 실제 기하학적 위치에서 직접
   * 난이도를 계산해, 어려운 점일수록 처음부터 더 낮은 기준에서 시작하게 한다.
   * stuckTime 기반 점진적 완화는 이 위에 그대로 추가로 적용된다(이 값을
   * 대체하는 게 아니라 시작점만 바꿈).
   */
  difficulty: number
}

/**
 * 중심(0.5, 0.5)에서의 거리를 0~1로 정규화해 난이도를 계산.
 * y축에 1.3배 가중 — 수직 방향 게이트가 구조적으로 더 불안정함.
 *
 * @param x 정규화된 x 좌표 (0~1)
 * @param y 정규화된 y 좌표 (0~1)
 * @returns 0(쉬움) ~ 1(어려움) 범위의 난이도 값
 */
function computeDifficulty(x: number, y: number): number {
  const dx = Math.abs(x - 0.5) * 2 // 0(중앙) ~ 1(좌우 끝)
  const dy = Math.abs(y - 0.5) * 2 // 0(중앙) ~ 1(상하 끝)
  const yWeight = 1.3
  const weighted = Math.sqrt(dx * dx + (dy * yWeight) * (dy * yWeight))
  const maxWeighted = Math.sqrt(1 + yWeight * yWeight) // 코너점 기준 정규화
  return Math.min(1, weighted / maxWeighted)
}

/**
 * 좌표로부터 난이도를 자동 계산해 캘리브레이션 포인트 객체를 생성.
 *
 * @param x 정규화된 x 좌표 (0~1)
 * @param y 정규화된 y 좌표 (0~1)
 * @returns 좌표와 계산된 난이도를 포함한 CalibrationPointData
 */
function point(x: number, y: number): CalibrationPointData {
  return { x, y, difficulty: computeDifficulty(x, y) }
}

/**
 * 13-point calibration — Center point first for baseline calibration,
 * followed by W shape top, M shape bottom (clockwise grid structure).
 * 상단 5점이 W 모양, 하단 5점이 M 모양을 이루고,
 * 좌우 중앙 1점씩으로 총 12점.
 *
 *  2 ── 4 ── 6        ← W 상단
 *    3     5
 *
 *  13    1    7     ← 좌우 중앙
 *
 *    11    9          ← M 하단
 *  12 ── 10 ── 8

 */
/**
 * 13점 캘리브레이션 시퀀스 — 중앙점 1개 + W/M 형태의 격자 12점.
 * CalibrationOverlay가 이 배열 순서대로 사용자에게 점을 보여주며 시선 데이터를 수집한다.
 */
export const CALIBRATION_POINTS: CalibrationPointData[] = [
  //  ── 초기 기준점 학습용 중앙점 ─────────────────────────────────
  point(0.50, 0.50),   //  1. Center — 기준점 보정용

  //  ── W 상단 (시계 방향, 좌 → 우) ──────────────────────────────
  point(0.05, 0.05),   //  2. TL     — W 좌측 꼭지
  point(0.28, 0.22),   //  3. W-골-L — W 좌측 골짜기
  point(0.50, 0.05),   //  4. TC     — W 중앙 꼭지
  point(0.72, 0.22),   //  5. W-골-R — W 우측 골짜기
  point(0.95, 0.05),   //  6. TR     — W 우측 꼭지

  //  ── 우측 중앙 ─────────────────────────────────────────────────
  point(0.95, 0.50),   //  7. R-mid

  //  ── M 하단 (시계 방향, 우 → 좌) ──────────────────────────────
  point(0.95, 0.95),   //  8. BR     — M 우측 기저
  point(0.72, 0.78),   //  9. M-봉-R — M 우측 꼭대기
  point(0.50, 0.95),   // 10. BC     — M 중앙 기저 (두 봉 사이 골)
  point(0.28, 0.78),   // 11. M-봉-L — M 좌측 꼭대기
  point(0.05, 0.95),   // 12. BL     — M 좌측 기저

  //  ── 좌측 중앙 ─────────────────────────────────────────────────
  point(0.05, 0.50),   // 13. L-mid
]

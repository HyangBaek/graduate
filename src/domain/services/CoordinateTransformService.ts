// src/domain/services/CoordinateTransformService.ts

import type { GazePoint } from '@domain/models/GazePoint'

import type { LandmarkPoint } from '@domain/models/FaceLandmark'

/**
 * 화면 크기를 나타내는 간단한 모델.
 */
export interface ScreenSize {
  width: number
  height: number
}

/**
 * 정규화 좌표 ↔ 화면 픽셀 좌표 ↔ PDF 좌표 간 변환을 담당하는 서비스.
 * tanh 기반 비선형 가속, 머리 자세에 따른 데드존 보정 등 시선 좌표를 실제 화면 좌표로
 * 매핑하는 핵심 알고리즘을 포함한다.
 */
export class CoordinateTransformService {
  /*
   * normalized → screen
   *
   * input:
   * 0 ~ 1 normalized coordinate
   *
   * output:
   * pixel coordinate
   */
  /**
   * 정규화된 눈동자 좌표(0~1)를 tanh 기반 비선형 가속과 Y축 데드존 보정을 적용해
   * 화면 픽셀 좌표로 변환한다.
   * @param point 0~1 정규화된 랜드마크 좌표
   * @param screen 변환 대상 화면 크기
   * @param gainOverride 캘리브레이션 데이터 기반으로 동적으로 조정되는 게인/데드존 옵션
   * @returns 화면 픽셀 좌표로 변환된 시선 좌표 (화면 범위로 clamp됨)
   */
  transformToScreen(
    point: LandmarkPoint,
    screen: ScreenSize,
    gainOverride?: { gainX?: number; gainY?: number; ySoftZone?: boolean },
  ): GazePoint {
    // 0.5 기준 편차
    const dx = point.x - 0.5
    const dy = point.y - 0.5

    // tanh 기반 비선형 gaze acceleration
    //
    // 원리: scaledNorm = 0.5 + tanh(dx * GAIN) * 0.5
    //
    // - tanh(x)는 자연스럽게 (-1, 1)으로 수렴 → 화면 밖으로 나가지 않음
    // - 작은 눈동자 이동도 커서를 화면 가장자리 방향으로 가속
    // - gainOverride: Worker에서 calibrationData 기반으로 동적 조정
    //   (calibration scaleX가 크면 GAIN을 낮춰서 double-amplification 방지)
    //
    // 기본값 (calibration 없을 때):
    // 이전엔 120.0이었으나, 실측 dx 범위(±0.01~0.03)에서는 120이 거의 즉시
    // 포화돼(tanh(120*0.01)≈0.84 ~ tanh(120*0.03)≈0.9985) 중간 지점과 가장자리
    // 지점을 구분하지 못하는 버그가 있었다(gazePipeline.worker.ts의 GAIN_X 동일
    // 버그 수정 참고). 호출부(gazePipeline.worker.ts)는 항상 gainOverride로 직접
    // 값을 넘기므로 이 기본값은 실제로 쓰이진 않지만, 혼동 방지를 위해 같은 값으로
    // 맞춘다.
    //   dx=±0.01 → tanh(±0.5)  ≈ ±0.462 → 화면 46% 커버
    //   dx=±0.02 → tanh(±1.0)  ≈ ±0.762 → 화면 76% 커버
    //   dx=±0.03 → tanh(±1.5)  ≈ ±0.905 → 화면 90% 커버
    const GAIN_X = gainOverride?.gainX ?? 50.0
    const GAIN_Y = gainOverride?.gainY ?? 120.0

    // dy 데드존 보정: GAIN_Y만 올리면 tanh 미분이 dy=0 근처에서 가장 크기(=GAIN_Y 자체)
    // 때문에, 가로로 읽다가 생기는 보통 크기의 수직 드리프트까지 의도적인 다음 줄 이동과
    // 거의 동일하게 증폭돼 "오른쪽으로 가려는데 대각선 아래로 너무 빠진다"는 현상이
    // 나타남.
    // (※ 이전에 시도한 거듭제곱(x^1.6) 커브는 dy=0 근처는 잘 죽였지만, 그 도함수가
    //  dy_max 쪽으로 갈수록 1을 넘어 오히려 기존보다 더 출렁이게 만들었음 — 그 결과
    //  y=0.78 캘리브레이션 점(9/11번, dy≈0.035)이 그 증폭 구간에 정확히 걸려 노이즈가
    //  거의 2배로 커지고 다시 stall이 재발함. 거듭제곱 대신 "데드존 + 선형 재척도"로
    //  교체: DEADZONE 이하 dy는 완전히 무시(0)하고, 그 이상은 dy_max가 그대로 dy_max로
    //  매핑되도록 일정한 비율로만 선형 확대한다. 도함수가 구간 전체에서 상수(약 1.29)로
    //  고정되므로 어떤 dy 값에서도 노이즈가 추가로 증폭되는 구간이 생기지 않는다.)
    //
    // ※ 캘리브레이션 진행 중(ySoftZone=false)에는 이 데드존을 끈다. 캘리브레이션은 점마다
    //  실제 raw dy를 그대로 측정해 다항식을 학습해야 하는데, dy_max=0.054는 일반적인
    //  추정치일 뿐이라 사용자별 실측 dy가 데드존(0.012) 근처거나 그보다 작으면 신호가
    //  과도하게 깎여 목표 지점에서 한참 못 미치는 위치로 거리 게이트가 영구히 실패함
    //  (9번 점에서 "게이지가 아주 조금 차고 멈춤" 재현 원인). 일반 사용(읽기) 중에만
    //  데드존을 적용해 대각선 쓸림을 줄이고, 캘리브레이션 캡처 구간에서는 원래 신호를
    //  그대로 사용해 점 구분 정확도를 지킨다.
    const ySoftZone = gainOverride?.ySoftZone ?? true
    // const DY_MAX = 0.054 // 캘리브레이션 기준 실측 최대 하방 dy
    // PDF 뷰어에서 "위아래로 너무 많이 움직인다"는 후속 보고의 원인:
    // 데드존(DY_DEADZONE) 자체는 작은 흔들림을 잘 죽였지만, 데드존 이후 구간을
    // DY_MAX/(DY_MAX - DEADZONE/2) ≈ 1.125배로 다시 "증폭"해서 큰 dy까지 동일하게
    // DY_MAX에 매핑되도록 했었음 — 이 1.125배 증폭이 GAIN_Y=45(이전엔 35)와 곱해져
    // 보통 크기의 수직 시선 이동까지 화면상으로는 과하게 크게 움직이는 결과를 낳았음.
    // → 증폭(scale>1)을 없애고 데드존만큼만 원점에서 평행 이동(scale=1)시킨다.
    // 데드존도 0.012→0.016으로 살짝 넓혀 작은 흔들림을 더 죽인다.
    const DY_DEADZONE = 0.016 // 이 이하의 수직 편차는 읽기 중 자연스러운 드리프트로 간주해 약하게 억제

    // PDF 뷰어에서 "커서가 아래로 안 내려가다가 꿀렁꿀렁 튄다"는 증상의 원인:
    // 기존에는 |dy| <= DEADZONE 구간을 완전히 0으로 끊어버리고 그 이상부터 선형으로
    // 다시 스케일링했음 — 값 자체는 DEADZONE 경계에서 연속(0)이지만 "기울기"가
    // 0 → 약 1.29로 그 경계에서 즉시 점프함(미분 불연속, 꺾임). 실제 읽기 중 dy는
    // 노이즈로 이 경계 값 근처를 계속 넘나드는데, 그때마다 "전혀 안 움직임"과
    // "갑자기 움직임"이 프레임 단위로 번갈아 나타나 끊기듯 튀어 보였고, 평소 작은
    // 하방 시선 이동(다음 줄로 살짝 내려가는 정도)은 대부분 DEADZONE 미만이라
    // 거의 항상 0으로 끊겨 "아래로 내려가지 않는" 저항감으로 느껴졌음.
    // → 완전한 0-구간 대신 DEADZONE 이하에서는 2차 곡선(soft-knee)으로 부드럽게
    //   감쇠시키고, DEADZONE 경계에서 값과 기울기가 모두 일치하도록 이어 붙여
    //   꺾임(미분 불연속) 자체를 없앤다. 작은 dy도 약하지만 0은 아닌 반응을 가지므로
    //   "전혀 안 움직임" 현상이 사라지고, 경계를 넘나들어도 더 이상 급격한 단차가
    //   생기지 않는다. 큰 시선 이동(dy_max)에서의 최종 매핑은 기존과 동일하게 유지.
    const absDy = Math.abs(dy)
    const shapedMagnitude = ySoftZone
      ? absDy <= DY_DEADZONE
        ? (absDy * absDy) / (2 * DY_DEADZONE) // soft-knee: 0에서 0, DEADZONE에서 DEADZONE/2, 기울기 0→1로 연속 증가
        : absDy - DY_DEADZONE / 2 // soft-knee 구간과 값·기울기(=1)가 모두 연속으로 이어지는 직선
      : absDy
    const dyShaped = ySoftZone
      ? Math.sign(dy) * shapedMagnitude // scale=1: 더 이상 증폭하지 않음
      : dy

    // 감도 적용 및 중앙 기준 복원 후 0~1 클램프
    const scaledNormalizedX = 0.5 + Math.tanh(dx * GAIN_X) * 0.5
    const scaledNormalizedY = 0.5 + Math.tanh(dyShaped * GAIN_Y) * 0.5

    const x = scaledNormalizedX * screen.width
    const y = scaledNormalizedY * screen.height

    return {
      x: this.clamp(x, 0, screen.width),
      y: this.clamp(y, 0, screen.height),
      timestamp: Date.now(),
    }
  }

  /*
   * screen → normalized
   */
  /**
   * 화면 픽셀 좌표를 0~1 정규화 좌표로 변환한다.
   * @param point 화면 픽셀 좌표
   * @param screen 기준 화면 크기
   * @returns 정규화된 좌표 (z는 항상 0)
   */
  transformToNormalized(
    point: GazePoint,
    screen: ScreenSize,
  ): LandmarkPoint {
    return {
      x:
        point.x / screen.width,

      y:
        point.y / screen.height,

      z: 0,
    }
  }

  /*
   * screen → canvas local
   */
  /**
   * 화면 좌표를 캔버스 로컬 좌표로 변환한다 (캔버스 bounding rect 기준 상대 좌표).
   * @param point 화면 좌표
   * @param canvasRect 캔버스 엘리먼트의 bounding rect
   * @returns 캔버스 내부 기준 상대 좌표
   */
  transformToCanvas(
    point: GazePoint,
    canvasRect: DOMRect,
  ): GazePoint {
    return {
      x:
        point.x - canvasRect.left,

      y:
        point.y - canvasRect.top,

      timestamp:
        point.timestamp,
    }
  }

  /*
   * viewport ratio 반환
   *
   * pixel → 0~1 ratio
   */
  /**
   * 화면 픽셀 좌표를 뷰포트 비율(0~1)로 변환한다.
   * @param point 화면 픽셀 좌표
   * @param screen 기준 화면 크기
   * @returns 0~1 비율 좌표 (z는 항상 0)
   */
  toViewportRatio(
    point: GazePoint,
    screen: ScreenSize,
  ): LandmarkPoint {
    return {
      x:
        point.x / screen.width,

      y:
        point.y / screen.height,

      z: 0,
    }
  }

  /*
   * PDF coordinate 변환
   */
  /**
   * 화면 좌표를 캔버스 영역 기준 비율로 환산한 뒤 PDF 페이지 좌표계로 변환한다.
   * @param point 화면 좌표
   * @param canvasRect 캔버스 엘리먼트의 bounding rect
   * @param pdfWidth PDF 페이지 너비
   * @param pdfHeight PDF 페이지 높이
   * @returns PDF 좌표계 기준 좌표
   */
  transformToPdfSpace(
    point: GazePoint,
    canvasRect: DOMRect,
    pdfWidth: number,
    pdfHeight: number,
  ): GazePoint {
    const relativeX =
      (
        point.x - canvasRect.left
      ) / canvasRect.width

    const relativeY =
      (
        point.y - canvasRect.top
      ) / canvasRect.height

    return {
      x:
        relativeX * pdfWidth,

      y:
        relativeY * pdfHeight,

      timestamp:
        point.timestamp,
    }
  }

  /*
   * linear interpolation
   *
   * alpha:
   * 0 = previous
   * 1 = current
   */
  /**
   * 이전 좌표와 현재 좌표 사이를 선형 보간한다.
   * @param previous 이전 좌표
   * @param current 현재 좌표
   * @param alpha 보간 비율 (0 = previous, 1 = current), 기본값 0.15
   * @returns 보간된 좌표 (timestamp는 current 기준)
   */
  interpolate(
    previous: GazePoint,
    current: GazePoint,
    alpha = 0.15,
  ): GazePoint {
    return {
      x:
        previous.x +
        (
          current.x - previous.x
        ) * alpha,

      y:
        previous.y +
        (
          current.y - previous.y
        ) * alpha,

      timestamp:
        current.timestamp,
    }
  }

  /*
   * clamp utility
   */
  /**
   * 값을 [min, max] 범위로 제한한다.
   * @param value 입력 값
   * @param min 최소값
   * @param max 최대값
   * @returns 범위 내로 제한된 값
   */
  private clamp(
    value: number,
    min: number,
    max: number,
  ): number {
    return Math.min(
      Math.max(value, min),
      max,
    )
  }
}

// src/infrastructure/mediapipe/LandmarkExtractor.ts

import type {
  FaceLandmark,
  LandmarkPoint,
  EyeRegion,
  FaceBounds,
  HeadRotation,
} from '@domain/models/FaceLandmark'

/*
 * MediaPipe NormalizedLandmark 최소 타입
 *
 * Domain이 MediaPipe 타입을 직접 import 하지 않도록
 * infrastructure 내부에서만 사용한다.
 */
export interface MediaPipeLandmark {
  x: number
  y: number
  z: number
}

/**
 * MediaPipe FaceMesh가 반환하는 정규화 좌표 landmark 배열을
 * 도메인의 FaceLandmark 모델(눈 영역, 얼굴 경계, 머리 회전 등)로 변환하는 어댑터.
 */
export class LandmarkExtractor {
  /*
   * MediaPipe 결과 → Domain 모델 변환
   */
  /**
   * MediaPipe landmark 배열을 도메인 FaceLandmark로 변환한다.
   * 좌표 매핑, 눈 영역 추출, 얼굴 경계 계산, 머리 회전 추정을 한 번에 수행한다.
   *
   * @param landmarks MediaPipe가 반환한 정규화 landmark 좌표 배열
   * @param confidence 검출 신뢰도 (0~1)
   * @returns 변환된 도메인 FaceLandmark 객체
   */
  extract(
    landmarks: MediaPipeLandmark[],
    confidence: number,
  ): FaceLandmark {
    const points = this.mapPoints(landmarks)

    const leftEye = this.extractLeftEye(points)
    const rightEye = this.extractRightEye(points)

    const bounds = this.calculateBounds(points)

    const rotation = this.estimateHeadRotation(
      leftEye.center,
      rightEye.center,
    )

    return {
      points,

      leftEye,
      rightEye,

      bounds,

      rotation,

      confidence,

      timestamp: Date.now(),
    }
  }

  /*
   * MediaPipe landmark → Domain point
   */
  /**
   * MediaPipe landmark 배열을 도메인 LandmarkPoint 배열로 매핑한다.
   *
   * @param landmarks MediaPipe landmark 좌표 배열
   * @returns 도메인 LandmarkPoint 배열
   */
  private mapPoints(
    landmarks: MediaPipeLandmark[],
  ): LandmarkPoint[] {
    return landmarks.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
    }))
  }

  /*
   * 왼쪽 눈 추출
   *
   * MediaPipe FaceMesh 기준 landmark index 사용
   */
  /**
   * 왼쪽 눈 영역을 추출한다. MediaPipe FaceMesh의 고정 landmark 인덱스
   * (33, 133, 159, 145)를 기준으로 좌/우/상/하 경계점을 가져온다.
   *
   * @param points 전체 landmark 포인트 배열
   * @returns 왼쪽 눈 영역 정보(EyeRegion)
   */
  private extractLeftEye(
    points: LandmarkPoint[],
  ): EyeRegion {
    const left = points[33]
    const right = points[133]

    const top = points[159]
    const bottom = points[145]

    return this.buildEyeRegion(
      left,
      right,
      top,
      bottom,
    )
  }

  /*
   * 오른쪽 눈 추출
   */
  /**
   * 오른쪽 눈 영역을 추출한다. MediaPipe FaceMesh의 고정 landmark 인덱스
   * (362, 263, 386, 374)를 기준으로 좌/우/상/하 경계점을 가져온다.
   *
   * @param points 전체 landmark 포인트 배열
   * @returns 오른쪽 눈 영역 정보(EyeRegion)
   */
  private extractRightEye(
    points: LandmarkPoint[],
  ): EyeRegion {
    const left = points[362]
    const right = points[263]

    const top = points[386]
    const bottom = points[374]

    return this.buildEyeRegion(
      left,
      right,
      top,
      bottom,
    )
  }

  /*
   * EyeRegion 생성
   */
  /**
   * 좌/우/상/하 경계점으로부터 눈 중심, 가로/세로 길이, 개안율(openness)을
   * 계산하여 EyeRegion 객체를 생성한다.
   *
   * @param left 눈 좌측 경계점
   * @param right 눈 우측 경계점
   * @param top 눈 상단 경계점
   * @param bottom 눈 하단 경계점
   * @returns 계산된 EyeRegion
   */
  private buildEyeRegion(
    left: LandmarkPoint,
    right: LandmarkPoint,
    top: LandmarkPoint,
    bottom: LandmarkPoint,
  ): EyeRegion {
    const width = this.distance(left, right)
    const height = this.distance(top, bottom)

    return {
      center: {
        x: (left.x + right.x) / 2,
        y: (top.y + bottom.y) / 2,
        z: (left.z + right.z) / 2,
      },

      left,
      right,

      top,
      bottom,

      width,
      height,

      openness: height / width,
    }
  }

  /*
   * 얼굴 bounding box 계산
   */
  /**
   * 전체 landmark 포인트의 최소/최대 x, y 값으로 얼굴 bounding box를 계산한다.
   *
   * @param points 전체 landmark 포인트 배열
   * @returns 얼굴 경계 영역(FaceBounds)
   */
  private calculateBounds(
    points: LandmarkPoint[],
  ): FaceBounds {
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)

    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)

    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    return {
      x: minX,
      y: minY,

      width: maxX - minX,
      height: maxY - minY,
    }
  }

  /*
   * 간단한 head rotation 추정
   *
   * 현재 MVP 수준 구현
   */
  /**
   * 양쪽 눈 중심의 상대 위치로 머리 회전(pitch/yaw/roll)을 근사 추정한다.
   * 정밀한 3D 포즈 추정이 아닌 MVP 수준의 단순 휴리스틱이다.
   *
   * @param leftEye 왼쪽 눈 중심 좌표
   * @param rightEye 오른쪽 눈 중심 좌표
   * @returns 추정된 머리 회전값(HeadRotation)
   */
  private estimateHeadRotation(
    leftEye: LandmarkPoint,
    rightEye: LandmarkPoint,
  ): HeadRotation {
    const dx = rightEye.x - leftEye.x
    const dy = rightEye.y - leftEye.y

    const yaw = dx
    const pitch = dy

    const roll =
      Math.atan2(dy, dx) * (180 / Math.PI)

    return {
      pitch,
      yaw,
      roll,
    }
  }

  /*
   * 두 점 거리 계산
   */
  /**
   * 두 좌표 사이의 유클리드 거리를 계산한다.
   *
   * @param a 첫 번째 점
   * @param b 두 번째 점
   * @returns 두 점 사이 거리
   */
  private distance(
    a: LandmarkPoint,
    b: LandmarkPoint,
  ): number {
    const dx = a.x - b.x
    const dy = a.y - b.y

    return Math.sqrt(dx * dx + dy * dy)
  }

  /*
  * iris 중심 기반 gaze landmark 추출
  */
  /**
   * 양쪽 눈동자(iris) 중심 좌표의 평균으로 시선 추정에 사용할 landmark 포인트를 구한다.
   * iris landmark가 없는 경우(예: 모델이 iris를 출력하지 않는 설정) null을 반환한다.
   *
   * @param points 전체 landmark 포인트 배열
   * @returns iris 중심 평균 좌표, 또는 iris 포인트가 없으면 null
   */
  extractGazePoint(
    points: LandmarkPoint[],
  ): LandmarkPoint | null {
    /*
    * MediaPipe FaceMesh iris landmark indices
    */
    const leftIris = points[468]
    const rightIris = points[473]

    if (!leftIris || !rightIris) {
      return null
    }

    return {
      x:
        (leftIris.x + rightIris.x) / 2,

      y:
        (leftIris.y + rightIris.y) / 2,

      z:
        (leftIris.z + rightIris.z) / 2,
    }
  }
}

// src/domain/models/FaceLandmark.ts

/**
 * 3차원 랜드마크 좌표 (정규화 또는 화면 기준 x, y, z).
 */
export interface LandmarkPoint {
  x: number
  y: number
  z: number
}

/**
 * 한쪽 눈의 영역 정보 (중심/경계 좌표, 크기, 눈 뜬 정도).
 */
export interface EyeRegion {
  center: LandmarkPoint

  top: LandmarkPoint
  bottom: LandmarkPoint

  left: LandmarkPoint
  right: LandmarkPoint

  width: number
  height: number

  openness: number
}

/**
 * 얼굴의 bounding box 좌표 및 크기.
 */
export interface FaceBounds {
  x: number
  y: number

  width: number
  height: number
}

/**
 * 머리 회전 각도 (pitch/yaw/roll).
 */
export interface HeadRotation {
  pitch: number
  yaw: number
  roll: number
}

/**
 * 한 프레임에서 검출된 얼굴 랜드마크 전체 정보.
 * 추적 파이프라인의 표준 입력/출력 단위로 사용된다.
 */
export interface FaceLandmark {
  /*
   * 전체 landmark 원본
   */
  points: LandmarkPoint[]

  /*
   * 왼쪽 눈 정보
   */
  leftEye: EyeRegion

  /*
   * 오른쪽 눈 정보
   */
  rightEye: EyeRegion

  /*
   * 얼굴 bounding box
   */
  bounds: FaceBounds

  /*
   * 얼굴 회전값
   */
  rotation: HeadRotation

  /*
   * 얼굴 감지 confidence
   */
  confidence: number

  /*
   * timestamp(ms)
   */
  timestamp: number
}

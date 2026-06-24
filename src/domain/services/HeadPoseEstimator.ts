// src/domain/services/HeadPoseEstimator.ts

import type {
  FaceLandmark,
  LandmarkPoint,
} from '@domain/models/FaceLandmark'

import type {
  HeadPose,
} from '@/domain/models/HeadPose'

/**
 * HeadPoseEstimator 동작을 제어하는 설정.
 */
export interface HeadPoseEstimatorConfig {
  /*
   * yaw 증폭 계수
   */
  yawMultiplier: number

  /*
   * pitch 증폭 계수
   */
  pitchMultiplier: number

  /*
   * roll 증폭 계수
   */
  rollMultiplier: number

  /*
   * 최대 회전 clamp
   */
  maxRotation: number
}

const DEFAULT_CONFIG: HeadPoseEstimatorConfig =
{
  yawMultiplier: 120,

  pitchMultiplier: 100,

  rollMultiplier: 180,

  maxRotation: 45,
}

/*
 * MediaPipe FaceMesh 기준 landmark index
 */
/**
 * MediaPipe FaceMesh 랜드마크 배열에서 머리 자세 추정에 사용하는 주요 포인트들의 인덱스.
 */
const LANDMARK_INDEX = {
  noseTip: 1,

  leftEyeOuter: 33,
  rightEyeOuter: 263,

  leftEyeInner: 133,
  rightEyeInner: 362,

  forehead: 10,
  chin: 152,
} as const

/**
 * 얼굴 랜드마크의 기하학적 위치(코, 눈, 이마, 턱)를 이용해 머리의 yaw/pitch/roll
 * 회전 각도를 추정하는 서비스. 별도의 3D 모델 없이 2D 랜드마크 간 상대 위치만으로
 * 간단하게 회전을 근사한다.
 */
export class HeadPoseEstimator {
  private readonly config:
    HeadPoseEstimatorConfig

  constructor(
    config?: Partial<HeadPoseEstimatorConfig>,
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    }
  }

  /*
   * Head pose 추정
   */
  /**
   * 얼굴 랜드마크로부터 머리 자세(yaw/pitch/roll/confidence)를 추정한다.
   * 필요한 랜드마크가 없으면 신뢰도 0인 결과를 반환한다.
   * @param landmark 얼굴 랜드마크 정보
   * @returns 추정된 HeadPose
   */
  estimate(
    landmark: FaceLandmark,
  ): HeadPose {
    const points = landmark.points

    /*
     * landmark 안전성 검증
     */
    if (
      !this.hasRequiredPoints(points)
    ) {
      return {
        yaw: 0,
        pitch: 0,
        roll: 0,

        confidence: 0,
      }
    }

    /*
     * 기준 landmark
     */
    const nose =
      points[
        LANDMARK_INDEX.noseTip
      ]

    const leftEyeOuter =
      points[
        LANDMARK_INDEX.leftEyeOuter
      ]

    const rightEyeOuter =
      points[
        LANDMARK_INDEX.rightEyeOuter
      ]

    const forehead =
      points[
        LANDMARK_INDEX.forehead
      ]

    const chin =
      points[
        LANDMARK_INDEX.chin
      ]

    /*
     * 눈 중심
     */
    const eyeCenterX =
      (leftEyeOuter.x + rightEyeOuter.x)
      / 2

    const eyeCenterY =
      (leftEyeOuter.y + rightEyeOuter.y)
      / 2

    /*
     * yaw 계산
     *
     * nose가 eye center 기준
     * 얼마나 좌우 이동했는가
     */
    const yaw =
      this.clamp(
        -(nose.x - eyeCenterX)
        * this.config.yawMultiplier,

        -this.config.maxRotation,
        this.config.maxRotation,
      )

    /*
     * pitch 계산
     *
     * nose가 eye line 기준
     * 얼마나 상하 이동했는가
     */
    const pitch =
      this.clamp(
        (eyeCenterY - nose.y)
        * this.config.pitchMultiplier,

        -this.config.maxRotation,
        this.config.maxRotation,
      )

    /*
     * roll 계산
     *
     * 양쪽 눈 기울기
     */
    const dx =
      rightEyeOuter.x
      - leftEyeOuter.x

    const dy =
      rightEyeOuter.y
      - leftEyeOuter.y

    const rollRadians =
      Math.atan2(dy, dx)

    const rollDegrees =
      rollRadians * (180 / Math.PI)

    const roll =
      this.clamp(
        rollDegrees,
        -this.config.maxRotation,
        this.config.maxRotation,
      )

    /*
     * confidence 계산
     *
     * face geometry 기반
     * 간단 추정
     */
    const confidence =
      this.calculateConfidence(
        nose,
        forehead,
        chin,
      )

    return {
      yaw,
      pitch,
      roll,

      confidence,
    }
  }

  /*
   * landmark 존재 여부 확인
   */
  /**
   * 머리 자세 추정에 필요한 모든 랜드마크 인덱스가 존재하는지 확인한다.
   * @param points 전체 랜드마크 포인트 배열
   * @returns 필요한 포인트가 모두 존재하면 true
   */
  private hasRequiredPoints(
    points: LandmarkPoint[],
  ): boolean {
    return [
      LANDMARK_INDEX.noseTip,
      LANDMARK_INDEX.leftEyeOuter,
      LANDMARK_INDEX.rightEyeOuter,
      LANDMARK_INDEX.forehead,
      LANDMARK_INDEX.chin,
    ].every(
      (index) =>
        points[index] !== undefined,
    )
  }

  /*
   * confidence 계산
   */
  /**
   * 얼굴 세로 길이와 코의 중심 위치 안정성을 기반으로 추정 신뢰도를 계산한다.
   * 얼굴이 너무 작게(가까이/멀리) 검출되면 0을 반환한다.
   * @param nose 코 끝 랜드마크
   * @param forehead 이마 랜드마크
   * @param chin 턱 랜드마크
   * @returns 0~1 범위의 신뢰도 점수
   */
  private calculateConfidence(
    nose: LandmarkPoint,
    forehead: LandmarkPoint,
    chin: LandmarkPoint,
  ): number {
    /*
     * 얼굴 세로 길이
     */
    const faceHeight =
      Math.abs(
        forehead.y - chin.y,
      )

    /*
     * 너무 작으면 얼굴 불안정
     */
    if (faceHeight < 0.05) {
      return 0
    }

    /*
     * nose 위치 안정성
     */
    const noseCenterRatio =
      Math.abs(
        nose.y
        - ((forehead.y + chin.y) / 2),
      )

    /*
     * normalize
     */
    const score =
      1 - Math.min(
        1,
        noseCenterRatio * 2,
      )

    return Number(
      score.toFixed(3),
    )
  }

  /*
   * 범위 제한
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

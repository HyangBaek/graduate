// src/domain/services/HeadPoseCompensationService.ts

import type {
  HeadPose,
} from '@domain/models/HeadPose'

import type {
  DetectedGazePoint,
} from '@domain/models/GazePoint'

/**
 * HeadPoseCompensationService 동작을 제어하는 설정.
 */
export interface HeadPoseCompensationConfig {
  /*
   * yaw 보정 강도
   *
   * 좌우 회전 영향도
   */
  yawStrength: number

  /*
   * pitch 보정 강도
   *
   * 상하 회전 영향도
   */
  pitchStrength: number

  /*
   * roll 보정 강도
   */
  rollStrength: number

  /*
   * 최대 보정 허용치
   *
   * normalized 기준
   */
  maxCompensation: number

  /*
   * confidence 최소 허용치
   */
  minConfidence: number

  /*
   * compensation smoothing
   *
   * 0 ~ 1
   */
  smoothingFactor: number
}

const DEFAULT_CONFIG:
  HeadPoseCompensationConfig = {
  yawStrength: 0.0035,

  pitchStrength: 0.003,

  rollStrength: 0.0015,

  maxCompensation: 0.12,

  minConfidence: 0.4,

  smoothingFactor: 0.2,
}

/**
 * 머리 자세로부터 계산된 시선 보정 offset.
 */
interface CompensationOffset {
  x: number
  y: number
}

/**
 * 머리 자세(yaw/pitch/roll)에 따라 발생하는 시선 추정 오차를 보정하는 서비스.
 * 머리가 회전한 방향과 반대로 시선 좌표를 이동시켜 보정하며, 급격한 보정값 변화를
 * 막기 위해 EMA 평활화를 적용한다.
 */
export class HeadPoseCompensationService {
  private readonly config:
    HeadPoseCompensationConfig

  /*
   * 이전 compensation 저장
   *
   * sudden jump 방지
   */
  private previousOffset:
    CompensationOffset | null = null

  constructor(
    config?: Partial<HeadPoseCompensationConfig>,
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    }
  }

  /*
   * Head pose 기반 gaze 보정
   */
  /**
   * 머리 자세를 기반으로 시선 좌표를 보정한다.
   * pose의 신뢰도가 minConfidence보다 낮으면 보정 없이 원본 시선을 그대로 반환한다.
   * @param gaze 보정 전 시선 좌표
   * @param pose 현재 머리 자세 추정값
   * @returns 보정된 시선 좌표 (0~1 범위로 clamp됨)
   */
  compensate(
    gaze: DetectedGazePoint,
    pose: HeadPose,
  ): DetectedGazePoint {
    /*
     * pose confidence 낮으면
     * 원본 반환
     */
    if (
      pose.confidence
      < this.config.minConfidence
    ) {
      return gaze
    }

    /*
     * yaw compensation
     *
     * 머리를 오른쪽으로 돌리면
     * 실제 gaze는 반대 방향 보정
     */
    const yawOffset =
      pose.yaw
      * this.config.yawStrength

    /*
     * pitch compensation
     */
    const pitchOffset =
      pose.pitch
      * this.config.pitchStrength

    /*
     * roll compensation
     *
     * roll은 영향 적음
     */
    const rollOffset =
      pose.roll
      * this.config.rollStrength

    /*
     * 최종 offset 계산
     */
    const targetOffset = {
      x:
        -(yawOffset)
        - (rollOffset * 0.5),

      y:
        -(pitchOffset)
        + (Math.abs(rollOffset) * 0.2),
    }

    /*
     * smoothing 적용
     */
    const smoothedOffset =
      this.applySmoothing(
        targetOffset,
      )

    /*
     * compensation clamp
     */
    const compensatedX =
      this.clamp(
        gaze.x + smoothedOffset.x,
        0,
        1,
      )

    const compensatedY =
      this.clamp(
        gaze.y + smoothedOffset.y,
        0,
        1,
      )

    return {
      ...gaze,

      x: compensatedX,

      y: compensatedY,
    }
  }

  /*
   * smoothing 처리
   *
   * sudden movement 감소
   */
  /**
   * 목표 보정 offset에 EMA 평활화를 적용해 프레임 간 급격한 변화를 줄인다.
   * @param target 이번 프레임에서 계산된 목표 offset
   * @returns 평활화된 offset
   */
  private applySmoothing(
    target: CompensationOffset,
  ): CompensationOffset {
    /*
     * 최초 frame
     */
    if (!this.previousOffset) {
      this.previousOffset = target

      return target
    }

    const alpha =
      this.config.smoothingFactor

    const smoothed = {
      x:
        this.previousOffset.x
        + (
          target.x
          - this.previousOffset.x
        ) * alpha,

      y:
        this.previousOffset.y
        + (
          target.y
          - this.previousOffset.y
        ) * alpha,
    }

    this.previousOffset = smoothed

    return smoothed
  }

  /*
   * compensation reset
   */
  /**
   * 이전 보정 offset 상태를 초기화한다.
   */
  reset(): void {
    this.previousOffset = null
  }

  /*
   * clamp
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

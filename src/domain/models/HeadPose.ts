// src/domain/models/HeadPose.ts

/**
 * 머리 자세(pose) 추정 결과.
 * yaw/pitch/roll 회전값과 추정 신뢰도를 포함하며, gaze 보정(HeadPoseCompensationService)에 사용된다.
 */
export interface HeadPose {
  /*
   * 좌우 회전
   *
   * -값:
   * 왼쪽 회전
   *
   * +값:
   * 오른쪽 회전
   */
  yaw: number

  /*
   * 상하 회전
   *
   * -값:
   * 아래 방향
   *
   * +값:
   * 위 방향
   */
  pitch: number

  /*
   * 머리 기울기
   *
   * -값:
   * 좌측 기울기
   *
   * +값:
   * 우측 기울기
   */
  roll: number

  /*
   * 추정 신뢰도
   */
  confidence: number
}

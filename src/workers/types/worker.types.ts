// workers/types/worker.types.ts

import type { LandmarkPoint } from '@/domain/models/FaceLandmark'
import type { DetectedGazePoint } from '@/domain/models/GazePoint'
import type { CalibrationData } from '@/domain/models/CalibrationData'

/** gazePipeline.worker에 전달되는 뷰포트(화면) 크기. */
export interface WorkerScreenSize {
  width: number
  height: number
}

/** 드웰(응시 유지) 판정에 사용되는 영역 — 사각형 또는 원형. */
export type DwellRegion =
  | RectRegion
  | CircleRegion

/** 사각형 드웰 영역 (좌/우/상/하 경계로 정의). */
export interface RectRegion {
  type: 'rect'
  left: number
  right: number
  top: number
  bottom: number
}

/** 원형 드웰 영역 (중심점과 반지름으로 정의). */
export interface CircleRegion {
  type: 'circle'
  centerX: number
  centerY: number
  radius: number
}

/**
 * gazePipeline.worker로 전달되는 입력 메시지 페이로드.
 * 매 프레임마다 메인 스레드에서 전송되며, 워커는 이를 기반으로
 * 시선 좌표 변환·필터링·드웰 판정을 수행한다.
 */
export interface GazeWorkerInput {
  /*
   * raw landmark points
   */
  landmarks: LandmarkPoint[]

  /*
   * frame timestamp
   */
  timestamp: number

  /*
   * viewport size
   */
  screen: WorkerScreenSize

  /*
   * dwell region
   */
  dwellRegion: DwellRegion

  /*
   * calibration data
   */
  calibrationData?: CalibrationData | null

  /*
   * is calibrating flag
   */
  isCalibrating?: boolean

  /*
   * PDF page coordinates bounding box
   */
  pdfBounds?: { x: number; y: number; width: number; height: number } | null

  /*
   * current calibration point index
   */
  currentPointIndex?: number

  /*
   * whether cognitive pause / navigation pause is active in the main thread
   */
  isNavigationPaused?: boolean
}

/**
 * gazePipeline.worker가 매 프레임 처리 후 메인 스레드로 반환하는 출력 페이로드.
 * raw/filtered/uncalibrated 세 가지 좌표 스트림과 페이지 네비게이션(dwell) 상태를 포함한다.
 */
export interface GazeWorkerOutput {
  fps: number

  raw: DetectedGazePoint | null

  filtered: DetectedGazePoint | null

  uncalibrated: DetectedGazePoint | null

  shouldNavigateNext: boolean
  shouldNavigatePrev: boolean

  nextProgress: number
  prevProgress: number

  headPose?: { yaw: number; pitch: number; roll: number } | null
  baselineX?: number
  baselineY?: number

  /*
   * irisBaseline 학습(고정) 완료 여부.
   * 캘리브레이션 0번(중앙)점은 baseline이 잠기기 전(~1초)에는 centered 좌표 자체가
   * 아직 수렴 중이라 distance gate가 신뢰할 수 없음 — Presentation에서 이 값으로
   * 0번 점의 게이트를 일시 면제할 수 있도록 노출.
   */
  isBaselineLocked: boolean
}

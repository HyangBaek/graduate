// src/domain/models/DwellRegion.ts

/**
 * dwell 영역의 도형 종류 (사각형 또는 원형).
 */
export type DwellRegionShape = 'rect' | 'circle'

/**
 * dwell 영역 좌표의 기준 공간 (화면 픽셀 좌표 또는 0~1 정규화 좌표).
 */
export type DwellRegionSpace = 'screen' | 'normalized'

/**
 * 모든 dwell 영역이 공통으로 갖는 기본 속성.
 */
export interface DwellRegionBase {
  id: string

  /*
   * 어떤 UI 요소인지
   */
  type?: 'button' | 'page' | 'hotspot' | 'custom'

  /*
   * 좌표 기준
   */
  space: DwellRegionSpace

  /*
   * dwell 안정성 보정값
   */
  tolerance?: number

  /*
   * 활성화 여부
   */
  enabled?: boolean
}

/**
 * 사각형 형태의 dwell 영역.
 */
export interface DwellRectRegion extends DwellRegionBase {
  shape: 'rect'

  left: number
  right: number
  top: number
  bottom: number
}

/**
 * 원형 형태의 dwell 영역.
 */
export interface DwellCircleRegion extends DwellRegionBase {
  shape: 'circle'

  centerX: number
  centerY: number

  radius: number
}

/**
 * dwell 도형 타입 (DwellRegionShape와 동일한 값 집합).
 */
export type DwellShape =
  | 'rect'
  | 'circle'

/**
 * DwellDetectionService에서 실제로 사용하는 dwell 영역 판별 유니언 타입.
 * rect/circle 종류에 따라 필요한 좌표 필드가 다르다.
 */
export type DwellRegion =
  | {
      type: 'rect'
      left: number
      right: number
      top: number
      bottom: number
    }
  | {
      type: 'circle'
      centerX: number
      centerY: number
      radius: number
      tolerance?: number
    }

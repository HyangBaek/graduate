// src/types/types.ts

// 기존에 사용 중인 기본 2D 포인트 타입
/**
 * 2차원 좌표를 나타내는 튜플 타입. [x, y] 순서로 고정된다.
 */
export type Point = [number, number];

/**
 * 시선 추적 결과 좌표를 나타내는 GazePoint 구조
 */
export interface GazePoint {
  x: number;       // 화면 상의 X 좌표 (픽셀 또는 정규화 값)
  y: number;       // 화면 상의 Y 좌표 (픽셀 또는 정규화 값)
  timestamp: number; // 칼만 필터 및 시계열 분석을 위한 타임스탬프
}

/**
 * 칼리브레이션 수집 단계를 위한 수집 포인트 구조
 */
export interface CalibrationPoint {
  id: string;            // 각 칼리브레이션 포인트의 고유 식별자 (예: 'top_left', 'center')
  
  // 1. 화면에 표시되는 목표 좌표 (Ground Truth)
  // mathUtils의 src 또는 dst 매개변수로 직결되는 픽셀/정규화 좌표
  targetPoint: Point;    // [x, y] 형태
  
  // 2. 해당 포인트를 바라볼 때 수집된 실제 시선 추정 데이터 배열 (여러 프레임을 모아서 평균 내기 위함)
  collectedSamples: {
    headVector: number[];      // getHeadVector()의 출력값 [x, y, z]
    faceOrigin3D: number[];    // computeFaceOrigin3D()의 출력값 [x, y, z]
    estimatedPoint: Point;     // 모델이 1차로 예측한 시선 좌표 [x, y]
  }[];
  
  isCompleted: boolean;  // 해당 포인트의 데이터 수집 완료 여부
}

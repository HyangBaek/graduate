// src/infrastructure/mediapipe/MediaPipeConfig.ts

/**
 * MediaPipe FaceLandmarker(Vision Task) 초기화에 사용되는 고정 설정값.
 * WASM/모델 자산 경로와 추론 옵션을 한곳에 모아 관리한다.
 */
export const MEDIAPIPE_CONFIG = {
  // 로컬 서빙: public/mediapipe/wasm/ (vite build 시 자동 복사)
  // CDN 대신 로컬 → 네트워크 왕복 없음, 브라우저 캐시 영구 적용
  visionBasePath:
    '/mediapipe/wasm',

  // 로컬 서빙: public/mediapipe/face_landmarker.task (~10MB)
  // 없으면 pnpm run setup:mediapipe 실행 (최초 1회)
  modelAssetPath:
    '/mediapipe/face_landmarker.task',

  // 동시에 추적할 최대 얼굴 수 (시선 추적은 사용자 1명만 대상으로 함)
  numFaces: 1,

  // 비디오 스트림 연속 프레임을 처리하는 모드 (이미지 1장 처리용 'IMAGE'와 구분)
  runningMode: 'VIDEO' as const,

  // blendshape/변환 행렬 출력은 시선 추적에 불필요 — 끌수록 추론 비용 절감
  outputFaceBlendshapes: false,

  outputFacialTransformationMatrixes: false,
}

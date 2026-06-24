// src/types/video-frame.d.ts

/**
 * requestVideoFrameCallback 콜백에 전달되는 메타데이터.
 * 표준 lib.dom.d.ts에 아직 포함되지 않은 Web API라 별도로 선언한다.
 */
interface VideoFrameCallbackMetadata {
  presentationTime: number
  expectedDisplayTime: number
  width: number
  height: number
  mediaTime: number
  presentedFrames: number
  processingDuration?: number
}

/**
 * requestVideoFrameCallback에 전달할 콜백 함수 시그니처.
 * @param now 콜백이 실행된 시각(고해상도 타임스탬프)
 * @param metadata 해당 프레임에 대한 메타데이터
 */
type VideoFrameRequestCallback = (
  now: DOMHighResTimeStamp,
  metadata: VideoFrameCallbackMetadata,
) => void

/**
 * HTMLVideoElement 확장: 프레임 단위 콜백 API.
 * 모든 브라우저에서 지원하지 않으므로 옵셔널(?)로 선언한다.
 */
interface HTMLVideoElement {
  requestVideoFrameCallback?(
    callback: VideoFrameRequestCallback,
  ): number

  cancelVideoFrameCallback?(
    handle: number,
  ): void
}

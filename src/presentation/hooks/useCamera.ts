// src/presentation/hooks/useCamera.ts

// import {
//   useCallback,
//   useEffect,
//   useRef,
//   useState,
// } from 'react'

// import { waitForVideoReady }
//   from '@/shared/utils/waitForVideoReady'

/**
 * 카메라 접근 권한 상태를 나타내는 타입.
 * permission 상태
 */
export type CameraPermissionState =
  | 'unknown'
  | 'prompt'
  | 'granted'
  | 'denied'

/**
 * 카메라가 준비 완료되었을 때 콜백으로 전달되는 데이터.
 * camera ready payload
 * @property stream 활성화된 MediaStream
 * @property video 스트림이 연결된 video 엘리먼트
 */
export interface CameraReadyPayload {
  stream: MediaStream

  video: HTMLVideoElement
}

/**
 * useCamera(확장판, 현재 미사용) 훅에 전달할 수 있는 옵션.
 * hook options
 */
export interface UseCameraOptions {
  /*
   * media constraints
   */
  video?: MediaTrackConstraints

  /*
   * audio 사용 여부
   */
  audio?: boolean

  /*
   * 자동 시작 여부
   */
  autoStart?: boolean

  /*
   * camera 준비 완료 callback
   */
  onCameraReady?: (
    payload: CameraReadyPayload,
  ) => void

  /*
   * 에러 callback
   */
  onError?: (
    error: Error,
  ) => void
}

/**
 * useCamera(확장판, 현재 미사용) 훅의 반환 값 형태.
 * 참고: 현재 활성 useCamera 구현은 이 타입과 일치하지 않으며
 * startCamera/stopCamera만 반환한다(아래 실제 구현 참고).
 * hook return
 */
export interface UseCameraReturn {
  /*
   * video element ref
   */
  videoRef:
    React.RefObject<HTMLVideoElement | null>

  /*
   * 현재 stream 상태
   * UI 표시용
   */
  stream: MediaStream | null

  /*
   * 카메라 로딩 여부
   */
  isLoading: boolean

  /*
   * 카메라 활성화 여부
   */
  isStreaming: boolean

  /*
   * permission 상태
   */
  permissionState:
    CameraPermissionState

  /*
   * 에러 메시지
   */
  error: string | null

  /*
   * 카메라 시작
   */
  startCamera: () => Promise<void>

  /*
   * 카메라 종료
   */
  stopCamera: () => void
}

/*
 * 기본 camera preset
 *
 * MediaPipe MVP 기준
 */
// const DEFAULT_VIDEO_CONSTRAINTS:
//   MediaTrackConstraints = {
//   width: {
//     ideal: 640,
//   },

//   height: {
//     ideal: 480,
//   },

//   frameRate: {
//     ideal: 30,
//     max: 30,
//   },

//   facingMode: 'user',
// }

/**
 * 웹캠 스트림을 시작/종료하는 최소 구현의 카메라 훅.
 * 전달된 video 엘리먼트에 getUserMedia로 얻은 스트림을 연결해 재생을
 * 시작한다. (아래 주석 처리된 확장판과 달리 권한 상태, 로딩 상태,
 * abort 처리 등은 포함하지 않은 단순 버전이다.)
 *
 * @returns startCamera(video): 카메라 시작 함수, stopCamera(): 종료 함수
 */
export const useCamera = () => {
  /**
   * 전달된 video 엘리먼트에 웹캠 스트림을 연결하고 재생을 시작한다.
   * @param video 스트림을 연결할 video 엘리먼트
   * @returns 재생이 시작된 video 엘리먼트
   * @throws getUserMedia 권한 거부 등으로 스트림 획득에 실패하면 예외 발생
   */
  const startCamera = async (
    video: HTMLVideoElement,
  ): Promise<HTMLVideoElement> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    })

    video.srcObject = stream
    video.playsInline = true
    video.autoplay = true
    video.muted = true

    await video.play()

    return video
  }

  /**
   * 카메라 정리 작업을 수행한다 (현재는 별도 동작 없음).
   */
  const stopCamera = () => {
    // optional cleanup
  }

  return {
    startCamera,
    stopCamera,
  }
}
// export function useCamera(
//   options: UseCameraOptions = {},
// ): UseCameraReturn {
//   const {
//     video = DEFAULT_VIDEO_CONSTRAINTS,

//     audio = false,

//     autoStart = false,

//     onCameraReady,

//     onError,
//   } = options

//   /*
//    * DOM ref
//    */
//   const videoRef =
//     useRef<HTMLVideoElement | null>(null)

//   /*
//    * active stream
//    * 내부 mutable stream 관리
//    */
//   const streamRef =
//     useRef<MediaStream | null>(null)

//   /*
//    * strict mode 중복 실행 방지
//    */
//   const isStartingRef =
//     useRef(false)

//   /*
//    * async race condition 방지
//    */
//   const abortControllerRef =
//     useRef<AbortController | null>(null)

//   /*
//    * mounted 상태 추적
//    */
//   const mountedRef =
//     useRef(true)

//   /*
//    * UI state
//    */
//   const [stream, setStream] =
//     useState<MediaStream | null>(null)

//   const [isLoading, setIsLoading] =
//     useState(false)

//   const [isStreaming, setIsStreaming] =
//     useState(false)

//   const [error, setError] =
//     useState<string | null>(null)

//   const [
//     permissionState,
//     setPermissionState,
//   ] = useState<CameraPermissionState>(
//     'unknown',
//   )

//   /*
//    * stream cleanup
//    */
//   const cleanupStream = useCallback(() => {
//     const currentStream =
//       streamRef.current

//     if (currentStream) {
//       currentStream
//         .getTracks()
//         .forEach((track) => {
//           track.stop()
//         })
//     }

//     streamRef.current = null

//     if (videoRef.current) {
//       videoRef.current.srcObject = null
//     }

//     if (mountedRef.current) {
//       setStream(null)

//       setIsStreaming(false)
//     }
//   }, [])

//   /*
//    * permission 조회
//    */
//   const checkPermission =
//     useCallback(async () => {
//       try {
//         if (
//           !navigator.permissions
//           || !navigator.permissions.query
//         ) {
//           return
//         }

//         const result =
//           await navigator.permissions.query({
//             name: 'camera' as PermissionName,
//           })

//         if (!mountedRef.current) {
//           return
//         }

//         switch (result.state) {
//           case 'granted':
//             setPermissionState(
//               'granted',
//             )
//             break

//           case 'denied':
//             setPermissionState(
//               'denied',
//             )
//             break

//           case 'prompt':
//           default:
//             setPermissionState(
//               'prompt',
//             )
//             break
//         }
//       } catch {
//         /*
//          * Safari 일부 브라우저 대응
//          */
//       }
//     }, [])

//   /*
//    * 카메라 종료
//    */
//   const stopCamera = useCallback(() => {
//     abortControllerRef.current?.abort()

//     cleanupStream()
//   }, [cleanupStream])

//   /*
//    * 카메라 시작
//    */
//   const startCamera =
//     useCallback(async () => {
//       /*
//        * 중복 실행 방지
//        */
//       if (isStartingRef.current) {
//         return
//       }

//       /*
//        * 이미 실행 중
//        */
//       if (streamRef.current) {
//         return
//       }

//       try {
//         isStartingRef.current = true

//         setError(null)

//         setIsLoading(true)

//         /*
//          * 이전 async 작업 중단
//          */
//         abortControllerRef.current?.abort()

//         const abortController =
//           new AbortController()

//         abortControllerRef.current =
//           abortController

//         const signal =
//           abortController.signal

//         const mediaStream =
//           await navigator.mediaDevices.getUserMedia(
//             {
//               video,
//               audio,
//             },
//           )

//         if (signal.aborted) {
//           mediaStream
//             .getTracks()
//             .forEach((track) => {
//               track.stop()
//             })

//           return
//         }
//       /*
//        * ref 저장
//        */
//       streamRef.current = mediaStream

//       /*
//        * state 저장
//        */
//       setStream(mediaStream)

//       /*
//        * video 연결
//        */
//         const videoElement =
//           videoRef.current

//         if (!videoElement) {
//           throw new Error(
//             'Video element is not mounted.',
//           )
//         }

//         videoElement.srcObject =
//           mediaStream


//         /*
//          * iOS 대응
//          */
//         videoElement.playsInline = true

//         videoElement.muted = true

//         try {
//           await videoElement.play()
//         } catch (error) {
//           console.warn(
//             '[useCamera] video play failed',
//             error,
//           )
//         }

//         await waitForVideoReady(
//           videoElement,
//         )

//         if (signal.aborted) {
//           cleanupStream()
//           return
//         }

//         if (mountedRef.current) {
//           setIsStreaming(true)

//           setPermissionState(
//             'granted',
//           )
//         }

//         onCameraReady?.({
//           stream: mediaStream,

//           video: videoElement,
//         })
//       } catch (err) {
//         console.error(
//           '[useCamera] startCamera error:',
//           err,
//         )

//         cleanupStream()

//         let message =
//           'Failed to access camera'

//         if (err instanceof Error) {
//           message = err.message
//         }

//         /*
//          * 권한 거부 감지
//          */
//         if (
//           err instanceof DOMException
//           && err.name === 'NotAllowedError'
//         ) {
//           setPermissionState(
//             'denied',
//           )
//         }

//         if (mountedRef.current) {
//           setError(message)
//         }

//         onError?.(
//           err instanceof Error
//             ? err
//             : new Error(message),
//         )
//       } finally {
//         if (mountedRef.current) {
//           setIsLoading(false)
//         }

//         isStartingRef.current = false
//       }
//     }, [
//       video,
//       audio,
//       cleanupStream,
//       onCameraReady,
//       onError,
//     ])

//   /*
//    * mount 상태 관리
//    */
//   useEffect(() => {
//     mountedRef.current = true

//     return () => {
//       mountedRef.current = false
//     }
//   }, [])

//   /*
//    * 초기 permission 조회
//    */
//   useEffect(() => {
//     const verifyPermission = async () => {
//       await checkPermission()
//     }

//     void verifyPermission()
//   }, [checkPermission])

//   /*
//    * auto start
//    */
//   useEffect(() => {
//     if (!autoStart) {
//       return
//     }

//     const startTimer = window.setTimeout(() => {
//       void startCamera()
//     }, 0)

//     return () => {
//       window.clearTimeout(startTimer)
//       stopCamera()
//     }
//   }, [
//     autoStart,
//     startCamera,
//     stopCamera,
//   ])

//   /*
//    * unmount cleanup
//    */
//   useEffect(() => {
//     return () => {
//       abortControllerRef.current?.abort()

//       cleanupStream()
//     }
//   }, [cleanupStream])

//   return {
//     videoRef,

//     stream,

//     isLoading,

//     isStreaming,

//     permissionState,

//     error,

//     startCamera,

//     stopCamera,
//   }
// }

// src/shared/utils/waitForVideoReady.ts

/**
 * HTMLVideoElement가 실제로 프레임을 그릴 수 있는 상태(메타데이터 로드 +
 * 유효한 width/height)가 될 때까지 대기한다.
 *
 * 'loadedmetadata'와 'canplay' 이벤트를 모두 구독해 어느 쪽이 먼저 와도
 * 동일한 readiness 체크(handleReady)로 판정하며, 호출 시점에 이미 준비된
 * 경우를 위해 즉시 한 번 더 handleReady()를 실행한다.
 *
 * @param video 준비 상태를 확인할 video 엘리먼트
 * @returns 비디오가 준비되면 resolve되는 Promise
 * @throws 10초 내에 준비되지 않으면 타임아웃 에러로 reject
 */
export const waitForVideoReady = (
  video: HTMLVideoElement,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()

      reject(
        new Error(
          'Timed out waiting for video readiness.',
        ),
      )
    }, 10000)

    const cleanup = () => {
      clearTimeout(timeout)

      video.removeEventListener(
        'loadedmetadata',
        handleReady,
      )

      video.removeEventListener(
        'canplay',
        handleReady,
      )
    }

    const handleReady = () => {
      if (
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        cleanup()

        resolve()
      }
    }

    video.addEventListener(
      'loadedmetadata',
      handleReady,
    )

    video.addEventListener(
      'canplay',
      handleReady,
    )

    handleReady()
  })
}

// src/infrastructure/browser/CameraManager.ts

/**
 * 브라우저 카메라(getUserMedia) 스트림 생명주기를 다루는 어댑터.
 * 시선 추적의 입력 영상 소스를 얻고 해제하는 책임을 가진다.
 */
export class CameraManager {
  /**
   * 카메라/마이크 등의 미디어 스트림을 요청한다.
   *
   * @param constraints getUserMedia에 전달할 제약 조건(해상도, 카메라 종류 등)
   * @returns 획득한 MediaStream
   * @throws 사용자가 권한을 거부했거나 사용 가능한 디바이스가 없는 경우 등
   *   navigator.mediaDevices.getUserMedia가 던지는 예외(NotAllowedError, NotFoundError 등)
   */
  async createStream(
    constraints: MediaStreamConstraints,
  ): Promise<MediaStream> {
    // 브라우저의 getUserMedia API를 그대로 호출 — 권한 프롬프트 및 디바이스 선택은
    // 브라우저가 담당하므로 여기서는 결과 Promise만 전달한다.
    return navigator.mediaDevices.getUserMedia(
      constraints,
    )
  }

  /**
   * 스트림에 포함된 모든 트랙을 정지시켜 카메라 사용을 종료한다.
   * 트랙을 멈추지 않으면 카메라 표시 인디케이터가 계속 켜져 있을 수 있다.
   *
   * @param stream 정지할 MediaStream
   */
  stopStream(stream: MediaStream) {
    stream.getTracks().forEach(track => {
      track.stop()
    })
  }
}

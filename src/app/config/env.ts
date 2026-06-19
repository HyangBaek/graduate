// src/app/config/env.ts

/**
 * 빌드/실행 환경 정보를 노출하는 객체.
 * Vite의 import.meta.env를 감싸 앱 코드에서 환경 분기를 단순화한다.
 */
export const env = {
  isDev: import.meta.env.DEV,
}

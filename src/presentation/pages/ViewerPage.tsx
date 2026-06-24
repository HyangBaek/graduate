// src/presentation/pages/ViewerPage.tsx
// PDF 시선추적 뷰어의 페이지 진입점.
// ViewerLayout을 마운트하는 것 외에 아무 역할도 하지 않습니다.
// 라우터가 이 페이지를 "/" 경로에 매핑합니다.

import { ViewerLayout } from '@/presentation/layouts/ViewerLayout'

export default function ViewerPage() {
  return <ViewerLayout />
}

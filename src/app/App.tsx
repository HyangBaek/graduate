// src/app/App.tsx
//
// 앱 루트 컴포넌트.
// - 테마/밝기 초기화는 main.tsx 모듈 레벨에서 동기 처리 (FOUC 방지)
// - 빈 Provider 래퍼 제거 → AppRouter 직접 렌더
// - ErrorBoundary: 전역 에러를 잡아 홈으로 복귀

import { Component, type ReactNode, type ErrorInfo } from 'react'
import '@/presentation/styles/App.css'
import { AppRouter } from '@app/router/AppRouter'

// ── 전역 ErrorBoundary ────────────────────────────────────────────────────────
/** AppErrorBoundary의 내부 상태 타입. 에러 발생 여부와 발생한 에러 객체를 보관한다. */
interface EBState { hasError: boolean; error?: Error }

/**
 * 앱 전역에서 발생하는 렌더링 에러를 포착하는 React 에러 바운더리.
 * 하위 트리에서 에러가 발생하면 에러 UI(다시 시작 버튼)를 표시하고,
 * 사용자가 버튼을 누르면 상태를 초기화하고 페이지를 새로고침한다.
 */
class AppErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  /**
   * 하위 컴포넌트에서 에러가 throw되면 React가 호출하여 다음 렌더링에 사용할 상태를 계산한다.
   * @param error 하위 트리에서 발생한 에러 객체
   * @returns 에러 발생 상태로 갱신된 EBState
   */
  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error }
  }

  /**
   * 에러가 커밋된 이후 호출되는 라이프사이클 메서드. 에러 로깅 용도로 사용한다.
   * @param error 발생한 에러 객체
   * @param info 컴포넌트 스택 등 에러 관련 부가 정보
   */
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack)
  }

  /**
   * 에러 상태이면 안내 메시지와 다시 시작 버튼을 렌더링하고,
   * 정상 상태이면 하위 children을 그대로 렌더링한다.
   * @returns 에러 UI 또는 children
   */
  render() {
    if (this.state.hasError) {
      return (
        <div className="app-error-boundary">
          <p className="app-error-message">
            오류가 발생했습니다.<br />앱을 다시 시작해 주세요.
          </p>
          <button
            className="app-error-button"
            onClick={() => { this.setState({ hasError: false }); window.location.reload() }}
          >
            다시 시작
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── App ───────────────────────────────────────────────────────────────────────
/**
 * 애플리케이션의 최상위 루트 컴포넌트.
 * 전역 ErrorBoundary로 AppRouter를 감싸 렌더링 중 발생하는 예외를 안전하게 처리한다.
 * @returns 앱 전체 렌더 트리(ErrorBoundary + AppRouter)
 */
export default function App() {
  return (
    <AppErrorBoundary>
      <AppRouter />
    </AppErrorBoundary>
  )
}

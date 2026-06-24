// src/app/router/useAppRouter.ts
// 상태 기반 경량 라우터 (react-router-dom 미사용)
//
// 최적화:
//   settingsClickTimer를 Zustand state에서 제거 → 모듈 레벨 변수로 이동
//   타이머 변경 시 Zustand 구독 컴포넌트가 불필요하게 리렌더되던 문제 해소

import { create } from 'zustand'
import { DEBUG_ENABLED, isDebugPage } from '@app/config/debugFlag'

/** 앱이 가질 수 있는 페이지(화면) 식별자 목록. */
export type AppPage =
  | 'home'
  | 'viewer'
  | 'settings'
  | 'debug'
  | 'calibration-analysis'
  | 'cursor-analysis'

/** 경량 라우터의 전체 상태와 액션을 정의하는 인터페이스. */
export interface AppRouterState {
  currentPage: AppPage
  /** 디버그 진입을 위한 설정 버튼 연속 클릭 카운터 */
  settingsClickCount: number

  /**
   * 지정한 페이지로 이동하고, 필요 시 브라우저 주소(history)를 동기화한다.
   * @param page 이동할 대상 페이지
   */
  navigate: (page: AppPage) => void
  /** 현재 페이지에 따라 적절한 이전 화면(viewer 또는 home)으로 되돌아간다. */
  goBack: () => void
  /** 설정 버튼 클릭 (3번 연속 → debug 진입) */
  onSettingsClick: () => void
}

const TRIPLE_CLICK_INTERVAL_MS = 1500
const DEBUG_CLICK_COUNT = 3

// ── 모듈 레벨 타이머 ─────────────────────────────────────────────────────────
// Zustand state에 두면 타이머 ID 변경마다 구독 컴포넌트가 리렌더됨.
// 모듈 변수로 이동해 state 업데이트 없이 관리.
let _settingsTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 페이지 ↔ URL 경로 매핑. 분석 페이지 2개는 /debug 하위 경로로 묶어
 * "디버그 메뉴에서 들어가는 화면"이라는 관계가 주소에도 드러나게 한다.
 */
const PAGE_TO_PATH: Partial<Record<AppPage, string>> = {
  debug: '/debug',
  'calibration-analysis': '/debug/calibration-analysis',
  'cursor-analysis': '/debug/cursor-analysis',
}

const PATH_TO_PAGE: Record<string, AppPage> = Object.fromEntries(
  Object.entries(PAGE_TO_PATH).map(([page, path]) => [path, page as AppPage]),
)

/**
 * 설정 버튼 3연속 클릭 없이도 /debug 경로로 직접 진입할 수 있게 하기 위한
 * 초기 페이지 판별. 실제 브라우저 라우팅(react-router 등)을 쓰지 않으므로
 * 전체 URL을 동기화하진 않지만, 최초 로드 시 주소창에 /debug,
 * /debug/calibration-analysis, /debug/cursor-analysis를 입력해 두면
 * 곧바로 해당 화면으로 진입한다.
 * @returns 현재 URL 경로에 대응하는 AppPage. 매칭되는 경로가 없으면 'home'.
 */
function getInitialPage(): AppPage {
  if (typeof window === 'undefined') return 'home'
  const path = window.location.pathname.replace(/\/+$/, '')
  const page = PATH_TO_PAGE[path] ?? 'home'
  // 프로덕션 빌드에서는 /debug 계열 주소로 직접 들어와도 home으로 고정한다.
  return DEBUG_ENABLED || !isDebugPage(page) ? page : 'home'
}

/**
 * 경량 상태 기반 라우터 Zustand 훅.
 * react-router-dom 없이 currentPage 상태와 navigate/goBack/onSettingsClick
 * 액션을 통해 앱 내 화면 전환을 관리한다.
 */
export const useAppRouter = create<AppRouterState>((set, get) => ({
  currentPage: getInitialPage(),
  settingsClickCount: 0,

  navigate: (page) => {
    // 프로덕션 빌드에서는 디버그 계열 페이지로의 이동 자체를 막는다 (home으로 대체).
    const targetPage = !DEBUG_ENABLED && isDebugPage(page) ? 'home' : page

    // /debug 계열 경로 동기화: debug/분석 페이지 진입 시 각자의 주소로,
    // 이탈 시 /로 되돌려 새로고침해도 같은 화면이 유지되고 다른 페이지로
    // 가면 주소가 정리된다.
    if (typeof window !== 'undefined') {
      const targetPath = PAGE_TO_PATH[targetPage] ?? '/'
      if (window.location.pathname !== targetPath) {
        window.history.replaceState(null, '', targetPath)
      }
    }
    set({ currentPage: targetPage })
  },

  goBack: () => {
    const { currentPage } = get()
    set({ currentPage: currentPage === 'debug' ? 'viewer' : 'home' })
  },

  onSettingsClick: () => {
    // 프로덕션 빌드에서는 3연속 클릭 카운트 자체를 사용하지 않고 바로 설정 화면으로 이동.
    if (!DEBUG_ENABLED) {
      get().navigate('settings')
      return
    }

    // 이전 타이머 초기화
    if (_settingsTimer !== null) {
      clearTimeout(_settingsTimer)
      _settingsTimer = null
    }

    const nextCount = get().settingsClickCount + 1

    if (nextCount >= DEBUG_CLICK_COUNT) {
      set({ settingsClickCount: 0 })
      get().navigate('debug')
      return
    }

    // 일정 시간 내 추가 클릭 없으면 카운터 리셋 + 설정 화면 이동
    _settingsTimer = setTimeout(() => {
      _settingsTimer = null
      set({ settingsClickCount: 0 })
      get().navigate('settings')
    }, TRIPLE_CLICK_INTERVAL_MS)

    set({ settingsClickCount: nextCount })
  },
}))

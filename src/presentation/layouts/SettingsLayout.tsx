// src/presentation/layouts/SettingsLayout.tsx
// 설정 화면 – 시선추적, 페이지넘김, 디스플레이, 기타

import { useState } from 'react'
import { useAppRouter } from '@/app/router/useAppRouter'
import { useCalibrationStore } from '@/presentation/store/calibrationStore'
import { useGazeStore } from '@/presentation/state/gazeStore'
import { AppInfoModal } from '@/presentation/components/settings/AppInfoModal'

/** localStorage 키 목록 */
const KEYS = {
  gazeEnabled: 'settings_gaze_enabled',
  gazeSensitivity: 'settings_gaze_sensitivity',
  turnMode: 'settings_turn_mode',
  turnDelay: 'settings_turn_delay',
  darkMode: 'settings_dark_mode',
  brightness: 'settings_brightness',
  fileFormat: 'settings_file_format',
}

/**
 * localStorage에서 설정 값을 읽어 JSON으로 파싱한다.
 * @param key localStorage 키
 * @param fallback 값이 없거나 파싱에 실패했을 때 반환할 기본값
 * @returns 파싱된 설정 값 또는 fallback
 */
function loadSetting<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return fallback
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

/**
 * 설정 값을 JSON으로 직렬화해 localStorage에 저장한다.
 * @param key localStorage 키
 * @param value 저장할 값
 */
function saveSetting(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

/**
 * 설정 화면. 시선추적 활성화/감도, 페이지 넘김 방식(자동/수동) 및
 * 딜레이, 다크모드/밝기 등 디스플레이 설정, 파일 형식 등 기타 옵션을
 * 관리한다. 일부 설정(gazeEnabled, turnMode 등)은 뷰어 화면과 동일한
 * 전역 스토어를 직접 구독/제어해 두 화면의 토글이 항상 동기화되도록 한다.
 *
 * @returns 설정 항목들을 섹션별로 보여주는 레이아웃 div
 */
export function SettingsLayout() {
  const navigate = useAppRouter((s) => s.navigate)

  // ── 시선 추적 설정 ──────────────────────────────────────────────
  // 뷰어 화면 ⋮메뉴의 "시선추적 켜기/끄기"와 동일한 gazeStore.trackingEnabled를
  // 그대로 구독/제어 — 두 토글이 항상 같은 상태를 보여주고 같은 효과를 낸다.
  const gazeEnabled = useGazeStore((s) => s.trackingEnabled)
  const setTrackingEnabled = useGazeStore((s) => s.setTrackingEnabled)

  const [gazeSensitivity, setGazeSensitivity] = useState<number>(() =>
    loadSetting(KEYS.gazeSensitivity, 50),
  )

  // GazeCursor 표시 여부 (viewer 라우트에서만 적용)
  const gazeCursorEnabled    = useCalibrationStore((s) => s.gazeCursorEnabled)
  const setGazeCursorEnabled = useCalibrationStore((s) => s.setGazeCursorEnabled)

  // ── 페이지 넘김 설정 ─────────────────────────────────────────────
  // gazeStore.turnMode를 직접 구독/제어 — NavigationRuntime·PageHotzones·
  // UserViewerLayout 하단 바가 같은 값을 읽어 자동/수동 넘김을 분기한다.
  const turnMode = useGazeStore((s) => s.turnMode)
  const setTurnModeStore = useGazeStore((s) => s.setTurnMode)
  // turnDelay: 시선 고정(드웰) 완료 기준 시간(ms). 기본 800ms — Worker 기본값과 일치.
  const setDwellThresholdMs = useGazeStore((s) => s.setDwellThresholdMs)
  const [turnDelay, setTurnDelay] = useState<number>(() =>
    loadSetting(KEYS.turnDelay, 800),
  )

  // ── 디스플레이 설정 ──────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = loadSetting<string | null>(KEYS.darkMode, null)
    return saved !== null
      ? saved === 'true'
      : document.body.classList.contains('dark-mode')
  })
  const [brightness, setBrightness] = useState<number>(() => {
    const val = loadSetting(KEYS.brightness, 100)
    document.body.style.filter = `brightness(${val}%)`
    return val
  })

  const applyBrightness = (value: number) => {
    document.body.style.filter = `brightness(${value}%)`
  }

  const [showAppInfo, setShowAppInfo] = useState(false)

  // ── 핸들러 ──────────────────────────────────────────────────────
  const toggleGaze = () => {
    const next = !gazeEnabled
    setTrackingEnabled(next)
    saveSetting(KEYS.gazeEnabled, next)
  }

  const toggleDark = () => {
    const next = !darkMode
    setDarkMode(next)
    saveSetting(KEYS.darkMode, String(next))
    if (next) {
      document.body.classList.add('dark-mode')
      localStorage.setItem('theme', 'dark')
    } else {
      document.body.classList.remove('dark-mode')
      localStorage.setItem('theme', 'light')
    }
  }

  return (
    <div className="mobile-shell">
      {/* ── 상단 바 ── */}
      <header className="mobile-topbar">
        <button
          id="settings-back-btn"
          className="mobile-topbar__back-btn"
          onClick={() => navigate('home')}
          aria-label="뒤로가기"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="mobile-topbar__title">설정</span>
        {/* 우측 공간 맞춤용 */}
        <div className="settings-topbar-spacer" />
      </header>

      {/* ── 설정 목록 ── */}
      <main className="mobile-scroll-area">
        {/* ─ 시선 추적 설정 ─ */}
        <div className="settings-section">
          <div className="settings-section-header">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="settings-section-icon"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            시선 추적 설정
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row__label">시선 추적 사용</div>
              <div className="settings-row__desc">
                웹캠으로 시선을 추적합니다
              </div>
            </div>
            <label className="settings-toggle" htmlFor="toggle-gaze">
              <input
                id="toggle-gaze"
                type="checkbox"
                checked={gazeEnabled}
                onChange={toggleGaze}
              />
              <span className="settings-toggle__track" />
            </label>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row__label">감도 조절</div>
              <div className="settings-row__desc">
                시선 안정화 임계값 ({gazeSensitivity}%)
              </div>
            </div>
            <input
              id="slider-gaze-sensitivity"
              type="range"
              min={10}
              max={90}
              value={gazeSensitivity}
              className="settings-slider"
              onChange={(e) => {
                const v = Number(e.target.value)
                setGazeSensitivity(v)
                saveSetting(KEYS.gazeSensitivity, v)
              }}
            />
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row__label">시선 커서 표시</div>
              <div className="settings-row__desc">
                PDF 뷰어에서 시선 위치 커서를 표시합니다
              </div>
            </div>
            <label className="settings-toggle" htmlFor="toggle-gaze-cursor">
              <input
                id="toggle-gaze-cursor"
                type="checkbox"
                checked={gazeCursorEnabled}
                onChange={() => setGazeCursorEnabled(!gazeCursorEnabled)}
              />
              <span className="settings-toggle__track" />
            </label>
          </div>

        </div>

        {/* ─ 페이지 넘김 설정 ─ */}
        <div className="settings-section">
          <div className="settings-section-header">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="settings-section-icon"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            페이지 넘김 설정
          </div>

          <div className="settings-row settings-row--top">
            <div className="settings-row__main">
              <div className="settings-row__label">넘김 방식</div>
              <div className="settings-row__desc settings-row__desc--spaced">
                {turnMode === 'auto' &&
                  '시선이 화면 하단 핫존에 머물면 자동으로 페이지가 넘어갑니다.'}
                {turnMode === 'manual' &&
                  '하단 바의 좌/우 터치 영역을 탭하여 수동으로 페이지를 넘깁니다.'}
                {turnMode === 'both' &&
                  '시선 자동 넘김과 하단 바 터치 수동 넘김 방식을 모두 사용합니다.'}
              </div>
            </div>
            <div
              className="settings-segmented settings-segmented--no-shrink"
              id="select-turn-mode"
            >
              <button
                type="button"
                className={`settings-segment ${turnMode === 'auto' ? 'active' : ''}`}
                onClick={() => {
                  setTurnModeStore('auto')
                  saveSetting(KEYS.turnMode, 'auto')
                }}
              >
                자동
              </button>
              <button
                type="button"
                className={`settings-segment ${turnMode === 'manual' ? 'active' : ''}`}
                onClick={() => {
                  setTurnModeStore('manual')
                  saveSetting(KEYS.turnMode, 'manual')
                }}
              >
                수동
              </button>
              <button
                type="button"
                className={`settings-segment ${turnMode === 'both' ? 'active' : ''}`}
                onClick={() => {
                  setTurnModeStore('both')
                  saveSetting(KEYS.turnMode, 'both')
                }}
              >
                혼합
              </button>
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row__label">넘김 딜레이</div>
              <div className="settings-row__desc">
                시선 고정 후 대기 시간 ({(turnDelay / 1000).toFixed(1)}초)
              </div>
            </div>
            <input
              id="slider-turn-delay"
              type="range"
              min={300}
              max={2000}
              step={50}
              value={turnDelay}
              className="settings-slider"
              onChange={(e) => {
                const v = Number(e.target.value)
                setTurnDelay(v)
                saveSetting(KEYS.turnDelay, v)
                setDwellThresholdMs(v)
              }}
            />
          </div>
        </div>

        {/* ─ 디스플레이 설정 ─ */}
        <div className="settings-section">
          <div className="settings-section-header">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="settings-section-icon"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            디스플레이 설정
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row__label">다크 모드</div>
              <div className="settings-row__desc">
                어두운 배경으로 전환합니다
              </div>
            </div>
            <label className="settings-toggle" htmlFor="toggle-dark">
              <input
                id="toggle-dark"
                type="checkbox"
                checked={darkMode}
                onChange={toggleDark}
              />
              <span className="settings-toggle__track" />
            </label>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row__label">화면 밝기</div>
              <div className="settings-row__desc">
                화면의 밝기를 조정합니다 ({brightness}%)
              </div>
            </div>
            <input
              id="slider-brightness"
              type="range"
              min={30}
              max={100}
              value={brightness}
              className="settings-slider"
              onChange={(e) => {
                const v = Number(e.target.value)
                setBrightness(v)
                saveSetting(KEYS.brightness, v)
                applyBrightness(v)
              }}
            />
          </div>
        </div>

        {/* ─ 기타 ─ */}
        <div className="settings-section">
          <div className="settings-section-header">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="settings-section-icon"
            >
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
              <circle cx="5" cy="12" r="1.5" />
            </svg>
            기타
          </div>

          <div
            className="settings-row settings-row--clickable"
            role="button"
            tabIndex={0}
            onClick={() => setShowAppInfo(true)}
          >
            <div className="settings-row__label">앱 정보</div>
            <span className="settings-row__chevron">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          </div>

          <div
            className="settings-row settings-row--clickable"
            role="button"
            tabIndex={0}
            onClick={() => {
              if (confirm('최근 악보 목록을 모두 삭제할까요?')) {
                localStorage.removeItem('eyescore_recent_files')
                alert('삭제되었습니다.')
              }
            }}
          >
            <div className="settings-row__label settings-row__label--danger">
              최근 악보 목록 초기화
            </div>
            <span className="settings-row__chevron settings-row__chevron--danger">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          </div>
        </div>

        {/* 여백 */}
        <div className="settings-bottom-spacer" />
      </main>

      {showAppInfo && (
        <AppInfoModal onClose={() => setShowAppInfo(false)} />
      )}
    </div>
  )
}

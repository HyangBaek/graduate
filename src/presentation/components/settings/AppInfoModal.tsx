// src/presentation/components/settings/AppInfoModal.tsx
// 설정 화면 "앱 정보" 항목에서 띄우는 정보 모달.
// 앱 소개, 주요 기능, 개인정보(웹캠) 안내, 사용 기술, 문의처를 섹션으로 구성.

import '@/presentation/styles/components/AppInfoModal.css'

/**
 * AppInfoModal 컴포넌트의 props.
 * @property onClose 모달을 닫을 때(배경 클릭 또는 닫기 버튼) 호출되는 콜백
 */
interface AppInfoModalProps {
  onClose: () => void
}

const FEATURES = [
  '시선이 화면 하단에 머물면 자동으로 페이지가 넘어갑니다',
  '연주 시작 전 시선 캘리브레이션으로 정확도를 보정합니다',
  '설정한 BPM에 맞춰 그리드를 순서대로 강조하는 연주 모드',
  '최근에 연 악보를 자동으로 기록하고 이어서 열 수 있습니다',
]

const TECH_STACK = ['MediaPipe Face Mesh', 'React', 'pdf.js', 'Capacitor']

/**
 * 설정 화면의 "앱 정보" 항목에서 띄우는 정보 모달.
 * 앱 소개, 주요 기능 목록, 개인정보(웹캠 처리) 안내, 사용 기술 스택,
 * 문의처를 섹션별로 보여준다.
 *
 * @param onClose 모달 닫기 콜백
 * @returns 배경(backdrop)과 정보 섹션들을 포함한 모달 JSX
 */
export function AppInfoModal({ onClose }: AppInfoModalProps) {
  return (
    <>
      <div className="app-info-backdrop" onClick={onClose} />
      <div
        className="app-info-modal"
        role="dialog"
        aria-modal="true"
        aria-label="앱 정보"
      >
        <div className="app-info-modal__header ">
          <span className="app-info-modal__title">EyeScore</span>
          <span className="app-info-modal__version">v1.0</span>
          <button
            className="app-info-modal__close"
            onClick={onClose}
            aria-label="닫기"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="app-info-modal__body">
          <p className="app-info-modal__tagline">
            시선 추적 기반 악보 뷰어 — PBL 연구 프로젝트
          </p>

          <section className="app-info-section">
            <h3 className="app-info-section__title">주요 기능</h3>
            <ul className="app-info-feature-list">
              {FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </section>

          <section className="app-info-section app-info-section--privacy">
            <h3 className="app-info-section__title">개인정보 안내</h3>
            <p>
              웹캠 영상은<br />
              시선 위치를 계산하는 데만<br />
              기기 내에서 처리되며,<br />
              저장되거나 외부로 전송되지 않습니다.
            </p>
          </section>

          <section className="app-info-section">
            <h3 className="app-info-section__title">사용 기술</h3>
            <div className="app-info-tech-pills">
              {TECH_STACK.map((tech) => (
                <span key={tech} className="app-info-tech-pill">
                  {tech}
                </span>
              ))}
            </div>
          </section>

          <section className="app-info-section">
            <h3 className="app-info-section__title">문의</h3>
            <p>sam4335@gmail.com</p>
          </section>
        </div>
      </div>
    </>
  )
}

export default AppInfoModal

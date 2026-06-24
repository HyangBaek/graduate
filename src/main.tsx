// src/main.tsx

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@app/App'
import '@/presentation/styles/global.css'

/**
 * 앱 부팅 전 테마/밝기 설정을 즉시 적용하는 즉시실행 함수(IIFE).
 * React 마운트 이전에 실행되어 FOUC(스타일 미적용 화면 깜빡임)를 방지한다.
 * localStorage 접근 실패(예: 프라이버시 모드)는 무시하고 기본 테마로 진행한다.
 */
;(function initTheme() {
  try {
    if (localStorage.getItem('theme') === 'dark') {
      document.body.classList.add('dark-mode')
    }
    const brightness = localStorage.getItem('settings_brightness')
    if (brightness !== null) {
      const val = JSON.parse(brightness)
      if (typeof val === 'number') {
        document.body.style.filter = `brightness(${val}%)`
      }
    }
  } catch {
    // localStorage ignore 접근 불가 환경 (SSR 등) 무시
  }
})()

// 앱의 React 진입점: #root DOM 노드에 React 트리를 마운트한다.
// StrictMode로 감싸 개발 중 잠재적 문제(부작용, 레거시 API 사용 등)를 조기에 검출한다.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

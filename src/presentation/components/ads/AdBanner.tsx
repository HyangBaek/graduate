// src/presentation/components/ads/AdBanner.tsx
// 홈 화면 "연주 시작" 버튼 아래 노출되는 Google AdSense 배너.
//
// TODO: ADSENSE_CLIENT_ID/ADSENSE_SLOT_ID는 자리표시 값.
// 실제 게시자 ID(ca-pub-...)와 슬롯 ID가 확정되면 교체한다.
import { useEffect, useRef } from 'react'
import '@/presentation/styles/components/AdBanner.css'

const ADSENSE_CLIENT_ID = 'ca-pub-0000000000000000'
const ADSENSE_SLOT_ID = '0000000000'

declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

/**
 * Google AdSense 배너를 렌더링한다.
 * React StrictMode의 mount → unmount → remount 시 동일 슬롯에 push가 중복
 * 호출되는 것을 막기 위해 pushedRef로 1회만 실행되도록 가드한다.
 */
export function AdBanner() {
  const pushedRef = useRef(false)

  useEffect(() => {
    if (pushedRef.current) return
    pushedRef.current = true
    try {
      ;(window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch {
      // 광고 차단기 등으로 실패해도 앱 동작에는 영향 없음
    }
  }, [])

  return (
    <div className="ad-banner">
      <ins
        className="ad-banner__slot adsbygoogle"
        data-ad-client={ADSENSE_CLIENT_ID}
        data-ad-slot={ADSENSE_SLOT_ID}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  )
}

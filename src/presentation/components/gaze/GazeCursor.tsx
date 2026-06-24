/**
 * GazeCursor — 모듈 레벨 초기화 커서 (v5)
 *
 * ★ 핵심: React 라이프사이클을 완전히 우회
 *
 * 이 모듈이 처음 import될 때 (React.StrictMode 이전, render 이전)
 * document.body에 커서 DOM을 생성하고 rAF 루프를 시작합니다.
 *
 * React StrictMode의 mount→cleanup→remount 사이클은 이 커서에
 * 아무런 영향을 주지 않습니다.
 *
 * GazeCursor 컴포넌트는 JSX 트리에서 위치를 나타내는 마커일 뿐이며
 * 실제 DOM 조작은 하지 않습니다.
 */
import { memo, useEffect } from 'react'
import { useGazeStore } from '@/presentation/state/gazeStore'
import { useDebugStore } from '@/presentation/store/useDebugStore'
import { useAppRouter } from '@/app/router/useAppRouter'
import { useCalibrationStore } from '@/presentation/store/calibrationStore'
import { Capacitor } from '@capacitor/core'

/**
 * GazeCursor React 마커 컴포넌트의 props.
 * 실제 DOM 렌더링/이동은 모듈 레벨 코드가 담당하므로, 이 props는 모듈 레벨
 * 변수(_size/_debug 등)를 동기화하는 용도로 쓰인다.
 * @property size 커서 점의 기본 지름(px). 기본값 22
 * @property debug 디버그 패널(좌표/안정성 정보) 표시 여부. 기본값 true
 * @property hideWhenUnstable 안정성이 낮을 때 커서를 숨길지 여부 (현재 모듈 로직에서는 미사용)
 * @property minimumStability hideWhenUnstable 적용 시 기준이 되는 최소 안정성 값 (현재 모듈 로직에서는 미사용)
 */
export interface GazeCursorProps {
  size?: number
  debug?: boolean
  hideWhenUnstable?: boolean
  minimumStability?: number
}

// ── 오션 계열 색상 ─────────────────────────────────────────────────────────────
const C = {
  ocean: 'rgba(0, 200, 220, 0.92)',
  oceanGlow:
    '0 0 20px rgba(0,200,220,0.65), 0 0 6px rgba(120,240,255,0.85), 0 0 40px rgba(0,180,220,0.3)',
  waitBg: 'rgba(255, 165, 0, 0.15)',
  waitBd: '2.5px dashed rgba(255, 165, 0, 1)',
  waitGlow: '0 0 16px rgba(255,165,0,0.70)',
  lostBg: 'rgba(140, 140, 160, 0.50)',
  dwellBg: 'rgba(0, 230, 118, 0.95)',
  dwellGlow: '0 0 24px rgba(0,230,118,0.8), 0 0 6px rgba(255,255,255,0.9)',
}

// ── 모듈 레벨 상태 (모듈 import 시 한 번 초기화) ──────────────────────────────
let _dot: HTMLDivElement | null = null
let _dbg: HTMLDivElement | null = null
// _lastX/_lastY: 실제로 화면에 그려지는(보간된) 위치
// _targetX/_targetY: 파이프라인이 보고하는 가장 최신 시선 좌표(보간의 목표값)
// 기존에는 filteredGaze가 들어오는 즉시 _lastX/_lastY에 그대로 대입해서 매 프레임
// 1:1로 스냅됐고, 그 결과 시선 자체의 프레임 간 노이즈가 커서에 그대로 드러나
// "꿀렁꿀렁" 흔들리는 것처럼 보였음. 목표(_target)와 표시(_last)를 분리해 두면
// 표시 위치를 목표 쪽으로 일부만 매 프레임 이동시키는 보간이 가능해진다.
let _lastX = 0
let _lastY = 0
let _targetX = 0
let _targetY = 0
let _size = 22
let _debug = true

// 시선이 화면 경계 밖(클램프 범위 밖)을 향하고 있는 동안 표시 위치를 고정하는 데
// 쓰는 값. 예: 우측 경계 밖을 보고 있으면 x는 이미 maxX에 고정되지만, y는 클램프
// 대상이 아니므로 노이즈가 그대로 드러나 "위아래로만 흔들린다"는 인상을 준다.
// 한쪽 축이라도 클램프되는 동안은 두 축 모두 마지막 표시 위치에 고정해 정지된
// 것처럼 보이게 하고, 시선이 경계 안으로 돌아오는 즉시(클램프 해제) 다시 정상
// 추적을 재개한다.
let _frozenX: number | null = null
let _frozenY: number | null = null

// ── Prediction Latency 실측 ────────────────────────────────────────────────
// "Prediction Latency"는 GazeCursor의 EASE 보간이 새 시선 목표에 정착(settle)하기까지
// 실제로 걸리는 시간을 측정한 값이다(고정 placeholder 아님). 노이즈 수준의 작은
// target 변화는 측정에서 제외하고(JUMP_THRESHOLD_PX 미만), 의미 있는 이동
// (saccade 등)이 발생했을 때만 "목표 도착 시각 → 표시 위치가 목표 근처
// (SETTLE_THRESHOLD_PX 이내)에 도달한 시각"의 차이를 ms로 기록한다.
const JUMP_THRESHOLD_PX = 8
const SETTLE_THRESHOLD_PX = 3
let _lastGazeTimestamp: number | null = null
let _moveStartTimestamp: number | null = null

// 시선 방향이 일정하면(=계속 같은 쪽으로 _target이 이동) 매 프레임 그 방향으로
// 거리의 EASE 비율만큼만 이동시켜 누적 이동은 그대로 따라가되, 한 프레임짜리
// 노이즈(앞뒤로 튀는 값)는 크게 줄어들도록 한다. 1에 가까우면 보간 없음(기존 동작),
// 0에 가까우면 지나치게 느려져 "안 따라옴"으로 느껴짐 — 0.35는 그 사이에서
// 지터 감소와 반응성을 함께 만족하는 값으로 선택.
//
// 다만 EASE를 고정값 하나로만 쓰면, 페이지 하단 핫존처럼 의도적으로 멀리(크게)
// 시선을 옮기는 경우에도 매 프레임 35%씩만 따라가다 보니 점이 목표에 도착하는 데
// 여러 프레임이 걸려 "넘어가는 게 느리다"는 체감으로 이어짐. 작은 노이즈와 큰
// 의도적 이동을 구분해야 함 — 목표까지의 거리가 크면(의도적 이동으로 간주)
// 더 빠른 EASE로 거의 즉시 따라붙고, 거리가 작으면(노이즈로 간주) 기존처럼
// 천천히 평활한다.
const CURSOR_EASE_SMALL = 0.35
const CURSOR_EASE_LARGE = 0.85
const CURSOR_LARGE_MOVE_PX = 60 // 이 부근에서 "노이즈"와 "의도적 이동" 사이를 부드럽게 전환
// "딱딱딱 끊기는, 튀는" 느낌의 원인: 위 EASE_SMALL/LARGE를 거리 60px 기준으로
// 즉시 전환(if/else)했기 때문에, 시선 이동 거리가 60px 위아래로 노이즈처럼
// 넘나들 때마다(특히 가로로 읽는 중간 속도 이동에서 흔함) 보간 비율 자체가
// 0.35 → 0.85로 프레임마다 갑자기 점프해 그 순간 커서 속도가 단차처럼 튀어
// 보였음(가로 이동이 "부자연스럽다"는 체감도 같은 원인의 일부).
// → 두 EASE 값 사이를 거리 기준 부드러운 램프(smoothstep)로 보간해 단차를 없앤다.
const CURSOR_EASE_RAMP_PX = 40 // 이 폭(px) 동안 EASE_SMALL → EASE_LARGE로 매끄럽게 전환

/**
 * 에르미트 기반 smoothstep 보간 함수. x를 [edge0, edge1] 구간에서 0~1로
 * 정규화한 뒤 3t²-2t³ 곡선으로 부드럽게 변환한다(가속/감속 구간을 만들어
 * 단계적 전환의 "단차" 느낌을 없앤다).
 * @param edge0 보간 시작 경계값
 * @param edge1 보간 종료 경계값
 * @param x 입력값
 * @returns 0~1 범위로 부드럽게 정규화된 값
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

// MutationObserver: body에서 커서 노드가 제거되면 즉시 재추가
let _observer: MutationObserver | null = null

/**
 * 화면에 표시되는 시선 커서(점) DOM 엘리먼트를 생성한다.
 * @returns 스타일이 적용된 새 div 엘리먼트 (아직 body에 추가되지 않음)
 */
function createDot(): HTMLDivElement {
  const dot = document.createElement('div')
  dot.id = '__gc-dot'
  dot.setAttribute('data-gaze-cursor', 'dot')
  // transform 없이 left/top만 사용 (stacking context 문제 방지)
  dot.style.cssText = [
    'position: fixed',
    'left: 0',
    'top: 0',
    `width: ${_size}px`,
    `height: ${_size}px`,
    'border-radius: 50%',
    'pointer-events: none',
    'user-select: none',
    'touch-action: none',
    'z-index: 2147483647',
    `background: ${C.ocean}`,
    `border: 2px solid rgba(120,240,255,0.85)`,
    `box-shadow: ${C.oceanGlow}`,
    'opacity: 1',
    'display: block',
  ].join('; ')
  return dot
}

/**
 * 커서 옆에 표시되는 디버그 정보 패널 DOM 엘리먼트를 생성한다.
 * @returns 스타일이 적용된 새 div 엘리먼트 (아직 body에 추가되지 않음)
 */
function createDbg(): HTMLDivElement {
  const dbg = document.createElement('div')
  dbg.id = '__gc-dbg'
  dbg.setAttribute('data-gaze-cursor', 'debug')
  dbg.style.cssText = [
    'position: fixed',
    'left: 0',
    'top: 0',
    'padding: 5px 9px',
    'border-radius: 7px',
    'background: rgba(0,0,0,0.82)',
    'color: #fff',
    'font: 11px/1.6 monospace',
    'pointer-events: none',
    'z-index: 2147483647',
    'white-space: nowrap',
    'display: none',
  ].join('; ')
  return dbg
}

/**
 * document.body에서 커서/디버그 DOM이 의도치 않게 제거되는 경우를 감지해
 * 즉시 재추가하는 MutationObserver를 등록한다. 이미 등록되어 있으면 무시한다.
 */
function setupObserver() {
  if (_observer) return
  _observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.removedNodes.forEach((node) => {
        if (node === _dot) {
          console.warn('[GazeCursor] 🚨 dot이 body에서 제거됨! 재추가합니다.')
          document.body.appendChild(_dot!)
        }
        if (node === _dbg) {
          console.warn('[GazeCursor] 🚨 dbg가 body에서 제거됨! 재추가합니다.')
          document.body.appendChild(_dbg!)
        }
      })
    }
  })
  _observer.observe(document.body, { childList: true })
}

/**
 * 모듈 로드 시 1회 호출되는 초기화 함수.
 * 커서/디버그 DOM을 생성(또는 HMR 시 기존 엘리먼트 재사용)해 body에 추가하고,
 * MutationObserver를 설정하며, 표시 위치를 화면 중앙으로 초기화한 뒤
 * rAF 루프(startLoop)를 시작한다.
 */
function init() {
  // HMR 대응: 기존 요소가 있으면 재사용
  const existingDot = document.getElementById(
    '__gc-dot',
  ) as HTMLDivElement | null
  const existingDbg = document.getElementById(
    '__gc-dbg',
  ) as HTMLDivElement | null

  if (existingDot) {
    _dot = existingDot
    console.log('[GazeCursor] 기존 dot 재사용')
  } else {
    _dot = createDot()
    document.body.appendChild(_dot)
    console.log(
      '[GazeCursor] dot 생성 및 body 추가, in body:',
      document.body.contains(_dot),
    )
  }

  if (existingDbg) {
    _dbg = existingDbg
  } else {
    _dbg = createDbg()
    document.body.appendChild(_dbg)
  }

  setupObserver()

  _lastX = window.innerWidth / 2
  _lastY = window.innerHeight / 2
  _targetX = _lastX
  _targetY = _lastY

  // 즉시 첫 위치 설정
  _dot.style.left = `${_lastX - _size / 2}px`
  _dot.style.top = `${_lastY - _size / 2}px`

  startLoop()
}

/**
 * 매 프레임 시선 좌표를 읽어 커서 위치/스타일을 갱신하는 requestAnimationFrame
 * 루프를 시작한다. 목표 위치로의 EASE 보간, 화면/PDF 영역 클램프, 경계 밖
 * 응시 시 위치 고정(freeze), Prediction Latency 측정, 페이지별 표시 규칙
 * 적용까지 커서의 핵심 동작을 모두 이 루프에서 처리한다.
 */
function startLoop() {
  if ((window as any).__gazeCursorRafId) {
    cancelAnimationFrame((window as any).__gazeCursorRafId)
  }

  console.log('[GazeCursor] rAF 루프 시작')

  let frameCount = 0
  let firstGazeLogged = false
  let lookAwayStartTimestamp: number | null = null

  const loop = () => {
    frameCount++

    // 100프레임(~3.3초)마다 상태 진단 로그
    if (frameCount % 100 === 0) {
      const inBody = document.body.contains(_dot)
      if (!inBody) {
        console.error('[GazeCursor] ❌ dot이 body에 없음! 재추가.')
        document.body.appendChild(_dot!)
        document.body.appendChild(_dbg!)
      }
    }

    if (!_dot) {
      (window as any).__gazeCursorRafId = requestAnimationFrame(loop)
      return
    }

    const g = useGazeStore.getState()
    const d = useDebugStore.getState()
    const isUserMode = useAppRouter.getState().currentPage !== 'debug'

    const gaze = g.filteredGaze
    const stab = g.stats?.stabilityScore ?? 0
    const isTrack = g.isTracking
    const isFace = g.isFaceDetected
    const nextP = g.nextProgress ?? 0
    const prevP = g.prevProgress ?? 0
    const sandbox = d.sandboxEnabled
    const headPose = g.headPose

    // 현재 보이는 화면 크기
    const w = window.innerWidth
    const h = window.innerHeight

    const isLookingAwayNow = headPose && (Math.abs(headPose.yaw) > 24 || Math.abs(headPose.pitch) > 20)

    if (isLookingAwayNow) {
      if (lookAwayStartTimestamp === null) {
        lookAwayStartTimestamp = Date.now()
      }
    } else {
      lookAwayStartTimestamp = null
    }

    const isLookingAwayDebounced = lookAwayStartTimestamp !== null && (Date.now() - lookAwayStartTimestamp > 700)

    const hasGaze =
      isTrack &&
      isFace &&
      gaze != null &&
      Number.isFinite(gaze.x) &&
      Number.isFinite(gaze.y) &&
      !isLookingAwayDebounced

    // 최초 시선 확보 시 1회 로그
    if (hasGaze && !firstGazeLogged) {
      firstGazeLogged = true
      console.log('[GazeCursor] ✅ 첫 시선 확보:', { x: Math.round(gaze!.x), y: Math.round(gaze!.y) })
    }

    // 150프레임(~5초)마다 파이프라인 상태 진단
    if (frameCount % 150 === 0) {
      console.log('[GazeCursor] 🔍 state:', {
        isTrack,
        isFace,
        hasGaze,
        gaze: gaze ? `(${Math.round(gaze.x)}, ${Math.round(gaze.y)})` : null,
        cursorVisible: d.cursorVisible,
        sandbox,
      })
    }

    const page = useAppRouter.getState().currentPage
    const isCalibrating = useCalibrationStore.getState().isCalibrating
    const gazeCursorEnabled = useCalibrationStore.getState().gazeCursorEnabled

    // 얼굴+추적+gaze 모두 활성일 때만 목표 위치 갱신 (freeze on loss)
    if (hasGaze) {
      // 새 시선 샘플(타임스탬프 갱신)이고, 현재 표시 위치 대비 의미 있는 거리만큼
      // 목표가 이동했을 때만 "정착 측정"을 시작한다 — 잡음 수준 흔들림은 제외.
      if (gaze!.timestamp !== _lastGazeTimestamp) {
        _lastGazeTimestamp = gaze!.timestamp
        const jumpDist = Math.hypot(gaze!.x - _lastX, gaze!.y - _lastY)
        if (jumpDist >= JUMP_THRESHOLD_PX) {
          _moveStartTimestamp = gaze!.timestamp
        }
      }
      _targetX = gaze!.x
      _targetY = gaze!.y
    }

    // 표시 위치(_lastX/Y)를 목표(_targetX/Y) 쪽으로 이동. 목표까지 남은 거리가
    // 크면(예: 페이지 하단 핫존을 보려고 의도적으로 시선을 크게 옮긴 경우)
    // 빠른 EASE로 거의 즉시 따라붙고, 거리가 작으면(잡음 수준의 흔들림) 느린
    // EASE로 평활해 지터를 줄인다 — 둘을 같은 값으로 고정하면 의도적인 큰
    // 이동까지 천천히 보정돼 "넘어가는 게 느리다"는 체감으로 이어짐.
    //
    // X/Y의 ease를 각자의 거리로 독립 계산한다(이전: dx,dy를 합친 유클리드 거리
    // 하나로 ease를 정해 두 축에 동일하게 적용). 그 결과 가로로 크게 움직이는
    // 동안(X distance가 큼) Y에도 똑같이 빠른 ease가 걸려, 본래는 거의 무시됐을
    // Y축의 미세한 흔들림까지 그대로 통과해버렸다 — "왼→오른쪽 이동 중 대각선으로
    // 위로 쓸리는" 느낌과 "계단처럼 튀는" 느낌 둘 다 이 결합이 원인이었음.
    // 축마다 자기 거리만 보고 ease를 정하면 가로 saccade 중에도 Y는 여전히 느린
    // ease로 평활되어 분리된다.
    const distX = _targetX - _lastX
    const distY = _targetY - _lastY
    const rampStart = CURSOR_LARGE_MOVE_PX - CURSOR_EASE_RAMP_PX / 2
    const rampEnd = CURSOR_LARGE_MOVE_PX + CURSOR_EASE_RAMP_PX / 2
    const blendX = smoothstep(rampStart, rampEnd, Math.abs(distX))
    const blendY = smoothstep(rampStart, rampEnd, Math.abs(distY))
    const easeX = CURSOR_EASE_SMALL + (CURSOR_EASE_LARGE - CURSOR_EASE_SMALL) * blendX
    const easeY = CURSOR_EASE_SMALL + (CURSOR_EASE_LARGE - CURSOR_EASE_SMALL) * blendY
    _lastX += distX * easeX
    _lastY += distY * easeY

    // 정착 판정: 측정 중인 이동이 있고, 표시 위치가 목표 근처에 도달했으면
    // 실제 경과 시간을 predictionLatency로 기록한다.
    if (_moveStartTimestamp !== null) {
      const remaining = Math.hypot(_targetX - _lastX, _targetY - _lastY)
      if (remaining <= SETTLE_THRESHOLD_PX) {
        const predictionLatency = performance.now() - _moveStartTimestamp
        g.updateStats({ predictionLatency })
        _moveStartTimestamp = null
      }
    }

    const targetX = _lastX
    const targetY = _lastY

    const dwellP = Math.max(nextP, prevP)
    const curSize = _size * (1 + (dwellP / 100) * 0.5)

    let minX = curSize / 2
    let maxX = w - curSize / 2
    let minY = curSize / 2
    let maxY = h - curSize / 2

    const isWeb = !Capacitor.isNativePlatform()
    const isDebugMode = page === 'debug'
    const isLandscape = w > h

    if ((isDebugMode || isWeb) && isLandscape && g.pdfBounds) {
      const bounds = g.pdfBounds
      minX = Math.max(minX, bounds.x)
      maxX = Math.min(maxX, bounds.x + bounds.width)
      minY = Math.max(minY, bounds.y)
      maxY = Math.min(maxY, bounds.y + bounds.height)
    }

    // 클램프 전 위치 기준으로 "경계 밖을 보고 있는지" 판정 — 클램프된 좌표(targetX
    // 자체가 아니라 clamp 적용 여부)로 판단해야 "딱 경계에 닿은 정상 위치"와
    // "경계를 넘어가서 더 갈 곳이 없는 상태"를 구분할 수 있다.
    //
    // 기존에는 두 축 중 하나라도 클램프되면 두 축 모두 "마지막 표시 위치"에
    // 고정해버렸음. 그 결과 예: 페이지 하단(next page zone, y 클램프)을 보려고
    // 시선을 옮기는 동안 x가 화면 폭 안쪽(클램프 안 됨)인데도 y 클램프 때문에
    // x까지 같이 멈춰버려, 실제로는 코너 쪽으로 이동 중인데 화면상 점은 중앙
    // 근처에 멈춰있는 것처럼 보였다 — "거의 가운데서만 움직인다"는 체감의 원인.
    // 클램프되지 않은 축은 freeze 없이 계속 목표를 따라가도록 축별로 분리한다.
    const isClampedX = targetX < minX || targetX > maxX
    const isClampedY = targetY < minY || targetY > maxY

    let cx: number
    let cy: number
    cx = isClampedX && _frozenX !== null
      ? _frozenX
      : Math.min(Math.max(targetX, minX), maxX)
    cy = isClampedY && _frozenY !== null
      ? _frozenY
      : Math.min(Math.max(targetY, minY), maxY)

    _frozenX = isClampedX ? cx : null
    _frozenY = isClampedY ? cy : null

    // 디버깅/분석용: 실제로 화면에 그려지는(EASE 보간 + clamp 적용 완료) 최종 위치를
    // gazeStore에 기록. filteredGaze(원본 신호)와 달리 이 값이 사용자가 실제로 보는
    // 커서 움직임이며, 60fps로 매 프레임 기록되지만 소비 측(ResearchRuntime)은
    // 200ms 간격으로만 샘플링하므로 store 갱신 자체의 비용은 무시할 수 있는 수준이다.
    g.setCursorDisplayPos({ x: cx, y: cy, timestamp: Date.now() }, isClampedX || isClampedY)

    const isLost = !sandbox && (!isTrack || !isFace || !hasGaze)
    const hasDwell = dwellP > 0
    const cursorVisible = d.cursorVisible

    // 페이지별 커서 표시 규칙:
    //   viewer   → gazeCursorEnabled 설정 토글로 제어
    //   debug    → cursorVisible (DebugStore) 토글로 제어
    //   home / settings → 항상 숨김
    const allowedOnPage =
      (page === 'viewer' && gazeCursorEnabled) ||
      (page === 'debug' && cursorVisible)

    // 통합 숨김 조건:
    //   - 캘리브레이션 중 → 숨김
    //   - 허용되지 않은 페이지 → 숨김
    //   - sandbox 아니고 추적 중 아님 → 숨김
    if (isCalibrating || !allowedOnPage || (!isTrack && !sandbox)) {

      if (_dot) {
        _dot.style.display = 'none'
      }
      if (_dbg) {
        _dbg.style.display = 'none'
      }
      (window as any).__gazeCursorRafId = requestAnimationFrame(loop)
      return
    } else {
      if (_dot) {
        _dot.style.display = 'block'
      }
    }

    // ── 위치: left/top 방식, transform 없음 ────────────────────────────────
    _dot.style.left = `${cx - curSize / 2}px`
    _dot.style.top = `${cy - curSize / 2}px`
    _dot.style.width = `${curSize}px`
    _dot.style.height = `${curSize}px`

    // ── 상태별 색상 ──────────────────────────────────────────────────────────
    if (!hasGaze && !sandbox) {
      _dot.style.background = C.waitBg
      _dot.style.border = C.waitBd
      _dot.style.boxShadow = C.waitGlow
      _dot.style.opacity = '1'
    } else if (isLost) {
      _dot.style.background = C.lostBg
      _dot.style.border = '1.5px dashed rgba(255,255,255,0.25)'
      _dot.style.boxShadow = 'none'
      _dot.style.opacity = '0.5'
    } else if (hasDwell) {
      _dot.style.background = C.dwellBg
      _dot.style.border = '2px solid rgba(255,255,255,0.9)'
      _dot.style.boxShadow = C.dwellGlow
      _dot.style.opacity = '1'
    } else {
      _dot.style.background = C.ocean
      _dot.style.border = '2px solid rgba(120,240,255,0.85)'
      _dot.style.boxShadow = C.oceanGlow
      _dot.style.opacity = '1'
    }

    // ── 디버그 패널 ──────────────────────────────────────────────────────────
    if (!isUserMode && _debug && _dbg && d.cursorDebugVisible) {
      _dbg.style.display = 'block'
      // 디버그 설명 패널도 화면 밖으로 나가지 않도록 Clamp
      const dbgWidth = 180 // 대략적인 디버그 텍스트 박스 가로 (정보가 많아져서 크기 증가)
      const dbgHeight = 130 // 대략적인 디버그 텍스트 박스 세로

      let dbgX = cx + 20
      let dbgY = cy + 20

      if (dbgX + dbgWidth > w) {
        dbgX = cx - dbgWidth - 20
      }
      if (dbgY + dbgHeight > h) {
        dbgY = cy - dbgHeight - 20
      }

      // 최종 clamp
      dbgX = Math.min(Math.max(dbgX, 0), w - dbgWidth)
      dbgY = Math.min(Math.max(dbgY, 0), h - dbgHeight)

      _dbg.style.left = `${dbgX}px`
      _dbg.style.top = `${dbgY}px`

      const rawG = g.rawGaze
      const rawX = rawG ? Math.round(rawG.x) : 0
      const rawY = rawG ? Math.round(rawG.y) : 0

      _dbg.innerHTML = [
        `<div><strong>Filtered Gaze:</strong></div>`,
        `<div style="color:#00e5ff">X: ${Math.round(cx)} / Y: ${Math.round(cy)}</div>`,
        `<div><strong>Raw Gaze:</strong></div>`,
        `<div style="color:#ff5555">X: ${rawX} / Y: ${rawY}</div>`,
        `<div><strong>Stability Score:</strong> ${stab.toFixed(2)}</div>`,
        !hasGaze && !sandbox
          ? `<div style="color:#ffaa00">⏳ gaze 대기중</div>`
          : '',
        sandbox ? `<div style="color:#00e5ff">🖱 sandbox</div>` : '',
      ].join('')
    } else if (_dbg) {
      _dbg.style.display = 'none'
    }

    (window as any).__gazeCursorRafId = requestAnimationFrame(loop)
  }

  (window as any).__gazeCursorRafId = requestAnimationFrame(loop)
}

// ── 모듈 로드 시 즉시 실행 ─────────────────────────────────────────────────────
// React가 render()를 호출하기 전에 이 코드가 실행됩니다.
// StrictMode의 mount/unmount 사이클에 완전히 독립적입니다.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    // DOMContentLoaded를 기다릴 필요 없이 body는 이미 있음 (Vite SPA)
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
}

// ── React 컴포넌트 (마커 역할만) ──────────────────────────────────────────────
/**
 * 시선 커서를 표시하는 React 컴포넌트. 파일 상단 설명대로 실제 DOM 생성과
 * rAF 루프는 모듈이 import되는 시점에 이미 동작 중이며, 이 컴포넌트는
 * JSX 트리 안에서 마운트 위치를 표시하는 마커 역할과 props/스토어 변화를
 * 모듈 레벨 변수에 동기화하는 역할만 수행한다. 화면에는 별도 DOM을
 * 렌더링하지 않는다(return null).
 *
 * @param size 커서 점의 기본 지름(px). 기본값 22
 * @param debug 디버그 패널 표시 여부. 기본값 true
 * @returns 항상 null (실제 시각 요소는 모듈 레벨에서 document.body에 직접 렌더링됨)
 */
export const GazeCursor = memo(
  ({
    size = 22,
    debug = true,
  }: GazeCursorProps) => {

    // 오염되거나 왜곡된 로컬스토리 캘리브레이션 데이터를 첫 로드 및 Rehydrate 완료 시 자동 초기화
    useEffect(() => {
      const checkAndReset = () => {
        const cal = useCalibrationStore.getState()
        if (cal.isCalibrated && cal.calibrationData) {
          const data = cal.calibrationData
          // 픽셀 보정이 정상적이라면 scaleX, scaleY는 보통 0.3 ~ 2.0 범위에 위치합니다.
          const isScaleInvalid =
            data.scaleX < 0.2 ||
            data.scaleX > 2.2 ||
            data.scaleY < 0.2 ||
            data.scaleY > 2.2
          // 오프셋이 브라우저 창 너비/높이를 넘어서는 것도 비정상적입니다.
          const isOffsetInvalid =
            Math.abs(data.offsetX) > window.innerWidth ||
            Math.abs(data.offsetY) > window.innerHeight

          if (isScaleInvalid || isOffsetInvalid) {
            console.warn(
              '[GazeCursor] ⚠️ 오염된 로컬스토리지 캘리브레이션 정보 감지, 자동 리셋:',
              data,
            )
            useCalibrationStore.getState().resetCalibration()
          }
        }
      }

      checkAndReset()

      // 캘리브레이션 스토어 상태(Rehydrate 완료 포함) 변화 감지 시 즉각 체크
      const unsubscribeCal = useCalibrationStore.subscribe(
        (state) => state.calibrationData,
        () => {
          checkAndReset()
        },
      )

      return () => {
        unsubscribeCal()
      }
    }, [])

    // props 변경 시 모듈 변수 동기화 (실시간 반영)
    useEffect(() => {
      _size = size
      _debug = debug
      console.log('[GazeCursor] props 동기화:', { size, debug })

      // Zustand store의 Gaze 좌표 및 상태가 바뀔 때마다 모듈 레벨 상태를 즉각 동기화
      const unsubscribe = useGazeStore.subscribe(
        (state) => ({
          filteredGaze: state.filteredGaze,
          rawGaze: state.rawGaze,
          isTracking: state.isTracking,
          isFaceDetected: state.isFaceDetected,
          nextProgress: state.nextProgress,
          prevProgress: state.prevProgress,
          stabilityScore: state.stats.stabilityScore,
        }),
        (data) => {
          if (
            data.filteredGaze &&
            Number.isFinite(data.filteredGaze.x) &&
            Number.isFinite(data.filteredGaze.y)
          ) {
            // rAF 루프(loop)와 동일하게 "목표"만 갱신 — 여기서 _lastX/_lastY를
            // 직접 덮어쓰면 loop의 보간(CURSOR_EASE)을 건너뛰고 매 store 갱신마다
            // 즉시 스냅되어 버려 지터 완화 효과가 사라짐.
            _targetX = data.filteredGaze.x
            _targetY = data.filteredGaze.y
          }
        },
        {
          equalityFn: (a, b) =>
            a.filteredGaze?.x === b.filteredGaze?.x &&
            a.filteredGaze?.y === b.filteredGaze?.y &&
            a.isTracking === b.isTracking &&
            a.isFaceDetected === b.isFaceDetected,
        },
      )

      return () => {
        unsubscribe()
      }
    }, [size, debug])

    return null // DOM은 모듈 레벨에서 직접 관리
  },
)

GazeCursor.displayName = 'GazeCursor'

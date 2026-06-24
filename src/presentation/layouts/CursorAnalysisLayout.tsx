// src/presentation/layouts/CursorAnalysisLayout.tsx
// PDF 뷰어 gaze cursor 분석 페이지 (디버그 메뉴 전용)
// - ResearchLog의 gaze_x/y(원본 시선 신호)와 cursor_x/y(실제 화면에 그려진
//   커서 위치, EASE 보간 + clamp 적용 완료)를 페이지별로 비교한다.
// - 데이터 소스: 현재 메모리에 있는 researchLogger.exportJson() 우선,
//   없으면(새로고침 등으로 메모리가 비었으면) localStorage에 마지막으로
//   영속화된 세션 히스토리(STORAGE_KEY)를 fallback으로 읽는다.
// - CalibrationAnalysisLayout과 동일하게 "세션 목록에서 골라서 본다" 구조다.
//   사용자(읽기) 세션과 디버그 세션이 같은 히스토리에 함께 보관되므로,
//   목록에서 source 뱃지로 구분해 보여준다.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAppRouter } from '@/app/router/useAppRouter'
import {
  researchLogger,
  STORAGE_KEY,
  type ResearchSessionBundle,
} from '@/infrastructure/storage/ResearchLoggerImpl'
import type { GazeDataSample, UserSession } from '@/domain/models/ResearchLog'
import '@/presentation/styles/AnalysisLayout.css'

/**
 * 한 페이지 안에서 수집된 시선/커서 샘플들을 집계한 통계.
 * @property page_number 대상 페이지 번호
 */
interface PageAggregate {
  page_number: number
  count: number
  avg_offset_px: number
  max_offset_px: number
  avg_confidence: number
  avg_stability: number
  fixation_ratio: number
  avg_cursor_jitter_px: number
  avg_gaze_jitter_px: number
  snr_db: number | null
  camera_snr_db: number | null
  min_sensitivity_px: number | null
  /**
   * SNR 개선분(dB) = camera_snr_db(보간 전 원본 신호) - snr_db(보간+clamp 적용된
   * 실제 커서). GazeCursor의 EASE 보간이 실제로 얼마나 신호를 깨끗하게 만들어
   * 주는지를 한 숫자로 보여준다. 둘 중 하나라도 null이면(신호/노이즈 구간 부족)
   * 계산할 수 없으므로 null. 0에 가까우면 보간이 거의 효과가 없었다는 뜻이고,
   * 이는 cursor==gaze로 동일하게 기록된(보간 효과가 측정되지 않는) 세션을
   * 가려내는 데도 쓸 수 있다.
   */
  snr_improvement_db: number | null
}

/**
 * fixation 중 연속된 두 샘플 사이의 흔들림(jitter) 측정값 한 건.
 * @property index 샘플 배열에서의 인덱스
 * @property timestamp 측정 시각
 * @property cursor_jitter GazeCursor(EASE 보간 후) 좌표의 프레임 간 displacement
 * @property gaze_jitter 원본 시선(raw gaze) 좌표의 프레임 간 displacement
 */
interface JitterPoint {
  index: number
  timestamp: number
  cursor_jitter: number
  gaze_jitter: number
}

/**
 * Jitter = "fixation 중인데도 위치가 얼마나 흔들리는가".
 * 연속된 두 샘플이 모두 is_fixation === true인 경우에만 그 사이의 프레임 간
 * displacement를 계산한다(사케이드/페이지 전환 중 이동은 흔들림이 아니라
 * 정상적인 움직임이므로 제외). raw gaze와 GazeCursor(EASE 보간 후) 둘 다
 * 계산해서 보간이 노이즈를 얼마나 줄여주는지 비교할 수 있게 한다.
 */
function computeJitterSeries(samples: GazeDataSample[]): JitterPoint[] {
  const points: JitterPoint[] = []
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]
    const cur = samples[i]
    if (!prev.is_fixation || !cur.is_fixation) continue

    const cursorJitter = Math.hypot(cur.cursor_x - prev.cursor_x, cur.cursor_y - prev.cursor_y)
    const gazeJitter = Math.hypot(cur.gaze_x - prev.gaze_x, cur.gaze_y - prev.gaze_y)

    points.push({
      index: i,
      timestamp: cur.timestamp,
      cursor_jitter: cursorJitter,
      gaze_jitter: gazeJitter,
    })
  }
  return points
}

/**
 * 숫자 배열의 산술 평균을 계산한다.
 * @param values 평균을 계산할 숫자 배열
 * @returns 평균값, 배열이 비어 있으면 0
 */
function average(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

/**
 * 숫자 배열의 RMS(Root Mean Square, 제곱평균제곱근)를 계산한다.
 * @param values RMS를 계산할 숫자 배열
 * @returns RMS 값, 배열이 비어 있으면 0
 */
function rms(values: number[]): number {
  return values.length > 0 ? Math.sqrt(average(values.map((v) => v * v))) : 0
}

/**
 * computeSnr의 계산 결과.
 * @property snrDb SNR(dB), 계산 불가 시 null
 * @property noiseRms fixation 구간(흔들림)의 RMS
 * @property signalRms 비-fixation 구간(의도적 이동)의 RMS
 */
interface SnrResult {
  snrDb: number | null
  noiseRms: number
  signalRms: number
}

/**
 * SNR(Signal-to-Noise Ratio) = "의도된 시선 이동(signal)"이 "fixation 중
 * 흔들림(noise)"보다 얼마나 큰가.
 * - Noise: 연속된 두 샘플이 모두 is_fixation === true인 구간의 프레임 간
 *   displacement RMS (= jitter와 같은 정의).
 * - Signal: 그 외(사케이드/페이지 읽기 중 실제 이동) 구간의 프레임 간
 *   displacement RMS — 의도적으로 움직인 거리.
 * dB로 표현해 절대 픽셀 단위보다 화면 크기/기기 차이에 덜 민감하게 만든다.
 *
 * source로 어떤 좌표를 쓸지 고른다:
 * - 'cursor': GazeCursor가 화면에 그리는 좌표(EASE 보간 + clamp 적용 완료).
 *   "사용자가 실제로 보는 커서가 얼마나 안정적인가" = 보간까지 포함한 체감 SNR.
 * - 'gaze': 보간 전 원본 시선 신호. 보간이 노이즈를 깎아내기 전 값이므로,
 *   "카메라(웹캠+MediaPipe 추정) 자체가 주는 신호가 얼마나 깨끗한가" = 카메라 SNR.
 *   cursor SNR보다 항상 같거나 낮게 나오는 게 정상이며, 그 차이가 곧 보간이
 *   벌어준 개선분이다.
 *
 * noise가 0(흔들림이 전혀 없거나 fixation 쌍이 없음)이거나 signal 구간이
 * 없으면 비교 기준이 없으므로 snrDb는 null.
 */
function computeSnr(samples: GazeDataSample[], source: 'cursor' | 'gaze'): SnrResult {
  const noiseDeltas: number[] = []
  const signalDeltas: number[] = []

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]
    const cur = samples[i]
    const d =
      source === 'cursor'
        ? Math.hypot(cur.cursor_x - prev.cursor_x, cur.cursor_y - prev.cursor_y)
        : Math.hypot(cur.gaze_x - prev.gaze_x, cur.gaze_y - prev.gaze_y)

    if (prev.is_fixation && cur.is_fixation) {
      noiseDeltas.push(d)
    } else {
      signalDeltas.push(d)
    }
  }

  const noiseRms = rms(noiseDeltas)
  const signalRms = rms(signalDeltas)
  const snrDb = noiseRms === 0 || signalDeltas.length === 0
    ? null
    : 20 * Math.log10(signalRms / noiseRms)

  return { snrDb, noiseRms, signalRms }
}

/**
 * 최소 민감도(px) = 카메라 노이즈 바닥(raw gaze noise RMS)에 안전 배수(K)를
 * 곱한 값. 이보다 작은 시선 이동은 통계적으로 노이즈와 구분이 안 되므로,
 * 시스템이 "신뢰하고" 인식할 수 있는 가장 작은 움직임의 하한선으로 본다.
 * K=2는 노이즈를 정규분포로 가정했을 때 대략 95% 신뢰구간에 해당하는
 * 보수적인 값(엄밀한 통계적 유도가 아니라 실용적 기준).
 */
const MIN_SENSITIVITY_K = 2

/**
 * 카메라 노이즈 바닥(RMS)에 안전 배수(MIN_SENSITIVITY_K)를 곱해
 * 신뢰 가능한 최소 움직임 크기(px)를 계산한다.
 * @param cameraNoiseRms 카메라(raw gaze) 노이즈 RMS
 * @returns 최소 민감도(px), cameraNoiseRms가 0 이하이면 null
 */
function computeMinSensitivityPx(cameraNoiseRms: number): number | null {
  return cameraNoiseRms > 0 ? cameraNoiseRms * MIN_SENSITIVITY_K : null
}

/** 이 기기(localStorage 또는 메모리)에서 읽은 원본 세션 목록 — "초기화"로 되돌아갈 기준점 */
function loadDeviceSessions(): ResearchSessionBundle[] {
  try {
    const fromMemory = JSON.parse(researchLogger.exportJson())
    if (Array.isArray(fromMemory?.sessions) && fromMemory.sessions.length > 0) {
      return fromMemory.sessions
    }
  } catch {
    // ignore, fall through to localStorage
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.sessions) ? parsed.sessions : []
  } catch {
    return []
  }
}

/**
 * stability_score 분포 진단용 히스토그램(0~1, 10개 구간).
 * is_fixation = stabilityScore > 0.5 임계값은 GazeCursor/캘리브레이션
 * dwell 메커니즘 전반에서 공유되는 파이프라인 상수라 분석 페이지만 보고
 * 바꾸기엔 영향 범위가 넓다(README: CLAUDE.md 룰과 별개로, 이 상수를 만지면
 * dwell 진행률 등 다른 기능까지 같이 바뀜). 그래서 임계값 자체는 그대로 두고,
 * "그 임계값이 실제로 데이터를 어디서 가르는지"를 시각적으로 보여주는
 * 진단 도구만 분석 페이지에 추가한다 — 0.5 근처에 샘플이 몰려 있다면 작은
 * 노이즈만으로도 fixation 비율이 크게 흔들릴 수 있다는 신호다.
 */
const STABILITY_BUCKET_COUNT = 10

/**
 * 샘플들의 stability_score를 STABILITY_BUCKET_COUNT개 구간으로 나눠
 * 히스토그램(구간별 개수)을 계산한다.
 * @param samples 분석할 시선 데이터 샘플 배열
 * @returns 각 구간(버킷)에 속한 샘플 개수 배열
 */
function computeStabilityHistogram(samples: GazeDataSample[]): number[] {
  const buckets = new Array(STABILITY_BUCKET_COUNT).fill(0) as number[]
  for (const s of samples) {
    const clamped = Math.min(0.999999, Math.max(0, s.stability_score))
    const idx = Math.floor(clamped * STABILITY_BUCKET_COUNT)
    buckets[idx] += 1
  }
  return buckets
}

/** 0.5 임계값을 기준으로 ±0.1 안에 들어오는(경계 근처) 샘플 비율. 높을수록
 * 작은 노이즈가 fixation 판정을 쉽게 뒤집을 수 있는 불안정한 상태라는 뜻. */
function computeNearThresholdRatio(samples: GazeDataSample[]): number | null {
  if (samples.length === 0) return null
  const near = samples.filter((s) => s.stability_score >= 0.4 && s.stability_score <= 0.6)
  return near.length / samples.length
}

/**
 * 한 샘플에서 raw gaze와 cursor 위치 사이의 유클리드 거리(오차)를 계산한다.
 * @param sample 시선 데이터 샘플
 * @returns gaze와 cursor 사이의 거리(px)
 */
function offset(sample: GazeDataSample): number {
  const dx = sample.gaze_x - sample.cursor_x
  const dy = sample.gaze_y - sample.cursor_y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * 시선 데이터 샘플들을 페이지(page_number) 기준으로 모아 오차/지터/SNR
 * 등의 통계를 집계한다.
 * @param samples 집계할 시선 데이터 샘플 배열
 * @returns page_number 오름차순으로 정렬된 PageAggregate 배열
 */
function aggregateByPage(samples: GazeDataSample[]): PageAggregate[] {
  const map = new Map<number, GazeDataSample[]>()
  for (const s of samples) {
    const list = map.get(s.page_number) ?? []
    list.push(s)
    map.set(s.page_number, list)
  }

  const result: PageAggregate[] = []
  for (const [page_number, list] of map.entries()) {
    const n = list.length
    const offsets = list.map(offset)
    const jitterPoints = computeJitterSeries(list)
    const cameraSnr = computeSnr(list, 'gaze')
    const cursorSnrDb = computeSnr(list, 'cursor').snrDb
    result.push({
      page_number,
      count: n,
      avg_offset_px: offsets.reduce((a, b) => a + b, 0) / n,
      max_offset_px: Math.max(...offsets),
      avg_confidence: list.reduce((a, s) => a + s.confidence, 0) / n,
      avg_stability: list.reduce((a, s) => a + s.stability_score, 0) / n,
      fixation_ratio: list.filter((s) => s.is_fixation).length / n,
      avg_cursor_jitter_px: average(jitterPoints.map((p) => p.cursor_jitter)),
      avg_gaze_jitter_px: average(jitterPoints.map((p) => p.gaze_jitter)),
      snr_db: cursorSnrDb,
      camera_snr_db: cameraSnr.snrDb,
      min_sensitivity_px: computeMinSensitivityPx(cameraSnr.noiseRms),
      snr_improvement_db:
        cursorSnrDb !== null && cameraSnr.snrDb !== null
          ? cursorSnrDb - cameraSnr.snrDb
          : null,
    })
  }

  return result.sort((a, b) => a.page_number - b.page_number)
}

/**
 * gaze/cursor 경로를 0~viewBox 좌표로 정규화한 SVG path 문자열 생성.
 * scaleX/scaleY를 같은 값(uniform scale)으로 받아 종횡비를 유지하고,
 * offsetX/offsetY로 남는 여백만큼 중앙에 배치한다.
 */
function buildPath(
  samples: GazeDataSample[],
  key: 'gaze' | 'cursor',
  minX: number,
  minY: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): string {
  return samples
    .map((s, i) => {
      const x = key === 'gaze' ? s.gaze_x : s.cursor_x
      const y = key === 'gaze' ? s.gaze_y : s.cursor_y
      const nx = offsetX + (x - minX) * scale
      const ny = offsetY + (y - minY) * scale
      return `${i === 0 ? 'M' : 'L'}${nx.toFixed(1)},${ny.toFixed(1)}`
    })
    .join(' ')
}

/** ISO 타임스탬프를 "YYYY-MM-DD HH:mm" 형태의 고정 길이 문자열로 변환 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

const VIEW_W = 600
const VIEW_H = 400
const PADDING = 20

/**
 * 업로드한 JSON에서 세션 묶음 배열을 추출.
 * researchLogger.exportJson()의 형태({ sessions: [...] })를 기대한다.
 * 형태가 다르면 null을 반환해 UI에서 에러 메시지를 보여줄 수 있게 한다.
 */
function parseUploadedSessions(raw: unknown): ResearchSessionBundle[] | null {
  const candidate =
    raw && typeof raw === 'object' && Array.isArray((raw as any).sessions)
      ? (raw as any).sessions
      : null

  if (!candidate) return null

  const isValid = candidate.every(
    (b: any) =>
      b &&
      b.session &&
      typeof b.session.session_id === 'string' &&
      Array.isArray(b.gazeData),
  )

  return isValid ? (candidate as ResearchSessionBundle[]) : null
}

/**
 * 세션의 출처(source)를 한국어 라벨로 변환한다.
 * @param session 라벨을 표시할 사용자 세션
 * @returns '디버그' 또는 '사용자'
 */
function sessionLabel(session: UserSession): string {
  return session.source === 'debug' ? '디버그' : '사용자'
}

/**
 * 세션 안의 모든 샘플에서 cursor_x/y가 gaze_x/y와 정확히 같은지 검사.
 * 정상적으로는 GazeCursor의 EASE 보간 때문에 둘이 완전히 같을 일이 거의 없다
 * (보간이 실제로 효과가 없을 정도로 천천히/적게 움직인 경우는 예외).
 * "로깅이 깨졌다"가 아니라 "보간 효과가 측정되지 않는 세션"이라는 의미로
 * 이상치 후보로만 표시하고, 실제 분석 시 별도로 검토하도록 한다.
 */
function isCursorIdenticalToGaze(samples: GazeDataSample[]): boolean {
  if (samples.length === 0) return false
  return samples.every((s) => s.cursor_x === s.gaze_x && s.cursor_y === s.gaze_y)
}

/**
 * 주어진 헤더/행 데이터를 CSV 형식으로 변환해 다운로드한다.
 * 쉼표/줄바꿈/쌍따옴표가 포함된 값은 안전하게 escape 처리한다.
 * @param filename 다운로드될 파일 이름
 * @param headers CSV 헤더(컬럼명) 배열
 * @param rows CSV 본문 행 배열
 */
function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escape = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers, ...rows].map((row) => row.map(escape).join(','))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

type AggSortKey =
  | 'page_number'
  | 'count'
  | 'avg_offset_px'
  | 'max_offset_px'
  | 'avg_confidence'
  | 'avg_stability'
  | 'fixation_ratio'
  | 'avg_cursor_jitter_px'
  | 'snr_db'
  | 'snr_improvement_db'

type SortDir = 'asc' | 'desc'

/** 오차(px) 값 크기별 경고 강도 — 값이 클수록(보간이 시선을 못 따라갈수록) 강함 */
/**
 * 오차(px) 값 크기에 따른 경고 강도를 0~3 등급으로 판정한다.
 * @param px 오차 거리(px)
 * @returns 0(정상)~3(심각) 사이의 등급
 */
function offsetSeverity(px: number): 0 | 1 | 2 | 3 {
  if (px >= 80) return 3
  if (px >= 40) return 2
  if (px >= 20) return 1
  return 0
}

const SEVERITY_CLASS: Record<0 | 1 | 2 | 3, string> = {
  0: '',
  1: 'cell-sev-1',
  2: 'cell-sev-2',
  3: 'cell-sev-3',
}

const AGG_SORT_LABEL: Record<AggSortKey, string> = {
  page_number: 'Page',
  count: '샘플 수',
  avg_offset_px: '평균 오차(px)',
  max_offset_px: '최대 오차(px)',
  avg_confidence: 'avg confidence',
  avg_stability: 'avg stability',
  fixation_ratio: 'fixation 비율',
  avg_cursor_jitter_px: 'cursor jitter(px)',
  snr_db: 'SNR(dB)',
  snr_improvement_db: 'SNR 개선분(dB)',
}

/**
 * Gaze Cursor 분석 페이지(디버그 메뉴 전용).
 * ResearchLog에 기록된 원본 시선(gaze_x/y)과 실제 화면에 그려진 커서
 * 위치(cursor_x/y, EASE 보간+clamp 적용 완료)를 페이지별로 비교해
 * 오차, 지터, SNR(신호 대 잡음비), 안정성 히스토그램 등을 표/차트로
 * 보여준다. 메모리의 researchLogger 데이터를 우선 사용하고 없으면
 * localStorage에 영속화된 세션 히스토리를 fallback으로 사용하며,
 * CalibrationAnalysisLayout과 마찬가지로 세션 목록 선택·비교·CSV/JSON
 * 업로드 및 내보내기 기능을 제공한다.
 *
 * @returns Gaze Cursor 분석 결과를 보여주는 페이지 레이아웃 div
 */
export function CursorAnalysisLayout() {
  const navigate = useAppRouter((s) => s.navigate)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const deviceSessionsRef = useRef<ResearchSessionBundle[]>(loadDeviceSessions())
  const [sessions, setSessions] = useState<ResearchSessionBundle[]>(
    deviceSessionsRef.current,
  )
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [aggSortKey, setAggSortKey] = useState<AggSortKey>('page_number')
  const [aggSortDir, setAggSortDir] = useState<SortDir>('asc')
  const [filterSource, setFilterSource] = useState<'all' | 'user' | 'debug'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'live' | 'ended'>('all')

  // 가장 최근 세션을 기본 선택 — 처음 들어왔을 때 빈 화면을 보지 않도록.
  useEffect(() => {
    if (selectedSessionId === null && sessions.length > 0) {
      setSelectedSessionId(sessions[sessions.length - 1].session.session_id)
    }
  }, [sessions, selectedSessionId])

  // ── 실시간 동기화 ────────────────────────────────────────────────────────
  // 진행 중인 세션은 ResearchLoggerImpl이 2초 간격으로 localStorage(STORAGE_KEY)에
  // 내보낸다. 'storage' 이벤트는 "다른 탭/창"에서 같은 키가 바뀔 때만 발생하므로,
  // 이 탭이 이벤트를 받으면 다른 탭에서 새 데이터가 저장됐다는 뜻 — 업로드한
  // 파일을 보고 있는 중이 아니라면 즉시 다시 읽어 목록을 갱신한다.
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      if (loadedFileName) return
      const fresh = loadDeviceSessions()
      if (fresh.length > 0) {
        deviceSessionsRef.current = fresh
        setSessions(fresh)
        setLastSyncAt(new Date())
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [loadedFileName])

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploadError(null)
    try {
      const text = await file.text()
      const parsed = parseUploadedSessions(JSON.parse(text))
      if (!parsed) {
        setUploadError('Gaze Cursor 로그 형식이 아닙니다 (sessions 배열 필요).')
        return
      }

      // 기존 세션과 합치되, 같은 session_id는 업로드한 파일 쪽으로 덮어씀
      setSessions((prev) => {
        const map = new Map(prev.map((b) => [b.session.session_id, b]))
        for (const b of parsed) map.set(b.session.session_id, b)
        return Array.from(map.values()).sort((a, b) =>
          a.session.start_time.localeCompare(b.session.start_time),
        )
      })
      setLoadedFileName(file.name)
      setSelectedSessionId(parsed[parsed.length - 1]?.session.session_id ?? null)
    } catch {
      setUploadError('파일을 읽는 중 오류가 발생했습니다. JSON 형식을 확인해주세요.')
    }
  }

  const handleReset = () => {
    setSessions(deviceSessionsRef.current)
    setLoadedFileName(null)
    setUploadError(null)
    setSelectedSessionId(
      deviceSessionsRef.current[deviceSessionsRef.current.length - 1]?.session
        .session_id ?? null,
    )
  }

  const selectedBundle =
    sessions.find((b) => b.session.session_id === selectedSessionId) ?? null
  const samples = selectedBundle?.gazeData ?? []

  const aggregates = useMemo(() => aggregateByPage(samples), [samples])

  const sortedAggregates = useMemo(() => {
    const list = aggregates.slice()
    list.sort((a, b) => {
      const av = a[aggSortKey]
      const bv = b[aggSortKey]
      const an = av === null ? -Infinity : av
      const bn = bv === null ? -Infinity : bv
      return aggSortDir === 'asc' ? an - bn : bn - an
    })
    return list
  }, [aggregates, aggSortKey, aggSortDir])

  const handleAggSort = (key: AggSortKey) => {
    if (aggSortKey === key) {
      setAggSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setAggSortKey(key)
      setAggSortDir('asc')
    }
  }

  const aggSortArrow = (key: AggSortKey) =>
    aggSortKey === key ? (aggSortDir === 'asc' ? ' ▲' : ' ▼') : ''

  // cursor==gaze 동일 세션(보간 효과가 측정되지 않는 세션) — 이상치 후보로 표시
  const degenerateSessionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const b of sessions) {
      if (b.gazeData.length > 0 && isCursorIdenticalToGaze(b.gazeData)) {
        ids.add(b.session.session_id)
      }
    }
    return ids
  }, [sessions])

  const filteredSessions = useMemo(() => {
    return sessions.filter((b) => {
      if (filterSource !== 'all' && b.session.source !== filterSource) return false
      if (filterStatus === 'live' && b.session.end_time) return false
      if (filterStatus === 'ended' && !b.session.end_time) return false
      return true
    })
  }, [sessions, filterSource, filterStatus])

  const liveSessionCount = sessions.filter((b) => !b.session.end_time).length

  const handleExportAggCsv = () => {
    if (!selectedBundle) return
    downloadCsv(
      `cursor-analysis-${selectedBundle.session.session_id}.csv`,
      [
        'page_number',
        'count',
        'avg_offset_px',
        'max_offset_px',
        'avg_confidence',
        'avg_stability',
        'fixation_ratio',
        'avg_cursor_jitter_px',
        'avg_gaze_jitter_px',
        'snr_db',
        'camera_snr_db',
        'snr_improvement_db',
        'min_sensitivity_px',
      ],
      sortedAggregates.map((a) => [
        a.page_number,
        a.count,
        a.avg_offset_px.toFixed(2),
        a.max_offset_px.toFixed(2),
        a.avg_confidence.toFixed(3),
        a.avg_stability.toFixed(3),
        (a.fixation_ratio * 100).toFixed(1),
        a.avg_cursor_jitter_px.toFixed(2),
        a.avg_gaze_jitter_px.toFixed(2),
        a.snr_db !== null ? a.snr_db.toFixed(2) : '',
        a.camera_snr_db !== null ? a.camera_snr_db.toFixed(2) : '',
        a.snr_improvement_db !== null ? a.snr_improvement_db.toFixed(2) : '',
        a.min_sensitivity_px !== null ? a.min_sensitivity_px.toFixed(2) : '',
      ]),
    )
  }

  const [selectedPage, setSelectedPage] = useState<number | null>(null)

  // 선택된 세션이 바뀌면(또는 실시간 동기화로 데이터가 갱신돼도) 보고 있던
  // 페이지가 여전히 존재하면 유지하고, 없으면 첫 페이지로 되돌린다.
  useEffect(() => {
    setSelectedPage((prev) => {
      if (prev !== null && aggregates.some((a) => a.page_number === prev)) {
        return prev
      }
      return aggregates[0]?.page_number ?? null
    })
  }, [aggregates])

  const pageSamples = useMemo(
    () => samples.filter((s) => s.page_number === selectedPage),
    [samples, selectedPage],
  )

  const svgPaths = useMemo(() => {
    if (pageSamples.length === 0) return null

    const allX = pageSamples.flatMap((s) => [s.gaze_x, s.cursor_x])
    const allY = pageSamples.flatMap((s) => [s.gaze_y, s.cursor_y])
    const minX = Math.min(...allX)
    const maxX = Math.max(...allX)
    const minY = Math.min(...allY)
    const maxY = Math.max(...allY)

    const rangeX = Math.max(maxX - minX, 1)
    const rangeY = Math.max(maxY - minY, 1)
    const availW = VIEW_W - PADDING * 2
    const availH = VIEW_H - PADDING * 2
    // 데이터의 실제 가로/세로 비율을 깨지 않도록, 두 축 중 더 빡빡한 쪽(min) 하나의
    // scale만 양 축에 동일하게 적용한다. 기존에는 scaleX/scaleY를 따로 계산해
    // 데이터 비율이 viewBox 비율과 다를 때 한쪽 축만 꽉 차고 반대쪽은 비어 보였다.
    const scale = Math.min(availW / rangeX, availH / rangeY)
    // 남는 여백은 중앙에 오도록 offset으로 보정.
    const offsetX = PADDING + (availW - rangeX * scale) / 2
    const offsetY = PADDING + (availH - rangeY * scale) / 2

    const gazePath = buildPath(pageSamples, 'gaze', minX, minY, scale, offsetX, offsetY)
    const cursorPath = buildPath(pageSamples, 'cursor', minX, minY, scale, offsetX, offsetY)

    return { gazePath, cursorPath }
  }, [pageSamples])

  const overallAvgOffset =
    samples.length > 0
      ? samples.reduce((a, s) => a + offset(s), 0) / samples.length
      : null

  const pageJitterSeries = useMemo(() => computeJitterSeries(pageSamples), [pageSamples])

  const overallAvgCursorJitter =
    samples.length > 0 ? average(computeJitterSeries(samples).map((p) => p.cursor_jitter)) : null

  const overallSnrDb = useMemo(() => computeSnr(samples, 'cursor').snrDb, [samples])

  const overallCameraSnr = useMemo(() => computeSnr(samples, 'gaze'), [samples])
  const overallCameraSnrDb = overallCameraSnr.snrDb
  const overallMinSensitivityPx = computeMinSensitivityPx(overallCameraSnr.noiseRms)
  const overallSnrImprovement =
    overallSnrDb !== null && overallCameraSnrDb !== null
      ? overallSnrDb - overallCameraSnrDb
      : null
  const selectedSessionIsDegenerate =
    selectedBundle !== null && degenerateSessionIds.has(selectedBundle.session.session_id)

  const overallFixationRatio =
    samples.length > 0 ? samples.filter((s) => s.is_fixation).length / samples.length : null
  const stabilityHistogram = useMemo(() => computeStabilityHistogram(samples), [samples])
  const stabilityHistogramMax = Math.max(1, ...stabilityHistogram)
  const nearThresholdRatio = useMemo(() => computeNearThresholdRatio(samples), [samples])

  const jitterChart = useMemo(() => {
    if (pageJitterSeries.length === 0) return null

    const maxJitter = Math.max(
      1,
      ...pageJitterSeries.map((p) => Math.max(p.cursor_jitter, p.gaze_jitter)),
    )
    const n = pageJitterSeries.length
    const scaleXp = n > 1 ? (VIEW_W - PADDING * 2) / (n - 1) : 0
    const scaleYp = (VIEW_H - PADDING * 2) / maxJitter

    const toPath = (key: 'cursor_jitter' | 'gaze_jitter') =>
      pageJitterSeries
        .map((p, i) => {
          const x = PADDING + i * scaleXp
          const y = VIEW_H - PADDING - p[key] * scaleYp
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
        })
        .join(' ')

    return { cursorPath: toPath('cursor_jitter'), gazePath: toPath('gaze_jitter'), maxJitter }
  }, [pageJitterSeries])

  const userSessionCount = sessions.filter((b) => b.session.source !== 'debug').length
  const debugSessionCount = sessions.filter((b) => b.session.source === 'debug').length

  return (
    <div className="analysis-layout">
      <div className="analysis-header">
        <button className="analysis-back-btn" onClick={() => navigate('debug')}>
          ← 디버그로
        </button>
        <h2>PDF 뷰어 Gaze Cursor 분석</h2>
        {!loadedFileName && (
          <span className="analysis-upload-status">
            🟢 실시간 동기화 중
            {lastSyncAt && ` (마지막 갱신 ${lastSyncAt.toLocaleTimeString()})`}
          </span>
        )}
        <div className="analysis-header-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileSelected}
            className="hidden"
          />
          <button
            className="analysis-upload-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            JSON 파일 불러오기
          </button>
          <button
            className="analysis-upload-btn"
            onClick={() => researchLogger.downloadJson()}
          >
            JSON 다운로드
          </button>
          {loadedFileName && (
            <>
              <span className="analysis-upload-status">
                불러옴: {loadedFileName}
              </span>
              <button className="analysis-upload-reset" onClick={handleReset}>
                기기 데이터로 초기화
              </button>
            </>
          )}
          {uploadError && <span className="analysis-upload-error">{uploadError}</span>}
        </div>
      </div>

      <div className="analysis-summary-row">
        <div className="analysis-summary-card">
          <span className="summary-key">총 세션</span>
          <span className="summary-val">{sessions.length}</span>
        </div>
        <div className="analysis-summary-card">
          <span className="summary-key">사용자 / 디버그</span>
          <span className="summary-val analysis-fs-16">
            {userSessionCount} / {debugSessionCount}
          </span>
        </div>
        <div className="analysis-summary-card">
          <span className="summary-key">진행 중 세션</span>
          <span className="summary-val">{liveSessionCount}</span>
        </div>
        <div className="analysis-summary-card">
          <span className="summary-key">선택된 세션 샘플 수</span>
          <span className="summary-val">{samples.length}</span>
        </div>
        <div className="analysis-summary-card">
          <span className="summary-key">평균 gaze-cursor 오차(px)</span>
          <span className="summary-val">
            {overallAvgOffset !== null ? overallAvgOffset.toFixed(1) : '-'}
          </span>
        </div>
        <div className="analysis-summary-card">
          <span className="summary-key">평균 cursor jitter(px)</span>
          <span className="summary-val">
            {overallAvgCursorJitter !== null ? overallAvgCursorJitter.toFixed(1) : '-'}
          </span>
        </div>
        <div className="analysis-summary-card">
          <span className="summary-key">gaze SNR(dB)</span>
          <span className="summary-val">
            {overallSnrDb !== null ? overallSnrDb.toFixed(1) : '-'}
          </span>
        </div>
        <div className="analysis-summary-card">
          <span className="summary-key">카메라 SNR(dB)</span>
          <span className="summary-val">
            {overallCameraSnrDb !== null ? overallCameraSnrDb.toFixed(1) : '-'}
          </span>
        </div>
        <div className="analysis-summary-card">
          <span className="summary-key">SNR 개선분(dB)</span>
          <span
            className={`summary-val ${
              overallSnrImprovement !== null && overallSnrImprovement <= 0.5
                ? 'cell-sev-2'
                : ''
            }`}
          >
            {overallSnrImprovement !== null ? overallSnrImprovement.toFixed(1) : '-'}
          </span>
        </div>
        <div className="analysis-summary-card">
          <span className="summary-key">최소 민감도(px)</span>
          <span className="summary-val">
            {overallMinSensitivityPx !== null ? overallMinSensitivityPx.toFixed(1) : '-'}
          </span>
        </div>
      </div>

      <section className="analysis-section">
        <div className="analysis-section-header-row">
          <h3>세션 목록</h3>
          <div className="analysis-filter-row">
            <select
              className="filter-select"
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value as 'all' | 'user' | 'debug')}
            >
              <option value="all">전체 출처</option>
              <option value="user">사용자</option>
              <option value="debug">디버그</option>
            </select>
            <select
              className="filter-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | 'live' | 'ended')}
            >
              <option value="all">전체 상태</option>
              <option value="live">진행 중</option>
              <option value="ended">종료</option>
            </select>
          </div>
        </div>

        {selectedSessionIsDegenerate && (
          <div className="analysis-outlier-banner">
            ⚠ 선택된 세션은 모든 샘플에서 cursor 좌표가 gaze 좌표와 완전히
            동일합니다 — GazeCursor 보간 효과가 측정되지 않는 세션입니다(마우스로
            느리게/적게 움직인 샌드박스 세션에서 EASE 보간이 200ms 샘플링 간격
            안에 완전히 수렴해 버린 경우가 흔한 원인). 오차/jitter/SNR 비교
            지표는 참고만 하세요.
          </div>
        )}

        {filteredSessions.length === 0 ? (
          <p className="analysis-empty">조건에 맞는 세션이 없습니다.</p>
        ) : (
          <div className="analysis-session-list">
            {filteredSessions
              .slice()
              .reverse()
              .map((b) => {
                const isLive = !b.session.end_time
                const isDegenerate = degenerateSessionIds.has(b.session.session_id)
                return (
                  <button
                    key={b.session.session_id}
                    className={`analysis-session-item ${
                      selectedSessionId === b.session.session_id ? 'active' : ''
                    }`}
                    onClick={() => setSelectedSessionId(b.session.session_id)}
                  >
                    <span className="session-id">{b.session.session_id.slice(-10)}</span>
                    <span className="session-time">
                      {formatTimestamp(b.session.start_time)}
                    </span>
                    <span
                      className={`session-badge ${
                        b.session.source === 'debug' ? 'err' : 'ok'
                      }`}
                    >
                      {sessionLabel(b.session)}
                    </span>
                    <span className="session-meta">
                      {b.gazeData.length} samples
                      {isDegenerate ? ' ⚠' : ''}
                    </span>
                    <span className={`session-meta ${isLive ? 'session-live-text' : ''}`}>
                      {isLive ? '🔴 진행 중' : '종료'}
                    </span>
                  </button>
                )
              })}
          </div>
        )}
      </section>

      <section className="analysis-section">
        <div className="analysis-section-header-row">
          <h3>페이지별 집계</h3>
          {aggregates.length > 0 && (
            <button className="analysis-upload-btn" onClick={handleExportAggCsv}>
              CSV 다운로드 (페이지 집계)
            </button>
          )}
        </div>
        {aggregates.length === 0 ? (
          <p className="analysis-empty">선택된 세션에 기록된 시선 데이터가 없습니다.</p>
        ) : (
          <>
            <div className="analysis-table-wrap analysis-mt-10">
              <table className="analysis-table">
                <thead>
                  <tr>
                    <th className="th-sortable" onClick={() => handleAggSort('page_number')}>
                      {AGG_SORT_LABEL.page_number}{aggSortArrow('page_number')}
                    </th>
                    <th className="th-sortable" onClick={() => handleAggSort('count')}>
                      {AGG_SORT_LABEL.count}{aggSortArrow('count')}
                    </th>
                    <th className="th-sortable" onClick={() => handleAggSort('avg_offset_px')}>
                      {AGG_SORT_LABEL.avg_offset_px}{aggSortArrow('avg_offset_px')}
                    </th>
                    <th className="th-sortable" onClick={() => handleAggSort('max_offset_px')}>
                      {AGG_SORT_LABEL.max_offset_px}{aggSortArrow('max_offset_px')}
                    </th>
                    <th className="th-sortable" onClick={() => handleAggSort('avg_confidence')}>
                      {AGG_SORT_LABEL.avg_confidence}{aggSortArrow('avg_confidence')}
                    </th>
                    <th className="th-sortable" onClick={() => handleAggSort('avg_stability')}>
                      {AGG_SORT_LABEL.avg_stability}{aggSortArrow('avg_stability')}
                    </th>
                    <th className="th-sortable" onClick={() => handleAggSort('fixation_ratio')}>
                      {AGG_SORT_LABEL.fixation_ratio}{aggSortArrow('fixation_ratio')}
                    </th>
                    <th
                      className="th-sortable"
                      onClick={() => handleAggSort('avg_cursor_jitter_px')}
                    >
                      {AGG_SORT_LABEL.avg_cursor_jitter_px}
                      {aggSortArrow('avg_cursor_jitter_px')}
                    </th>
                    <th>gaze jitter(px)</th>
                    <th className="th-sortable" onClick={() => handleAggSort('snr_db')}>
                      {AGG_SORT_LABEL.snr_db}{aggSortArrow('snr_db')}
                    </th>
                    <th>카메라 SNR(dB)</th>
                    <th
                      className="th-sortable"
                      onClick={() => handleAggSort('snr_improvement_db')}
                    >
                      {AGG_SORT_LABEL.snr_improvement_db}
                      {aggSortArrow('snr_improvement_db')}
                    </th>
                    <th>최소 민감도(px)</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAggregates.map((a) => {
                    const sev = offsetSeverity(a.avg_offset_px)
                    return (
                      <tr
                        key={a.page_number}
                        className={`row-clickable${selectedPage === a.page_number ? ' row-selected' : ''}`}
                        onClick={() => setSelectedPage(a.page_number)}
                      >
                        <td>{a.page_number}</td>
                        <td>{a.count}</td>
                        <td className={SEVERITY_CLASS[sev]}>{a.avg_offset_px.toFixed(1)}</td>
                        <td>{a.max_offset_px.toFixed(1)}</td>
                        <td>{a.avg_confidence.toFixed(2)}</td>
                        <td>{a.avg_stability.toFixed(2)}</td>
                        <td>{(a.fixation_ratio * 100).toFixed(0)}%</td>
                        <td>{a.avg_cursor_jitter_px.toFixed(2)}</td>
                        <td>{a.avg_gaze_jitter_px.toFixed(2)}</td>
                        <td>{a.snr_db !== null ? a.snr_db.toFixed(1) : '-'}</td>
                        <td>{a.camera_snr_db !== null ? a.camera_snr_db.toFixed(1) : '-'}</td>
                        <td
                          className={
                            a.snr_improvement_db !== null && a.snr_improvement_db <= 0.5
                              ? 'cell-sev-2'
                              : ''
                          }
                        >
                          {a.snr_improvement_db !== null ? a.snr_improvement_db.toFixed(1) : '-'}
                        </td>
                        <td>
                          {a.min_sensitivity_px !== null ? a.min_sensitivity_px.toFixed(1) : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="analysis-section">
        <h3>경로 시각화 {selectedPage !== null ? `(Page ${selectedPage})` : ''}</h3>
        <p className="analysis-hint">
          위 표에서 행을 클릭하면 해당 페이지의 경로가 표시됩니다. 연한 빨간 선이
          raw gaze(원본 신호), 파란 선이 실제 화면에 그려진 cursor 경로입니다.
        </p>
        {svgPaths ? (
          <div className="analysis-svg-wrap">
            <div className="chart-pill-row">
              <span className="chart-pill tone-primary">경로</span>
            </div>
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              width="100%"
              height="380"
              className="analysis-svg"
            >
              <rect
                x="0"
                y="0"
                width={VIEW_W}
                height={VIEW_H}
                fill="none"
                stroke="rgba(128,128,128,0.2)"
              />
              <path
                d={svgPaths.gazePath}
                fill="none"
                stroke="#ff9b9b"
                strokeWidth="1.5"
                opacity="0.8"
              />
              <path
                d={svgPaths.cursorPath}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth="1.5"
                opacity="0.8"
              />
            </svg>
            <div className="analysis-legend">
              <span className="legend-item">
                <span className="legend-dot legend-dot--raw" />
                raw gaze
              </span>
              <span className="legend-item">
                <span className="legend-dot legend-dot--cursor" />
                displayed cursor
              </span>
            </div>
          </div>
        ) : (
          <p className="analysis-empty">선택된 페이지의 데이터가 없습니다.</p>
        )}
      </section>

      <section className="analysis-section">
        <h3>Jitter 타임라인 {selectedPage !== null ? `(Page ${selectedPage})` : ''}</h3>
        <p className="analysis-hint">
          fixation 중인(시선이 멈춰있어야 할) 연속 샘플 사이의 프레임 간 이동거리만
          모은 그래프입니다. 값이 0에 가까울수록 안정적이고, 튀는 구간이 많을수록
          흔들림(jitter)이 큽니다.
        </p>
        {jitterChart ? (
          <div className="analysis-svg-wrap">
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              width="100%"
              height="200"
              className="analysis-svg"
            >
              <rect
                x="0"
                y="0"
                width={VIEW_W}
                height={VIEW_H}
                fill="none"
                stroke="rgba(128,128,128,0.2)"
              />
              <path
                d={jitterChart.gazePath}
                fill="none"
                stroke="#ff9b9b"
                strokeWidth="1.5"
                opacity="0.8"
              />
              <path
                d={jitterChart.cursorPath}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth="1.5"
                opacity="0.8"
              />
            </svg>
            <div className="analysis-legend">
              <span className="legend-item">
                <span className="legend-dot legend-dot--raw" />
                raw gaze jitter (max {jitterChart.maxJitter.toFixed(1)}px)
              </span>
              <span className="legend-item">
                <span className="legend-dot legend-dot--cursor" />
                cursor jitter
              </span>
            </div>
          </div>
        ) : (
          <p className="analysis-empty">
            이 페이지에는 연속된 fixation 샘플이 없어 jitter를 계산할 수 없습니다.
          </p>
        )}
      </section>

      <section className="analysis-section">
        <h3>Fixation 임계값 진단 (선택된 세션 전체)</h3>
        <p className="analysis-hint">
          is_fixation 판정은 stabilityScore &gt; 0.5라는 단일 임계값으로 결정되며,
          이 값은 GazeCursor dwell 등 다른 기능과도 공유되는 파이프라인 상수라
          분석 페이지에서 바꾸지 않습니다. 대신 stabilityScore가 실제로 어떻게
          분포돼 있는지를 보여줘, fixation 비율이 낮게 나오는 원인이 "임계값
          근처에 샘플이 몰려 작은 노이즈로도 판정이 쉽게 뒤집히는 것"인지
          판단할 수 있게 합니다.
        </p>
        {samples.length === 0 ? (
          <p className="analysis-empty">선택된 세션에 데이터가 없습니다.</p>
        ) : (
          <>
            <div className="analysis-summary-row analysis-mb-12">
              <div className="analysis-summary-card">
                <span className="summary-key">현재 Fixation 비율</span>
                <span className="summary-val">
                  {overallFixationRatio !== null ? `${(overallFixationRatio * 100).toFixed(1)}%` : '-'}
                </span>
              </div>
              <div className="analysis-summary-card">
                <span className="summary-key">0.5 경계 근접 비율 (0.4~0.6)</span>
                <span className="summary-val">
                  {nearThresholdRatio !== null ? `${(nearThresholdRatio * 100).toFixed(1)}%` : '-'}
                </span>
              </div>
            </div>
            {nearThresholdRatio !== null && nearThresholdRatio > 0.2 && (
              <p className="analysis-outlier-banner">
                stabilityScore 샘플 중 {(nearThresholdRatio * 100).toFixed(1)}%가 0.5 임계값
                ±0.1 범위에 몰려 있습니다. 이 비중이 크면 fixation 비율이 실제 응시
                안정성보다는 임계값 근처의 작은 노이즈에 더 좌우될 수 있습니다.
              </p>
            )}
            <div className="bar-chart">
              <div className="chart-pill-row">
                <span className="chart-pill tone-primary">stabilityScore 분포</span>
              </div>
              {stabilityHistogram.map((count, i) => {
                const rangeLow = (i / STABILITY_BUCKET_COUNT).toFixed(1)
                const rangeHigh = ((i + 1) / STABILITY_BUCKET_COUNT).toFixed(1)
                const crossesThreshold = i === 5 // 0.5~0.6 구간 (임계값 바로 위)
                return (
                  <div className="bar-chart-row" key={i}>
                    <span className="bar-chart-label">{rangeLow}-{rangeHigh}</span>
                    <div className="bar-chart-track">
                      <div
                        className={`bar-chart-fill ${crossesThreshold ? 'histogram-tone-warn' : 'histogram-tone'}`}
                        style={
                          {
                            '--bar-width': `${(count / stabilityHistogramMax) * 100}%`,
                          } as CSSProperties
                        }
                      />
                    </div>
                    <span className="bar-chart-value">{count}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export default CursorAnalysisLayout

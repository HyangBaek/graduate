// src/presentation/layouts/CalibrationAnalysisLayout.tsx
// 캘리브레이션 결과 분석 페이지 (디버그 메뉴 전용)
// - calibrationLogger.exportJson()의 세션 히스토리(최대 20개)를 읽어
//   "점(point_index)별로 어떤 게이트가 가장 많이 막았는지", "forceProgress가
//   얼마나 자주 발동했는지"를 집계해 보여준다.
// - 매번 JSON을 받아 직접 해석해 달라고 요청하지 않아도 되도록, 요약 화면을 제공.
// - 추가 기능: quality 추이 차트, 게이트 실패 분포 차트, 강제진행 바 차트,
//   이상치(완료인데 quality 0) 강조, 값 크기별 색상 단계, 표 정렬, 세션 필터,
//   세션 비교 뷰, CSV 내보내기.

import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { useAppRouter } from '@/app/router/useAppRouter'
import { calibrationLogger } from '@/infrastructure/storage/CalibrationLoggerImpl'
import type {
  CalibrationSessionLog,
  CalibrationPointLog,
} from '@/domain/models/CalibrationLog'
import '@/presentation/styles/AnalysisLayout.css'

/**
 * 여러 세션에서 동일한 캘리브레이션 점(point_index)에 대한 기록을
 * 모아 집계한 통계.
 * @property point_index 캘리브레이션 점 번호
 * @property attempts 이 점에 대한 총 시도(샘플) 횟수
 * @property avg_duration_ms 평균 소요 시간(ms)
 * @property force_progress_count 강제진행(forceProgress)이 발동한 횟수
 * @property gate_fail_totals 게이트별(edge/confidence/distance/stability) 실패 누적 횟수
 * @property avg_final_confidence 평균 최종 신뢰도
 * @property avg_final_stability_score 평균 최종 안정성 점수
 * @property avg_final_distance 평균 최종 거리(px)
 */
interface PointAggregate {
  point_index: number
  attempts: number
  avg_duration_ms: number
  force_progress_count: number
  gate_fail_totals: {
    edge: number
    confidence: number
    distance: number
    stability: number
  }
  avg_final_confidence: number
  avg_final_stability_score: number
  avg_final_distance: number
}

/**
 * 여러 캘리브레이션 세션 로그를 점(point_index) 기준으로 모아 평균/합계
 * 통계를 계산한다.
 * @param sessions 집계할 캘리브레이션 세션 로그 배열
 * @returns point_index 오름차순으로 정렬된 PointAggregate 배열
 */
function aggregateByPoint(sessions: CalibrationSessionLog[]): PointAggregate[] {
  const map = new Map<number, CalibrationPointLog[]>()

  for (const session of sessions) {
    for (const point of session.points) {
      const list = map.get(point.point_index) ?? []
      list.push(point)
      map.set(point.point_index, list)
    }
  }

  const result: PointAggregate[] = []
  for (const [point_index, points] of map.entries()) {
    const n = points.length
    const sum = (f: (p: CalibrationPointLog) => number) =>
      points.reduce((acc, p) => acc + f(p), 0)

    result.push({
      point_index,
      attempts: n,
      avg_duration_ms: sum((p) => p.duration_ms) / n,
      force_progress_count: points.filter((p) => p.force_progress).length,
      gate_fail_totals: {
        edge: sum((p) => p.gate_fail_counts.edge),
        confidence: sum((p) => p.gate_fail_counts.confidence),
        distance: sum((p) => p.gate_fail_counts.distance),
        stability: sum((p) => p.gate_fail_counts.stability),
      },
      avg_final_confidence: sum((p) => p.final_confidence) / n,
      avg_final_stability_score: sum((p) => p.final_stability_score) / n,
      avg_final_distance: sum((p) => p.final_distance) / n,
    })
  }

  return result.sort((a, b) => a.point_index - b.point_index)
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

/**
 * 게이트별 실패 누적 횟수 중 가장 많이 실패한 게이트 이름을 반환한다.
 * @param totals 게이트별 실패 누적 횟수
 * @returns 가장 많이 실패한 게이트 이름, 모두 0이면 '-'
 */
function worstGate(totals: PointAggregate['gate_fail_totals']): string {
  const entries = Object.entries(totals) as [string, number][]
  const max = entries.reduce((a, b) => (b[1] > a[1] ? b : a))
  return max[1] === 0 ? '-' : max[0]
}

/**
 * 강제진행 횟수의 심각도 등급 (0=정상,1=약,2=중,3=강).
 * attempts 대비 비율로 판단해, 시도 수가 적은 점에서도 공정하게 비교한다.
 */
function forceProgressSeverity(count: number, attempts: number): 0 | 1 | 2 | 3 {
  if (count === 0) return 0
  const ratio = attempts > 0 ? count / attempts : 0
  if (ratio > 0.5) return 3
  if (ratio > 0.2) return 2
  return 1
}

/** 게이트 실패 프레임 수의 심각도 등급 — 절대값 기준 3단계 */
function gateFailSeverity(count: number): 0 | 1 | 2 | 3 {
  if (count === 0) return 0
  if (count >= 300) return 3
  if (count >= 100) return 2
  return 1
}

const SEVERITY_CLASS: Record<0 | 1 | 2 | 3, string> = {
  0: '',
  1: 'cell-sev-1',
  2: 'cell-sev-2',
  3: 'cell-sev-3',
}

/** CSV 다운로드 헬퍼 — 쉼표/줄바꿈/쌍따옴표가 섞여도 안전하게 escape */
function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
): void {
  const escape = (v: string | number): string => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    headers.map(escape).join(','),
    ...rows.map((r) => r.map(escape).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 업로드한 JSON에서 세션 배열을 추출.
 * calibrationLogger.exportJson()의 형태({ sessions: [...] })와, 누군가 sessions
 * 배열만 따로 저장한 경우([...]) 둘 다 허용한다. 형태가 다르면 null을 반환.
 */
function parseUploadedSessions(raw: unknown): CalibrationSessionLog[] | null {
  const candidate = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).sessions)
      ? (raw as any).sessions
      : null

  if (!candidate) return null

  const isValid = candidate.every(
    (s: any) =>
      s &&
      typeof s.session_id === 'string' &&
      Array.isArray(s.points),
  )

  return isValid ? (candidate as CalibrationSessionLog[]) : null
}

/** 이 기기(localStorage)에서 읽은 원본 세션 목록 — "초기화"로 되돌아갈 기준점 */
function loadDeviceSessions(): CalibrationSessionLog[] {
  try {
    const parsed = JSON.parse(calibrationLogger.exportJson())
    return Array.isArray(parsed.sessions) ? parsed.sessions : []
  } catch {
    return []
  }
}

type SortKey =
  | 'point_index'
  | 'attempts'
  | 'avg_duration_ms'
  | 'force_progress_count'
  | 'avg_final_confidence'
  | 'avg_final_stability_score'
  | 'avg_final_distance'
type SortDir = 'asc' | 'desc'

const SORT_LABEL: Record<SortKey, string> = {
  point_index: 'Point',
  attempts: '시도 수',
  avg_duration_ms: '평균 소요(ms)',
  force_progress_count: '강제진행 횟수',
  avg_final_confidence: 'avg conf',
  avg_final_stability_score: 'avg stab',
  avg_final_distance: 'avg dist(px)',
}

const VIEW_W = 600
const VIEW_H = 160
const PADDING = 20

/**
 * 캘리브레이션 결과 분석 페이지(디버그 메뉴 전용).
 * 기기에 저장된(또는 업로드한) 캘리브레이션 세션 로그를 점별로 집계해
 * 어떤 게이트가 가장 자주 막았는지, forceProgress가 얼마나 자주
 * 발동했는지를 표/차트로 보여준다. quality 추이, 게이트 실패 분포,
 * 강제진행 막대 차트, 이상치 강조, 표 정렬, 세션 비교, CSV/JSON
 * 업로드·내보내기 기능을 포함한다.
 *
 * @returns 캘리브레이션 분석 결과를 보여주는 페이지 레이아웃 div
 */
export function CalibrationAnalysisLayout() {
  const navigate = useAppRouter((s) => s.navigate)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const deviceSessionsRef = useRef<CalibrationSessionLog[]>(loadDeviceSessions())
  const [sessions, setSessions] = useState<CalibrationSessionLog[]>(
    deviceSessionsRef.current,
  )
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploadError(null)
    try {
      const text = await file.text()
      const parsed = parseUploadedSessions(JSON.parse(text))
      if (!parsed) {
        setUploadError('캘리브레이션 로그 형식이 아닙니다 (sessions 배열 필요).')
        return
      }

      // 기존 세션과 합치되, 같은 session_id는 업로드한 파일 쪽으로 덮어씀
      setSessions((prev) => {
        const map = new Map(prev.map((s) => [s.session_id, s]))
        for (const s of parsed) map.set(s.session_id, s)
        return Array.from(map.values()).sort((a, b) =>
          a.started_at.localeCompare(b.started_at),
        )
      })
      setLoadedFileName(file.name)
    } catch {
      setUploadError('파일을 읽는 중 오류가 발생했습니다. JSON 형식을 확인해주세요.')
    }
  }

  const handleReset = () => {
    setSessions(deviceSessionsRef.current)
    setLoadedFileName(null)
    setUploadError(null)
  }

  const aggregates = useMemo(() => aggregateByPoint(sessions), [sessions])

  // ── 표 정렬 ──────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<SortKey>('point_index')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const sortedAggregates = useMemo(() => {
    const arr = [...aggregates]
    arr.sort((a, b) => {
      const av = sortKey === 'point_index' ? a.point_index : (a as unknown as Record<string, number>)[sortKey]
      const bv = sortKey === 'point_index' ? b.point_index : (b as unknown as Record<string, number>)[sortKey]
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return arr
  }, [aggregates, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  // ── 세션 필터 ────────────────────────────────────────────────────────
  const [filterSource, setFilterSource] = useState<'all' | 'user' | 'debug'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'cancelled'>(
    'all',
  )

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (filterSource !== 'all' && s.source !== filterSource) return false
      if (filterStatus === 'completed' && !s.completed) return false
      if (filterStatus === 'cancelled' && s.completed) return false
      return true
    })
  }, [sessions, filterSource, filterStatus])

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const selectedSession =
    sessions.find((s) => s.session_id === selectedSessionId) ?? null

  // ── 세션 비교 ────────────────────────────────────────────────────────
  const [compareMode, setCompareMode] = useState(false)
  const [compareIds, setCompareIds] = useState<string[]>([])

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
  }

  const compareA = sessions.find((s) => s.session_id === compareIds[0]) ?? null
  const compareB = sessions.find((s) => s.session_id === compareIds[1]) ?? null

  const handleSessionItemClick = (id: string) => {
    if (compareMode) {
      toggleCompare(id)
    } else {
      setSelectedSessionId((prev) => (prev === id ? null : id))
    }
  }

  const completedSessions = sessions.filter((s) => s.completed)
  const avgQuality =
    completedSessions.length > 0
      ? completedSessions.reduce((acc, s) => acc + (s.quality_score ?? 0), 0) /
        completedSessions.length
      : null

  const userSessionCount = sessions.filter((s) => s.source !== 'debug').length
  const debugSessionCount = sessions.filter((s) => s.source === 'debug').length

  // ── 이상치: 완료됐는데 quality가 0 또는 측정되지 않은 세션 ──────────────
  const outlierSessions = useMemo(
    () =>
      sessions.filter(
        (s) => s.completed && (s.quality_score === null || s.quality_score === 0),
      ),
    [sessions],
  )
  const outlierIds = useMemo(
    () => new Set(outlierSessions.map((s) => s.session_id)),
    [outlierSessions],
  )

  // ── quality 추이 차트 (시간순) ───────────────────────────────────────
  const qualityTrend = useMemo(() => {
    const chronological = [...sessions].sort((a, b) =>
      a.started_at.localeCompare(b.started_at),
    )
    return chronological.map((s, i) => ({
      index: i,
      quality: s.quality_score,
      completed: s.completed,
      sessionId: s.session_id,
    }))
  }, [sessions])

  const qualityChart = useMemo(() => {
    const valid = qualityTrend.filter(
      (p): p is { index: number; quality: number; completed: boolean; sessionId: string } =>
        p.quality !== null,
    )
    if (valid.length === 0) return null
    const n = qualityTrend.length
    const maxQ = Math.max(100, ...valid.map((p) => p.quality))
    const scaleX = n > 1 ? (VIEW_W - PADDING * 2) / (n - 1) : 0
    const scaleY = (VIEW_H - PADDING * 2) / maxQ
    const barW = n > 1 ? Math.max(2, scaleX * 0.55) : 12

    // 막대: 세션별 원본 품질 점수
    const bars = valid.map((p) => ({
      x: PADDING + p.index * scaleX - barW / 2,
      y: VIEW_H - PADDING - p.quality * scaleY,
      width: barW,
      height: p.quality * scaleY,
      outlier: p.completed && p.quality === 0,
    }))

    // 추이선: 이동평균(최대 3개)으로 부드럽게 다듬은 라인
    const smoothWindow = 3
    const smoothed = valid.map((p, i) => {
      const start = Math.max(0, i - (smoothWindow - 1))
      const slice = valid.slice(start, i + 1)
      const avg = slice.reduce((sum, s) => sum + s.quality, 0) / slice.length
      return { index: p.index, value: avg }
    })

    const path = smoothed
      .map((p, i) => {
        const x = PADDING + p.index * scaleX
        const y = VIEW_H - PADDING - p.value * scaleY
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')

    const dots = valid.map((p) => ({
      x: PADDING + p.index * scaleX,
      y: VIEW_H - PADDING - p.quality * scaleY,
      outlier: p.completed && p.quality === 0,
    }))

    return { path, dots, bars, maxQ }
  }, [qualityTrend])

  // ── 게이트 실패 분포 (전체 세션 합산) ────────────────────────────────
  const gateFailTotals = useMemo(() => {
    const totals = { edge: 0, confidence: 0, distance: 0, stability: 0 }
    for (const a of aggregates) {
      totals.edge += a.gate_fail_totals.edge
      totals.confidence += a.gate_fail_totals.confidence
      totals.distance += a.gate_fail_totals.distance
      totals.stability += a.gate_fail_totals.stability
    }
    return totals
  }, [aggregates])
  const gateFailTotalSum = Object.values(gateFailTotals).reduce((a, b) => a + b, 0)
  const gateFailMax = Math.max(1, ...Object.values(gateFailTotals))

  // ── Point별 강제진행 횟수 바 차트 ────────────────────────────────────
  const forceProgressMax = Math.max(1, ...aggregates.map((a) => a.force_progress_count))

  // ── CSV 내보내기 ─────────────────────────────────────────────────────
  const handleExportPointCsv = () => {
    downloadCsv(
      'calibration_point_aggregate.csv',
      [
        'point',
        'attempts',
        'avg_duration_ms',
        'force_progress_count',
        'worst_gate',
        'edge',
        'confidence',
        'distance',
        'stability',
        'avg_conf',
        'avg_stab',
        'avg_dist_px',
      ],
      sortedAggregates.map((a) => [
        a.point_index,
        a.attempts,
        a.avg_duration_ms.toFixed(0),
        a.force_progress_count,
        worstGate(a.gate_fail_totals),
        a.gate_fail_totals.edge,
        a.gate_fail_totals.confidence,
        a.gate_fail_totals.distance,
        a.gate_fail_totals.stability,
        a.avg_final_confidence.toFixed(2),
        a.avg_final_stability_score.toFixed(2),
        a.avg_final_distance.toFixed(1),
      ]),
    )
  }

  const handleExportSessionCsv = () => {
    if (!selectedSession) return
    downloadCsv(
      `calibration_session_${selectedSession.session_id.slice(-10)}.csv`,
      [
        'point',
        'duration_ms',
        'force_progress',
        'edge',
        'confidence',
        'distance',
        'stability',
        'final_conf',
        'final_stab',
        'final_dist',
        'retry',
      ],
      selectedSession.points.map((p) => [
        p.point_index,
        p.duration_ms,
        p.force_progress ? 'YES' : '-',
        p.gate_fail_counts.edge,
        p.gate_fail_counts.confidence,
        p.gate_fail_counts.distance,
        p.gate_fail_counts.stability,
        p.final_confidence.toFixed(2),
        p.final_stability_score.toFixed(2),
        p.final_distance.toFixed(1),
        p.capture_retry_count,
      ]),
    )
  }

  const renderSessionPointTable = (session: CalibrationSessionLog) => (
    <div className="analysis-table-wrap analysis-mt-8">
      <table className="analysis-table">
        <thead>
          <tr>
            <th>Point</th>
            <th>소요(ms)</th>
            <th>강제진행</th>
            <th>edge</th>
            <th>confidence</th>
            <th>distance</th>
            <th>stability</th>
            <th>final conf</th>
            <th>final stab</th>
            <th>final dist</th>
            <th>retry</th>
          </tr>
        </thead>
        <tbody>
          {session.points.map((p) => (
            <tr key={p.point_index} className={p.force_progress ? 'row-warn' : ''}>
              <td>{p.point_index}</td>
              <td>{p.duration_ms}</td>
              <td className={p.force_progress ? 'cell-danger' : ''}>
                {p.force_progress ? 'YES' : '-'}
              </td>
              <td>{p.gate_fail_counts.edge}</td>
              <td>{p.gate_fail_counts.confidence}</td>
              <td>{p.gate_fail_counts.distance}</td>
              <td>{p.gate_fail_counts.stability}</td>
              <td>{p.final_confidence.toFixed(2)}</td>
              <td>{p.final_stability_score.toFixed(2)}</td>
              <td>{p.final_distance.toFixed(1)}</td>
              <td>{p.capture_retry_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="analysis-layout">
      <div className="analysis-header">
        <button className="analysis-back-btn" onClick={() => navigate('debug')}>
          ← 디버그로
        </button>
        <h2>캘리브레이션 결과 분석</h2>
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
            onClick={() => calibrationLogger.downloadJson()}
          >
            JSON 다운로드
          </button>
          <button className="analysis-upload-btn" onClick={handleExportPointCsv}>
            CSV 다운로드 (Point 집계)
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
          <span className="summary-key">완료된 세션</span>
          <span className="summary-val">{completedSessions.length}</span>
        </div>
        <div className="analysis-summary-card">
          <span className="summary-key">사용자 / 디버그</span>
          <span className="summary-val analysis-fs-16">
            {userSessionCount} / {debugSessionCount}
          </span>
        </div>
        <div className="analysis-summary-card">
          <span className="summary-key">평균 품질 점수</span>
          <span className="summary-val">
            {avgQuality !== null ? avgQuality.toFixed(1) : '-'}
          </span>
        </div>
        <div className="analysis-summary-card">
          <span className="summary-key">이상치 세션</span>
          <span
            className={`summary-val${outlierSessions.length > 0 ? ' summary-val--danger' : ''}`}
          >
            {outlierSessions.length}
          </span>
        </div>
      </div>

      {outlierSessions.length > 0 && (
        <div className="analysis-outlier-banner">
          완료된 세션 중 품질 점수가 0이거나 측정되지 않은 세션이{' '}
          {outlierSessions.length}개 있습니다 (
          {outlierSessions.map((s) => s.session_id.slice(-10)).join(', ')}). 측정
          로직 또는 데이터 수집 문제일 수 있어 우선 확인이 필요합니다.
        </div>
      )}

      {qualityChart && (
        <section className="analysis-section">
          <h3>품질 점수 추이 (시간순)</h3>
          <p className="analysis-hint">
            세션이 진행될수록 캘리브레이션 품질이 좋아지는지 확인합니다. 빨간 점은
            완료됐지만 품질이 0인 이상치 세션입니다.
          </p>
          <div className="chart-card">
            <div className="chart-pill-row">
              <span className="chart-pill tone-primary">품질 점수</span>
            </div>
            <div className="chart-axis-labels">
              <span>{Math.round(qualityChart.maxQ)}</span>
              <span>0</span>
            </div>
            <div className="analysis-svg-wrap">
              <svg
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                width="100%"
                height="160"
                className="analysis-svg"
              >
                <line
                  x1={PADDING}
                  y1={VIEW_H - PADDING}
                  x2={VIEW_W - PADDING}
                  y2={VIEW_H - PADDING}
                  className="chart-grid-line"
                />
                {qualityChart.bars.map((b, i) => (
                  <rect
                    key={i}
                    x={b.x}
                    y={b.y}
                    width={b.width}
                    height={Math.max(b.height, 0.5)}
                    className={`chart-bar${b.outlier ? ' tone-warn' : ''}`}
                  />
                ))}
                <path d={qualityChart.path} className="chart-trend-line" />
                {qualityChart.dots
                  .filter((d) => d.outlier)
                  .map((d, i) => (
                    <circle key={i} cx={d.x} cy={d.y} r={4} className="chart-trend-dot" />
                  ))}
              </svg>
            </div>
          </div>
        </section>
      )}

      <section className="analysis-section">
        <h3>점(Point)별 집계 — 어떤 점/게이트가 가장 자주 문제였는지</h3>
        {aggregates.length === 0 ? (
          <p className="analysis-empty">기록된 캘리브레이션 데이터가 없습니다.</p>
        ) : (
          <>
            <div className="bar-chart">
              <div className="chart-pill-row">
                <span className="chart-pill tone-warn">강제진행 횟수</span>
              </div>
              <p className="analysis-hint analysis-mt-0">
                Point별 강제진행 횟수 (시도 수 대비 — 높을수록 정상 게이트로 통과하지
                못하고 9초 안전장치로 넘어간 비율이 큼)
              </p>
              {sortedAggregates.map((a) => {
                const sev = forceProgressSeverity(a.force_progress_count, a.attempts)
                return (
                  <div className="bar-chart-row" key={a.point_index}>
                    <span className="bar-chart-label">P{a.point_index}</span>
                    <div className="bar-chart-track">
                      <div
                        className={`bar-chart-fill ${SEVERITY_CLASS[sev]}`}
                        style={
                          {
                            '--bar-width': `${(a.force_progress_count / forceProgressMax) * 100}%`,
                          } as CSSProperties
                        }
                      />
                    </div>
                    <span className="bar-chart-value">
                      {a.force_progress_count}/{a.attempts}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="analysis-table-wrap analysis-mt-16">
              <table className="analysis-table">
                <thead>
                  <tr>
                    {(
                      [
                        'point_index',
                        'attempts',
                        'avg_duration_ms',
                        'force_progress_count',
                      ] as SortKey[]
                    ).map((key) => (
                      <th
                        key={key}
                        className="th-sortable"
                        onClick={() => handleSort(key)}
                      >
                        {SORT_LABEL[key]}
                        {sortArrow(key)}
                      </th>
                    ))}
                    <th>최다 실패 게이트</th>
                    <th>edge</th>
                    <th>confidence</th>
                    <th>distance</th>
                    <th>stability</th>
                    {(
                      [
                        'avg_final_confidence',
                        'avg_final_stability_score',
                        'avg_final_distance',
                      ] as SortKey[]
                    ).map((key) => (
                      <th
                        key={key}
                        className="th-sortable"
                        onClick={() => handleSort(key)}
                      >
                        {SORT_LABEL[key]}
                        {sortArrow(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedAggregates.map((a) => {
                    const forceSev = forceProgressSeverity(a.force_progress_count, a.attempts)
                    return (
                      <tr key={a.point_index} className={forceSev > 0 ? 'row-warn' : ''}>
                        <td>{a.point_index}</td>
                        <td>{a.attempts}</td>
                        <td>{a.avg_duration_ms.toFixed(0)}</td>
                        <td className={SEVERITY_CLASS[forceSev]}>
                          {a.force_progress_count}
                        </td>
                        <td className="cell-strong">{worstGate(a.gate_fail_totals)}</td>
                        <td className={SEVERITY_CLASS[gateFailSeverity(a.gate_fail_totals.edge)]}>
                          {a.gate_fail_totals.edge}
                        </td>
                        <td className={SEVERITY_CLASS[gateFailSeverity(a.gate_fail_totals.confidence)]}>
                          {a.gate_fail_totals.confidence}
                        </td>
                        <td className={SEVERITY_CLASS[gateFailSeverity(a.gate_fail_totals.distance)]}>
                          {a.gate_fail_totals.distance}
                        </td>
                        <td className={SEVERITY_CLASS[gateFailSeverity(a.gate_fail_totals.stability)]}>
                          {a.gate_fail_totals.stability}
                        </td>
                        <td>{a.avg_final_confidence.toFixed(2)}</td>
                        <td>{a.avg_final_stability_score.toFixed(2)}</td>
                        <td>{a.avg_final_distance.toFixed(1)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {gateFailTotalSum > 0 && (
        <section className="analysis-section">
          <h3>게이트 실패 분포 (전체 세션 합산)</h3>
          <p className="analysis-hint">
            어떤 게이트가 전체적으로 가장 자주 캘리브레이션을 막았는지 보여줍니다.
          </p>
          <div className="bar-chart">
            <div className="chart-pill-row">
              <span className="chart-pill tone-primary">게이트 실패 분포</span>
            </div>
            {(Object.entries(gateFailTotals) as [string, number][]).map(([gate, count]) => (
              <div className="bar-chart-row" key={gate}>
                <span className="bar-chart-label">{gate}</span>
                <div className="bar-chart-track">
                  <div
                    className={`bar-chart-fill ${SEVERITY_CLASS[gateFailSeverity(count)]}`}
                    style={{ '--bar-width': `${(count / gateFailMax) * 100}%` } as CSSProperties}
                  />
                </div>
                <span className="bar-chart-value">
                  {count} ({((count / gateFailTotalSum) * 100).toFixed(0)}%)
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="analysis-section">
        <div className="analysis-filter-row">
          <h3 className="analysis-m-0">세션별 상세</h3>
          <select
            className="filter-select"
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value as typeof filterSource)}
          >
            <option value="all">전체 출처</option>
            <option value="user">사용자</option>
            <option value="debug">디버그</option>
          </select>
          <select
            className="filter-select"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
          >
            <option value="all">전체 상태</option>
            <option value="completed">완료</option>
            <option value="cancelled">취소</option>
          </select>
          <button
            className={`compare-toggle-btn ${compareMode ? 'active' : ''}`}
            onClick={() => {
              setCompareMode((v) => !v)
              setCompareIds([])
            }}
          >
            {compareMode ? '비교 모드 종료' : '세션 비교'}
          </button>
          {compareMode && (
            <span className="analysis-upload-status">
              비교할 세션 2개를 선택하세요 ({compareIds.length}/2)
            </span>
          )}
        </div>

        {filteredSessions.length === 0 ? (
          <p className="analysis-empty">조건에 맞는 세션이 없습니다.</p>
        ) : (
          <div className="analysis-session-list">
            {filteredSessions
              .slice()
              .reverse()
              .map((s) => (
                <button
                  key={s.session_id}
                  className={`analysis-session-item calibration-session-row ${
                    !compareMode && selectedSessionId === s.session_id ? 'active' : ''
                  } ${compareMode && compareIds.includes(s.session_id) ? 'compare-selected' : ''}`}
                  onClick={() => handleSessionItemClick(s.session_id)}
                >
                  <span className="session-id">{s.session_id.slice(-10)}</span>
                  <span className="session-time">{formatTimestamp(s.started_at)}</span>
                  <span
                    className={`session-badge ${s.source === 'debug' ? 'err' : 'ok'}`}
                  >
                    {s.source === 'debug' ? '디버그' : '사용자'}
                  </span>
                  <span className={`session-badge ${s.completed ? 'ok' : 'err'}`}>
                    {s.completed ? '완료' : '취소'}
                  </span>
                  <span
                    className={`session-badge warn${outlierIds.has(s.session_id) ? '' : ' analysis-invisible'}`}
                  >
                    이상치
                  </span>
                  <span className="session-meta">
                    {s.points.length}/{s.total_points} pts
                  </span>
                  <span className="session-meta">
                    quality {s.quality_score?.toFixed(1) ?? '-'}
                  </span>
                </button>
              ))}
          </div>
        )}

        {!compareMode && selectedSession && (
          <>
            <div className="analysis-filter-row analysis-mt-12">
              <span className="analysis-hint analysis-m-0">
                선택된 세션: {selectedSession.session_id.slice(-10)}
              </span>
              <button className="analysis-upload-btn" onClick={handleExportSessionCsv}>
                CSV 다운로드 (세션 상세)
              </button>
            </div>
            {renderSessionPointTable(selectedSession)}
          </>
        )}

        {compareMode && compareA && compareB && (
          <div className="compare-grid analysis-mt-16">
            <div className="compare-col">
              <div className="analysis-summary-card">
                <span className="summary-key">세션 A — {compareA.session_id.slice(-10)}</span>
                <span className="summary-val analysis-fs-16">
                  quality {compareA.quality_score?.toFixed(1) ?? '-'}
                </span>
              </div>
              {renderSessionPointTable(compareA)}
            </div>
            <div className="compare-col">
              <div className="analysis-summary-card">
                <span className="summary-key">세션 B — {compareB.session_id.slice(-10)}</span>
                <span className="summary-val analysis-fs-16">
                  quality {compareB.quality_score?.toFixed(1) ?? '-'}
                </span>
              </div>
              {renderSessionPointTable(compareB)}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default CalibrationAnalysisLayout

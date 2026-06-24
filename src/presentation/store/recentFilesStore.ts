// src/presentation/store/recentFilesStore.ts
// 최근 열람 파일 목록 (localStorage 연동, 최대 5개)
//
// ── 썸네일 영속화 전략 ───────────────────────────────────────────────────────
//  메인 키(eyescore_recent_files): thumbnail 제외 → 매 lastPage 갱신 시 직렬화 비용 최소
//  썸네일 키(eyescore_thumbnails): name→base64 맵으로 별도 저장
//    → 썸네일 생성 시에만 write (빈도 낮음)
//    → 앱 시작 시 두 키를 읽어 머지 → 세션 간 썸네일 유지
//
// ── 최적화 ──────────────────────────────────────────────────────────────────
//  updateFileThumbnail: eyescore_thumbnails 키에만 write (메인 200KB 직렬화 없음)
//  addFile / updateLastPage 등: 메인 키만 write (thumbnail 없는 slim 배열)

import { create } from 'zustand'

export interface RecentFile {
  /** 파일 이름 */
  name: string
  /** Object URL 또는 파일 경로 (재오픈용) */
  url: string
  /** 열람 시각 (ISO 8601) */
  openedAt: string
  /** 총 페이지 수 */
  totalPages: number
  /** 마지막으로 본 페이지 */
  lastPage: number
  /** 첫 페이지의 base64 썸네일 이미지 (선택사항) */
  thumbnail?: string
}

const STORAGE_KEY   = 'eyescore_recent_files'
const THUMBNAIL_KEY = 'eyescore_thumbnails'
const MAX_RECENT = 5

// ── 썸네일 맵 헬퍼 ───────────────────────────────────────────────────────────
/**
 * localStorage(THUMBNAIL_KEY)에서 파일명→썸네일(base64) 맵을 읽어온다.
 * @returns 파일명을 키로 하는 썸네일 맵, 파싱 실패 시 빈 객체
 */
function loadThumbnailMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(THUMBNAIL_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/**
 * 파일명→썸네일 맵을 localStorage(THUMBNAIL_KEY)에 저장한다.
 * @param map 저장할 썸네일 맵
 * @throws 저장 공간이 가득 차면 예외가 발생할 수 있으나 내부에서 잡아 무시한다.
 */
function saveThumbnailMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(THUMBNAIL_KEY, JSON.stringify(map))
  } catch {
    // storage full — skip
  }
}

// ── 메인 파일 목록 헬퍼 ──────────────────────────────────────────────────────
/**
 * localStorage(STORAGE_KEY)에서 최근 파일 목록을 읽고, 별도 저장된 썸네일 맵을 머지한다.
 * @returns 썸네일이 병합된 최근 파일 목록, 파싱 실패 시 빈 배열
 */
function loadFromStorage(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const files = JSON.parse(raw) as RecentFile[]
    // 썸네일 맵을 읽어 각 파일에 머지
    const thumbMap = loadThumbnailMap()
    return files.map((f) => ({
      ...f,
      thumbnail: thumbMap[f.name] ?? f.thumbnail,
    }))
  } catch {
    return []
  }
}

/**
 * 최근 파일 목록을 localStorage(STORAGE_KEY)에 저장한다.
 * thumbnail 필드는 별도 THUMBNAIL_KEY에서 관리하므로 직렬화 전에 제외한다.
 * @param files 저장할 최근 파일 목록
 * @throws 저장 공간이 가득 차면 예외가 발생할 수 있으나 내부에서 잡아 무시한다.
 */
function saveToStorage(files: RecentFile[]): void {
  try {
    // thumbnail 제외: 별도 THUMBNAIL_KEY에 관리하므로 메인 배열에서 제외
    const slim = files.map(({ thumbnail: _thumb, ...rest }) => rest)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim))
  } catch {
    // storage full — skip
  }
}

/**
 * 최근 열람 파일 목록과 관련 액션을 정의하는 상태 인터페이스.
 */
interface RecentFilesState {
  files: RecentFile[]
  /** 파일 추가/업데이트 (같은 이름이면 맨 앞으로 이동) */
  addFile: (file: Omit<RecentFile, 'openedAt'>) => void
  /** 마지막 열람 페이지 업데이트 */
  updateLastPage: (name: string, page: number) => void
  /** blob URL 갱신 — IndexedDB에서 신선한 blob 생성 시 호출 */
  updateFileUrl: (name: string, url: string) => void
  /** 썸네일 갱신 — state + eyescore_thumbnails 키에 저장 */
  updateFileThumbnail: (name: string, thumbnail: string) => void
  /** 파일 삭제 */
  removeFile: (name: string) => void
  /** 전체 삭제 */
  clearAll: () => void
}

/**
 * 최근 열람 PDF 파일 목록(최대 MAX_RECENT개)을 관리하는 Zustand 스토어.
 * 파일 목록과 썸네일을 별도의 localStorage 키로 분리 저장해 직렬화 비용을 최소화한다.
 */
export const useRecentFilesStore = create<RecentFilesState>((set) => ({
  files: loadFromStorage(),

  // 동일 파일명이 있으면 제거 후 맨 앞에 추가, 기존 썸네일은 보존, MAX_RECENT개로 제한
  addFile: (file) => {
    set((state) => {
      // 동일 파일명 제거 후 맨 앞에 추가
      // 기존 썸네일 보존: 이미 state에 있던 thumbnail 유지
      const existing = state.files.find((f) => f.name === file.name)
      const filtered = state.files.filter((f) => f.name !== file.name)
      const updated: RecentFile[] = [
        {
          ...file,
          openedAt: new Date().toISOString(),
          thumbnail: file.thumbnail ?? existing?.thumbnail,
        },
        ...filtered,
      ].slice(0, MAX_RECENT)

      saveToStorage(updated)
      return { files: updated }
    })
  },

  updateLastPage: (name, page) => {
    set((state) => {
      const updated = state.files.map((f) =>
        f.name === name ? { ...f, lastPage: page } : f,
      )
      saveToStorage(updated)
      return { files: updated }
    })
  },

  updateFileUrl: (name, url) => {
    set((state) => {
      const updated = state.files.map((f) =>
        f.name === name ? { ...f, url } : f,
      )
      saveToStorage(updated)
      return { files: updated }
    })
  },

  // 메인 배열을 직렬화하지 않고 THUMBNAIL_KEY에만 기록 (쓰기 비용 절감)
  updateFileThumbnail: (name, thumbnail) => {
    // 썸네일 별도 키에 영속화 (메인 배열 직렬화 없음)
    const thumbMap = loadThumbnailMap()
    thumbMap[name] = thumbnail
    saveThumbnailMap(thumbMap)

    // state 업데이트
    set((state) => ({
      files: state.files.map((f) =>
        f.name === name ? { ...f, thumbnail } : f,
      ),
    }))
  },

  removeFile: (name) => {
    // 썸네일 맵에서도 제거
    const thumbMap = loadThumbnailMap()
    delete thumbMap[name]
    saveThumbnailMap(thumbMap)

    set((state) => {
      const updated = state.files.filter((f) => f.name !== name)
      saveToStorage(updated)
      return { files: updated }
    })
  },

  clearAll: () => {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(THUMBNAIL_KEY)
    set({ files: [] })
  },
}))

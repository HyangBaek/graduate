// src/shared/utils/pdfFileStore.ts
//
// PDF 파일 데이터 저장소 (두 계층)
//
//   1. 세션 캐시 (Map) — 페이지 새로고침 전까지 메모리에 유지
//   2. IndexedDB   — 새로고침 후에도 파일 데이터를 복원 가능
//
// 사용 흐름:
//   HomeLayout.handleFileChange:
//     const buf = await file.arrayBuffer()
//     storeFile(file.name, buf)            // 세션 캐시 (동기)
//     saveFilePersistent(file.name, buf)   // IndexedDB (비동기, fire & forget)
//
//   PdfViewerPage.loadPdf (preload 미스 시 폴백):
//     const buf = await loadFile(documentName)
//     if (buf) pdf = await getDocument({ data: buf.slice(0) })
//     // blob URL을 사용하지 않으므로 ERR_FILE_NOT_FOUND 발생 없음

// ── IndexedDB 설정 ──────────────────────────────────────────────────────────
const DB_NAME = 'eyescore_pdf_files'
const STORE_NAME = 'files'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ── 세션 캐시 ────────────────────────────────────────────────────────────────
const _sessionCache = new Map<string, ArrayBuffer>()

// ── loadFile Promise dedup ───────────────────────────────────────────────────
// HomeLayout preload, openRecentFile 선점, PdfRuntime이 동시에 loadFile()을 호출하면
// IndexedDB를 중복으로 읽게 됨. 진행 중인 Promise를 캐싱해 1회 읽기로 통합.
const _loadingBuffers = new Map<string, Promise<ArrayBuffer | null>>()

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * 세션 캐시에 파일 데이터를 즉시 저장한다 (동기).
 * PdfViewerPage가 같은 세션 내에서 파일을 재사용할 때 사용.
 *
 * @param name 캐시 키로 사용할 파일 이름
 * @param buffer 저장할 파일의 ArrayBuffer
 */
export function storeFile(name: string, buffer: ArrayBuffer): void {
  _sessionCache.set(name, buffer)
}

/**
 * IndexedDB에 파일 데이터를 비동기로 저장한다.
 * 실패해도 세션 캐시는 이미 설정돼 있으므로 치명적이지 않다.
 *
 * @param name IndexedDB 저장 키로 사용할 파일 이름
 * @param buffer 저장할 파일의 ArrayBuffer
 */
export async function saveFilePersistent(name: string, buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(buffer.slice(0), name)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
    console.log('[pdfFileStore] IndexedDB 저장 완료:', name)
  } catch (err) {
    console.warn('[pdfFileStore] IndexedDB 저장 실패 (세션 캐시는 유효):', err)
  }
}

/**
 * 파일이 세션 캐시 또는 IndexedDB에 존재하는지 확인한다.
 * 실제 데이터를 읽지 않으므로 loadFile보다 훨씬 빠르다.
 *
 * @param name 확인할 파일 이름
 * @returns 존재하면 true, 아니면 false
 */
export async function fileExists(name: string): Promise<boolean> {
  if (_sessionCache.has(name)) return true
  try {
    const db = await openDB()
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).getKey(name)
      req.onsuccess = () => { db.close(); resolve(req.result !== undefined) }
      req.onerror = () => { db.close(); resolve(false) }
    })
  } catch {
    return false
  }
}

/**
 * 파일 데이터를 반환한다.
 *   1. 세션 캐시 확인 (즉시)
 *   2. 진행 중인 로딩 Promise 재사용 (dedup)
 *   3. IndexedDB 확인 (새로고침 후에도 복원 가능)
 *   4. 없으면 null
 *
 * @param name 조회할 파일 이름
 * @returns 파일의 ArrayBuffer 또는 null (어디에도 없는 경우)
 */
export async function loadFile(name: string): Promise<ArrayBuffer | null> {
  // 1. 세션 캐시 (빠른 경로)
  const cached = _sessionCache.get(name)
  if (cached) return cached

  // 2. 이미 로딩 중 → 동일 Promise 재사용 (IndexedDB 중복 읽기 방지)
  if (_loadingBuffers.has(name)) {
    return _loadingBuffers.get(name)!
  }

  // 3. IndexedDB
  const p = (async () => {
    try {
      const db = await openDB()
      const buffer = await new Promise<ArrayBuffer | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const req = tx.objectStore(STORE_NAME).get(name)
        req.onsuccess = () => { db.close(); resolve((req.result as ArrayBuffer) ?? null) }
        req.onerror = () => { db.close(); reject(req.error) }
      })
      if (buffer) {
        _sessionCache.set(name, buffer)
        console.log('[pdfFileStore] IndexedDB에서 복원:', name)
      }
      return buffer
    } catch (err) {
      console.warn('[pdfFileStore] IndexedDB 로드 실패:', err)
      return null
    } finally {
      _loadingBuffers.delete(name)
    }
  })()

  _loadingBuffers.set(name, p)
  return p
}

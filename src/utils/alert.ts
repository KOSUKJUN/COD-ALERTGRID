import {
  appendToQuery,
  buildFilterToken,
  compareValues,
  filterRecords,
  getValueByPath,
  groupCounts,
  type DataSource,
  type LogRecord,
  type SearchResult,
} from '@codvill/cod-searchgrid'
import type { HistogramBucket } from '../types'

/**
 * 로컬 배열을 COD-SEARCHGRID DataSource 프로토콜로 감싼다.
 * (원격/로컬 모두 같은 경로 → 페이징·groupBy 집계·필드 요약·히스토그램 코드가 하나)
 * 대량 배열은 markRaw/shallowRef 로 넘기면 반응형 변환 비용이 없다.
 */
export function createLocalSource(getRows: () => readonly LogRecord[]): DataSource {
  let lastKey = ''
  let lastRows: LogRecord[] = []
  let lastSrc: readonly LogRecord[] | null = null
  return async ({ query, offset, limit, sort, groupBy }) => {
    const src = getRows()
    const key = `${query}\u0000${sort?.field ?? ''}\u0000${sort?.order ?? ''}`
    if (key !== lastKey || src !== lastSrc || groupBy) {
      let rows = filterRecords(src, query)
      if (sort && !groupBy) {
        const dir = sort.order === 'asc' ? 1 : -1
        rows = rows.sort((a, b) => dir * compareValues(getValueByPath(a, sort.field), getValueByPath(b, sort.field)))
      }
      if (groupBy) {
        const groups = groupCounts(rows, groupBy, sort).slice(offset, offset + limit)
        return { rows: [], groups, total: rows.length } satisfies SearchResult
      }
      lastKey = key
      lastRows = rows
      lastSrc = src
    }
    return { rows: lastRows.slice(offset, offset + limit), total: lastRows.length }
  }
}

export function toEpoch(v: unknown): number {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (v instanceof Date) return v.getTime()
  const t = Date.parse(String(v ?? ''))
  return Number.isFinite(t) ? t : NaN
}

/** 사람이 읽기 좋은 구간 폭 (1s … 1d) 으로 맞춘다 */
const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400].map(
  (s) => s * 1000,
)
export function niceStep(spanMs: number, buckets: number): number {
  const raw = Math.max(1000, spanMs / Math.max(1, buckets))
  return NICE_STEPS.find((s) => s >= raw) ?? Math.ceil(raw / 86400000) * 86400000
}

/** 시각 배열 → 히스토그램 (min/max 는 지정 시 그 범위로 고정) */
export function bucketize(times: readonly number[], buckets = 48, min?: number, max?: number): HistogramBucket[] {
  const valid = times.filter(Number.isFinite)
  if (!valid.length) return []
  let lo = min ?? Infinity
  let hi = max ?? -Infinity
  if (min == null || max == null)
    for (const t of valid) {
      if (min == null && t < lo) lo = t
      if (max == null && t > hi) hi = t
    }
  const step = niceStep(Math.max(hi - lo, 1000), buckets)
  const start = Math.floor(lo / step) * step
  const n = Math.max(1, Math.floor((hi - start) / step) + 1)
  const out: HistogramBucket[] = Array.from({ length: n }, (_, i) => ({
    start: start + i * step,
    end: start + (i + 1) * step,
    count: 0,
  }))
  for (const t of valid) {
    const i = Math.floor((t - start) / step)
    if (i >= 0 && i < n) out[i].count++
  }
  return out
}

/** 로컬 근거 이벤트 히스토그램 */
export function localHistogram(rows: readonly LogRecord[], timeField: string, query: string, buckets = 48): HistogramBucket[] {
  return bucketize(
    filterRecords(rows, query).map((r) => toEpoch(getValueByPath(r, timeField))),
    buckets,
  )
}

/** 시간 범위 → 쿼리 토큰 (ISO 문자열은 사전순 비교로 범위 필터가 된다) */
export function timeRangeTokens(field: string, start: number, end: number): string {
  return `${buildFilterToken(field, '>=', new Date(start).toISOString())} ${buildFilterToken(field, '<', new Date(end).toISOString())}`
}

/** 쿼리에서 특정 필드의 범위 토큰 제거 */
export function stripFieldTokens(query: string, field: string): string {
  const esc = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return query
    .replace(new RegExp(`(^|\\s)${esc}(>=|<=|>|<)("[^"]*"|\\S+)`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function joinQuery(...parts: (string | undefined | null)[]): string {
  return parts.reduce<string>((q, p) => (p && p.trim() ? appendToQuery(q, p.trim()) : q), '')
}

export function asList(v: unknown): string[] {
  if (v == null || v === '') return []
  if (Array.isArray(v)) return v.map(String)
  return String(v)
    .split(/\s*,\s*/)
    .filter(Boolean)
}

const pad = (n: number) => String(n).padStart(2, '0')
export function formatTime(v: unknown): string {
  const t = toEpoch(v)
  if (!Number.isFinite(t)) return v == null ? '' : String(v)
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

let regionNames: Intl.DisplayNames | null | undefined
/**
 * 국가 코드 → 한글 국가명 (브라우저 내장 Intl.DisplayNames, 별도 표 없음).
 * 코드가 아니면(이미 국가명) 그대로 돌려준다.
 */
export function countryName(code: unknown, locale = 'ko'): string {
  const s = code == null ? '' : String(code).trim()
  if (!/^[A-Za-z]{2}$/.test(s)) return s
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames([locale], { type: 'region' })
    } catch {
      regionNames = null
    }
  }
  try {
    return regionNames?.of(s.toUpperCase()) ?? s.toUpperCase()
  } catch {
    return s.toUpperCase()
  }
}

/** 국가 코드(2글자) → 국기 이모지 (Regional Indicator). 코드가 아니면 '' */
export function flagEmoji(code: unknown): string {
  const s = code == null ? '' : String(code).trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(s)) return ''
  return String.fromCodePoint(...[...s].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

/** IP + Port → "1.2.3.4 (443)", 포트 없으면 IP 만 (IPv6 도 같은 형식) */
export function formatEndpoint(ip: unknown, port: unknown): string {
  const a = ip == null ? '' : String(ip).trim()
  const p = port == null ? '' : String(port).trim()
  if (!a) return p ? `(${p})` : ''
  return p ? `${a} (${p})` : a
}

/** 상대 시각 ("방금", "12분 전", "3시간 전", "2일 전") */
export function formatRelative(
  v: unknown,
  now: number,
  m: { justNow: string; minutesAgo: string; hoursAgo: string; daysAgo: string },
): string {
  const t = toEpoch(v)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  const fill = (msg: string, n: number) => msg.replace('{n}', String(n))
  if (s < 60) return m.justNow
  if (s < 3600) return fill(m.minutesAgo, Math.floor(s / 60))
  if (s < 86400) return fill(m.hoursAgo, Math.floor(s / 3600))
  return fill(m.daysAgo, Math.floor(s / 86400))
}

/** 짧은 시각 (같은 해면 연도 생략) */
export function formatShortTime(v: unknown): string {
  const full = formatTime(v)
  const year = String(new Date().getFullYear())
  return full.startsWith(year) ? full.slice(5) : full
}

export function formatSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}초`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}시간 ${m % 60 ? `${m % 60}분` : ''}`.trim()
  return `${Math.floor(h / 24)}일`
}

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
